/**
 * Splash : logo centré, fond uni (composité par expo-splash-screen).
 * Couleurs alignées sur lib/theme/colors.ts (accent + backgrounds).
 *
 * Usage: node scripts/generate-splash.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ACCENT = "#5dc705";
const SIZE = 1024;
const FONT = Math.floor(SIZE * 0.22);
const TRACKING = Math.floor(SIZE * 0.018);
const outDir = path.join(__dirname, "../assets/images");

function wordmarkSvg(fill) {
  return `
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <text
    x="50%"
    y="50%"
    text-anchor="middle"
    dominant-baseline="central"
    fill="${fill}"
    font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    font-weight="800"
    font-size="${FONT}"
    letter-spacing="${TRACKING}"
  >BLYP</text>
</svg>`;
}

async function writePng(name, svg) {
  const file = path.join(outDir, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log("OK", path.relative(process.cwd(), file));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  /** Sur fond blanc (clair) — marque accent. */
  await writePng("splash-mark-light.png", wordmarkSvg(ACCENT));
  /** Sur fond sombre — marque accent. */
  await writePng("splash-mark-dark.png", wordmarkSvg(ACCENT));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
