const { Blob } = require('node:buffer');

const QWEN_IMAGE_MODELS = Object.freeze([
  { id: 'qwen-image-3.0-pro', label: '千问图像 3.0 Pro（推荐）' },
  { id: 'qwen-image-3.0', label: '千问图像 3.0' },
  { id: 'qwen-image-2.1-pro', label: '千问图像 2.1 Pro' },
  { id: 'qwen-image-2.1-turbo', label: '千问图像 2.1 Turbo' },
]);

function envSettings() {
  const provider = process.env.STYLECAM_PROVIDER || 'openai';
  return { provider, apiKey: process.env.STYLECAM_API_KEY || process.env.OPENAI_API_KEY || '', apiBase: process.env.STYLECAM_API_BASE || (provider === 'qwen' ? '' : 'https://api.openai.com/v1'), model: process.env.STYLECAM_IMAGE_MODEL || (provider === 'qwen' ? 'qwen-image-3.0-pro' : 'gpt-image-2') };
}

const PROVIDERS = Object.freeze({
  openai: { label: 'OpenAI 官方', base: 'https://api.openai.com/v1', kind: 'openai', imageEdit: true },
  qwen: { label: '阿里云百炼 / 千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', kind: 'qwen-image', imageEdit: true },
  doubao: { label: '火山引擎 / 豆包', base: 'https://ark.cn-beijing.volces.com/api/v3', kind: 'openai-compatible', imageEdit: false },
  kimi: { label: 'Moonshot / Kimi', base: 'https://api.moonshot.cn/v1', kind: 'openai-compatible', imageEdit: false },
  google: { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta', kind: 'google', imageEdit: false },
  custom: { label: '其他 OpenAI 兼容服务', base: '', kind: 'openai-compatible', imageEdit: false },
  codex: { label: 'Codex CLI（开发测试）', base: '', kind: 'codex', imageEdit: false },
});

function providerCatalog() { return Object.entries(PROVIDERS).map(([id, item]) => ({ id, label: item.label, base: item.base, imageEdit: item.imageEdit })); }

function normalizeModelSettings(settings = {}) {
  const next = { ...settings };
  if (next.provider === 'qwen' && !QWEN_IMAGE_MODELS.some(item => item.id === next.model)) next.model = QWEN_IMAGE_MODELS[0].id;
  return next;
}

function validateModelSettings(settings = {}) {
  if (settings.provider === 'qwen' && !QWEN_IMAGE_MODELS.some(item => item.id === settings.model)) {
    throw new Error(`当前千问模型“${settings.model || '未选择'}”不支持图像生成，请选择 ${QWEN_IMAGE_MODELS.map(item => item.id).join('、')}。`);
  }
}

function serviceStatus(settings = {}) {
  const current = { ...envSettings(), ...settings };
  const provider = PROVIDERS[current.provider] || PROVIDERS.custom;
  return { configured: Boolean(current.apiKey && current.model), hasKey: Boolean(current.apiKey), provider: current.provider || 'openai', providerLabel: provider.label, imageEdit: provider.imageEdit, model: current.model, apiBase: current.apiBase || provider.base, maskedKey: current.apiKey ? `${current.apiKey.slice(0, 4)}••••${current.apiKey.slice(-4)}` : '', providers: providerCatalog() };
}

function validateHttpsUrl(raw, label = '服务地址') {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label}不是有效的网址。`); }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error(`${label}必须使用 HTTPS。`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label}不能包含账号、密码、查询参数或片段。`);
  return url;
}

function qwenApiBase(settings = {}) {
  const raw = (settings.apiBase || PROVIDERS.qwen.base).trim().replace(/\/+$/, '');
  if (!raw) throw new Error('请检查千问 Base URL。默认地址为 https://dashscope.aliyuncs.com/compatible-mode/v1；若 Key 属于其他地域，请填写控制台对应地域地址。');
  const url = validateHttpsUrl(raw, '千问兼容模式地址');
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/images/generations')) pathname = pathname.slice(0, -'/images/generations'.length);
  if (!pathname.endsWith('/compatible-mode/v1')) {
    if (pathname === '' || pathname === '/') pathname = '/compatible-mode/v1';
    else throw new Error('千问服务地址请填写兼容模式 Base URL，例如 https://dashscope.aliyuncs.com/compatible-mode/v1。');
  }
  return `${url.origin}${pathname}`;
}

