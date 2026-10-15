import test from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_PROFILES, keySignature, normalizeForProfile, rawKeyLabel, sceneForState, shouldRouteKey } from '../src/input-router.mjs';

const key = (code, flags = {}) => ({ code, key: code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, repeat: false, ...flags });

test('设备映射配置区分课堂数字键与第五课组合键', () => {
  assert.deepEqual(normalizeForProfile(key('Digit3'), 'course'), { type: 'BUTTON', index: 3 });
  assert.equal(normalizeForProfile(key('Digit3', { ctrlKey: true, altKey: true, shiftKey: true }), 'course'), null);
  assert.equal(normalizeForProfile(key('Digit3'), 'repeater'), null);
  assert.deepEqual(normalizeForProfile(key('Digit3', { ctrlKey: true, altKey: true, shiftKey: true }), 'repeater'), { type: 'BUTTON', index: 3 });
  assert.equal(INPUT_PROFILES.auto.label, '自动识别');
});

test('设备日志保留原始修饰键组合', () => {
  assert.equal(rawKeyLabel(key('Digit3', { ctrlKey: true, altKey: true, shiftKey: true })), 'Ctrl+Alt+Shift+Digit3');
});

test('自定义校准绑定优先于预设映射', () => {
  const event = key('KeyQ');
  assert.equal(keySignature(event), 'KeyQ');
  assert.deepEqual(normalizeForProfile(event, 'auto', { KeyQ: { type: 'BUTTON', index: 7 } }), { type: 'BUTTON', index: 7 });
});

test('窗口失焦和弹窗打开时不接管创作按键', () => {
  const target = { closest: () => null };
  assert.equal(shouldRouteKey({ target, hasFocus: false, overlayOpen: false }), false);
  assert.equal(shouldRouteKey({ target, hasFocus: true, overlayOpen: true }), false);
  assert.equal(shouldRouteKey({ target, hasFocus: true, overlayOpen: false }), true);
});

test('场景提示随工作台状态变化', () => {
  assert.equal(sceneForState({ phase: 'ready', controlMode: 'style', zoomed: false }).id, 'create');
  assert.equal(sceneForState({ phase: 'ready', controlMode: 'intensity', zoomed: false }).id, 'intensity');
  assert.equal(sceneForState({ phase: 'preview', controlMode: 'style', zoomed: true }).id, 'inspect');
  assert.equal(sceneForState({ phase: 'ready', controlMode: 'style', zoomed: false }, false).id, 'inactive');
});
