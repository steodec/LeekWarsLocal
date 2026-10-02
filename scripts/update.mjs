// Met à jour une copie de travail (mode développement / `npm run server`) depuis GitHub.
//
//   npm run update
//
// git pull --ff-only, réinstalle les dépendances si package-lock.json a changé, reconstruit l'interface.
// L'application installée (Tauri) se met à jour toute seule depuis Paramètres → Mises à jour.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const out = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
const lockHash = () => crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, "package-lock.json"))).digest("hex");

if (out("git status --porcelain --untracked-files=no")) {
  console.error("Modifications locales non commitées : commitez-les ou mettez-les de côté (git stash) avant de mettre à jour.");
  process.exit(1);
}

const before = out("git rev-parse HEAD");
const lockBefore = lockHash();
sh("git pull --ff-only");
if (out("git rev-parse HEAD") === before) {
  console.log("Déjà à jour.");
  process.exit(0);
}

console.log("\nNouveautés :");
sh(`git log --oneline ${before}..HEAD`);
if (lockHash() !== lockBefore) sh("npm install");
sh("npm run build");
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
console.log(`\nLeekWars Local ${version} prêt. Redémarrez le serveur (npm run server) s'il tourne.`);
