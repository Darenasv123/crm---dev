const path  = require("path");
const fs    = require("fs");
const sharp = require("sharp");

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
  console.log("All icons generated.");
}

main().catch(console.error);
