const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const input = path.join(__dirname, '../assets/images/splash-screen.png');
const output = path.join(__dirname, '../assets/images/splash-screen-2048.png');

sharp(input)
  .resize(2048, 2048)
  .png()
  .toFile(output)
  .then(() => {
    fs.copyFileSync(output, input);
    fs.unlinkSync(output);
    console.log('splash-screen.png redimensionné en 2048x2048');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
