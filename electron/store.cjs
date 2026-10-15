const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class WorkStore {
  constructor(root) { this.root = root; this.indexPath = path.join(root, 'index.json'); }
  async ensure() { await fs.mkdir(this.root, { recursive: true }); }
  async readIndex() {
    await this.ensure();
    try { const value = JSON.parse(await fs.readFile(this.indexPath, 'utf8')); return Array.isArray(value) ? value : []; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async list() {
    const index = await this.readIndex();
    return Promise.all(index.slice(0, 40).map(async work => {
      try { const bytes = await fs.readFile(path.join(this.root, work.fileName)); return { ...work, dataUrl: `data:${work.mimeType};base64,${bytes.toString('base64')}` }; }
      catch { return null; }
    })).then(items => items.filter(Boolean));
  }
  async save(input) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl || '');
    if (!match) throw new Error('作品不是有效的 PNG、JPEG 或 WebP 图片。');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('作品文件必须小于 20 MB。');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[match[1]];
    const id = crypto.randomUUID();
    const fileName = `${id}.${extension}`;
    const work = {
      id, fileName, mimeType: match[1], createdAt: new Date().toISOString(),
      sourceName: String(input.sourceName || '未命名素材').slice(0, 120),
      styleId: String(input.styleId || '').slice(0, 40), styleName: String(input.styleName || '').slice(0, 80),
      intensity: Number(input.intensity) || 60, provider: String(input.provider || 'demo').slice(0, 50),
      promptSnapshot: String(input.promptSnapshot || '').slice(0, 3000),
      sourceDataUrl: input.sourceDataUrl && input.sourceDataUrl.length < 15 * 1024 * 1024 ? input.sourceDataUrl : null,
    };
    await this.ensure();
    await fs.writeFile(path.join(this.root, fileName), bytes, { flag: 'wx' });
    const index = await this.readIndex();
    index.unshift(work);
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
    return { ...work, dataUrl: input.dataUrl };
  }
  async fileFor(id) {
    const index = await this.readIndex();
    const work = index.find(item => item.id === id);
    if (!work) throw new Error('找不到这张作品。');
    return { work, path: path.join(this.root, work.fileName) };
  }
}
module.exports = { WorkStore };
