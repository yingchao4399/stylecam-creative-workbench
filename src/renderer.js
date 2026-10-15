import { STYLES, INTENSITIES, initialState, reduce, buildPrompt, fitImageDimensions, containImageSize } from './domain.mjs';
import { INPUT_PROFILES, keySignature, normalizeForProfile, rawKeyLabel, shouldRouteKey, sceneForState } from './input-router.mjs';

const $ = id => document.getElementById(id);
let state = initialState();
let service = { configured: false, model: '' };
let outputMode = 'demo';
let pending = false;
let sourceDataUrl = null;
let inputTimer;
let inputProfile = INPUT_PROFILES[localStorage.getItem('stylecam-input-profile')] ? localStorage.getItem('stylecam-input-profile') : 'auto';
let customBindings = readCustomBindings();
let calibrationTarget = '';
let calibrationArmed = false;
let calibrationMessage = `已保存 ${Object.keys(customBindings).length} 个自定义绑定。`;
let windowFocused = document.hasFocus();
const deviceLog = [];
const inspiration = [
  '让窗边的午后光线更柔和，保留主体的表情和轮廓。',
  '强调材质的手工痕迹，让画面像一件可以收藏的小物。',
  '保持原本构图，加入温暖的桌面空间与轻微的景深。',
];
let inspirationIndex = 0;

