// Prépare une nouvelle version : la CI (.github/workflows/release.yml) construit et publie l'installeur
// dès que le commit arrive sur main.
//
//   npm run release -- <patch|minor|major|x.y.z>
//
// Incrémente la version (package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock),
// commit « Version x.y.z » et push la branche courante. Sur une autre branche que main,
// la release partira à la fusion de la PR.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const file = (...p) => path.join(ROOT, ...p);
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (out("git status --porcelain")) fail("Copie de travail non propre : commitez avant de publier.");

const bump = process.argv[2] ?? "patch";
const pkg = JSON.parse(fs.readFileSync(file("package.json"), "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
const version =
  bump === "major" ? `${maj + 1}.0.0` : bump === "minor" ? `${maj}.${min + 1}.0` : bump === "patch" ? `${maj}.${min}.${pat + 1}` : bump;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Version invalide : ${bump}`);
console.log(`Version ${pkg.version} → ${version}`);

const editJson = (p, fn) => {
  const j = JSON.parse(fs.readFileSync(file(p), "utf8"));
  fn(j);
  fs.writeFileSync(file(p), JSON.stringify(j, null, 2) + "\n");
};
editJson("package.json", (j) => (j.version = version));
editJson("package-lock.json", (j) => {
  j.version = version;
  if (j.packages?.[""]) j.packages[""].version = version;
});
editJson("src-tauri/tauri.conf.json", (j) => (j.version = version));
const replaceIn = (p, re, by) => fs.writeFileSync(file(p), fs.readFileSync(file(p), "utf8").replace(re, by));
replaceIn("src-tauri/Cargo.toml", /^version = ".*"$/m, `version = "${version}"`);
replaceIn("src-tauri/Cargo.lock", /(name = "leekwarslocal"\r?\nversion = )".*"/, `$1"${version}"`);

sh("git add -A");
sh(`git commit -m "Version ${version}"`);
const branch = out("git rev-parse --abbrev-ref HEAD");
sh(`git push origin ${branch}`);
console.log(
  branch === "main"
    ? `\n✓ Poussé sur main : la CI publie v${version} (https://github.com/steodec/LeekWarsLocal/actions).`
    : `\n✓ Poussé sur ${branch} : v${version} sera publiée à la fusion dans main.`,
);
