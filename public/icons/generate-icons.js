/**
 * Run once with Node.js to generate all PWA icon PNGs from the SVG source.
 * Usage:  node public/icons/generate-icons.js
 *
 * Requires: npm install -D sharp   (only needed for generation, not for the app)
 *
 * If you don't want to install sharp, you can also use any online tool like
 * https://realfavicongenerator.net/ — upload icon-512.svg and download the set.
 */

const path = require("path");
const fs   = require("fs");

// Try to use sharp; if not installed, print instructions
let sharp;
try {
  sharp = require("sharp");
} catch {
  console.log("⚠️  sharp is not installed.");
  console.log("Run:  npm install -D sharp");
  console.log("Then: node public/icons/generate-icons.js");
  process.exit(0);
}

const SVG_PATH = path.join(__dirname, "icon-source.svg");
const OUT_DIR  = __dirname;
const SIZES    = [72, 96, 128, 144, 152, 192, 384, 512];

async function main() {
  const svgBuffer = fs.readFileSync(SVG_PATH);
  for (const size of SIZES) {
    const outPath = path.join(OUT_DIR, `icon-${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
    console.log(`✓ icon-${size}.png`);
  }
  console.log("✅ All icons generated.");
}

main().catch(console.error);