function readCustomBindings() {
  try {
    const parsed = JSON.parse(localStorage.getItem('stylecam-custom-bindings') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function calibrationAction(target) {
  if (target === 'knob-press') return { type: 'PRESS' };
  const match = /^button-([1-8])$/.exec(target);
  return match ? { type: 'BUTTON', index: Number(match[1]) } : null;
}

function dispatch(action) { state = reduce(state, action); render(); }
const currentStyle = () => STYLES[state.styleIndex];
const activeWork = () => state.works.find(work => work.id === state.activeWorkId) || null;
function setInputMonitor(label) {
  $('inputMonitor').textContent = `输入：${label}`;
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => { $('inputMonitor').textContent = '输入：等待操作'; }, 2800);
}

function logDeviceKey(event, action) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
  deviceLog.unshift({ raw: rawKeyLabel(event), action: action ? action.type === 'BUTTON' ? `S${action.index}` : action.type === 'ROTATE' ? `旋钮${action.delta > 0 ? '顺时针' : '逆时针'}` : '旋钮短按' : '未映射' });
  deviceLog.length = Math.min(deviceLog.length, 8);
  renderDevicePanel();
}

function renderDevicePanel() {
  const scene = sceneForState(state, windowFocused);
  $('deviceScene').textContent = scene.label;
  $('profileDescription').textContent = INPUT_PROFILES[inputProfile].description;
  document.querySelectorAll('[data-profile]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.profile === inputProfile)));
  $('deviceLog').innerHTML = deviceLog.length ? deviceLog.map(item => `<li><kbd>${escapeHtml(item.raw)}</kbd><span>${escapeHtml(item.action)}</span></li>`).join('') : '<li>等待输入…</li>';
  if ($('calibrationStatus')) $('calibrationStatus').textContent = calibrationArmed ? `请按下要绑定的实体键（目标：${$('calibrationTarget').selectedOptions[0]?.textContent || '未选择'}）` : calibrationMessage;
  if ($('calibrationStart')) $('calibrationStart').textContent = calibrationArmed ? '取消校准' : '开始校准';
}

function fitResponsiveImageFrames() {
  const sourceImage = $('sourceImage');
  const sourceFrame = $('sourceImageWrap');
  if (sourceImage?.naturalWidth && sourceFrame) {
    const parent = sourceFrame.parentElement;
    const parentStyle = getComputedStyle(parent);
    const availableWidth = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
    const maxHeight = Math.min(200, Number.parseFloat(getComputedStyle(sourceFrame).maxHeight) || 200);
    const size = containImageSize(sourceImage.naturalWidth, sourceImage.naturalHeight, availableWidth, maxHeight);
    sourceFrame.style.width = `${size.width}px`;
    sourceFrame.style.height = `${size.height}px`;
  }

  const stageImage = $('stageImage');
  const stageFrame = $('machineImageFrame');
  if (stageImage?.naturalWidth && stageFrame) {
    const machine = stageFrame.parentElement;
    const availableWidth = Math.max(1, machine.clientWidth - 38);
    const maxHeight = Math.max(180, Math.min(window.innerHeight * 0.46, 460));
    const size = containImageSize(stageImage.naturalWidth, stageImage.naturalHeight, availableWidth, maxHeight);
    stageFrame.style.width = `${size.width}px`;
    stageFrame.style.height = `${size.height}px`;
  }
}

async function openSettings() {
  $('settingsDialog').hidden = false;
  $('settingsStatus').textContent = '正在读取当前配置…';
  $('settingsStatus').classList.remove('error');
  try {
    const current = await window.stylecam.getSettings();
    $('settingsProvider').value = current.provider || 'openai';
    $('settingsBase').value = current.apiBase || providerDefaults(current.provider || 'openai');
    $('settingsModel').value = current.model || defaultModel(current.provider || 'openai');
    $('settingsModelSelect').value = '';
    $('settingsModels').textContent = current.provider === 'qwen' ? '查看图像模型' : '获取官方模型';
    $('settingsBase').placeholder = current.provider === 'qwen' ? providerDefaults('qwen') : 'https://api.openai.com/v1';
    $('settingsProviderHelp').textContent = current.provider === 'qwen'
      ? '默认使用北京地域官方地址 https://dashscope.aliyuncs.com/compatible-mode/v1。若 API Key 和模型开通在其他地域，可填写该地域的官方 Base URL；使用业务空间专属域名时，粘贴控制台提供的完整地址。模型、API Key 和地址必须属于同一地域。'
      : '模型服务地址应与 API Key 所属区域和服务商保持一致。';
    $('settingsKey').value = '';
    $('settingsStatus').textContent = current.configured
      ? `已配置：${current.maskedKey || '密钥已保存'}。留空 Key 会沿用。`
      : current.hasKey ? 'API Key 已保存；确认服务地址与 Key 属于同一地域，留空 Key 会沿用。' : '尚未配置密钥，当前只能使用演示模式。';
  } catch (error) { $('settingsStatus').textContent = error.message; $('settingsStatus').classList.add('error'); }
  $('settingsBase').focus();
}

function settingsPayload() { return { provider: $('settingsProvider').value, apiBase: $('settingsBase').value.trim(), model: $('settingsModel').value.trim(), apiKey: $('settingsKey').value }; }

function providerDefaults(id) {
  return { openai: 'https://api.openai.com/v1', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1', doubao: 'https://ark.cn-beijing.volces.com/api/v3', kimi: 'https://api.moonshot.cn/v1', google: 'https://generativelanguage.googleapis.com/v1beta', custom: '', codex: '' }[id] ?? '';
}

function defaultModel(id) {
  return { openai: 'gpt-image-2', qwen: 'qwen-image-3.0-pro', doubao: '', kimi: '', google: '', custom: '', codex: 'codex-cli' }[id] ?? '';
}

function render() {
  const style = currentStyle();
  const work = activeWork();
  const source = state.source;
  const scene = sceneForState(state, windowFocused);
  $('sceneLabel').textContent = scene.label;
  $('sourceName').textContent = source?.name || '等待装载';
  $('sourceBadge').textContent = source ? source.isDemo ? '原创示例' : '本地图片' : '未装载';
  $('sourceDescription').textContent = source ? source.isDemo ? '这张原图有三种同主体风格样片。' : '已装载。演示模式仅提供本地显示效果。' : '导入后可选择风格并生成。';
  $('sourceImage').src = source?.dataUrl || 'assets/styles/source-robot.png';
  $('phaseTag').textContent = ({ empty: '等待素材', ready: '准备就绪', generating: '制作中', preview: '作品已出片' })[state.phase];
  $('statusText').textContent = state.error ? `${state.status} ${state.error}` : state.status;
  $('statusText').classList.toggle('error', Boolean(state.error));
  $('intensityValue').textContent = `${INTENSITIES[state.intensityIndex]}%`;
  $('intensitySlider').value = String(state.intensityIndex);
  $('intensitySlider').disabled = state.phase === 'generating';
  if (document.activeElement !== $('noteInput')) $('noteInput').value = state.note;
  $('noteInput').disabled = state.phase === 'generating';
  $('generateButton').disabled = !source || pending;
  $('generateLabel').textContent = pending ? '正在制作…' : state.displayMode === 'creative' ? '制作本地显示' : '生成作品';
  $('stageOverlay').hidden = !pending;
  $('providerPill').textContent = outputMode === 'live' ? service.configured ? `实时 AI · ${service.model}` : '实时 AI 未配置' : '样片 / 本地演示';
  $('demoModeButton').setAttribute('aria-pressed', String(outputMode === 'demo'));
  $('liveModeButton').setAttribute('aria-pressed', String(outputMode === 'live'));
  $('modeDescription').textContent = outputMode === 'demo' ? '内置样片或本地显示效果；不调用图像服务。' : !service.configured ? '未检测到服务密钥，无法发送实时请求。' : service.imageEdit ? service.provider === 'qwen' ? '点击生成会通过千问官方 DashScope 图像编辑接口发送原图与编辑提示词。' : '点击生成会调用已配置的图像编辑服务。' : `${service.providerLabel || '当前服务'} 当前未接入图片编辑接口，请选择已支持的图像模型。`;
  $('topHint').textContent = scene.hint;
  $('knobAction').textContent = state.controlMode === 'intensity' ? '旋转调强度' : state.zoomed ? '旋转看作品' : '旋转选风格';
  $('knobNext').textContent = state.controlMode === 'intensity' ? '按下旋钮 → 确认强度' : state.zoomed ? '按下旋钮 → 返回画面' : '按下旋钮 → 生成作品';
  $('machineIndex').textContent = `${String(state.styleIndex + 1).padStart(2, '0')} — ${String(STYLES.length).padStart(2, '0')}`;

  const showingWork = state.phase === 'preview' && work;
  $('stageImage').src = showingWork ? state.comparing ? work.sourceDataUrl || source?.dataUrl || work.dataUrl : work.dataUrl : source?.isDemo ? style.image : source?.dataUrl || style.image;
  $('stageImage').className = showingWork || source?.isDemo ? '' : `local-preview ${style.id}`;
  $('previewStamp').textContent = showingWork ? work.provider === 'ai-live' ? '实时 AI 生成结果' : work.provider === 'sample' ? '预生成样片演示' : '本地显示效果 · 非 AI' : source?.isDemo ? '原创风格样片预览 · 尚未生成' : '本地风格显示示意 · 尚未生成';
  fitResponsiveImageFrames();
  $('styleRail').innerHTML = STYLES.map((item, index) => `<button type="button" class="style-card ${index === state.styleIndex ? 'active' : ''}" data-style="${index}" role="option" aria-selected="${index === state.styleIndex}" ${pending ? 'disabled' : ''}><img src="${item.image}" alt="${item.name}样片" /><span class="style-index">0${index + 1}</span><strong>${item.name}</strong><small>${item.category}</small></button>`).join('');
  $('workCount').textContent = String(state.works.length);
  $('gallery').innerHTML = state.works.length ? state.works.map(item => `<button type="button" class="work-card" data-work="${item.id}" aria-label="查看作品 ${escapeHtml(item.styleName)}"><img src="${item.dataUrl}" alt="${escapeHtml(item.styleName)}作品" /><span><strong>${escapeHtml(item.styleName)}</strong><small>${item.provider === 'ai-live' ? '实时 AI' : item.provider === 'sample' ? '样片演示' : '本地显示'} · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}</small></span></button>`).join('') : '<div class="gallery-empty"><span>◌</span><strong>等待第一张作品</strong><small>生成后会从这里继续查看与保存</small></div>';
  $('viewer').hidden = !state.zoomed || !work;
  if (state.zoomed && work) {
    $('viewerTitle').textContent = work.styleName;
    $('viewerImage').src = state.comparing ? work.sourceDataUrl || source?.dataUrl || work.dataUrl : work.dataUrl;
    $('viewerStamp').textContent = state.comparing ? '原始素材' : work.provider === 'ai-live' ? '实时 AI 生成结果' : work.provider === 'sample' ? '预生成样片演示' : '本地显示效果';
    $('compareButton').textContent = state.comparing ? 'S5 返回作品' : 'S5 原图对比';
  }
  renderDevicePanel();
}

function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

async function loadSource(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { dispatch({ type: 'STATUS', message: '请选择 PNG、JPG 或 WebP 图片。', error: '格式不支持。' }); return; }
  if (file.size > 15 * 1024 * 1024) { dispatch({ type: 'STATUS', message: '图片过大。', error: '请选择 15 MB 以下的文件。' }); return; }
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('读取图片失败。')); reader.readAsDataURL(file); });
  let imageWidth = 0;
  let imageHeight = 0;
  try {
    const image = new Image(); image.src = dataUrl; await image.decode();
    if (image.naturalWidth < 128 || image.naturalHeight < 128 || image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error('图片长宽应在 128～8192 像素之间。');
    imageWidth = image.naturalWidth;
    imageHeight = image.naturalHeight;
  } catch (error) { dispatch({ type: 'STATUS', message: '图片无法装载。', error: error.message || '文件可能已损坏。' }); return; }
  sourceDataUrl = dataUrl;
  dispatch({ type: 'LOAD_SOURCE', source: { name: file.name, dataUrl, isDemo: false, width: imageWidth, height: imageHeight } });
}

async function loadDemoSource() {
  const dataUrl = await window.stylecam.demoAsset('source-robot');
  const image = new Image(); image.src = dataUrl; await image.decode();
  sourceDataUrl = dataUrl;
  dispatch({ type: 'LOAD_SOURCE', source: { name: '青绿桌面机器人 · 原创示例', dataUrl, isDemo: true, width: image.naturalWidth, height: image.naturalHeight } });
}

async function localEffect(source, styleId, intensity) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const { width, height } = fitImageDimensions(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (styleId === 'pixel') {
    const pixelScale = Math.max(1, Math.round(Math.max(width, height) / 72));
    const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(width / pixelScale)); small.height = Math.max(1, Math.round(height / pixelScale));
    const smallCtx = small.getContext('2d'); smallCtx.imageSmoothingEnabled = true; smallCtx.drawImage(image, 0, 0, width, height, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(small, 0, 0, width, height);
  } else {
    ctx.filter = styleId === 'wool' ? `sepia(${Math.round(intensity * 0.35)}%) saturate(0.82) contrast(0.93)` : `saturate(${1 + intensity / 200}) contrast(1.05) brightness(1.03)`;
    ctx.drawImage(image, 0, 0, width, height);
  }
  return canvas.toDataURL('image/png');
}

async function prepareQwenImage(sourceDataUrl, source) {
  const width = source?.width || 0;
  const height = source?.height || 0;
  if (width && height && Math.max(width, height) / Math.min(width, height) > 10) {
    throw new Error('千问官方接口要求输入图像的长短边比例不超过 10:1。请先裁切这张超宽或超长图片。');
  }
  const encoded = sourceDataUrl.split(',')[1] || '';
  const sourceBytes = Math.floor(encoded.length * 3 / 4);
  if (width <= 2048 && height <= 2048 && sourceBytes <= 10 * 1024 * 1024) return sourceDataUrl;

  const image = new Image(); image.src = sourceDataUrl; await image.decode();
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.9, 0.82, 0.74, 0.66]) {
    const optimized = canvas.toDataURL('image/jpeg', quality);
    if (Math.floor((optimized.length - optimized.indexOf(',') - 1) * 3 / 4) <= 10 * 1024 * 1024) return optimized;
  }
  throw new Error('图片压缩后仍超过千问接口的 10 MB 限制，请缩小图片后重试。');
}

