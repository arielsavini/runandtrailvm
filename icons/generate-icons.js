/**
 * Genera iconos PNG para la PWA a partir del SVG.
 * Requiere: npm install sharp
 * Uso: node generate-icons.js
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconDir = __dirname;
const svgPath = path.join(iconDir, 'icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

const sizes = [192, 512];

async function generate() {
  for (const size of sizes) {
    // Ícono normal
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconDir, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png`);

    // Ícono maskable (con padding del 10% para la safe zone)
    const pad = Math.round(size * 0.1);
    const innerSize = size - pad * 2;
    const resized = await sharp(svgBuffer).resize(innerSize, innerSize).png().toBuffer();
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 12, g: 130, b: 51, alpha: 1 } // #0c8233
      }
    })
      .composite([{ input: resized, gravity: 'center' }])
      .png()
      .toFile(path.join(iconDir, `icon-maskable-${size}.png`));
    console.log(`✓ icon-maskable-${size}.png`);
  }
  console.log('\nÍconos generados correctamente en icons/');
}

generate().catch(console.error);
