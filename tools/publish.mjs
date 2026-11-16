#!/usr/bin/env node
// Adds an app to the store, or publishes a new version of one that is already there.
//
//   New app:      node tools/publish.mjs wall-rush --name "Wall Rush" --tagline "..." --web ../wall-rush
//   New version:  node tools/publish.mjs wall-rush --notes "Faster rival, new sounds"
//   Remove:       node tools/publish.mjs wall-rush --remove
//
// Options
//   --name, --tagline, --description, --color "#rrggbb"   what the store shows
//   --web <folder | https://...>   a folder is copied into the store; an address is linked as it is
//   --shot-from <folder>           folder to photograph for the screenshot when --web is an address
//   --apk <file>                   Android app file, offered to Android phones
//   --icon <png | svg>             otherwise found in the web folder, or drawn from the first letter
//   --version <x.y>                otherwise the last number goes up by one (1.0 -> 1.1)
//   --notes "..."                  what changed, shown under "New in this version"
//   --build "<command>"            run before copying; {version} is replaced. Remembered for next time
//   --skip-build, --no-shot
//
// Where each app comes from is remembered in tools/sources.json, so a new version needs only --notes.
// Nothing is sent anywhere: this only changes files in this folder. Going live is a separate push.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "apps.json");
const SOURCES = path.join(ROOT, "tools", "sources.json");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SKIP = new Set([".git", ".DS_Store", "node_modules", "README.md", ".gitignore", ".nojekyll", ".claude"]);

const argv = process.argv.slice(2);
const id = argv[0];
if (!id || id.startsWith("-") || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  fail("First give the app's short id, lowercase with dashes, for example: wall-rush");
}
const opt = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) fail(`Unexpected "${a}". Options start with --`);
  const key = a.slice(2);
  if (["remove", "skip-build", "no-shot"].includes(key)) opt[key] = true;
  else { if (argv[i + 1] === undefined) fail(`--${key} needs a value`); opt[key] = argv[++i]; }
}

function fail(msg) { console.error("\n  " + msg + "\n"); process.exit(1); }
function readJson(file, fallback) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; }
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n"); }
function today() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function isUrl(s) { return /^https?:\/\//.test(s || ""); }
function abs(p) { return path.resolve(process.cwd(), p); }
function rel(p) { return path.relative(ROOT, p) || "."; }
function fromRoot(p) { return path.resolve(ROOT, p); }
function bump(v) {
  const parts = String(v).split(".");
  const last = parts.length - 1;
  if (!/^\d+$/.test(parts[last])) fail(`Cannot work out the version after "${v}". Pass --version.`);
  parts[last] = String(Number(parts[last]) + 1);
  return parts.join(".");
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".env")) continue;
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b); else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}
// Chrome draws a page into a picture: used for screenshots and for icons made from SVG.
function snap(url, out, w, h, scale) {
  if (!fs.existsSync(CHROME)) return false;
  try {
    execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      `--user-data-dir=${path.join(ROOT, ".chrome-tmp")}`, `--window-size=${w},${h}`,
      `--force-device-scale-factor=${scale}`, "--virtual-time-budget=5000", `--screenshot=${out}`, url],
      { stdio: "ignore", timeout: 60000 });
  } catch { /* fall through to the existence check */ }
  fs.rmSync(path.join(ROOT, ".chrome-tmp"), { recursive: true, force: true });
  return fs.existsSync(out);
}
function svgToPng(svg, out, size = 512) {
  const page = path.join(ROOT, ".icon-tmp.html");
  fs.writeFileSync(page, `<!doctype html><html><body style="margin:0;overflow:hidden">${svg.replace("<svg", `<svg style="display:block;width:${size}px;height:${size}px"`)}</body></html>`);
  const ok = snap(pathToFileURL(page).href, out, size, size, 1);
  fs.rmSync(page, { force: true });
  return ok;
}

const catalog = readJson(CATALOG, { store: { name: "Sallam Apps", tagline: "Home-made apps for family and friends." }, apps: [] });
const sources = readJson(SOURCES, {});
let app = catalog.apps.find((a) => a.id === id);
const appDir = path.join(ROOT, "apps", id);

if (opt.remove) {
  if (!app) fail(`There is no app with the id "${id}" in the store.`);
  catalog.apps = catalog.apps.filter((a) => a.id !== id);
  delete sources[id];
  fs.rmSync(appDir, { recursive: true, force: true });
  writeJson(CATALOG, catalog); writeJson(SOURCES, sources);
  console.log(`\n  Removed ${app.name} from the store.\n`);
  process.exit(0);
}

const isNew = !app;
const src = sources[id] || {};
if (opt.web) { if (isUrl(opt.web)) { src.web = opt.web; } else { src.web = rel(abs(opt.web)); } }
if (opt["shot-from"]) src.shotFrom = rel(abs(opt["shot-from"]));
if (opt.apk) src.apk = rel(abs(opt.apk));
if (opt.icon) src.icon = rel(abs(opt.icon));
if (opt.build) src.build = opt.build;

