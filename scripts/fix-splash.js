const sharp = require('sharp');
const path = require('path');

const GREEN = '#5dc705';
const WHITE = '#ffffff';

// Format portrait haute résolution pour couvrir la plupart des écrans
const WIDTH = 1284;
const HEIGHT = 2778;

const splashPath = path.join(__dirname, '../assets/images/splash-screen.png');

// On génère le splash directement à partir d'un SVG avec le texte "BLYP"
// - fond blanc
// - texte vert, très grand
// - letter-spacing augmenté
// - marges latérales suffisantes pour éviter toute coupure
const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${WHITE}"/>
  <text
    x="50%"
    y="50%"
    text-anchor="middle"
    dominant-baseline="central"
    fill="${GREEN}"
    font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    font-weight="800"
    font-size="${Math.floor(WIDTH * 0.28)}"
    letter-spacing="${Math.floor(WIDTH * 0.03)}"
  >
    BLYP
  </text>
</svg>
`;

sharp(Buffer.from(svg))
  .png()
  .toFile(splashPath)
  .then(() => {
    console.log('Splash créé : fond blanc, BLYP vert centré (responsive par ratio).');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
