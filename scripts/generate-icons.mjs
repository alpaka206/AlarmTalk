/* global Buffer, process, console */
import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'apps', 'mobile', 'assets');

const CORAL = '#FF7F6B';
const WHITE = '#FFFFFF';

function treeSvg(size, fg = WHITE, padding = 0.2) {
  const s = size;
  const _p = s * padding;
  const cx = s / 2;

  const trunkW = s * 0.06;
  const trunkH = s * 0.18;
  const trunkTop = s * 0.62;
  const _trunkBottom = trunkTop + trunkH;

  const canopyR = s * 0.28;
  const canopyCY = s * 0.38;

  const leafR1 = s * 0.18;
  const leaf1CX = cx - s * 0.16;
  const leaf1CY = canopyCY + s * 0.12;

  const leaf2CX = cx + s * 0.16;
  const leaf2CY = canopyCY + s * 0.12;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <!-- Main canopy (large circle) -->
      <circle cx="${cx}" cy="${canopyCY}" r="${canopyR}" fill="${fg}"/>
      <!-- Left leaf cluster -->
      <circle cx="${leaf1CX}" cy="${leaf1CY}" r="${leafR1}" fill="${fg}"/>
      <!-- Right leaf cluster -->
      <circle cx="${leaf2CX}" cy="${leaf2CY}" r="${leafR1}" fill="${fg}"/>
      <!-- Fill gap between canopy circles -->
      <rect x="${cx - canopyR}" y="${canopyCY}" width="${canopyR * 2}" height="${s * 0.14}" fill="${fg}" rx="${s * 0.02}"/>
      <!-- Trunk -->
      <rect x="${cx - trunkW}" y="${trunkTop}" width="${trunkW * 2}" height="${trunkH}" fill="${fg}" rx="${trunkW * 0.5}"/>
    </svg>
  `;
}

function iconSvg(size) {
  const s = size;
  const r = s * 0.22;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FF9580"/>
          <stop offset="100%" stop-color="#FF6B55"/>
        </linearGradient>
      </defs>
      <!-- Rounded square background -->
      <rect width="${s}" height="${s}" rx="${r}" fill="url(#bg)"/>
      ${treeSvg(s, WHITE, 0.22).replace(/<svg[^>]*>/, '').replace('</svg>', '')}
    </svg>
  `;
}

function adaptiveForegroundSvg(size) {
  return treeSvg(size, WHITE, 0.3);
}

function monochromeSvg(size) {
  return treeSvg(size, '#000000', 0.3);
}

function faviconSvg(size) {
  const s = size;
  const r = s * 0.2;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
      <rect width="${s}" height="${s}" rx="${r}" fill="${CORAL}"/>
      ${treeSvg(s, WHITE, 0.15).replace(/<svg[^>]*>/, '').replace('</svg>', '')}
    </svg>
  `;
}

function splashSvg(size) {
  return treeSvg(size, WHITE, 0.1);
}

async function generate(name, svgStr, size, outputPath) {
  const buf = Buffer.from(svgStr);
  await sharp(buf)
    .resize(size, size)
    .png()
    .toFile(outputPath);
  console.log(`  ✓ ${name} → ${outputPath} (${size}x${size})`);
}

async function main() {
  console.log('Generating VoiceAlarm app icons...\n');

  await generate('icon.png', iconSvg(1024), 1024, join(ASSETS, 'icon.png'));
  await generate('adaptive-icon.png', adaptiveForegroundSvg(1024), 1024, join(ASSETS, 'adaptive-icon.png'));
  await generate('monochrome-icon.png', monochromeSvg(1024), 1024, join(ASSETS, 'monochrome-icon.png'));
  await generate('splash-icon.png', splashSvg(200), 200, join(ASSETS, 'splash-icon.png'));
  await generate('favicon.png', faviconSvg(48), 48, join(ASSETS, 'favicon.png'));

  console.log('\nDone! Icons generated in apps/mobile/assets/');
}

main().catch(err => {
  console.error('Failed to generate icons:', err.message);
  process.exit(1);
});