function qwenNativeEndpoint(settings = {}) {
  const base = new URL(qwenApiBase(settings));
  return `${base.origin}/api/v1/services/aigc/multimodal-generation/generation`;
}

function qwenOutputSize(width, height) {
  const imageWidth = Number(width);
  const imageHeight = Number(height);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return '1024*1024';
  const ratio = Math.min(8, Math.max(1 / 8, imageWidth / imageHeight));
  const maxSide = 1536;
  const outWidth = ratio >= 1 ? maxSide : Math.round(maxSide * ratio / 8) * 8;
  const outHeight = ratio < 1 ? maxSide : Math.round(maxSide / ratio / 8) * 8;
  return `${outWidth}*${outHeight}`;
}

function parseImageDataUrl(sourceDataUrl, maxBytes = 15 * 1024 * 1024) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(sourceDataUrl || '');
  if (!match) throw new Error('请导入 PNG、JPEG 或 WebP 图片。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw new Error(`原图必须小于 ${Math.floor(maxBytes / (1024 * 1024))} MB。`);
  return { mimeType: match[1], bytes };
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw new Error('提示词为空或过长。');
}

function parseJsonResponse(text) {
  try { return JSON.parse(text); } catch { return {}; }
}

function providerError(json, status, requestId = '') {
  if (status === 404) return new Error(`千问图像接口返回 404：请核对 Base URL 所属地域与 API Key 是否一致。${requestId ? ` 请求 ID：${requestId}` : ''}`);
  const error = json?.error || json || {};
  const code = error.code || error.type || '';
  const message = error.message || json?.message || '请检查 API Key、模型名称、地域和账户可用额度。';
  return new Error(`千问返回 ${status}${code ? `（${code}）` : ''}：${message}${requestId ? ` 请求 ID：${requestId}` : ''}`);
}

