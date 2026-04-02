const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const GREEN = '#5dc705';
const SIZE = 1024;
const LOGO_SIZE = 650;
const VERTICAL_OFFSET = 40;

/** #00C853 → #5dc705 (évite jimp / replace-color, vulnérabilités npm) */
async function recolorLogoGreen(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tr = 0x00;
  const tg = 0xc8;
  const tb = 0x53;
  const rr = 0x5d;
  const rg = 0xc7;
  const rb = 0x05;
  const tol = 45;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (
      Math.abs(r - tr) <= tol &&
      Math.abs(g - tg) <= tol &&
      Math.abs(b - tb) <= tol
    ) {
      data[i] = rr;
      data[i + 1] = rg;
      data[i + 2] = rb;
    }
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

const svgPath = path.join(__dirname, '../assets/images/blyp_pay_logo.svg');
const outputPath = path.join(__dirname, '../assets/images/icon.png');
const tempPath = path.join(__dirname, '../assets/images/icon-temp.png');

const logoTop = Math.floor((SIZE - LOGO_SIZE) / 2) + VERTICAL_OFFSET;
const logoLeft = Math.floor((SIZE - LOGO_SIZE) / 2);

sharp(svgPath)
  .resize(LOGO_SIZE, LOGO_SIZE)
  .png()
  .toBuffer()
  .then((logoBuffer) => recolorLogoGreen(logoBuffer))
  .then((logoBuffer) => {
    return sharp({
      create: {
        width: SIZE,
        height: SIZE,
        channels: 3,
        background: GREEN
      }
    })
    .png()
    .composite([{
      input: logoBuffer,
      top: logoTop,
      left: logoLeft
    }])
    .toFile(tempPath);
  })
  .then(() => {
    fs.copyFileSync(tempPath, outputPath);
    fs.unlinkSync(tempPath);
    console.log('Icône 1024x1024 créée : assets/images/icon.png');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