async function generate() {
  if (pending) return;
  if (!state.source) { dispatch({ type: 'STATUS', message: '请先装载素材。' }); return; }
  if (state.controlMode === 'intensity') { dispatch({ type: 'PRESS_KNOB' }); return; }
  if (outputMode === 'live' && state.displayMode === 'generate' && !service.configured) { dispatch({ type: 'STATUS', message: '实时 AI 尚未配置。', error: '请在设置中填写 API Key，或点击“演示”后生成。' }); return; }
  if (outputMode === 'live' && state.displayMode === 'generate' && !service.imageEdit) { dispatch({ type: 'STATUS', message: '当前服务暂不能直接生成图片。', error: `${service.providerLabel || '当前服务'} 当前未接入图片编辑接口，请在设置中选择已支持的图像模型。` }); return; }
  const snapshot = { source: state.source, sourceDataUrl, style: currentStyle(), intensity: INTENSITIES[state.intensityIndex], note: state.note, outputMode };
  const prompt = buildPrompt(snapshot);
  pending = true; dispatch({ type: 'START_GENERATE' });
  try {
    let output;
    if (snapshot.outputMode === 'live' && state.displayMode === 'generate') {
      const requestImage = service.provider === 'qwen' ? await prepareQwenImage(snapshot.sourceDataUrl, snapshot.source) : snapshot.sourceDataUrl;
      output = await window.stylecam.generate({ sourceDataUrl: requestImage, prompt, width: snapshot.source.width, height: snapshot.source.height });
    }
    else if (snapshot.source.isDemo && state.displayMode === 'generate') output = { dataUrl: await window.stylecam.demoAsset(snapshot.style.id), provider: 'sample' };
    else output = { dataUrl: await localEffect(snapshot.sourceDataUrl, snapshot.style.id, snapshot.intensity), provider: 'local-effect' };
    const work = await window.stylecam.saveWork({ dataUrl: output.dataUrl, sourceDataUrl: snapshot.sourceDataUrl, sourceName: snapshot.source.name, styleId: snapshot.style.id, styleName: snapshot.style.name, intensity: snapshot.intensity, provider: output.provider, promptSnapshot: prompt });
    dispatch({ type: 'GENERATE_DONE', work });
  } catch (error) { dispatch({ type: 'GENERATE_ERROR', message: error?.message || '未知错误。' }); }
  finally { pending = false; render(); }
}

