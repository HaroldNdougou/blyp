const sharp = require('sharp');
const path = require('path');

const SIZE = 1242;
const GREEN = '#5dc705';
const WHITE = '#ffffff';

// BLYP doit occuper ~90% de l'espace (largeur ET hauteur)
// font-size 1100 = lettres ~1100px de haut (~89% de 1242)
// letter-spacing négatif pour garder la largeur à ~90%
const FONT_SIZE = 1100;
const LETTER_SPACING = -200;

const output = path.join(__dirname, '../assets/images/logo-blyp.png');

const svg = `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${WHITE}"/>
  <text
    x="50%"
    y="50%"
    text-anchor="middle"
    dominant-baseline="central"
    fill="${GREEN}"
    font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    font-weight="800"
    font-size="${FONT_SIZE}"
    letter-spacing="${LETTER_SPACING}"
  >
    BLYP
  </text>
</svg>
`;

sharp(Buffer.from(svg))
  .png()
  .toFile(output)
  .then(() => console.log('logo-blyp.png régénéré : BLYP occupe ~90% de l\'espace'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
