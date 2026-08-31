// Minimal "build": this app is plain HTML/CSS/JS, so there's nothing to
// transpile or bundle. This script just assembles a clean dist/ folder
// containing exactly what needs to be deployed (and previewed as a
// WebSpatial-ready PWA on PICO OS 6 / PICO Browser).
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIST = "dist";
const FILES = ["index.html", "styles.css", "config.js", "manifest.json", "js", "icons"];

async function build() {
  if (existsSync(DIST)) {
    await rm(DIST, { recursive: true });
  }
  await mkdir(DIST);

  for (const item of FILES) {
    await cp(item, `${DIST}/${item}`, { recursive: true });
  }

  console.log(`Build complete → ./${DIST}/`);
  console.log("Serve it with: npx serve dist");
  console.log("Then open the URL in the PICO Browser and tap");
  console.log('"Run as a standalone app" to launch it as a WebSpatial Web App.');
}

build();