async function saveCurrent() {
  const work = activeWork();
  if (!work) { dispatch({ type: 'STATUS', message: '还没有可以保存的作品。' }); return; }
  try { const result = await window.stylecam.exportWork(work.id); dispatch({ type: 'STATUS', message: result.exported ? `已保存到 ${result.path}。当前创作仍在工作台。` : '已取消文件导出，作品仍保留在工作台。' }); }
  catch (error) { dispatch({ type: 'STATUS', message: '保存失败。', error: error.message }); }
}

function handleButton(index) {
  setInputMonitor(`S${index}`);
  if (pending) return;
  switch (index) {
    case 1: dispatch({ type: 'TOGGLE_INTENSITY' }); break;
    case 2: dispatch({ type: 'VIEW' }); break;
    case 3: void saveCurrent(); break;
    case 4: dispatch({ type: 'CLOSE_VIEW' }); break;
    case 5: dispatch({ type: 'COMPARE' }); break;
    case 6: dispatch({ type: 'SET_NOTE', note: inspiration[inspirationIndex++ % inspiration.length] }); dispatch({ type: 'STATUS', message: '灵感已填入，可继续编辑；不会自动生成。' }); break;
    case 7: dispatch({ type: 'RESET' }); break;
    case 8: dispatch({ type: 'TOGGLE_DISPLAY' }); break;
  }
}

