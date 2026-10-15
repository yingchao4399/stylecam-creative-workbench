import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, STYLES, buildPrompt, normalizeKey, isEditable, fitImageDimensions } from '../src/domain.mjs';

const loaded = () => reduce(initialState(), { type: 'LOAD_SOURCE', source: { name: 'source.png', dataUrl: 'data:image/png;base64,AA==', isDemo: true } });

test('旋钮循环选风格，但不会进入生成状态', () => {
  let state = loaded();
  for (let i = 0; i < STYLES.length + 1; i++) state = reduce(state, { type: 'ROTATE', delta: 1 });
  assert.equal(state.styleIndex, 1);
  assert.equal(state.phase, 'ready');
  assert.match(state.status, /尚未发起生成/);
});

test('强度模式下旋钮短按仅确认，不进入生成', () => {
  let state = reduce(loaded(), { type: 'TOGGLE_INTENSITY' });
  state = reduce(state, { type: 'ROTATE', delta: 1 });
  state = reduce(state, { type: 'PRESS_KNOB' });
  assert.equal(state.intensityIndex, 3);
  assert.equal(state.controlMode, 'style');
  assert.equal(state.phase, 'ready');
});

test('生成中忽略重复开始和旋转', () => {
  const state = reduce(loaded(), { type: 'START_GENERATE' });
  assert.equal(reduce(state, { type: 'START_GENERATE' }), state);
  assert.equal(reduce(state, { type: 'ROTATE', delta: 1 }), state);
});

test('作品生成后收起与重置都保留素材和历史', () => {
  const item = { id: 'one', styleName: '毛线手作' };
  let state = reduce(loaded(), { type: 'START_GENERATE' });
  state = reduce(state, { type: 'GENERATE_DONE', work: item });
  state = reduce(state, { type: 'VIEW' });
  state = reduce(state, { type: 'CLOSE_VIEW' });
  state = reduce(state, { type: 'RESET' });
  assert.equal(state.works.length, 1);
  assert.equal(state.source.name, 'source.png');
  assert.equal(state.zoomed, false);
  assert.equal(state.phase, 'ready');
});

test('提示词包含风格、强度边界与补充说明', () => {
  const prompt = buildPrompt({ style: STYLES[0], intensity: 20, note: 'warm light' });
  assert.match(prompt, /needle-felt/);
  assert.match(prompt, /Preserve the subject/);
  assert.match(prompt, /warm light/);
});

test('课程键位与第五课组合键归一化，其他修饰键不接管', () => {
  const key = (code, flags = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, repeat: false, ...flags });
  assert.deepEqual(normalizeKey(key('Digit3')), { type: 'BUTTON', index: 3 });
  assert.deepEqual(normalizeKey(key('Digit3', { ctrlKey: true, altKey: true, shiftKey: true })), { type: 'BUTTON', index: 3 });
  assert.deepEqual(normalizeKey(key('F8')), { type: 'BUTTON', index: 8 });
  assert.equal(normalizeKey(key('Digit3', { ctrlKey: true })), null);
  assert.deepEqual(normalizeKey(key('ArrowLeft')), { type: 'ROTATE', delta: -1 });
  assert.deepEqual(normalizeKey(key('Enter')), { type: 'PRESS' });
});

test('文本输入区域可被焦点守卫识别', () => {
  assert.equal(isEditable({ closest: selector => selector.includes('textarea') ? {} : null }), true);
  assert.equal(isEditable({ closest: () => null }), false);
});

test('本地图片效果按原图比例缩放，不中心裁切', () => {
  assert.deepEqual(fitImageDimensions(4000, 2000), { width: 1536, height: 768 });
  assert.deepEqual(fitImageDimensions(1200, 1800), { width: 1024, height: 1536 });
});

import { containImageSize } from '../src/domain.mjs';

test('source previews fit landscape, portrait, and square images without cropping', () => {
  for (const [width, height] of [[1600, 900], [900, 1600], [1000, 1000]]) {
    const fitted = containImageSize(width, height, 600, 400);
    assert.ok(fitted.width <= 600);
    assert.ok(fitted.height <= 400);
    assert.ok(Math.abs(fitted.width / fitted.height - width / height) < 0.01);
  }
  assert.throws(() => containImageSize(0, 100, 600, 400), /尺寸无效/);
});
