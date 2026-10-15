import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { editImage, listModels, qwenApiBase, qwenNativeEndpoint, qwenOutputSize, serviceStatus, testConnection } = require('../electron/image-provider.cjs');
const pngDataUrl = `data:image/png;base64,${Buffer.from('tiny-image').toString('base64')}`;

test('千问图片模型列表根据当前 Key 的官方模型目录筛选', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ data: [
    { id: 'qwen-image-3.0-pro' }, { id: 'qwen-image-2.1-pro' }, { id: 'qwen-plus' },
  ] }), { status: 200 });
  const models = await listModels({ provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test' });
  assert.deepEqual(models.map(item => item.id), [
    'qwen-image-3.0-pro',
    'qwen-image-2.1-pro',
  ]);
  assert.equal(serviceStatus({ ...serviceStatus(), provider: 'qwen', apiKey: 'test-key' }).imageEdit, true);
});

test('千问 API 地址兼容官方地域 Base URL 和兼容模式 Base URL', () => {
  assert.equal(qwenApiBase({ apiBase: 'https://dashscope.aliyuncs.com' }), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(qwenApiBase({ apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com' }), 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
  assert.equal(qwenApiBase({ apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }), 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
  assert.equal(qwenApiBase({ apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations' }), 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
  assert.equal(qwenNativeEndpoint({ apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }), 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(qwenNativeEndpoint({ apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }), 'https://test-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(qwenApiBase({ apiBase: '' }), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.throws(() => qwenApiBase({ apiBase: 'http://dashscope.aliyuncs.com' }), /HTTPS/);
});

test('千问输出尺寸按横图、竖图、方图及模型长宽比约束自适配', () => {
  assert.equal(qwenOutputSize(1600, 900), '1536*864');
  assert.equal(qwenOutputSize(900, 1600), '864*1536');
  assert.equal(qwenOutputSize(1200, 1200), '1536*1536');
  assert.equal(qwenOutputSize(9000, 500), '1536*192');
  assert.equal(qwenOutputSize(0, 0), '1024*1024');
});

test('千问图片编辑按官方 DashScope 协议发送 Base64 image 与 prompt，并下载临时图片 URL', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/multimodal-generation/generation')) {
      return new Response(JSON.stringify({ request_id: 'request-123', output: { choices: [{ message: { content: [{ image: 'https://dashscope-result.example/image.png?Expires=123' }] } }] } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'request-123' } });
    }
    return new Response(Buffer.from('fake-png'), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const result = await editImage(
    { sourceDataUrl: pngDataUrl, prompt: '把照片变成毛线手作风格。', width: 640, height: 480 },
    { provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test-secret', model: 'qwen-image-3.0-pro' },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://test-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test-secret');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, 'qwen-image-3.0-pro');
  assert.equal(payload.input.messages[0].role, 'user');
  assert.equal(payload.input.messages[0].content[0].image, pngDataUrl);
  assert.match(payload.input.messages[0].content[1].text, /毛线手作/);
  assert.equal(payload.parameters.size, '1536*1152');
  assert.equal(payload.parameters.n, 1);
  assert.equal(payload.parameters.watermark, false);
  assert.equal(calls[1].url, 'https://dashscope-result.example/image.png?Expires=123');
  assert.equal(calls[1].options.headers?.Authorization, undefined);
  assert.equal(result.provider, 'ai-live');
  assert.equal(result.requestId, 'request-123');
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
});

test('千问文本模型不能误用为图片编辑模型', async () => {
  await assert.rejects(editImage({ sourceDataUrl: pngDataUrl, prompt: 'test' }, {
    provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test', model: 'qwen-plus',
  }), /不支持图像生成/);
});

test('千问输入比例超过官方 10:1 限制时在本机拒绝发送', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error('不应发起请求'); };
  await assert.rejects(editImage({ sourceDataUrl: pngDataUrl, prompt: 'test', width: 10000, height: 500 }, {
    provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test', model: 'qwen-image-3.0-pro',
  }), /长短边比例不超过 10:1/);
});

test('千问图像 API 错误保留官方错误码和请求 ID', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ error: { code: 'ModelNotAvailable', message: '该地域未开通此模型。' } }), {
    status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'request-error-1' },
  });
  await assert.rejects(editImage({ sourceDataUrl: pngDataUrl, prompt: 'test' }, {
    provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test', model: 'qwen-image-3.0-pro',
  }), /ModelNotAvailable.*该地域未开通此模型.*request-error-1/);
});

test('千问连接测试用空请求探测官方原生图片路由，不会创建生成任务', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === 'POST') return new Response(JSON.stringify({ code: 'BadRequest.EmptyModel', message: 'Required parameter "model" missing from request.' }), { status: 400 });
    return new Response(JSON.stringify({ data: [{ id: 'qwen-image-3.0-pro' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await testConnection({ provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test', model: 'qwen-image-3.0-pro' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models');
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[1].url, 'https://test-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, '{}');
});

test('千问连接测试提示 Key 未开放所选模型', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'qwen-image-2.1-pro' }] }), { status: 200 });
  await assert.rejects(testConnection({ provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-test', model: 'qwen-image-3.0-pro' }), /未开放模型 qwen-image-3.0-pro.*qwen-image-2.1-pro/);
});

const { normalizeModelSettings } = require('../electron/image-provider.cjs');

test('saved Qwen settings migrate mismatched image models and reject unsupported models', async () => {
  assert.equal(normalizeModelSettings({ provider: 'qwen', model: 'gpt-image-2' }).model, 'qwen-image-3.0-pro');
  await assert.rejects(testConnection({ provider: 'qwen', apiBase: 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'test-key', model: 'gpt-image-2' }), /不支持图像生成/);
  assert.equal(normalizeModelSettings({ provider: 'qwen', model: 'qwen-image-3.0-pro', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }).apiBase, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  const status = serviceStatus({ provider: 'qwen', model: 'qwen-image-3.0-pro', apiBase: '', apiKey: 'test-key' });
  assert.equal(status.configured, true);
  assert.equal(status.hasKey, true);
});
