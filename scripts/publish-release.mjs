// Publie la release GitHub de la version courante (appelé par .github/workflows/release.yml après `npm run build:app`).
//
// Assets :
//   LeekWarsLocal-setup.exe               nom stable → lien « dernière version » : releases/latest/download/LeekWarsLocal-setup.exe
//   LeekWarsLocal_<version>_x64-setup.exe + .sig, et latest.json (manifeste lu par l'updater de l'application).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.env.GITHUB_REPOSITORY || "steodec/LeekWarsLocal";
const ROOT = path.resolve(import.meta.dirname, "..");
const out = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const tag = `v${version}`;
const nsis = path.join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
const setup = fs.readdirSync(nsis).find((f) => f.endsWith(`_${version}_x64-setup.exe`));
if (!setup || !fs.existsSync(path.join(nsis, setup + ".sig"))) {
  console.error(`Installeur ou signature ${version} introuvable dans ${nsis} (TAURI_SIGNING_PRIVATE_KEY manquante ?)`);
  process.exit(1);
}

// Noms sans espace (GitHub remplace les espaces des noms d'assets).
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "lwl-release-"));
const asset = `LeekWarsLocal_${version}_x64-setup.exe`;
const files = {
  versioned: path.join(stage, asset),
  sig: path.join(stage, asset + ".sig"),
  stable: path.join(stage, "LeekWarsLocal-setup.exe"),
  manifest: path.join(stage, "latest.json"),
  notes: path.join(stage, "notes.md"),
};
fs.copyFileSync(path.join(nsis, setup), files.versioned);
fs.copyFileSync(path.join(nsis, setup), files.stable);
fs.copyFileSync(path.join(nsis, setup + ".sig"), files.sig);

// Notes : commits depuis la release précédente.
let previous = null;
try {
  previous = out("gh", ["release", "view", "--repo", REPO, "--json", "tagName", "-q", ".tagName"]);
} catch {
  /* première release */
}
let log = "";
try {
  log = out("git", ["log", "--pretty=format:- %s", previous ? `${previous}..HEAD` : "-20"]);
} catch {
  /* historique incomplet (checkout superficiel) */
}
const notes = log || `Version ${version}`;
fs.writeFileSync(files.notes, `${notes}\n\n**Installer** : téléchargez \`LeekWarsLocal-setup.exe\` ci-dessous. Les versions installées se mettent à jour toutes seules.\n`);

fs.writeFileSync(
  files.manifest,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: fs.readFileSync(files.sig, "utf8").trim(),
          url: `https://github.com/${REPO}/releases/download/${tag}/${asset}`,
        },
      },
    },
    null,
    2,
  ),
);

execFileSync(
  "gh",
  ["release", "create", tag, "--repo", REPO, "--target", process.env.GITHUB_SHA || "main", "--title", `LeekWars Local ${version}`,
    "--notes-file", files.notes, "--latest", files.stable, files.versioned, files.sig, files.manifest],
  { stdio: "inherit" },
);
console.log(`✓ ${tag} publiée : https://github.com/${REPO}/releases/tag/${tag}`);
