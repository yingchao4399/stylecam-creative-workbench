const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const fsSync = require('node:fs');
const assert = require('node:assert/strict');
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { WorkStore } = require('./store.cjs');
const { serviceStatus, editImage, testConnection, listModels, normalizeModelSettings, validateModelSettings } = require('./image-provider.cjs');

let window;
let store;
let generating = false;
let modelSettings = {};
const smoke = process.env.STYLECAM_SMOKE === '1';
if (smoke) {
  app.setPath('userData', fsSync.mkdtempSync(path.join(os.tmpdir(), 'stylecam-smoke-')));
  app.disableHardwareAcceleration();
}
function requireWindow(event) {
  if (!window || event.sender !== window.webContents) throw new Error('未授权的窗口请求。');
}
function createWindow() {
  window = new BrowserWindow({
    width: 1510, height: 980, minWidth: 1100, minHeight: 760,
    title: 'StyleCam 创作工作台', backgroundColor: '#12211f', icon: path.join(__dirname, '..', 'assets', 'icon', 'stylecam.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, '..', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('dev.easyinput.stylecam-workbench');
    Menu.setApplicationMenu(null);
    store = new WorkStore(path.join(app.getPath('userData'), 'works'));
    const settingsPath = path.join(app.getPath('userData'), 'model-settings.json');
    const settingsReady = fs.readFile(settingsPath, 'utf8').then(async value => {
      const saved = JSON.parse(value);
      modelSettings = normalizeModelSettings(saved);
      if (JSON.stringify(modelSettings) !== JSON.stringify(saved)) await fs.writeFile(settingsPath, JSON.stringify(modelSettings, null, 2), { encoding: 'utf8', mode: 0o600 });
    }).catch(() => {});
    ipcMain.handle('stylecam:initial', async event => { requireWindow(event); await settingsReady; return { works: await store.list(), service: serviceStatus(modelSettings) }; });
    ipcMain.handle('stylecam:get-settings', async event => { requireWindow(event); return serviceStatus(modelSettings); });
    ipcMain.handle('stylecam:save-settings', async (event, input) => {
      requireWindow(event);
      const next = { provider: String(input?.provider || 'openai'), apiBase: String(input?.apiBase || '').trim(), model: String(input?.model || '').trim(), apiKey: String(input?.apiKey || '') };
      if (!next.apiBase || !next.model) throw new Error('服务地址和模型名称不能为空。');
      validateModelSettings(next);
      new URL(next.apiBase);
      if (next.apiKey) modelSettings = next;
      else modelSettings = { ...modelSettings, provider: next.provider, apiBase: next.apiBase, model: next.model };
      await fs.writeFile(settingsPath, JSON.stringify(modelSettings, null, 2), { encoding: 'utf8', mode: 0o600 });
      return serviceStatus(modelSettings);
    });
    ipcMain.handle('stylecam:test-connection', async (event, input) => { requireWindow(event); return testConnection({ provider: String(input?.provider || modelSettings.provider || 'openai'), apiBase: String(input?.apiBase || '').trim(), model: String(input?.model || '').trim(), apiKey: String(input?.apiKey || modelSettings.apiKey || '') }); });
    ipcMain.handle('stylecam:list-models', async (event, input) => { requireWindow(event); return listModels({ provider: String(input?.provider || modelSettings.provider || 'openai'), apiBase: String(input?.apiBase || '').trim(), apiKey: String(input?.apiKey || modelSettings.apiKey || '') }); });
    ipcMain.handle('stylecam:demo-asset', async (event, name) => {
      requireWindow(event);
      if (!['source-robot', 'wool', 'clay', 'pixel'].includes(name)) throw new Error('未知示例素材。');
      const bytes = await fs.readFile(path.join(__dirname, '..', 'assets', 'styles', `${name}.png`));
      return `data:image/png;base64,${bytes.toString('base64')}`;
    });
    ipcMain.handle('stylecam:generate', async (event, payload) => {
      requireWindow(event);
      if (generating) throw new Error('已有生成任务正在进行。');
      generating = true;
      try { return await editImage(payload, modelSettings); }
      finally { generating = false; }
    });
    ipcMain.handle('stylecam:save-work', async (event, payload) => { requireWindow(event); return store.save(payload); });
    ipcMain.handle('stylecam:export-work', async (event, id) => {
      requireWindow(event);
      const { work, path: source } = await store.fileFor(id);
      const result = await dialog.showSaveDialog(window, { title: '保存 StyleCam 作品', defaultPath: `${work.styleName || 'StyleCam'}-${work.id.slice(0, 8)}.${work.fileName.split('.').pop()}` });
      if (result.canceled || !result.filePath) return { exported: false };
      await fs.copyFile(source, result.filePath);
      return { exported: true, path: result.filePath };
    });
    createWindow();
    if (smoke) window.webContents.once('did-finish-load', () => { void runSmoke().catch(error => { console.error('SMOKE_FAIL', error); app.exit(1); }); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
}

async function runSmoke() {
  const evaluate = script => window.webContents.executeJavaScript(script);
  async function until(script, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`等待页面状态超时：${script}`);
  }
  await until("document.getElementById('sourceBadge').textContent === '原创示例'");
  await until("document.getElementById('stageImage').complete && document.getElementById('stageImage').naturalWidth > 0");
  const sourceFit = await evaluate(`(() => { const image = document.getElementById('sourceImage'); const frame = document.getElementById('sourceImageWrap'); return { ratio: frame.getBoundingClientRect().width / frame.getBoundingClientRect().height, natural: image.naturalWidth / image.naturalHeight, fit: getComputedStyle(image).objectFit }; })()`);
  assert.ok(Math.abs(sourceFit.ratio - sourceFit.natural) < 0.03);
  assert.equal(sourceFit.fit, 'contain');
  for (const [width, height] of [[800, 400], [400, 800], [500, 500]]) {
    await evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width = ${width}; canvas.height = ${height}; document.getElementById('stageImage').src = canvas.toDataURL('image/png'); })()`);
    await until(`document.getElementById('stageImage').complete && document.getElementById('stageImage').naturalWidth === ${width} && document.getElementById('stageImage').naturalHeight === ${height}`);
    await evaluate("window.dispatchEvent(new Event('resize'))");
    const fit = await evaluate(`(() => { const image = document.getElementById('stageImage'); const frame = document.getElementById('machineImageFrame'); return { ratio: frame.getBoundingClientRect().width / frame.getBoundingClientRect().height, fit: getComputedStyle(image).objectFit }; })()`);
    assert.ok(Math.abs(fit.ratio - width / height) < 0.03);
    assert.equal(fit.fit, 'contain');
  }
  await evaluate("document.getElementById('stageImage').src = 'assets/styles/wool.png'");
  await until("document.getElementById('stageImage').complete && document.getElementById('stageImage').naturalWidth > 0");
  await evaluate("document.querySelector('[data-style=\"1\"]').click()");
  assert.match(await evaluate("document.getElementById('statusText').textContent"), /尚未发起生成/);
  await evaluate("document.getElementById('generateButton').click()");
  await until("document.getElementById('workCount').textContent === '1'");
  assert.match(await evaluate("document.getElementById('previewStamp').textContent"), /样片演示/);
  await evaluate("document.querySelector('[data-key=\"2\"]').click()");
  assert.equal(await evaluate("document.getElementById('viewer').hidden"), false);
  await evaluate("document.getElementById('compareButton').click()");
  assert.equal(await evaluate("document.getElementById('viewerStamp').textContent"), '原始素材');
  await evaluate("document.getElementById('foldButton').click()");
  assert.equal(await evaluate("document.getElementById('workCount').textContent"), '1');
  await evaluate("document.getElementById('settingsButton').click()");
  assert.equal(await evaluate("document.getElementById('settingsDialog').hidden"), false);
  assert.equal(await evaluate("document.getElementById('settingsModel').value"), 'gpt-image-2');
  await evaluate("document.getElementById('settingsProvider').value = 'qwen'; document.getElementById('settingsProvider').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('settingsModels').click()");
  await until("document.getElementById('settingsModelSelect').options.length === 4");
  assert.equal(await evaluate("document.getElementById('settingsModelSelect').options[0].value"), 'qwen-image-3.0-pro');
  assert.match(await evaluate("document.getElementById('settingsProviderHelp').textContent"), /默认使用北京地域官方地址/);
  assert.equal(await evaluate("document.getElementById('settingsBase').value"), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  await evaluate("document.getElementById('settingsProvider').value = 'codex'; document.getElementById('settingsProvider').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('settingsModels').click()");
  await until("document.getElementById('settingsModelSelect').options.length === 1");
  assert.equal(await evaluate("document.getElementById('settingsModelSelect').options[0].value"), 'codex-cli');
  await evaluate("document.getElementById('settingsModelSelect').value = 'codex-cli'; document.getElementById('settingsModelSelect').dispatchEvent(new Event('change', { bubbles: true }))");
  await evaluate("document.getElementById('settingsTest').click()");
  await until("document.getElementById('settingsStatus').textContent.includes('Codex CLI')");
  await evaluate("document.getElementById('settingsProvider').value = 'openai'; document.getElementById('settingsProvider').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('settingsModel').value = 'gpt-image-2'");
  await evaluate("document.getElementById('settingsKey').value = 'smoke-test-key'; document.getElementById('settingsForm').requestSubmit()");
  await until("document.getElementById('settingsStatus').textContent.includes('已保存')");
  assert.equal(await evaluate("document.getElementById('providerPill').textContent"), '样片 / 本地演示');
  await evaluate("document.getElementById('settingsClose').click()");
  assert.equal(await evaluate("document.getElementById('settingsDialog').hidden"), true);
  await evaluate("document.getElementById('deviceButton').click()");
  assert.equal(await evaluate("document.getElementById('deviceDialog').hidden"), false);
  await evaluate("document.querySelector('[data-profile=\"repeater\"]').click()");
  assert.equal(await evaluate("document.querySelector('[data-profile=\"repeater\"]').getAttribute('aria-pressed')"), 'true');
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', key: '4', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true }))");
  assert.match(await evaluate("document.getElementById('deviceLog').textContent"), /S4/);
  await evaluate("document.getElementById('calibrationTarget').value = 'button-7'; document.getElementById('calibrationStart').click(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q', bubbles: true }))");
  assert.match(await evaluate("document.getElementById('calibrationStatus').textContent"), /KeyQ/);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('stylecam-custom-bindings')).KeyQ.index"), 7);
  assert.equal(await evaluate("document.getElementById('workCount').textContent"), '1');
  await evaluate("document.getElementById('deviceClose').click()");
  assert.equal(await evaluate("document.getElementById('deviceDialog').hidden"), true);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const shot = await window.webContents.capturePage();
  const output = app.isPackaged
    ? path.join(app.getPath('temp'), 'stylecam-smoke', 'basic-workbench-smoke.png')
    : path.join(__dirname, '..', 'docs', 'basic-workbench-smoke.png');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, shot.toPNG());
  await evaluate(`(() => {
    const data = document.getElementById('sourceImage').src.split(',')[1];
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const file = new File([bytes], 'uploaded-robot.png', { type: 'image/png' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    document.getElementById('dropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  })()`);
  await until("document.getElementById('sourceBadge').textContent === '本地图片'");
  await evaluate("document.getElementById('generateButton').click()");
  await until("document.getElementById('workCount').textContent === '2'");
  assert.match(await evaluate("document.getElementById('previewStamp').textContent"), /本地显示效果/);
  assert.equal((await store.list()).length, 2);
  console.log('SMOKE_OK', JSON.stringify({ sampleWork: true, importedImage: true, localEffect: true, works: 2, compare: true, closeKeepsWork: true, screenshot: output }));
  app.exit(0);
}
