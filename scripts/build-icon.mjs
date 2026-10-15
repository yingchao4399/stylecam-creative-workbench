import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = path.resolve(import.meta.dirname, '..');
const iconDir = path.join(root, 'assets', 'icon');
const input = await fs.readFile(path.join(iconDir, 'stylecam-mark.svg'));
const paths = [];
for (const size of [16, 32, 48, 64, 128, 256]) {
  const output = path.join(iconDir, `stylecam-${size}.png`);
  await sharp(input).resize(size, size).png().toFile(output);
  paths.push(output);
}
await fs.copyFile(path.join(iconDir, 'stylecam-256.png'), path.join(iconDir, 'stylecam.png'));
await fs.writeFile(path.join(iconDir, 'stylecam.ico'), await pngToIco(paths));
console.log('已生成 StyleCam 图标 PNG 与 Windows ICO。');
