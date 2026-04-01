const sharp = require('sharp');
const replaceColor = require('replace-color');
const path = require('path');
const fs = require('fs');

const GREEN = '#5dc705';
const SIZE = 1024;
const LOGO_SIZE = 650;
const VERTICAL_OFFSET = 40;

const svgPath = path.join(__dirname, '../assets/images/blyp_pay_logo.svg');
const outputPath = path.join(__dirname, '../assets/images/icon.png');
const tempPath = path.join(__dirname, '../assets/images/icon-temp.png');

const logoTop = Math.floor((SIZE - LOGO_SIZE) / 2) + VERTICAL_OFFSET;
const logoLeft = Math.floor((SIZE - LOGO_SIZE) / 2);

sharp(svgPath)
  .resize(LOGO_SIZE, LOGO_SIZE)
  .png()
  .toBuffer()
  .then((logoBuffer) => {
    return replaceColor({
      image: logoBuffer,
      colors: {
        type: 'hex',
        targetColor: '#00C853',
        replaceColor: GREEN
      },
      deltaE: 30
    });
  })
  .then((jimpObject) => {
    return new Promise((resolve, reject) => {
      jimpObject.getBuffer('image/png', (err, buffer) => {
        if (err) reject(err);
        else resolve(buffer);
      });
    });
  })
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