async function fetchQwenModelCatalog(current) {
  if (!current.apiKey) throw new Error('请先填写 API Key，再读取千问图片模型列表。');
  const base = qwenApiBase(current);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${current.apiKey}` }, signal: controller.signal });
    const json = parseJsonResponse(await response.text());
    const requestId = response.headers.get('x-request-id') || json.request_id || '';
    if (!response.ok) throw providerError(json, response.status, requestId);
    const availableIds = new Set((Array.isArray(json.data) ? json.data : []).map(item => item?.id).filter(id => typeof id === 'string'));
    return QWEN_IMAGE_MODELS.filter(model => availableIds.has(model.id));
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('读取千问图片模型列表超过 15 秒未完成。');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function probeQwenImageEndpoint(current) {
  const endpoint = qwenNativeEndpoint(current);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.apiKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    const requestId = response.headers.get('x-request-id') || '';
    const json = parseJsonResponse(await response.text());
    if (!response.ok && !(response.status === 400 && (json.code === 'BadRequest.EmptyModel' || /model/i.test(json?.error?.message || json?.message || '') && /(required|empty|missing)/i.test(json?.error?.message || json?.message || '')))) throw providerError(json, response.status, requestId || json.request_id || '');
    return { ok: true, endpoint };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('千问图片接口地址测试超过 15 秒未完成。');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function downloadImage(remoteUrl, { signal, apiKey } = {}) {
  if (typeof remoteUrl !== 'string' || !/^https:\/\//i.test(remoteUrl)) throw new Error('千问没有返回有效的 HTTPS 图片链接。');
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const imageResponse = await fetch(remoteUrl, { headers, signal });
  if (!imageResponse.ok) throw new Error(`图片结果下载失败 ${imageResponse.status}。`);
  const contentType = imageResponse.headers.get('content-type') || 'image/png';
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error('图像服务返回的链接内容不是图片。');
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!imageBytes.length || imageBytes.length > 15 * 1024 * 1024) throw new Error('图像服务返回的图片无效或超过 15 MB。');
  return `data:${contentType};base64,${imageBytes.toString('base64')}`;
}

function findImageResult(json) {
  const candidates = [
    ...(Array.isArray(json?.data) ? json.data : []),
    ...(Array.isArray(json?.output?.choices) ? json.output.choices.flatMap(choice => choice?.message?.content || []) : []),
    ...(Array.isArray(json?.output) ? json.output : []),
  ];
  for (const item of candidates) {
    const base64 = item?.b64_json || item?.base64 || item?.image_base64;
    if (typeof base64 === 'string' && base64) return { base64 };
    const remoteUrl = item?.url || item?.image_url || item?.imageUrl || item?.image;
    if (typeof remoteUrl === 'string' && remoteUrl) return { remoteUrl };
  }
  return null;
}

async function editQwenImage({ sourceDataUrl, prompt, width, height }, current) {
  const key = current.apiKey;
  if (!key) throw new Error('尚未配置阿里云百炼 API Key。');
  const { bytes } = parseImageDataUrl(sourceDataUrl, 10 * 1024 * 1024);
  validatePrompt(prompt);
  const imageWidth = Number(width);
  const imageHeight = Number(height);
  if (Number.isFinite(imageWidth) && Number.isFinite(imageHeight) && imageWidth > 0 && imageHeight > 0 && Math.max(imageWidth, imageHeight) / Math.min(imageWidth, imageHeight) > 10) throw new Error('千问官方接口要求输入图像的长短边比例不超过 10:1。请先裁切这张超宽或超长图片。');
  validateModelSettings(current);

  const endpoint = qwenNativeEndpoint(current);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: current.model,
        input: {
          messages: [{ role: 'user', content: [
            { image: sourceDataUrl },
            { text: `${prompt} Preserve the full original composition and keep every important part inside the frame.` },
          ] }],
        },
        parameters: { n: 1, size: qwenOutputSize(imageWidth, imageHeight), prompt_extend: true, watermark: false },
      }),
      signal: controller.signal,
    });
    const json = parseJsonResponse(await response.text());
    const requestId = response.headers.get('x-request-id') || json.request_id || '';
    if (!response.ok) throw providerError(json, response.status, requestId);
    const result = findImageResult(json);
    if (!result) throw new Error(`千问接口已响应，但未返回图片 URL。${requestId ? ` 请求 ID：${requestId}` : ''}`);
    const dataUrl = result.base64
      ? (result.base64.startsWith('data:image/') ? result.base64 : `data:image/png;base64,${result.base64}`)
      : await downloadImage(result.remoteUrl, { signal: controller.signal });
    return { dataUrl, provider: 'ai-live', requestId };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('千问图像任务超过 180 秒未完成；请求结果未知，不会自动重试。');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function editImage({ sourceDataUrl, prompt, width, height }, settings = {}) {
  const current = { ...envSettings(), ...settings };
  const provider = PROVIDERS[current.provider] || PROVIDERS.custom;
  if (provider.kind === 'qwen-image') return editQwenImage({ sourceDataUrl, prompt, width, height }, current);
  if (provider.kind !== 'openai' && current.provider !== 'custom') throw new Error(`${provider.label} 的文本模型接口不能直接编辑图片；请配置已接入的图像编辑服务。`);
  const key = current.apiKey;
  if (!key) throw new Error('尚未配置图像服务密钥。可先使用已标注的样片演示模式。');
  const { mimeType, bytes } = parseImageDataUrl(sourceDataUrl);
  validatePrompt(prompt);
  const base = current.apiBase.replace(/\/$/, '');
  const url = new URL(`${base}/images/edits`);
  validateHttpsUrl(url.toString(), '图像服务地址');
  const form = new FormData();
  form.append('model', current.model);
  form.append('prompt', prompt);
  form.append('size', '1024x1024');
  form.append('image', new Blob([bytes], { type: mimeType }), `source.${mimeType.split('/')[1]}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: controller.signal });
    const json = parseJsonResponse(await response.text());
    if (!response.ok) throw new Error(`图像服务返回 ${response.status}：${json.error?.message || '请检查服务配置和用量。'}`);
    const result = findImageResult(json);
    if (result?.base64) return { dataUrl: result.base64.startsWith('data:image/') ? result.base64 : `data:image/png;base64,${result.base64}`, provider: 'ai-live' };
    if (result?.remoteUrl) return { dataUrl: await downloadImage(result.remoteUrl, { signal: controller.signal }), provider: 'ai-live' };
    throw new Error('图像服务没有返回可保存的图片数据（需要 base64 或图片 URL）。');
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('图像服务超过 180 秒未完成；请求结果未知，不会自动重试。');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function testConnection(settings = {}) {
  const current = { ...envSettings(), ...settings };
  const provider = PROVIDERS[current.provider] || PROVIDERS.custom;
  if (provider.kind === 'codex') return { ok: true, mode: 'codex-session', model: current.model || 'Codex CLI', detail: 'Codex CLI 仅用于开发测试，图片生成仍需配置图像服务 API。' };
  if (!current.apiKey) throw new Error('请先填写 API Key。');
  validateModelSettings(current);
  if (provider.kind === 'qwen-image') {
    const models = await fetchQwenModelCatalog(current);
    if (!models.some(model => model.id === current.model)) {
      const available = models.map(model => model.id);
      throw new Error(available.length
        ? `连接成功，但当前 Key 未开放模型 ${current.model}。该 Key 可用的千问图片模型：${available.join('、')}。`
        : '连接成功，但当前地域没有返回可用的千问图片模型；请确认模型已开通，并核对 Key 与地域地址。');
    }
    await probeQwenImageEndpoint(current);
    return { ok: true, model: current.model, detail: 'API Key、模型权限和图片生成接口均可用。' };
  }
  const base = (current.apiBase || provider.base).replace(/\/$/, '');
  validateHttpsUrl(base, '服务地址');
  const url = provider.kind === 'google' ? new URL(`${base}/models?key=${encodeURIComponent(current.apiKey)}`) : new URL(`${base}/models`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = provider.kind === 'google' ? {} : provider.kind === 'anthropic' ? { 'x-api-key': current.apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${current.apiKey}` };
    const response = await fetch(url, { headers, signal: controller.signal });
    const json = parseJsonResponse(await response.text());
    if (!response.ok) throw provider.kind === 'qwen-image' ? providerError(json, response.status, response.headers.get('x-request-id') || json.request_id || '') : new Error(`连接返回 ${response.status}。请检查地址、Key 和模型服务。`);
    return { ok: true, model: current.model };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接测试超过 15 秒未完成。');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function listModels(settings = {}) {
  const current = { ...envSettings(), ...settings };
  const provider = PROVIDERS[current.provider] || PROVIDERS.custom;
  if (provider.kind === 'codex') return [{ id: 'codex-cli', label: 'Codex CLI（开发测试）' }];
  if (provider.kind === 'qwen-image') return fetchQwenModelCatalog(current);
  if (!current.apiKey) throw new Error('请先填写 API Key，再获取模型列表。');
  const base = (current.apiBase || provider.base).replace(/\/$/, '');
  const url = provider.kind === 'google' ? new URL(`${base}/models?key=${encodeURIComponent(current.apiKey)}`) : new URL(`${base}/models`);
  const headers = provider.kind === 'google' ? {} : { Authorization: `Bearer ${current.apiKey}` };
  const response = await fetch(url, { headers });
  const json = parseJsonResponse(await response.text());
  if (!response.ok) throw new Error(`获取模型失败 ${response.status}：${json.error?.message || '请检查服务配置。'}`);
  const rows = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return rows.map(item => ({ id: item.id || item.name, label: item.id || item.name })).filter(item => item.id).slice(0, 100);
}

module.exports = { serviceStatus, editImage, testConnection, listModels, envSettings, providerCatalog, QWEN_IMAGE_MODELS, qwenApiBase, qwenNativeEndpoint, qwenOutputSize, normalizeModelSettings, validateModelSettings };
