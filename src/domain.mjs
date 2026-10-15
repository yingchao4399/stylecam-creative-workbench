export const STYLES = Object.freeze([
  { id: 'wool', name: '毛线手作', category: '手作材质', image: 'assets/styles/wool.png', description: '细密羊毛纤维、缝线与柔和手工痕迹', prompt: 'Transform the image into a handcrafted needle-felt and knitted wool scene. Show fine fibers, stitches and tactile handmade details.' },
  { id: 'clay', name: '软陶微景', category: '手作材质', image: 'assets/styles/clay.png', description: '手捏软陶、圆润边缘和温暖定格动画质感', prompt: 'Transform the image into a miniature handmade clay stop-motion scene, with subtle fingerprints and rounded sculpted forms.' },
  { id: 'pixel', name: '像素午后', category: '数字与工业', image: 'assets/styles/pixel.png', description: '清晰大像素、暖调限定色盘和游戏场景光影', prompt: 'Transform the image into a crisp pixel-art diorama with large readable pixels, a restrained warm palette and layered sunlight.' },
]);
export const INTENSITIES = Object.freeze([20, 40, 60, 80, 100]);

export function fitImageDimensions(width, height, maxSide = 1536) {
  if (![width, height, maxSide].every(Number.isFinite) || width <= 0 || height <= 0 || maxSide <= 0) throw new Error('图片尺寸无效。');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function containImageSize(width, height, maxWidth, maxHeight) {
  if (![width, height, maxWidth, maxHeight].every(Number.isFinite) || width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) throw new Error('图片或预览区域尺寸无效。');
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function initialState() {
  return {
    phase: 'empty', controlMode: 'style', displayMode: 'generate', source: null,
    styleIndex: 0, intensityIndex: 2, note: '', works: [], activeWorkId: null,
    zoomed: false, comparing: false, status: '导入一张图片，或使用内置示例开始创作。', error: null,
  };
}

const wrap = (n, length) => ((n % length) + length) % length;
export function reduce(state, action) {
  switch (action.type) {
    case 'LOAD_SOURCE':
      return { ...state, source: action.source, phase: 'ready', comparing: false, zoomed: false, status: `已装载 ${action.source.name}。旋转浏览风格，按下确认后生成。`, error: null };
    case 'ROTATE': {
      if (state.phase === 'generating' || state.phase === 'empty') return state;
      if (state.controlMode === 'intensity') {
        const next = wrap(state.intensityIndex + action.delta, INTENSITIES.length);
        return { ...state, intensityIndex: next, status: `创意强度 ${INTENSITIES[next]}%。按下旋钮只确认强度。` };
      }
      if (state.zoomed && state.works.length) {
        const current = Math.max(0, state.works.findIndex(w => w.id === state.activeWorkId));
        const next = state.works[wrap(current + action.delta, state.works.length)];
        return { ...state, activeWorkId: next.id, status: `正在查看作品：${next.styleName}` };
      }
      const next = wrap(state.styleIndex + action.delta, STYLES.length);
      return { ...state, styleIndex: next, status: `已预览「${STYLES[next].name}」。尚未发起生成。` };
    }
    case 'SELECT_STYLE':
      if (state.phase === 'generating' || state.phase === 'empty') return state;
      return { ...state, styleIndex: Math.max(0, Math.min(STYLES.length - 1, action.index)), status: `已预览「${STYLES[action.index].name}」。尚未发起生成。` };
    case 'SET_INTENSITY':
      if (state.phase === 'generating') return state;
      return { ...state, intensityIndex: Math.max(0, Math.min(INTENSITIES.length - 1, action.index)), status: `创意强度 ${INTENSITIES[action.index]}%。` };
    case 'TOGGLE_INTENSITY':
      if (state.phase === 'empty' || state.phase === 'generating') return state;
      return { ...state, controlMode: state.controlMode === 'intensity' ? 'style' : 'intensity', status: state.controlMode === 'intensity' ? '强度已确认。旋钮现在选择风格。' : '旋钮现在调节创意强度，按下只确认数值。' };
    case 'PRESS_KNOB':
      if (state.controlMode === 'intensity') return { ...state, controlMode: 'style', status: `强度已确认为 ${INTENSITIES[state.intensityIndex]}%。再次按下旋钮才会生成。` };
      return state;
    case 'START_GENERATE':
      if (!state.source || state.phase === 'generating') return state;
      return { ...state, phase: 'generating', controlMode: 'style', error: null, status: `正在制作「${STYLES[state.styleIndex].name}」，请稍候…` };
    case 'GENERATE_DONE':
      if (state.phase !== 'generating') return state;
      return { ...state, phase: 'preview', works: [action.work, ...state.works], activeWorkId: action.work.id, zoomed: false, comparing: false, status: `作品「${action.work.styleName}」已出片。可以查看、对比和保存。` };
    case 'GENERATE_ERROR':
      if (state.phase !== 'generating') return state;
      return { ...state, phase: 'ready', error: action.message, status: '生成未完成。请检查原因后手动重试。' };
    case 'SET_NOTE': return { ...state, note: action.note };
    case 'SET_WORKS': return { ...state, works: action.works };
    case 'VIEW': {
      if (!state.works.length) return { ...state, status: '还没有作品，请先生成一张。' };
      return { ...state, phase: state.phase === 'generating' ? state.phase : 'preview', activeWorkId: state.activeWorkId || state.works[0].id, zoomed: !state.zoomed, status: state.zoomed ? '已返回工作台作品区。' : '正在放大查看作品。' };
    }
    case 'SELECT_WORK': return { ...state, activeWorkId: action.id, phase: 'preview', zoomed: true, comparing: false, status: '正在查看所选作品。' };
    case 'COMPARE':
      if (!state.activeWorkId) return { ...state, status: '还没有可对比的作品。' };
      return { ...state, comparing: !state.comparing, status: state.comparing ? '已恢复生成结果。' : '正在查看原始素材；再次按 S5 恢复结果。' };
    case 'CLOSE_VIEW': return { ...state, zoomed: false, comparing: false, controlMode: 'style', phase: state.source ? 'ready' : 'empty', status: '已收起预览，作品仍保留在作品桌面。' };
    case 'RESET': return { ...state, styleIndex: 0, intensityIndex: 2, controlMode: 'style', comparing: false, status: '已重置风格与强度，素材和历史作品均已保留。' };
    case 'TOGGLE_DISPLAY': return { ...state, displayMode: state.displayMode === 'generate' ? 'creative' : 'generate', status: state.displayMode === 'generate' ? '已切换到本地创意显示；不会调用 AI 服务。' : '已切换到图像生成模式。' };
    case 'STATUS': return { ...state, status: action.message, error: action.error || null };
    default: return state;
  }
}

export function buildPrompt({ style, intensity, note }) {
  const boundary = intensity <= 40 ? 'Preserve the subject, pose, composition and background layout closely; change mostly surface material and color.' : intensity <= 60 ? 'Preserve the clearly identifiable subject, facial features and main composition while visibly changing material and atmosphere.' : 'Allow a stronger redesign of textures, lighting and surrounding scene, but preserve the main subject identity and readable silhouette.';
  return `Edit the supplied image as one coherent image. ${style.prompt} ${boundary} Keep important details recognizable. No text, logo, watermark, border or collage.${note?.trim() ? ` Additional direction: ${note.trim()}` : ''}`;
}

export function normalizeKey(event) {
  if (event.isComposing || event.repeat) return null;
  const code = event.code || '';
  const match = /^Digit([1-8])$/.exec(code) || /^F([1-8])$/.exec(code) || /^Numpad([1-8])$/.exec(code);
  if (match) {
    if (event.ctrlKey || event.altKey || event.shiftKey) {
      if (!(event.ctrlKey && event.altKey && event.shiftKey)) return null;
    }
    return { type: 'BUTTON', index: Number(match[1]) };
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (code === 'ArrowRight' || code === 'ArrowDown') return { type: 'ROTATE', delta: 1 };
  if (code === 'ArrowLeft' || code === 'ArrowUp') return { type: 'ROTATE', delta: -1 };
  if (code === 'Enter' || code === 'Space') return { type: 'PRESS' };
  return null;
}

export function isEditable(target) {
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
}
