// Compile le serveur Node (server/) en un exécutable autonome (Node "Single Executable Application")
// et le place là où Tauri l'attend comme sidecar : src-tauri/binaries/leekwars-server-<triple>(.exe).
//
//   npm run build:server
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "build");
const BIN_DIR = path.join(ROOT, "src-tauri", "binaries");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BIN_DIR, { recursive: true });

// 1. Un seul fichier CommonJS (exigé par SEA). node:* reste externe (modules intégrés).
await build({
  entryPoints: [path.join(ROOT, "server", "main.js")],
  outfile: path.join(OUT, "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  logLevel: "warning",
  // import.meta.url n'est utilisé qu'en repli quand __dirname est absent (exécution ESM directe).
  logOverride: { "empty-import-meta": "silent" },
});

// 2. Blob SEA.
const seaConfig = path.join(OUT, "sea-config.json");
fs.writeFileSync(
  seaConfig,
  JSON.stringify({ main: path.join(OUT, "server.cjs"), output: path.join(OUT, "sea-prep.blob"), disableExperimentalSEAWarning: true }),
);
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

// 3. Copie de node.exe + injection du blob.
const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/host: (\S+)/)[1];
const ext = process.platform === "win32" ? ".exe" : "";
const target = path.join(BIN_DIR, `leekwars-server-${triple}${ext}`);
fs.copyFileSync(process.execPath, target);
const args = [target, "NODE_SEA_BLOB", path.join(OUT, "sea-prep.blob"), "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
execFileSync(process.execPath, [path.join(ROOT, "node_modules", "postject", "dist", "cli.js"), ...args], { stdio: "inherit" });

console.log(`Serveur autonome : ${path.relative(ROOT, target)} (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} Mo)`);