function rotate(delta) { if (pending) return; setInputMonitor(delta > 0 ? '旋钮顺时针' : '旋钮逆时针'); dispatch({ type: 'ROTATE', delta }); }
function pressKnob() { if (pending) return; setInputMonitor('旋钮短按'); if (state.zoomed) dispatch({ type: 'VIEW' }); else if (state.controlMode === 'intensity') dispatch({ type: 'PRESS_KNOB' }); else void generate(); }

function toggleCalibration() {
  if (calibrationArmed) { calibrationArmed = false; calibrationTarget = ''; renderDevicePanel(); return; }
  calibrationTarget = $('calibrationTarget')?.value || '';
  if (!calibrationAction(calibrationTarget)) {
    calibrationMessage = '先选择一个目标动作。';
    if ($('calibrationStatus')) $('calibrationStatus').textContent = calibrationMessage;
    return;
  }
  calibrationArmed = true;
  renderDevicePanel();
}

function clearCalibration() {
  customBindings = {};
  localStorage.removeItem('stylecam-custom-bindings');
  calibrationArmed = false;
  calibrationTarget = '';
  calibrationMessage = '尚未配置自定义绑定。';
  renderDevicePanel();
}

function captureCalibration(event) {
  if (!calibrationArmed || event.isComposing || event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return false;
  const action = calibrationAction(calibrationTarget);
  if (!action) return false;
  const signature = keySignature(event);
  customBindings[signature] = action;
  localStorage.setItem('stylecam-custom-bindings', JSON.stringify(customBindings));
  calibrationArmed = false;
  const label = $('calibrationTarget')?.selectedOptions[0]?.textContent || calibrationTarget;
  calibrationTarget = '';
  calibrationMessage = `已将 ${signature} 绑定为${label}。`;
  if ($('calibrationStatus')) $('calibrationStatus').textContent = calibrationMessage;
  renderDevicePanel();
  return true;
}

function attachEvents() {
  $('sourceImage').addEventListener('load', fitResponsiveImageFrames);
  $('stageImage').addEventListener('load', fitResponsiveImageFrames);
  window.addEventListener('resize', fitResponsiveImageFrames);
  $('dropZone').addEventListener('click', () => $('sourceFile').click());
  $('dropZone').addEventListener('keydown', event => { if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); $('sourceFile').click(); } });
  $('sourceFile').addEventListener('change', event => { if (event.target.files?.[0]) void loadSource(event.target.files[0]); });
  for (const type of ['dragenter', 'dragover']) $('dropZone').addEventListener(type, event => { event.preventDefault(); $('dropZone').classList.add('dragging'); });
  $('dropZone').addEventListener('dragleave', () => $('dropZone').classList.remove('dragging'));
  $('dropZone').addEventListener('drop', event => { event.preventDefault(); $('dropZone').classList.remove('dragging'); if (event.dataTransfer.files?.[0]) void loadSource(event.dataTransfer.files[0]); });
  $('demoSourceButton').addEventListener('click', () => void loadDemoSource());
  $('styleRail').addEventListener('click', event => { const button = event.target.closest('[data-style]'); if (button) dispatch({ type: 'SELECT_STYLE', index: Number(button.dataset.style) }); });
  $('gallery').addEventListener('click', event => { const button = event.target.closest('[data-work]'); if (button) dispatch({ type: 'SELECT_WORK', id: button.dataset.work }); });
  $('generateButton').addEventListener('click', () => void generate());
  $('intensitySlider').addEventListener('input', event => dispatch({ type: 'SET_INTENSITY', index: Number(event.target.value) }));
  $('noteInput').addEventListener('input', event => dispatch({ type: 'SET_NOTE', note: event.target.value }));
  $('inspirationButton').addEventListener('click', () => handleButton(6));
  $('demoModeButton').addEventListener('click', () => { outputMode = 'demo'; render(); });
  $('liveModeButton').addEventListener('click', () => { outputMode = 'live'; render(); });
  $('keyGrid').addEventListener('click', event => { const button = event.target.closest('[data-key]'); if (button) handleButton(Number(button.dataset.key)); });
  $('viewerClose').addEventListener('click', () => dispatch({ type: 'CLOSE_VIEW' }));
  $('foldButton').addEventListener('click', () => dispatch({ type: 'CLOSE_VIEW' }));
  $('compareButton').addEventListener('click', () => dispatch({ type: 'COMPARE' }));
  $('saveButton').addEventListener('click', () => void saveCurrent());
  $('helpButton').addEventListener('click', () => { $('helpDialog').hidden = false; $('helpClose').focus(); });
  $('helpClose').addEventListener('click', () => { $('helpDialog').hidden = true; $('helpButton').focus(); });
  $('helpDialog').addEventListener('click', event => { if (event.target === $('helpDialog')) $('helpDialog').hidden = true; });
  $('deviceButton').addEventListener('click', () => { $('deviceDialog').hidden = false; $('deviceClose').focus(); });
  $('deviceClose').addEventListener('click', () => { calibrationArmed = false; calibrationTarget = ''; $('deviceDialog').hidden = true; $('deviceButton').focus(); });
  $('deviceDialog').addEventListener('click', event => { if (event.target === $('deviceDialog')) { calibrationArmed = false; calibrationTarget = ''; $('deviceDialog').hidden = true; $('deviceButton').focus(); } });
  $('deviceDialog').addEventListener('click', event => {
    const button = event.target.closest('[data-profile]');
    if (!button) return;
    inputProfile = button.dataset.profile;
    localStorage.setItem('stylecam-input-profile', inputProfile);
    renderDevicePanel();
  });
  $('calibrationStart').addEventListener('click', toggleCalibration);
  $('calibrationClear').addEventListener('click', clearCalibration);
  $('calibrationTarget').addEventListener('change', () => { if (calibrationArmed) { calibrationTarget = $('calibrationTarget').value; renderDevicePanel(); } });
  $('settingsButton').addEventListener('click', () => void openSettings());
  $('settingsClose').addEventListener('click', () => { $('settingsDialog').hidden = true; $('settingsButton').focus(); });
  $('settingsDialog').addEventListener('click', event => { if (event.target === $('settingsDialog')) { $('settingsDialog').hidden = true; $('settingsButton').focus(); } });
  $('settingsTest').addEventListener('click', async () => {
    const status = $('settingsStatus');
    status.classList.remove('error'); status.textContent = '正在测试 Key、模型权限和图片接口…'; $('settingsTest').disabled = true;
    try { const result = await window.stylecam.testConnection(settingsPayload()); status.textContent = result.mode === 'codex-session' ? result.detail : result.detail || `连接成功，模型：${result.model}。`; }
    catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { $('settingsTest').disabled = false; }
  });
  $('settingsProvider').addEventListener('change', event => {
    const base = $('settingsBase');
    if (!base.value || Object.values({ openai: 'https://api.openai.com/v1', doubao: 'https://ark.cn-beijing.volces.com/api/v3', kimi: 'https://api.moonshot.cn/v1', google: 'https://generativelanguage.googleapis.com/v1beta' }).includes(base.value) || /^https:\/\/dashscope\.aliyuncs\.com(?:\/|$)/i.test(base.value)) base.value = providerDefaults(event.target.value);
    $('settingsModel').value = defaultModel(event.target.value);
    $('settingsModelSelect').innerHTML = `<option value="">${event.target.value === 'qwen' ? '点击查看千问图像模型' : '先获取模型列表'}</option>`;
    $('settingsModels').textContent = event.target.value === 'qwen' ? '查看图像模型' : '获取官方模型';
    $('settingsBase').placeholder = event.target.value === 'qwen' ? providerDefaults('qwen') : 'https://api.openai.com/v1';
    $('settingsProviderHelp').textContent = event.target.value === 'qwen'
      ? '默认使用北京地域官方地址 https://dashscope.aliyuncs.com/compatible-mode/v1。若 API Key 和模型开通在其他地域，可填写该地域的官方 Base URL；使用业务空间专属域名时，粘贴控制台提供的完整地址。模型、API Key 和地址必须属于同一地域。'
      : '模型服务地址应与 API Key 所属区域和服务商保持一致。';
  });
  $('settingsModelSelect').addEventListener('change', event => {
    if (event.target.value) $('settingsModel').value = event.target.value;
  });
  $('settingsModels').addEventListener('click', async () => {
    const status = $('settingsStatus');
    const isQwen = $('settingsProvider').value === 'qwen';
    status.classList.remove('error'); status.textContent = isQwen ? '正在载入千问官方图像模型…' : '正在获取官方模型…'; $('settingsModels').disabled = true;
    try {
      const models = await window.stylecam.listModels(settingsPayload());
      $('settingsModelSelect').innerHTML = models.length ? models.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('') : '<option value="">服务商未返回模型</option>';
      if (models[0] && !$('settingsModel').value) $('settingsModel').value = models[0].id;
      if (models[0]) $('settingsModelSelect').value = $('settingsModel').value || models[0].id;
      status.textContent = isQwen ? `已载入 ${models.length} 个官方图像编辑模型；文本模型不适用于图片编辑。` : `已获取 ${models.length} 个模型，可从模型输入框选择。`;
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { $('settingsModels').disabled = false; }
  });
  $('settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = $('settingsStatus');
    status.classList.remove('error'); status.textContent = '正在保存…'; $('settingsSave').disabled = true;
    try {
      service = await window.stylecam.saveSettings(settingsPayload());
      status.textContent = service.configured ? `已保存：${service.model}，Key ${service.maskedKey}。` : '服务地址和模型已保存，仍未配置 Key。';
      $('settingsKey').value = '';
      render();
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { $('settingsSave').disabled = false; }
  });
  window.addEventListener('focus', () => { windowFocused = true; render(); });
  window.addEventListener('blur', () => { windowFocused = false; render(); });
  $('machine').addEventListener('wheel', event => { if (event.ctrlKey) return; event.preventDefault(); rotate(event.deltaY > 0 ? 1 : -1); }, { passive: false });
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape') {
      if (!$('settingsDialog').hidden) { $('settingsDialog').hidden = true; $('settingsButton').focus(); }
      else if (!$('deviceDialog').hidden) { calibrationArmed = false; calibrationTarget = ''; $('deviceDialog').hidden = true; $('deviceButton').focus(); }
      else if (!$('helpDialog').hidden) { $('helpDialog').hidden = true; $('helpButton').focus(); }
      else if (state.zoomed) dispatch({ type: 'CLOSE_VIEW' });
      return;
    }
    if (captureCalibration(event)) { event.preventDefault(); return; }
    const action = normalizeForProfile(event, inputProfile, customBindings);
    if (!$('deviceDialog').hidden) logDeviceKey(event, action);
    if (!shouldRouteKey({ target: event.target, hasFocus: windowFocused, overlayOpen: !$('helpDialog').hidden || !$('deviceDialog').hidden || !$('settingsDialog').hidden || !state.zoomed && document.activeElement === $('dropZone') })) return;
    if (!action) return;
    event.preventDefault();
    if (action.type === 'BUTTON') handleButton(action.index);
    if (action.type === 'ROTATE') rotate(action.delta);
    if (action.type === 'PRESS') pressKnob();
  });
}

async function boot() {
  $('keyGrid').innerHTML = [['S1', '强度'], ['S2', '查看'], ['S3', '保存'], ['S4', '收起'], ['S5', '对比'], ['S6', '灵感'], ['S7', '重置'], ['S8', '模式']].map(([key, name], index) => `<button type="button" data-key="${index + 1}" title="${key} ${name}"><kbd>${key}</kbd><span>${name}</span></button>`).join('');
  attachEvents();
  try {
    const initial = await window.stylecam.initial();
    service = initial.service;
    state = reduce(state, { type: 'SET_WORKS', works: initial.works });
    await loadDemoSource();
    dispatch({ type: 'STATUS', message: '原创示例已装载。转动旋钮浏览三种风格，按下生成演示作品。' });
  } catch (error) { dispatch({ type: 'STATUS', message: '工作台启动失败。', error: error.message }); }
}
void boot();
