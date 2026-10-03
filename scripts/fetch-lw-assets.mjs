// Récupère les images et polices de Leek Wars dans public/lw/ (servies par Vite puis embarquées dans dist/).
//
//   npm run assets            → clone léger de github.com/leek-wars/leek-wars (images + polices seulement)
//   LW_REPO=<chemin> npm run assets   → réutilise un clone existant
//
// Le client Leek Wars est sous GPL v3 : voir public/lw/NOTICE.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "lw");
const SITE = "https://leekwars.com";

// Stades d'apparence d'un poireau (1 à 11) et peaux (miroir de leek-wars/src/model/leekwars.ts).
const APPEARANCES = 11;
const SKINS = {
  1: "green", 2: "blue", 3: "yellow", 4: "red", 5: "orange", 6: "magenta", 7: "cyan", 8: "purple",
  9: "multi", 10: "rasta", 11: "white", 12: "black", 13: "alpha", 14: "apple", 15: "gold", 16: "pink",
  17: "grey", 18: "turquoise", 19: "celestialblue", 20: "marine", 21: "greenfluo", 22: "brown", 23: "blackandwhite",
  24: "whiteandblack", 25: "ghost", 26: "salmon", 27: "radioactive", 28: "sand", 29: "teal", 30: "matcha", 31: "peach",
  32: "fire", 33: "venimous", 34: "greyscale", 35: "frozen", 36: "dalton", 37: "charlie", 38: "mariniere", 39: "france",
  40: "iron", 41: "diamond", 42: "mafia", 43: "bordeaux", 44: "terracotta", 45: "emerald",
  46: "amethyst", 47: "sapphire", 48: "topaz", 49: "ruby", 50: "opal",
};

// Dossiers / fichiers de public/image copiés tels quels (le reste du site ne sert pas ici).
const IMAGE_DIRS = ["chip", "weapon", "charac", "icon", "state", "hat"];
const IMAGE_FILES = ["leekwars.svg", "leekwars_flat.svg", "logo_pixel.svg", "talent.svg", "favicon.png", "icon64.png", "vs.png", "fight.png", "garden.png", "crystal.png", "trophy.png"];
const FONT_PREFIXES = ["pixel-operator", "inter-latin"];

function repo() {
  if (process.env.LW_REPO) return process.env.LW_REPO;
  const dir = path.join(os.tmpdir(), "leekwars-client-assets");
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "inherit" });
  if (!fs.existsSync(path.join(dir, ".git"))) {
    execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/leek-wars/leek-wars.git", dir], { stdio: "inherit" });
    git("sparse-checkout", "set", "--no-cone", "/public/image/**", "/public/fonts/**", "/LICENSE");
  } else {
    git("pull", "--depth", "1", "--quiet");
  }
  return dir;
}

function copyDir(src, dst, filter = () => true) {
  let n = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyDir(s, d, filter);
    else if (filter(e.name)) fs.copyFileSync(s, d), n++;
  }
  return n;
}

/** Largeur/hauteur d'un PNG (en-tête IHDR). */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function fetchOk(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return r;
    if (r && r.status === 404) return null;
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  return null;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

const src = repo();
const IMG = path.join(src, "public", "image");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const d of IMAGE_DIRS) {
  // Chapeaux : seule la vue de face sert ; armes : les variantes "cart_" (chariots) et projectiles non plus.
  const filter = d === "hat" ? (f) => !f.includes("_back") : d === "weapon" ? (f) => !f.startsWith("cart_") : () => true;
  console.log(`${d}/ : ${copyDir(path.join(IMG, d), path.join(OUT, d), filter)} fichier(s)`);
}
for (const f of IMAGE_FILES) if (fs.existsSync(path.join(IMG, f))) fs.copyFileSync(path.join(IMG, f), path.join(OUT, f));
console.log(`fonts/ : ${copyDir(path.join(src, "public", "fonts"), path.join(OUT, "fonts"), (f) => FONT_PREFIXES.some((p) => f.startsWith(p)))} fichier(s)`);

// Chapeaux : id du modèle (champ `hat` d'un poireau en combat) → image et placement.
const { hats } = await (await fetchOk(`${SITE}/api/hat/get-all`)).json();
const hatData = {};
for (const h of Object.values(hats)) {
  const file = path.join(OUT, "hat", `${h.name}.png`);
  if (!fs.existsSync(file)) continue;
  hatData[h.id] = { name: h.name, item: h.item, width: h.width, height: h.height, crop: h.crop, ...Object.fromEntries(Object.entries(pngSize(file)).map(([k, v]) => [`px_${k}`, v])) };
}
fs.writeFileSync(path.join(OUT, "hats.json"), JSON.stringify(hatData));
console.log(`hats.json : ${Object.keys(hatData).length} chapeau(x)`);

// Poireaux : SVG de face, un par stade × peau (les variantes métal / visage restent chargées depuis le site).
const leekDir = path.join(OUT, "leek");
fs.mkdirSync(leekDir, { recursive: true });
const names = [];
for (let a = 1; a <= APPEARANCES; a++) for (const s of Object.values(SKINS)) names.push(`leek_${a}_front_${s}.svg`);
let ok = 0;
await pool(names, 8, async (name) => {
  const r = await fetchOk(`${SITE}/image/leek/svg/${name}`);
  if (!r) return;
  fs.writeFileSync(path.join(leekDir, name), Buffer.from(await r.arrayBuffer()));
  ok++;
});
console.log(`leek/ : ${ok}/${names.length} SVG`);

// Messages des erreurs LeekScript (logs de combat de type 6 à 8 : clé `error_<code>`, paramètres {0}, {1}…).
const lsLang = await (await fetchOk("https://raw.githubusercontent.com/leek-wars/leek-wars/master/src/lang/fr/leekscript.json")).json();
const lsErrors = Object.fromEntries(Object.entries(lsLang).filter(([k]) => /^error_\d+$/.test(k)).map(([k, v]) => [k.slice(6), v]));
fs.writeFileSync(path.join(OUT, "leekscript-errors.json"), JSON.stringify(lsErrors));
console.log(`leekscript-errors.json : ${Object.keys(lsErrors).length} message(s)`);

const license = path.join(src, "LICENSE");
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(OUT, "LICENSE"));
else fs.writeFileSync(path.join(OUT, "LICENSE"), await (await fetchOk("https://raw.githubusercontent.com/leek-wars/leek-wars/master/LICENSE")).text());
fs.writeFileSync(path.join(OUT, "NOTICE.md"), `# Ressources Leek Wars

Images et polices issues du client Leek Wars (https://github.com/leek-wars/leek-wars, licence GPL v3, voir LICENSE)
et de https://leekwars.com. Récupérées par \`npm run assets\` (scripts/fetch-lw-assets.mjs) le ${new Date().toISOString().slice(0, 10)}.
Polices : Pixel Operator (CC0), Inter (SIL OFL).
`);
console.log(`Ressources Leek Wars dans ${OUT}`);
