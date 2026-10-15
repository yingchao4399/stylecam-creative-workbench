import { normalizeKey, isEditable } from './domain.mjs';

export const INPUT_PROFILES = Object.freeze({
  auto: { label: '自动识别', description: '同时识别课堂数字键与第五课组合键。' },
  course: { label: '课堂映射', description: '数字 1～8、方向键、Enter。' },
  repeater: { label: '第五课映射', description: 'Ctrl+Alt+Shift+1～8 与画面区滚轮。' },
});

export function keySignature(event) {
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Win', event.code || event.key || 'Unknown'].filter(Boolean).join('+');
}

export function normalizeForProfile(event, profile = 'auto', customBindings = {}) {
  const custom = customBindings[keySignature(event)];
  if (custom) return custom;
  const action = normalizeKey(event);
  if (!action) return null;
  const code = event.code || '';
  const chord = event.ctrlKey && event.altKey && event.shiftKey;
  if (profile === 'course' && chord) return null;
  if (profile === 'repeater' && /^Digit[1-8]$/.test(code) && !chord) return null;
  return action;
}

export function rawKeyLabel(event) {
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Win', event.code || event.key || '未知键'].filter(Boolean).join('+');
}

export function shouldRouteKey({ target, hasFocus, overlayOpen }) {
  return Boolean(hasFocus && !overlayOpen && !isEditable(target) && !target?.closest?.('button, a, [role="button"]'));
}

export function sceneForState(state, hasFocus = true) {
  if (!hasFocus) return { id: 'inactive', label: '输入已暂停', hint: '返回工作台后继续操作' };
  if (state.phase === 'generating') return { id: 'generating', label: '生成等待', hint: '已屏蔽重复提交与旋钮输入' };
  if (state.controlMode === 'intensity') return { id: 'intensity', label: '强度调节', hint: '旋钮调强度；短按只确认' };
  if (state.zoomed) return { id: 'inspect', label: '作品检视', hint: '旋钮浏览作品；S5 对比原图' };
  return { id: 'create', label: '风格创作', hint: '旋钮选风格；短按生成' };
}