if (isNew) {
  if (!opt.name) fail(`"${id}" is a new app, so it needs --name.`);
  if (!src.web && !src.apk) fail("A new app needs --web (a folder or an address) or --apk (an Android app file).");
  app = { id, name: opt.name, tagline: "", description: "", color: "#2447F0", icon: `apps/${id}/icon.png`, version: "", updated: "", history: [] };
  catalog.apps.push(app);
}
for (const k of ["name", "tagline", "description", "color"]) if (opt[k] !== undefined) app[k] = opt[k];

const version = opt.version || (isNew ? "1.0" : bump(app.version));
if (!isNew && app.history.some((h) => h.version === version)) fail(`Version ${version} of ${app.name} was already published. Pick a higher --version.`);

if (src.build && !opt["skip-build"]) {
  const cmd = src.build.replaceAll("{version}", version);
  console.log(`  Building: ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

fs.mkdirSync(appDir, { recursive: true });

// The app itself
let shotFolder = null;
if (src.web && isUrl(src.web)) {
  app.web = src.web;
  if (src.shotFrom) shotFolder = fromRoot(src.shotFrom);
} else if (src.web) {
  const from = fromRoot(src.web);
  if (!fs.existsSync(path.join(from, "index.html"))) fail(`No index.html in ${from}`);
  fs.rmSync(path.join(appDir, "app"), { recursive: true, force: true });
  copyDir(from, path.join(appDir, "app"));
  app.web = `apps/${id}/app/`;
  shotFolder = path.join(appDir, "app");
}
if (src.apk) {
  const from = fromRoot(src.apk);
  if (!fs.existsSync(from)) fail(`Android app file not found: ${from}`);
  for (const f of fs.readdirSync(appDir)) if (f.endsWith(".apk")) fs.rmSync(path.join(appDir, f));
  const name = `${app.name.replace(/[^A-Za-z0-9]+/g, "")}-${version}.apk`;
  fs.copyFileSync(from, path.join(appDir, name));
  app.android = { file: `apps/${id}/${name}`, size: fs.statSync(from).size };
}

// Icon
const iconOut = path.join(appDir, "icon.png");
let iconFrom = src.icon ? fromRoot(src.icon) : null;
if (!iconFrom) {
  const folder = src.web && !isUrl(src.web) ? fromRoot(src.web) : shotFolder;
  if (folder) iconFrom = ["icon-512.png", "icon512.png", "icon.png", "icon-192.png", "apple-touch-icon.png", "icon-180.png"].map((f) => path.join(folder, f)).find((f) => fs.existsSync(f)) || null;
}
if (iconFrom && iconFrom.endsWith(".svg")) {
  if (!svgToPng(fs.readFileSync(iconFrom, "utf8"), iconOut)) fail("Could not draw the icon (Google Chrome is needed for SVG icons).");
} else if (iconFrom) {
  fs.copyFileSync(iconFrom, iconOut);
} else if (!fs.existsSync(iconOut)) {
  const letter = app.name.trim()[0].toUpperCase().replace(/[&<>]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${app.color}"/><text x="256" y="345" font-family="Arial, sans-serif" font-weight="700" font-size="270" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
  if (!svgToPng(svg, iconOut)) console.log("  No icon was made (Google Chrome not found). Pass --icon.");
}

// Screenshot of the first screen, phone-sized
if (!opt["no-shot"] && shotFolder && fs.existsSync(path.join(shotFolder, "index.html"))) {
  const out = path.join(appDir, "shot-1.png");
  // Chrome windows cannot be phone-narrow, so the app is shown in a phone-sized frame drawn at double size.
  const frame = path.join(ROOT, ".icon-tmp.html");
  fs.writeFileSync(frame, `<!doctype html><html><body style="margin:0;overflow:hidden"><iframe src="${pathToFileURL(path.join(shotFolder, "index.html")).href}" style="border:0;width:390px;height:780px;transform:scale(2);transform-origin:0 0"></iframe></body></html>`);
  const shot = snap(pathToFileURL(frame).href, out, 780, 1560, 1);
  fs.rmSync(frame, { force: true });
  if (shot) {
    const extra = (app.screenshots || []).filter((s) => !s.endsWith("/shot-1.png"));
    app.screenshots = [`apps/${id}/shot-1.png`, ...extra];
  } else console.log("  Screenshot skipped (Google Chrome did not produce one).");
}

app.version = version;
app.updated = today();
if (isNew) app.added = app.updated;
app.history.unshift({ version, date: app.updated, notes: opt.notes || (isNew ? "First version." : "") });

sources[id] = src;
writeJson(CATALOG, catalog);
writeJson(SOURCES, sources);

console.log(`\n  ${isNew ? "Added" : "Updated"} ${app.name}, version ${version}.`);
if (!isNew && !opt.notes) console.log('  Tip: add --notes "what changed" so people see what is new.');
console.log("  The store on this computer is ready. It reaches everyone once the folder is pushed.\n");
