// Serveur local LeekWarsLocal : API REST (pour l'interface et pour les scripts / Claude)
// + service des fichiers statiques de l'interface (dist/).
//
//   npm run server      → http://127.0.0.1:3737   (API sous /api, doc : GET /api)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LeekWarsClient, LeekWarsError } from "./lw.js";
import { Db } from "./db.js";
import { analyzeFight, ANALYSIS_VERSION, CONTEXTS, TYPES } from "./analyze.js";
import { computeStats } from "./stats.js";
import { characteristicsView, CHARACTERISTICS } from "./capital.js";
import { leekProfile, aggregateMeta } from "./meta.js";
import { PROVIDERS, DEFAULT_PROMPT, AiError, aiSettings, resolveProvider, formatLogs, fightDigest, collectAiCode, buildUserMessage, runAnalysis, checkKey } from "./ai.js";

// Emplacement des données : le dossier applicatif de l'application de bureau (%APPDATA%\com.steodec.leekwarslocal),
// en dev comme dans l'application packagée (Tauri fournit LWL_DATA_DIR). Une seule base, quel que soit le serveur
// lancé : l'application réutilise un `npm run server` déjà démarré, et deux emplacements donnaient deux bases.
const APP_ID = "com.steodec.leekwarslocal";
function appDataDir() {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), APP_ID);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", APP_ID);
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), APP_ID);
}
const ROOT = process.env.LWL_ROOT || path.resolve(typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.LWL_DATA_DIR || appDataDir();
for (const file of [path.join(ROOT, ".env"), path.join(DATA, ".env")]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* .env optionnel : les comptes se gèrent dans Paramètres */
  }
}

const PORT = Number(process.env.LWL_PORT || 3737);
const HOST = process.env.LWL_HOST || "127.0.0.1";
const DIST = process.env.LWL_DIST_DIR || path.join(ROOT, "dist");
const ENV_API_KEY = process.env.LEEKWARS_API_KEY || null;

const db = new Db(path.join(DATA, "leekwars.db"));
const migration = db.migrateFromJson(DATA);
if (migration) console.log(`Migration JSON → SQLite : ${migration.fights} combat(s) importé(s) (ancien stockage dans data/legacy-json/).`);

// Ancien emplacement en dev (data/ du projet) : fusionné une fois dans la base courante, puis laissé en place.
const LEGACY_DB = path.join(ROOT, "data", "leekwars.db");
if (path.resolve(LEGACY_DB) !== path.resolve(DATA, "leekwars.db") && fs.existsSync(LEGACY_DB) && !db.get("mergedFrom")?.[LEGACY_DB]) {
  try {
    const merged = db.mergeFrom(LEGACY_DB);
    db.set("mergedFrom", { ...db.get("mergedFrom"), [LEGACY_DB]: { at: Date.now(), ...merged } });
    console.log(`Ancienne base ${LEGACY_DB} fusionnée :`, merged);
  } catch (e) {
    console.warn(`Fusion de ${LEGACY_DB} impossible :`, e.message);
  }
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const maskKey = (k) => (k ? (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "••••") : null);

// ---------------------------------------------------------------------------
// Comptes Leek Wars (un éleveur + sa clé API). Un compte est "actif" (vue éleveur par défaut,
// combats éleveur), mais toute action sur un poireau passe par le compte qui le possède.
// ---------------------------------------------------------------------------

/** Client sans authentification, pour les routes publiques (combats, profils, catalogue). */
const publicLw = new LeekWarsClient({});
const clients = new Map();
const farmerCache = new Map(); // accountId → { at, farmer }

function clientFor(account) {
  const c = clients.get(account.id);
  if (c && c.apiKey === account.api_key) return c;
  const fresh = new LeekWarsClient({ apiKey: account.api_key });
  clients.set(account.id, fresh);
  // Détecte LW+ au plus tôt pour passer la limite de 5 à 10 requêtes/s.
  farmerCache.delete(account.id);
  farmerOf(account).catch(() => {});
  return fresh;
}

function noAccountError() {
  return new HttpError(401, "Aucun compte Leek Wars configuré : ajoutez une clé API dans Paramètres.", "no_api_key");
}

function activeAccount() {
  const list = db.accounts();
  const id = db.get("activeAccount");
  return list.find((a) => a.id === id) ?? list[0] ?? null;
}

/** Client du compte actif (routes authentifiées sans poireau précis : historique, proxy…). */
function lwActive() {
  const a = activeAccount();
  if (!a) throw noAccountError();
  return clientFor(a);
}

async function farmerOf(account, force = false) {
  const c = farmerCache.get(account.id);
  if (!force && c && Date.now() - c.at < 60_000) return c.farmer;
  const client = clientFor(account);
  const { farmer } = await client.me();
  client.setLwPlus(farmer.lwplus);
  farmerCache.set(account.id, { at: Date.now(), farmer });
  if (farmer.name !== account.name) db.putAccount({ id: account.id, name: farmer.name, apiKey: account.api_key });
  return farmer;
}

/** Éleveur du compte actif. */
async function farmer(force = false) {
  const a = activeAccount();
  if (!a) throw noAccountError();
  return farmerOf(a, force);
}

/** Éleveurs de tous les comptes (ceux dont la clé ne répond plus sont ignorés). */
async function allFarmers(force = false) {
  const out = [];
  for (const a of db.accounts()) {
    try {
      out.push({ account: a, farmer: await farmerOf(a, force) });
    } catch (e) {
      console.warn(`Compte ${a.name} indisponible : ${e.message}`);
    }
  }
  return out;
}

const myFarmerIds = () => new Set(db.accounts().map((a) => a.id));
const activeFarmerId = () => activeAccount()?.id ?? null;

/** Compte propriétaire d'un poireau, s'il est à moi. */
async function ownerOf(leekId) {
  for (const { account, farmer: f } of await allFarmers()) {
    if (f.leeks?.[leekId]) return { account, farmer: f, leek: f.leeks[leekId], client: clientFor(account) };
  }
  return null;
}

async function assertOwned(leekId) {
  const o = await ownerOf(Number(leekId));
  if (!o) throw new HttpError(403, `Le poireau #${leekId} n'appartient à aucun de vos comptes : analyse seulement.`);
  return o;
}

/** Ajoute un compte depuis une clé API (vérifiée), suit ses poireaux et analyse ses combats déjà stockés. */
async function addAccount(apiKey, { activate = false, trackLeeks = true } = {}) {
  const key = String(apiKey ?? "").trim();
  if (!key) throw new HttpError(400, "Clé API vide");
  let f;
  try {
    f = (await new LeekWarsClient({ apiKey: key }).me()).farmer;
  } catch (e) {
    throw new HttpError(400, `Clé refusée par Leek Wars (${e.body?.error ?? e.message})`);
  }
  const existed = !!db.account(f.id);
  db.putAccount({ id: f.id, name: f.name, apiKey: key });
  farmerCache.set(f.id, { at: Date.now(), farmer: f });
  if (activate || !db.get("activeAccount")) db.set("activeAccount", f.id);
  if (!existed) {
    if (trackLeeks) {
      for (const l of Object.values(f.leeks ?? {})) {
        db.trackLeek({ id: l.id, name: l.name, farmerId: f.id, farmerName: f.name, owned: true, info: leekView(l) });
        await indexPerspective({ leekId: l.id }, db.fightIdsOfLeek(l.id));
      }
      db.set("trackedInit", true);
    }
    await indexPerspective({ farmerId: f.id }, db.fightIdsOfFarmer(f.id));
  }
  return { account: { id: f.id, name: f.name, leeks: Object.keys(f.leeks ?? {}).length }, existed };
}

/** Démarrage : reprend l'ancienne clé unique (interface puis .env) comme premier compte. */
async function migrateKeys() {
  const legacy = db.get("apiKey");
  if (legacy) {
    try {
      await addAccount(legacy, { trackLeeks: false });
      db.set("apiKey", null);
    } catch (e) {
      console.warn("Ancienne clé API non reprise :", e.message);
    }
  }
  // La clé du .env est importée une seule fois (la supprimer dans l'interface reste définitif).
  if (ENV_API_KEY && db.get("envKeyImported") !== ENV_API_KEY && !db.accounts().some((a) => a.api_key === ENV_API_KEY)) {
    try {
      await addAccount(ENV_API_KEY, { trackLeeks: false });
      db.set("envKeyImported", ENV_API_KEY);
      console.log("Clé du .env ajoutée comme compte.");
    } catch (e) {
      console.warn("Clé du .env refusée :", e.message);
    }
  }
  // Anciennes données : la liste de poireaux suivis initiale vient du premier compte.
  if (!db.get("trackedInit")) {
    const first = db.accounts()[0];
    if (first) {
      const f = await farmerOf(first);
      const legacyIds = migration?.legacyTracked;
      const ids = (legacyIds?.length ? legacyIds : Object.keys(f.leeks).map(Number)).filter((id) => f.leeks[id]);
      for (const id of ids) db.trackLeek({ id, name: f.leeks[id].name, farmerId: f.id, farmerName: f.name, owned: true, info: leekView(f.leeks[id]) });
      db.set("trackedInit", true);
    }
  }
}

let catalog = null;
async function getCatalog() {
  if (catalog) return catalog;
  let raw = db.get("catalog");
  if (!raw || Date.now() - raw.at > 24 * 3600_000) {
    const [c, w] = await Promise.all([publicLw.chips(), publicLw.weapons()]);
    raw = { at: Date.now(), chips: Object.values(c.chips), weapons: Object.values(w.weapons) };
    db.set("catalog", raw);
  }
  catalog = {
    // Les actions de combat référencent le "template" ; l'inventaire d'un poireau référence l'"item".
    chips: new Map(raw.chips.map((x) => [x.template, x])),
    weapons: new Map(raw.weapons.map((x) => [x.template, x])),
    chipsById: new Map(raw.chips.map((x) => [x.id, x])),
    weaponsByItem: new Map(raw.weapons.map((x) => [x.item, x])),
  };
  return catalog;
}

// ---------------------------------------------------------------------------
// Poireaux suivis : les miens (tous comptes confondus) ou n'importe lequel (analyse)
// ---------------------------------------------------------------------------

function leekView(l) {
  return {
    id: l.id, name: l.name, level: l.level, talent: l.talent, ai: l.ai_path ?? null, capital: l.capital ?? null,
    life: l.total_life ?? null, tp: l.total_tp ?? null, mp: l.total_mp ?? null,
    // Apparence. `hat` : id du modèle de chapeau ; l'API donne un objet d'inventaire, avec `hat_template` chez l'éleveur,
    // seulement l'item (`template`) dans leek/get : l'interface le retrouve alors via hats.json.
    skin: l.skin ?? 1, metal: !!l.metal, face: l.face ?? 0,
    hat: (l.hat && typeof l.hat === "object" ? l.hat.hat_template : l.hat) ?? null,
    hatItem: l.hat && typeof l.hat === "object" ? l.hat.template ?? null : null,
  };
}

/** Liste des poireaux suivis, enrichie avec les données fraîches du compte propriétaire pour les miens. */
async function trackedLeeks() {
  const owners = new Map();
  for (const { account, farmer: f } of await allFarmers()) for (const l of Object.values(f.leeks ?? {})) owners.set(l.id, { account, leek: l });
  return db.trackedLeeks().map((t) => {
    const own = owners.get(t.id);
    const info = own ? leekView(own.leek) : t.info ?? {};
    return {
      ...info, id: t.id, name: own?.leek.name ?? t.name, owned: !!own,
      accountId: own?.account.id ?? null, accountName: own?.account.name ?? null,
      farmerId: own?.account.id ?? t.farmer_id, farmerName: own?.account.name ?? t.farmer_name, addedAt: t.added_at,
    };
  });
}

async function trackedIds() {
  return db.trackedLeeks().map((t) => t.id);
}

/** Profil public d'un poireau (n'importe lequel). */
async function publicLeek(id) {
  const res = await publicLw.get("leek/get", id);
  return res.leek ?? res;
}

async function privateLeek(client, id) {
  const res = await client.leek(id);
  return res.leek ?? res;
}

// ---------------------------------------------------------------------------
// Import & analyse (une analyse par perspective : chacun de mes éleveurs "f<id>" + chaque poireau suivi présent "l<id>")
// ---------------------------------------------------------------------------

function perspectivesWith(raw, fids, tracked) {
  const leeks = [...(raw.leeks1 || []), ...(raw.leeks2 || [])];
  const out = [];
  for (const fid of new Set(leeks.map((l) => l.farmer))) if (fids.has(fid)) out.push({ farmerId: fid });
  for (const l of leeks) if (tracked.has(l.id)) out.push({ leekId: l.id });
  return out;
}

const perspectivesFor = (raw) => perspectivesWith(raw, myFarmerIds(), new Set(db.trackedLeeks().map((t) => t.id)));

/** Enregistre un combat et ses résumés par perspective. Renvoie le résumé "principal" (compte actif si possible). */
async function indexFight(raw, source) {
  db.putFight(raw, source);
  analysisCache.forEach((_, k) => k.startsWith(`${raw.id}:`) && analysisCache.delete(k));
  if (raw.status !== 2) return null;
  const cat = await getCatalog();
  const active = activeFarmerId();
  let main = null;
  for (const p of perspectivesFor(raw)) {
    const { summary } = analyzeFight(raw, p, cat);
    db.putParticipation(summary, ANALYSIS_VERSION);
    if (!main || p.farmerId === active) main = summary;
  }
  return main ?? analyzeFight(raw, { leekId: raw.leeks1?.[0]?.id }, cat).summary;
}

async function importFight(id, { source = "sync", force = false } = {}) {
  if (!force && db.hasFight(id)) return null;
  return indexFight(await publicLw.fight(id), source);
}

/** (Ré)analyse des combats déjà stockés pour une perspective (ex. poireau ou compte qu'on vient d'ajouter). */
async function indexPerspective(perspective, fightIds) {
  const cat = await getCatalog();
  let n = 0;
  db.tx(() => {
    for (const id of fightIds) {
      const raw = db.raw(id);
      if (!raw) continue;
      const { summary } = analyzeFight(raw, perspective, cat);
      if (!summary.mySide) continue;
      db.putParticipation(summary, ANALYSIS_VERSION);
      n++;
    }
  });
  return n;
}

/** Ré-analyse : combats dont l'analyse est d'une ancienne version, ou sans aucune analyse (migration). */
async function reanalyze() {
  const outdated = new Set(db.outdatedFightIds(ANALYSIS_VERSION));
  const missing = Object.keys(db.countByPerspective()).length ? [] : db.allFightIds();
  const ids = [...new Set([...outdated, ...missing])];
  if (!ids.length) return;
  const cat = await getCatalog();
  const fids = myFarmerIds();
  const tracked = new Set(db.trackedLeeks().map((t) => t.id));
  db.tx(() => {
    for (const id of ids) {
      const raw = db.raw(id);
      if (!raw) continue;
      for (const p of perspectivesWith(raw, fids, tracked)) db.putParticipation(analyzeFight(raw, p, cat).summary, ANALYSIS_VERSION);
    }
  });
  console.log(`${ids.length} combat(s) analysé(s) (v${ANALYSIS_VERSION}).`);
}

const analysisCache = new Map();
/** Analyse détaillée à la volée, depuis n'importe quel point de vue présent dans le combat. */
async function analysisOf(id, perspective) {
  const key = `${id}:${JSON.stringify(perspective)}`;
  if (analysisCache.has(key)) return analysisCache.get(key);
  const raw = db.raw(id);
  if (!raw) return null;
  const res = analyzeFight(raw, perspective, await getCatalog());
  if (analysisCache.size > 200) analysisCache.delete(analysisCache.keys().next().value);
  analysisCache.set(key, res);
  return res;
}

/** Perspective d'une requête : ?leek=<id> → ce poireau ; ?account=<id> → cet éleveur ; sinon le compte actif. */
function perspectiveKey(q) {
  if (q.leek) return `l${Number(q.leek)}`;
  const fid = Number(q.account) || activeFarmerId();
  if (!fid) throw noAccountError();
  return `f${fid}`;
}

// ---------------------------------------------------------------------------
// Tâches de fond (lancement de combats, synchronisation)
// ---------------------------------------------------------------------------

const jobs = new Map();
let jobSeq = 0;
function createJob(kind, params, fn) {
  const job = {
    id: ++jobSeq, kind, params, status: "running", progress: { done: 0, total: 0 },
    fights: [], log: [], error: null, startedAt: Date.now(), endedAt: null,
  };
  const log = (msg) => {
    job.log.push(`${new Date().toLocaleTimeString("fr-FR")} ${msg}`);
    if (job.log.length > 200) job.log.shift();
  };
  jobs.set(job.id, job);
  fn(job, log)
    .then(() => (job.status = "done"))
    .catch((e) => {
      job.status = "error";
      job.error = e.message;
      log("Erreur : " + e.message);
    })
    .finally(() => {
      job.endedAt = Date.now();
      if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
    });
  return job;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend la fin des combats lancés puis les importe. */
async function waitAndImport(job, log, ids, source) {
  const pending = new Set(ids);
  const deadline = Date.now() + 5 * 60_000;
  while (pending.size && Date.now() < deadline) {
    await sleep(2000);
    for (const id of [...pending]) {
      const raw = await publicLw.fight(id);
      if (raw.status !== 2) continue;
      const s = await indexFight(raw, source);
      pending.delete(id);
      job.progress.done++;
      const f = job.fights.find((x) => x.id === id);
      if (f) Object.assign(f, { result: s?.result, turns: s?.turns });
      log(`Combat ${id} terminé : ${s?.result} (${s?.turns ?? "?"} tours)`);
    }
  }
  if (pending.size) log(`${pending.size} combat(s) toujours en cours, relancer /api/sync plus tard.`);
}

function pickOpponent(opponents, strategy, myTalent) {
  if (!opponents.length) return null;
  switch (strategy) {
    case "strongest":
      return [...opponents].sort((a, b) => b.talent - a.talent)[0];
    case "random":
      return opponents[Math.floor(Math.random() * opponents.length)];
    case "closest":
      return [...opponents].sort((a, b) => Math.abs(a.talent - myTalent) - Math.abs(b.talent - myTalent))[0];
    case "weakest":
    default:
      return [...opponents].sort((a, b) => a.talent - b.talent)[0];
  }
}

function extractFightIds(res) {
  if (res == null) return [];
  if (typeof res === "number") return [res];
  if (Array.isArray(res)) return res.flatMap(extractFightIds);
  if (Array.isArray(res.fights)) return res.fights.flatMap(extractFightIds);
  if (res.fight != null) return extractFightIds(res.fight);
  if (res.id != null) return [res.id];
  return [];
}

const isTargetGone = (e) => e instanceof LeekWarsError && /target_not_in_garden/.test(String(e.body?.error ?? e.message));

/**
 * Lance un combat contre la cible fixée ou un adversaire choisi dans le potager.
 * Les adversaires du potager changent après chaque combat : si la cible n'y est
 * plus (error_fight_target_not_in_garden), on recharge la liste sans elle et on réessaie.
 */
async function startAgainstPicked({ targetId, fetchOpponents, strategy, talent, start, log, tries = 5 }) {
  const excluded = new Set();
  for (let attempt = 1; ; attempt++) {
    let target = targetId ? { id: Number(targetId), name: `#${targetId}` } : null;
    if (!target) {
      const opponents = (await fetchOpponents()).filter((o) => !excluded.has(o.id));
      target = pickOpponent(opponents, strategy, talent);
      if (!target) throw new Error("Aucun adversaire disponible");
    }
    try {
      const [id] = extractFightIds(await start(target.id));
      return { id, target };
    } catch (e) {
      if (!isTargetGone(e)) throw e;
      if (targetId) throw new HttpError(409, `La cible ${target.name} n'est pas dans le potager (adversaires disponibles seulement)`);
      if (attempt >= tries) throw new Error(`Aucun adversaire du potager accepté après ${tries} essais`);
      excluded.add(target.id);
      log(`${target.name} n'est plus dans le potager, choix d'un autre adversaire (essai ${attempt + 1}/${tries})`);
      await sleep(400 * attempt);
    }
  }
}

/** Lance `count` combats un par un ; en cas d'échec, garde ceux déjà lancés pour les importer. */
async function launchLoop(count, ids, log, launchOne) {
  for (let i = 0; i < count; i++) {
    try {
      ids.push(await launchOne());
    } catch (e) {
      if (!ids.length) throw e;
      log(`Arrêt après ${ids.length}/${count} combat(s) : ${e.message}`);
      return e;
    }
  }
  return null;
}

async function ensureFightsLeft(client, count, accountName) {
  const { garden } = await client.garden();
  if (garden.fights < count) throw new HttpError(409, `Combats restants insuffisants sur ${accountName} : ${garden.fights} < ${count}`);
  return garden;
}

async function launchSolo({ leekId, targetId, strategy = "weakest", count = 1, batch = false }) {
  leekId = Number(leekId);
  count = clamp(Number(count) || 1, 1, 100);
  if (!leekId) throw new HttpError(400, "leekId requis");
  const { client, account, leek: me } = await assertOwned(leekId);
  return createJob("solo", { leekId, targetId, strategy, count, batch, account: account.name }, async (job, log) => {
    await ensureFightsLeft(client, count, account.name);
    job.progress.total = count;
    const ids = [];
    if (batch && !targetId) {
      ids.push(...extractFightIds(await client.startSoloFightBatch(leekId, count)));
      log(`Lot lancé : ${ids.length} combat(s)`);
      for (const id of ids) job.fights.push({ id, opponent: null, result: "pending" });
    }
    const failure = batch && !targetId ? null : await launchLoop(count, ids, log, async () => {
      const { id, target } = await startAgainstPicked({
        targetId, strategy, talent: me.talent ?? 0, log,
        fetchOpponents: async () => (await client.leekOpponents(leekId)).opponents ?? [],
        start: (tid) => client.startSoloFight(leekId, tid),
      });
      job.fights.push({ id, opponent: { id: target.id, name: target.name, level: target.level, talent: target.talent }, result: "pending" });
      log(`Combat ${id} lancé contre ${target.name} (niv. ${target.level ?? "?"}, talent ${target.talent ?? "?"})`);
      return id;
    });
    await waitAndImport(job, log, ids, "launch");
    farmerCache.delete(account.id);
    if (failure) throw failure;
  });
}

function accountOrActive(accountId) {
  const a = accountId ? db.account(Number(accountId)) : activeAccount();
  if (!a) throw accountId ? new HttpError(404, `Compte #${accountId} inconnu`) : noAccountError();
  return a;
}

function launchFarmer({ targetId, strategy = "weakest", count = 1, batch = false, accountId }) {
  count = clamp(Number(count) || 1, 1, 100);
  const account = accountOrActive(accountId);
  const client = clientFor(account);
  return createJob("farmer", { targetId, strategy, count, batch, account: account.name }, async (job, log) => {
    await ensureFightsLeft(client, count, account.name);
    job.progress.total = count;
    const ids = [];
    if (batch && !targetId) {
      ids.push(...extractFightIds(await client.post("garden/start-farmer-fight-batch", { count })));
      for (const id of ids) job.fights.push({ id, opponent: null, result: "pending" });
      log(`Lot éleveur lancé : ${ids.length} combat(s)`);
    }
    const me = batch && !targetId ? null : await farmerOf(account);
    const failure = !me ? null : await launchLoop(count, ids, log, async () => {
      const { id, target } = await startAgainstPicked({
        targetId, strategy, talent: me.talent, log,
        fetchOpponents: async () => (await client.farmerOpponents()).opponents ?? [],
        start: (tid) => client.startFarmerFight(tid),
      });
      job.fights.push({ id, opponent: { id: target.id, name: target.name, talent: target.talent }, result: "pending" });
      log(`Combat éleveur ${id} lancé contre ${target.name} (compte ${account.name})`);
      return id;
    });
    await waitAndImport(job, log, ids, "launch");
    if (failure) throw failure;
  });
}

async function launchChallenge({ leekId, targetId, seed = 0, side = "random", count = 1 }) {
  if (!leekId || !targetId) throw new HttpError(400, "leekId et targetId requis");
  const { client, account } = await assertOwned(Number(leekId));
  count = clamp(Number(count) || 1, 1, 50);
  return createJob("challenge", { leekId, targetId, seed, side, count, account: account.name }, async (job, log) => {
    job.progress.total = count;
    const ids = [];
    for (let i = 0; i < count; i++) {
      const s = Number(seed) || 0;
      const [id] = extractFightIds(await client.startSoloChallenge(Number(leekId), Number(targetId), s, side));
      ids.push(id);
      job.fights.push({ id, opponent: { id: Number(targetId) }, result: "pending" });
      log(`Défi ${id} lancé (seed ${s || "aléatoire"}, côté ${side})`);
    }
    await waitAndImport(job, log, ids, "challenge");
  });
}

// IA de test fournies par Leek Wars (chemins tels qu'attendus par l'éditeur, `confirmed` sans « / ») et bots adverses.
const TEST_AIS = {
  lambda: { path: "/lambda", name: "Lambda" },
  normal: { path: "/normal", name: "Normal" },
  confirmed: { path: "confirmed", name: "Confirmé" },
  expert: { path: "/expert", name: "Expert" },
};
const TEST_BOTS = {
  "-1": { name: "Domingo", profile: "force" },
  "-2": { name: "Betalpha", profile: "magie" },
  "-3": { name: "Tisma", profile: "sagesse" },
  "-4": { name: "Guj", profile: "vie" },
  "-5": { name: "Hachess", profile: "résistance" },
  "-6": { name: "Rex", profile: "science" },
};

// La clé API (rôle « player ») peut lire les scénarios et les lancer, mais pas les créer ni les modifier
// (scope « session ») : on réutilise donc les scénarios préparés dans l'éditeur Leek Wars.
const testAiKey = (path) => {
  const key = String(path ?? "").replace(/^\/+/, "");
  return TEST_AIS[key] ? key : null;
};

function describeScenario(s, leekNames) {
  const member = (l) => ({
    id: l.id, ai: l.ai ?? null, aiKey: testAiKey(l.ai),
    name: l.id < 0 ? TEST_BOTS[l.id]?.name ?? `Bot ${l.id}` : leekNames.get(l.id) ?? `#${l.id}`,
  });
  return { id: s.id, name: s.name, type: s.type, seed: s.seed ?? null, map: s.map ?? null, team1: (s.team1 ?? []).map(member), team2: (s.team2 ?? []).map(member) };
}

/** Scénarios du compte, et pour chaque IA de test celui où `leekId` affronte uniquement des bots qui la jouent. */
async function testScenariosFor(client, account, leekId) {
  const { scenarios } = await client.testScenarios();
  const f = await farmerOf(account);
  const leekNames = new Map(Object.values(f.leeks ?? {}).map((l) => [l.id, l.name]));
  const list = Object.values(scenarios ?? {}).map((s) => describeScenario(s, leekNames)).sort((a, b) => a.id - b.id);
  const byAi = {};
  for (const key of Object.keys(TEST_AIS)) {
    byAi[key] = list.find((s) => s.team1.some((l) => l.id === leekId) && s.team2.length && s.team2.every((l) => l.id < 0 && l.aiKey === key)) ?? null;
  }
  return { scenarios: list, byAi };
}

async function launchTest({ leekId, ais, scenarioIds, count = 1, aiPath }) {
  leekId = Number(leekId);
  if (!leekId) throw new HttpError(400, "leekId requis");
  count = clamp(Number(count) || 1, 1, 50);
  const { client, account, leek } = await assertOwned(leekId);
  const { scenarios, byAi } = await testScenariosFor(client, account, leekId);
  // Scénarios à jouer : ceux demandés explicitement, sinon celui de chaque IA de test demandée (toutes par défaut).
  let plan;
  if (scenarioIds?.length) {
    plan = scenarioIds.map(Number).map((id) => {
      const s = scenarios.find((x) => x.id === id);
      if (!s) throw new HttpError(404, `Scénario de test #${id} introuvable sur ${account.name}`);
      if (!s.team1.some((l) => l.id === leekId)) throw new HttpError(400, `${leek.name} n'est pas dans l'équipe 1 du scénario « ${s.name} »`);
      return { scenario: s, aiKey: s.team2.find((l) => l.aiKey)?.aiKey ?? null };
    });
  } else {
    const keys = (Array.isArray(ais) ? ais : ais ? String(ais).split(",") : Object.keys(TEST_AIS)).map((k) => String(k).trim());
    const unknown = keys.filter((k) => !TEST_AIS[k]);
    if (unknown.length || !keys.length) throw new HttpError(400, `IA de test inconnue : ${unknown.join(", ") || "aucune"} (${Object.keys(TEST_AIS).join(", ")})`);
    const missing = keys.filter((k) => !byAi[k]);
    if (missing.length) {
      throw new HttpError(409, `Aucun scénario de test pour ${leek.name} contre ${missing.map((k) => TEST_AIS[k].path).join(", ")} : `
        + `dans l'éditeur Leek Wars (onglet Test), créez un scénario avec ${leek.name} en équipe 1 et un bot avec cette IA en équipe 2 `
        + `(la clé API ne permet pas de créer les scénarios).`, "no_test_scenario");
    }
    plan = keys.map((k) => ({ scenario: byAi[k], aiKey: k }));
  }
  return createJob("test", { leekId, ais: plan.map((p) => p.aiKey), scenarios: plan.map((p) => p.scenario.id), count, account: account.name }, async (job, log) => {
    job.progress.total = plan.length * count;
    const ids = [];
    const failure = await launchLoop(plan.length * count, ids, log, async () => {
      const { scenario, aiKey } = plan[Math.floor(ids.length / count)];
      // IA jouée par mon poireau : celle demandée, sinon celle équipée (l'IA du scénario dépend du fichier ouvert dans l'éditeur).
      const path = aiPath || leek.ai_path || scenario.team1.find((l) => l.id === leekId)?.ai;
      if (!path) throw new HttpError(409, `${leek.name} n'a pas d'IA équipée : précisez aiPath`);
      const [id] = extractFightIds(await client.startTestFight(scenario.id, path));
      const bots = scenario.team2.map((l) => l.name).join(", ");
      job.fights.push({ id, opponent: { id: scenario.team2[0]?.id, name: bots }, testAi: aiKey, scenario: { id: scenario.id, name: scenario.name, seed: scenario.seed }, result: "pending" });
      log(`Test ${id} lancé : ${path} contre ${bots}${aiKey ? ` (IA ${TEST_AIS[aiKey].name})` : ""}, scénario « ${scenario.name} »`);
      return id;
    });
    await waitAndImport(job, log, ids, "test");
    if (failure) throw failure;
  });
}

// ---------------------------------------------------------------------------
// Combats d'équipe et de boss
// ---------------------------------------------------------------------------

/**
 * Compte qui lance avec la composition `compositionId` (garden/get → my_compositions). Une composition appartient à
 * l'équipe : plusieurs de mes comptes peuvent la jouer, chacun avec ses combats d'équipe ; `accountId` choisit lequel.
 */
async function compositionOwner(compositionId, accountId) {
  for (const account of db.accounts()) {
    if (accountId && account.id !== Number(accountId)) continue;
    try {
      const { garden } = await clientFor(account).garden();
      const composition = (garden.my_compositions ?? []).find((c) => c.id === compositionId);
      if (composition) return { account, client: clientFor(account), composition, garden };
    } catch (e) {
      console.warn(`Compositions de ${account.name} indisponibles : ${e.message}`);
    }
  }
  throw new HttpError(404, `Composition #${compositionId} introuvable dans vos comptes`);
}

async function launchTeam({ compositionId, accountId, targetId, strategy = "weakest", count = 1, batch = false }) {
  compositionId = Number(compositionId);
  if (!compositionId) throw new HttpError(400, "compositionId requis");
  count = clamp(Number(count) || 1, 1, 100);
  const { account, client, composition, garden } = await compositionOwner(compositionId, accountId);
  if (garden.team_fights < count) throw new HttpError(409, `Combats d'équipe restants insuffisants sur ${account.name} : ${garden.team_fights} < ${count}`);
  return createJob("team", { compositionId, composition: composition.name, targetId, strategy, count, batch, account: account.name }, async (job, log) => {
    job.progress.total = count;
    const ids = [];
    if (batch && !targetId) {
      ids.push(...extractFightIds(await client.startTeamFightBatch(compositionId, count)));
      for (const id of ids) job.fights.push({ id, opponent: null, result: "pending" });
      log(`Lot d'équipe lancé : ${ids.length} combat(s)`);
    }
    const failure = batch && !targetId ? null : await launchLoop(count, ids, log, async () => {
      const { id, target } = await startAgainstPicked({
        targetId, strategy, talent: composition.talent ?? 0, log,
        fetchOpponents: async () => (await client.compositionOpponents(compositionId)).opponents ?? [],
        start: (tid) => client.startTeamFight(compositionId, tid),
      });
      const name = target.team_name ? `${target.name} [${target.team_name}]` : target.name;
      job.fights.push({ id, opponent: { id: target.id, name, talent: target.talent }, result: "pending" });
      log(`Combat d'équipe ${id} lancé : ${composition.name} contre ${name}`);
      return id;
    });
    await waitAndImport(job, log, ids, "launch");
    if (failure) throw failure;
  });
}

async function launchBoss({ bossId, leekIds, count = 1, batch = false }) {
  bossId = Number(bossId);
  const participants = [...new Set((leekIds ?? []).map(Number).filter(Boolean))];
  if (!bossId || !participants.length) throw new HttpError(400, "bossId et leekIds requis");
  if (participants.length > 8) throw new HttpError(400, "8 poireaux au plus contre un boss");
  count = clamp(Number(count) || 1, 1, 100);
  const owners = await Promise.all(participants.map((id) => assertOwned(id)));
  const { client, account } = owners[0];
  if (owners.some((o) => o.account.id !== account.id)) throw new HttpError(400, "Les poireaux engagés contre un boss doivent appartenir au même compte");
  const names = owners.map((o) => o.leek.name).join(", ");
  return createJob("boss", { bossId, leekIds: participants, count, batch, account: account.name }, async (job, log) => {
    await ensureFightsLeft(client, count, account.name);
    job.progress.total = count;
    const ids = [];
    if (batch) {
      ids.push(...extractFightIds(await client.startBossFightBatch(bossId, participants, count)));
      for (const id of ids) job.fights.push({ id, opponent: null, result: "pending" });
      log(`Lot de ${ids.length} combat(s) de boss lancé avec ${names}`);
    }
    const failure = batch ? null : await launchLoop(count, ids, log, async () => {
      const [id] = extractFightIds(await client.startBossFight(bossId, participants));
      job.fights.push({ id, opponent: { id: -bossId, name: `Boss #${bossId}` }, result: "pending" });
      log(`Combat de boss ${id} lancé avec ${names}`);
      return id;
    });
    await waitAndImport(job, log, ids, "launch");
    farmerCache.delete(account.id);
    if (failure) throw failure;
  });
}

// ---------------------------------------------------------------------------
// Arène : l'inscription expire (`expires_in`) ; on la renouvelle tant que l'utilisateur ne quitte pas la salle.
// ---------------------------------------------------------------------------

const arenaKeepAlive = new Map(); // accountId → { leekId, leekName, preference, timer, since, until, lastError }
const ARENA_MAX_WAIT = 3 * 3600_000;

function stopArenaKeepAlive(accountId) {
  const k = arenaKeepAlive.get(accountId);
  if (k) clearTimeout(k.timer);
  arenaKeepAlive.delete(accountId);
}

async function registerArena({ leekId, preference = -1, keep = true }) {
  const { account, client, leek } = await assertOwned(Number(leekId));
  if (leek.level < 20) throw new HttpError(409, `${leek.name} doit être au moins niveau 20 pour l'arène`);
  stopArenaKeepAlive(account.id);
  const res = await client.arenaRegister(leek.id, Number(preference));
  if (keep) {
    const entry = { leekId: leek.id, leekName: leek.name, preference: Number(preference), since: Date.now(), until: Date.now() + ARENA_MAX_WAIT, lastError: null, timer: null };
    const renew = (expiresIn) => {
      // Renouvelle un peu avant l'expiration ; s'arrête au bout de 3 h ou si Leek Wars refuse (arène lancée, poireau en combat…).
      entry.timer = setTimeout(async () => {
        if (Date.now() > entry.until) return stopArenaKeepAlive(account.id);
        try {
          const r = await client.arenaRegister(entry.leekId, entry.preference);
          renew(r.expires_in);
        } catch (e) {
          entry.lastError = e.body?.error ?? e.message;
          console.warn(`Arène (${account.name}) : renouvellement arrêté, ${entry.lastError}`);
          arenaKeepAlive.delete(account.id);
        }
      }, Math.max(20, (Number(expiresIn) || 300) - 30) * 1000);
    };
    arenaKeepAlive.set(account.id, entry);
    renew(res.expires_in);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Tournois : chaque poireau (leek/get) et éleveur liste ses tournois récents avec son parcours
// (`rounds` : 1 manche gagnée, -1 éliminé, 0 en attente). Les tournois terminés sont mis en cache.
// ---------------------------------------------------------------------------

const ROUND_LABELS = {
  sixtyfourths: "Soixante-quatrièmes", thirtyseconds: "Trente-deuxièmes", sixteenths: "Seizièmes", eighths: "Huitièmes",
  quarters: "Quarts de finale", semifinals: "Demi-finales", finals: "Finale", final: "Finale",
};

async function tournamentData(id) {
  const cached = db.get(`tournament:${id}`);
  if (cached) return cached;
  const res = await publicLw.tournament(id);
  const t = res.tournament ?? res;
  if (t.finished) db.set(`tournament:${id}`, t);
  return t;
}

function parcours(rounds) {
  const r = rounds ?? [];
  const status = r.includes(-1) ? "eliminated" : r.includes(0) || !r.length ? "running" : "qualified";
  return { rounds: r, wins: r.filter((x) => x === 1).length, status };
}

/** Tournois récents de mes éleveurs et de mes poireaux (et des poireaux suivis). */
async function myTournaments() {
  const out = [];
  for (const { farmer: f } of await allFarmers()) {
    for (const t of f.tournaments ?? []) {
      out.push({ id: t.id, date: t.date, kind: "farmer", entity: { id: f.id, name: f.name, mine: true }, ...parcours(t.rounds?.[f.id]) });
    }
  }
  for (const t of db.trackedLeeks()) {
    try {
      const l = await publicLeek(t.id);
      for (const x of l.tournaments ?? []) {
        out.push({ id: x.id, date: x.date, kind: "solo", entity: { id: l.id, name: l.name, mine: !!t.owned }, ...parcours(x.rounds?.[l.id]) });
      }
    } catch (e) {
      console.warn(`Tournois de ${t.name} indisponibles : ${e.message}`);
    }
  }
  return out.sort((a, b) => b.date - a.date || a.entity.name.localeCompare(b.entity.name));
}

/** Arbre d'un tournoi ; mes participants sont marqués, et leurs combats terminés importés en arrière-plan. */
async function tournamentView(id) {
  const t = await tournamentData(id);
  const fids = myFarmerIds();
  const tracked = new Map(db.trackedLeeks().map((l) => [l.id, l]));
  const isMine = (c) => (t.type === "farmer" ? fids.has(c.id) : t.type === "solo" ? !!tracked.get(c.id)?.owned : fids.has(c.farmer_id));
  const toImport = [];
  const rounds = Object.entries(t.rounds ?? {}).map(([key, matches]) => ({
    key,
    label: ROUND_LABELS[key] ?? key,
    matches: (matches ?? []).map((m) => {
      const fightId = Number(String(m?.fight ?? "").match(/\/fight\/(\d+)/)?.[1]) || null;
      // Places pas encore attribuées (manches à venir) : null.
      const contestants = (m?.contestants ?? []).map((c) => {
        if (!c) return null;
        const named = String(c.name ?? "").match(/^(.*) \((\d+)\)$/);
        return {
          id: c.id, name: named ? named[1] : c.name, level: named ? Number(named[2]) : null, win: !!c.win,
          mine: isMine(c), tracked: tracked.has(c.id), farmerId: c.farmer_id ?? null,
        };
      });
      if (fightId && contestants.some((c) => c?.mine || c?.tracked) && !db.hasFight(fightId)) toImport.push(fightId);
      return { fightId, contestants };
    }),
  }));
  if (toImport.length) {
    (async () => {
      for (const fid of toImport) await importFight(fid, { source: "tournament" }).catch(() => {});
    })();
  }
  return {
    id: t.id, type: t.type, date: t.date, finished: !!t.finished, size: t.size, currentRound: t.current_round ?? null,
    nextRound: t.next_round ?? null, rounds, importing: toImport.length, url: `https://leekwars.com/tournament/${t.id}`,
  };
}

// ---------------------------------------------------------------------------
// Méta par niveau (classement public + profils publics, mis en cache 12 h)
// ---------------------------------------------------------------------------

const META_TTL = 12 * 3600_000;

async function cachedPublicLeek(id) {
  const key = `publicLeek:${id}`;
  const cached = db.get(key);
  if (cached && Date.now() - cached.at < META_TTL) return cached.leek;
  const leek = await publicLeek(id);
  db.set(key, { at: Date.now(), leek });
  return leek;
}

function launchMeta({ level, spread = 10, count = 30, leekId }) {
  if (!Number(level)) throw new HttpError(400, "level requis");
  level = clamp(Number(level), 1, 301);
  spread = clamp(Number(spread) || 10, 0, 100);
  count = clamp(Number(count) || 30, 5, 60);
  return createJob("meta", { level, spread, count, leekId: leekId ? Number(leekId) : null }, async (job, log) => {
    // Classement « level-N » : poireaux de niveau ≤ N triés par talent ; on garde ceux proches de N.
    const picked = [];
    for (let page = 1; page <= 20 && picked.length < count; page++) {
      const { ranking, pages } = await publicLw.ranking(`level-${level}`, "talent", page);
      for (const r of ranking ?? []) if (r.level >= level - spread && picked.length < count) picked.push(r);
      log(`Classement niveau ≤ ${level}, page ${page} : ${picked.length}/${count} poireau(x) entre les niveaux ${level - spread} et ${level}`);
      if (!ranking?.length || page >= (pages ?? 1)) break;
    }
    job.progress.total = picked.length;
    const cat = await getCatalog();
    const profiles = [];
    for (const r of picked) {
      try {
        profiles.push({ ...leekProfile(await cachedPublicLeek(r.id), cat), rank: r.rank, country: r.country ?? null });
      } catch (e) {
        log(`Profil de ${r.name} indisponible : ${e.message}`);
      }
      job.progress.done++;
    }
    let mine = null;
    if (job.params.leekId) {
      const o = await ownerOf(job.params.leekId);
      const raw = o ? await privateLeek(o.client, job.params.leekId) : await publicLeek(job.params.leekId);
      mine = leekProfile(raw, cat);
    }
    db.set(`meta:${level}:${spread}`, { at: Date.now(), level, spread, count: profiles.length, leeks: profiles, mine, ...aggregateMeta(profiles, mine) });
    log(`Méta du niveau ${level} calculée sur ${profiles.length} poireau(x)`);
  });
}

let syncJob = null;
async function sync({ leekIds, limit = 500, farmerFights = true } = {}) {
  if (syncJob && syncJob.status === "running") return syncJob;
  const client = lwActive();
  const tracked = db.trackedLeeks();
  const names = Object.fromEntries(tracked.map((l) => [l.id, l.name]));
  syncJob = createJob("sync", { leekIds, limit, farmerFights }, async (job, log) => {
    const ids = leekIds?.length ? leekIds.map(Number) : tracked.map((l) => l.id);
    const seen = new Map();
    for (const leekId of ids) {
      try {
        const { fights } = await client.leekHistory(leekId);
        log(`Historique de ${names[leekId] ?? leekId} : ${fights.length} combat(s)`);
        for (const x of fights) seen.set(x.id, x);
      } catch (e) {
        log(`Historique de ${names[leekId] ?? leekId} indisponible : ${e.message}`);
      }
    }
    if (farmerFights && !leekIds?.length) {
      for (const account of db.accounts()) {
        try {
          const { fights } = await clientFor(account).farmerHistory(account.id);
          log(`Historique éleveur ${account.name} : ${fights.length} combat(s)`);
          for (const x of fights) seen.set(x.id, x);
        } catch (e) {
          log(`Historique éleveur ${account.name} indisponible : ${e.message}`);
        }
      }
    }
    const todo = [...seen.values()]
      .filter((x) => x.status === 2 && !db.hasFight(x.id))
      .sort((a, b) => b.date - a.date)
      .slice(0, clamp(Number(limit) || 500, 1, 5000));
    job.progress.total = todo.length;
    log(`${todo.length} combat(s) à importer`);
    for (const x of todo) {
      try {
        await importFight(x.id);
      } catch (e) {
        log(`Combat ${x.id} : ${e.message}`);
      }
      job.progress.done++;
    }
    db.set("lastSync", Date.now());
    log("Synchronisation terminée");
  });
  return syncJob;
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

function filterFights(q) {
  const num = (v) => (v == null || v === "" ? null : Number(v));
  let list = db.summaries(perspectiveKey(q), { since: num(q.since), until: num(q.until) });
  if (q.result) {
    const set = new Set(String(q.result).split(","));
    list = list.filter((f) => set.has(f.result));
  }
  if (q.context != null && q.context !== "") {
    const set = new Set(String(q.context).split(",").map(Number));
    list = list.filter((f) => set.has(f.context));
  }
  if (q.type != null && q.type !== "") {
    const set = new Set(String(q.type).split(",").map(Number));
    list = list.filter((f) => set.has(f.type));
  }
  if (q.opponent) {
    const o = String(q.opponent).toLowerCase();
    list = list.filter((f) => (f.opponents ?? []).some((x) => String(x.id) === o || x.name?.toLowerCase().includes(o)));
  }
  if (q.tag) list = list.filter((f) => f.tags?.includes(q.tag));
  if (q.source) list = list.filter((f) => f.source === q.source);
  if (q.bugs === "1" || q.bugs === "true") list = list.filter((f) => f.me?.bugs > 0);
  if (q.q) {
    const s = String(q.q).toLowerCase();
    list = list.filter((f) => String(f.id).includes(s) || f.note?.toLowerCase().includes(s) || (f.opponents ?? []).some((x) => String(x.id) === s || x.name?.toLowerCase().includes(s)));
  }
  list.sort((a, b) => b.date - a.date || b.id - a.id);
  const last = num(q.last);
  if (last) list = list.slice(0, last);
  return list;
}

// ---------------------------------------------------------------------------
// Routage HTTP
// ---------------------------------------------------------------------------

const routes = [];
const route = (method, pattern, doc, handler) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")).replace(/\*$/, "(.*)") + "$");
  routes.push({ method, pattern, doc, re, keys, handler });
};

route("GET", "/api", "Documentation : liste des routes", () => ({
  name: "LeekWarsLocal API",
  routes: routes.map((r) => ({ method: r.method, path: r.pattern, doc: r.doc })),
  labels: { contexts: CONTEXTS, types: TYPES, results: ["win", "loss", "draw", "pending"] },
  perspectives: "Sans ?leek, les combats/stats sont vus depuis le compte actif (ou ?account=<farmerId>) ; avec ?leek=<id>, depuis ce poireau suivi.",
}));

async function accountsView() {
  const active = activeFarmerId();
  const out = [];
  for (const a of db.accounts()) {
    const row = { id: a.id, name: a.name, active: a.id === active, keyMasked: maskKey(a.api_key), ok: false, error: null, leeks: 0, garden: null };
    try {
      const f = await farmerOf(a);
      row.ok = true;
      row.name = f.name;
      row.leeks = Object.keys(f.leeks ?? {}).length;
      row.talent = f.talent;
      row.lwplus = !!f.lwplus;
      row.requestsPerSecond = clientFor(a).requestsPerSecond;
      const { garden } = await clientFor(a).garden();
      row.garden = { fights: garden.fights, maxFights: garden.max_fights };
    } catch (e) {
      row.error = e.message;
    }
    out.push(row);
  }
  return out;
}

route("GET", "/api/status", "Compte actif, comptes, poireaux suivis, combats restants, état du stockage", async () => {
  const [f, leeks, accounts] = await Promise.all([farmer(), trackedLeeks(), accountsView()]);
  const { garden } = await lwActive().garden();
  const tracked = new Set(leeks.map((l) => l.id));
  const untracked = [];
  for (const { account, farmer: af } of await allFarmers()) {
    for (const l of Object.values(af.leeks ?? {})) if (!tracked.has(l.id)) untracked.push({ ...leekView(l), accountId: account.id, accountName: account.name });
  }
  return {
    farmer: { id: f.id, name: f.name, talent: f.talent, habs: f.habs, crystals: f.crystals, victories: f.victories, defeats: f.defeats, draws: f.draws },
    accounts,
    leeks,
    untrackedLeeks: untracked,
    garden: {
      fights: garden.fights, maxFights: garden.max_fights,
      teamFights: garden.team_fights, battleRoyaleFights: garden.battle_royale_fights,
      compositions: (garden.my_compositions ?? []).map((c) => ({ id: c.id, name: c.name, fights: c.fights })),
    },
    store: { engine: "sqlite", fights: db.fightCount(), lastSync: db.get("lastSync") ?? null },
    jobs: [...jobs.values()].filter((j) => j.status === "running").map(jobView),
  };
});

// --- Comptes ---

route("GET", "/api/accounts", "Comptes Leek Wars (clés masquées), compte actif, combats restants par compte", async () => accountsView());

route("POST", "/api/accounts", "Ajoute un compte depuis sa clé API (vérifiée), suit ses poireaux et importe son historique. Body : {apiKey, activate?, sync?}", async ({ body }) => {
  const res = await addAccount(body.apiKey, { activate: !!body.activate });
  const job = body.sync === false ? null : await sync({});
  return { ...res, job: job ? jobView(job) : null };
});

route("PUT", "/api/accounts/active", "Change le compte actif. Body : {id}", ({ body }) => {
  const a = db.account(Number(body.id));
  if (!a) throw new HttpError(404, `Compte #${body.id} inconnu`);
  db.set("activeAccount", a.id);
  return { active: a.id, name: a.name };
});

route("PUT", "/api/accounts/order", "Réordonne les comptes. Body : {ids: number[]}", ({ body }) => {
  db.reorderAccounts((body.ids ?? []).map(Number));
  return { ok: true };
});

route("PUT", "/api/accounts/:id/key", "Remplace la clé API d'un compte (doit correspondre au même éleveur). Body : {apiKey}", async ({ params, body }) => {
  const id = Number(params.id);
  if (!db.account(id)) throw new HttpError(404, `Compte #${id} inconnu`);
  const key = String(body.apiKey ?? "").trim();
  let f;
  try {
    f = (await new LeekWarsClient({ apiKey: key }).me()).farmer;
  } catch (e) {
    throw new HttpError(400, `Clé refusée par Leek Wars (${e.body?.error ?? e.message})`);
  }
  if (f.id !== id) throw new HttpError(400, `Cette clé appartient à ${f.name}, pas à ce compte : ajoutez-la comme nouveau compte.`);
  db.putAccount({ id, name: f.name, apiKey: key });
  farmerCache.delete(id);
  return { ok: true, keyMasked: maskKey(key) };
});

route("DELETE", "/api/accounts/:id", "Retire un compte (ses poireaux restent suivis en analyse ; les combats sont conservés)", ({ params }) => {
  const id = Number(params.id);
  if (!db.account(id)) throw new HttpError(404, `Compte #${id} inconnu`);
  db.removeAccount(id);
  clients.delete(id);
  farmerCache.delete(id);
  if (db.get("activeAccount") === id) db.set("activeAccount", db.accounts()[0]?.id ?? null);
  return { ok: true, active: activeFarmerId() };
});

// --- Poireaux ---

route("GET", "/api/leeks", "Poireaux suivis (miens tous comptes confondus, et autres) + mes poireaux non suivis, avec nb de combats stockés", async () => {
  const counts = db.countByPerspective();
  const mine = new Map();
  for (const { account, farmer: f } of await allFarmers(true)) for (const l of Object.values(f.leeks ?? {})) mine.set(l.id, { account, leek: l });
  // Rafraîchit le profil public des poireaux suivis qui ne sont pas à moi.
  for (const t of db.trackedLeeks().filter((t) => !mine.has(t.id))) {
    try {
      const l = await publicLeek(t.id);
      db.trackLeek({ id: t.id, name: l.name, farmerId: l.farmer?.id, farmerName: l.farmer?.name, owned: false, info: leekView(l) });
    } catch {
      /* profil indisponible : on garde l'ancien */
    }
  }
  const tracked = await trackedLeeks();
  const ids = new Set(tracked.map((l) => l.id));
  return {
    tracked: tracked.map((l) => ({ ...l, storedFights: counts[`l${l.id}`] ?? 0 })),
    available: [...mine.values()]
      .filter(({ leek }) => !ids.has(leek.id))
      .map(({ account, leek }) => ({ ...leekView(leek), owned: true, accountId: account.id, accountName: account.name, storedFights: 0 })),
  };
});

route("POST", "/api/leeks/tracked", "Suivre un poireau, le mien ou n'importe lequel (ID ou lien). Body : {id, sync?: true}", async ({ body }) => {
  const id = Number(String(body.id ?? "").match(/(\d+)\D*$/)?.[1]);
  if (!id) throw new HttpError(400, "ID ou lien de poireau requis");
  const owner = await ownerOf(id);
  let leek;
  try {
    leek = owner ? { ...owner.leek, farmer: { id: owner.account.id, name: owner.account.name } } : await publicLeek(id);
  } catch (e) {
    throw new HttpError(404, `Poireau #${id} introuvable sur Leek Wars (${e.message})`);
  }
  db.trackLeek({ id, name: leek.name, farmerId: leek.farmer?.id, farmerName: leek.farmer?.name, owned: !!owner, info: leekView(leek) });
  // Analyse tout de suite les combats déjà stockés où il apparaît, puis importe son historique.
  const indexed = await indexPerspective({ leekId: id }, db.fightIdsOfLeek(id));
  const job = body.sync === false ? null : await sync({ leekIds: [id] });
  return { leek: { ...leekView(leek), owned: !!owner, farmerName: leek.farmer?.name }, indexed, job: job ? jobView(job) : null };
});

route("PUT", "/api/leeks/tracked", "Réordonne les poireaux suivis. Body : {ids: number[]}", async ({ body }) => {
  const known = new Set(db.trackedLeeks().map((t) => t.id));
  db.reorderTracked([...new Set((body.ids ?? []).map(Number))].filter((id) => known.has(id)));
  return { tracked: await trackedIds() };
});

route("DELETE", "/api/leeks/tracked/:id", "Ne plus suivre un poireau. Query : purge=1 supprime aussi les combats qui ne concernent plus personne", async ({ params, query }) => {
  const id = Number(params.id);
  const ids = db.fightIdsOfLeek(id);
  db.untrackLeek(id);
  db.removeParticipations(`l${id}`);
  let purged = 0;
  if (query.purge === "1" || query.purge === "true") {
    for (const fid of ids) {
      if (!db.perspectivesOf(fid).length) {
        db.removeFight(fid);
        purged++;
      }
    }
  }
  return { tracked: await trackedIds(), purged };
});

route("GET", "/api/leeks/:id", "Détail d'un poireau (privé si c'est le mien, public sinon) avec équipement nommé", async ({ params }) => {
  const owner = await ownerOf(Number(params.id));
  const leek = owner ? await privateLeek(owner.client, params.id) : await publicLeek(params.id);
  const cat = await getCatalog();
  return {
    ...leek,
    owned: !!owner,
    accountId: owner?.account.id ?? null,
    weaponsNamed: (leek.weapons ?? []).map((w) => ({ ...w, name: cat.weaponsByItem.get(w.template)?.name ?? `#${w.template}` })),
    chipsNamed: (leek.chips ?? []).map((c) => ({ ...c, name: cat.chipsById.get(c.template)?.name ?? `#${c.template}` })),
  };
});

async function leekForCharacteristics(id) {
  const owner = await ownerOf(Number(id));
  return { owner, leek: owner ? await privateLeek(owner.client, id) : await publicLeek(id) };
}

route("GET", "/api/leeks/:id/characteristics", "Caractéristiques : base, capital investi, équipement, total, coût du prochain point (lecture seule si pas à moi)", async ({ params }) => {
  const { owner, leek } = await leekForCharacteristics(params.id);
  return { ...characteristicsView(leek), owned: !!owner, accountName: owner?.account.name ?? null };
});

route("POST", "/api/leeks/:id/characteristics/preview", "Simule une répartition sans dépenser. Body : {bonuses: {strength: 10, life: 40, …}} (points de carac. à ajouter), spend?: {strength: 25} (capital à dépenser, converti en points). Chaque carac. a adds[1|10|100] : effet de +N capital", async ({ params, body }) => {
  const { owner, leek } = await leekForCharacteristics(params.id);
  return { ...characteristicsView(leek, body.bonuses ?? (body.spend ? {} : body), body.spend ?? {}), owned: !!owner, accountName: owner?.account.name ?? null };
});

route("POST", "/api/leeks/:id/characteristics", "Dépense le capital d'un de mes poireaux (irréversible sans potion de restat). Body : {bonuses: {…}}", async ({ params, body }) => {
  const { client, account } = await assertOwned(Number(params.id));
  const leek = await privateLeek(client, params.id);
  const bonuses = Object.fromEntries(
    Object.entries(body.bonuses ?? {})
      .map(([k, v]) => [k, Math.round(Number(v) || 0)])
      .filter(([k, v]) => CHARACTERISTICS.includes(k) && v > 0),
  );
  if (!Object.keys(bonuses).length) throw new HttpError(400, "Aucune caractéristique à augmenter");
  const plan = characteristicsView(leek, bonuses);
  const invalid = Object.entries(plan.stats).filter(([, s]) => !s.bonusValid).map(([k]) => k);
  if (invalid.length) throw new HttpError(400, `Montant impossible pour : ${invalid.join(", ")} (les points s'achètent par paliers)`);
  if (plan.planned > plan.capital) throw new HttpError(409, `Capital insuffisant : ${plan.planned} requis, ${plan.capital} disponible`);
  const full = Object.fromEntries(CHARACTERISTICS.map((c) => [c, bonuses[c] ?? 0]));
  await client.call("POST", "leek/spend-capital", { leek_id: leek.id, characteristics: full });
  farmerCache.delete(account.id);
  db.logCapital(leek.id, bonuses, plan.planned);
  return { spent: plan.planned, bonuses, after: { ...characteristicsView(await privateLeek(client, params.id)), owned: true, accountName: account.name } };
});

route("GET", "/api/capital-log", "Historique des dépenses de capital faites via cet outil. Query : leek", ({ query }) => db.capitalLog(query.leek ? Number(query.leek) : null));

route("GET", "/api/opponents/farmer", "Adversaires éleveur proposés (compte actif, ou ?account=)", async ({ query }) => clientFor(accountOrActive(query.account)).farmerOpponents());
route("GET", "/api/opponents/:leekId", "Adversaires proposés pour un de mes poireaux (+ bilan local contre eux)", async ({ params }) => {
  const leekId = Number(params.leekId);
  const { client } = await assertOwned(leekId);
  const { opponents } = await client.leekOpponents(leekId);
  const history = db.summaries(`l${leekId}`);
  const tracked = new Set(db.trackedLeeks().map((t) => t.id));
  return {
    opponents: opponents.map((o) => {
      const vs = history.filter((f) => f.opponents?.some((x) => x.id === o.id));
      return { ...o, tracked: tracked.has(o.id), record: { fights: vs.length, wins: vs.filter((f) => f.result === "win").length, losses: vs.filter((f) => f.result === "loss").length } };
    }),
  };
});

route("POST", "/api/fights/solo", "Lancer des combats solo (poireau d'un de mes comptes). Body : {leekId, targetId?, strategy?: weakest|strongest|closest|random, count?, batch?}", async ({ body }) =>
  jobView(await launchSolo(body)));
route("POST", "/api/fights/farmer", "Lancer des combats éleveur. Body : {accountId?, targetId?, strategy?, count?, batch?}", ({ body }) => jobView(launchFarmer(body)));
route("POST", "/api/fights/challenge", "Lancer des défis. Body : {leekId, targetId, seed?, side?: random|left|right, count?}", async ({ body }) =>
  jobView(await launchChallenge(body)));
route("GET", "/api/fights/test", "IA de test, bots et scénarios de test (éditeur Leek Wars). Query : leekId → scénario retenu pour chaque IA de test", async ({ query }) => {
  const leekId = Number(query.leekId) || null;
  const { client, account } = leekId ? await assertOwned(leekId) : { account: activeAccount(), client: lwActive() };
  const { scenarios, byAi } = await testScenariosFor(client, account, leekId);
  return {
    ais: Object.entries(TEST_AIS).map(([key, a]) => ({ key, ...a, scenario: leekId ? byAi[key] : undefined })),
    bots: Object.entries(TEST_BOTS).map(([id, b]) => ({ id: Number(id), ...b })),
    scenarios,
    account: account.name,
  };
});
route("POST", "/api/fights/test", "Combats de test d'IA contre les bots (gratuits, ne consomment pas les combats du jour) via les scénarios de l'éditeur. Body : {leekId, ais?: (lambda|normal|confirmed|expert)[] (toutes par défaut), scenarioIds?, count?: par scénario, aiPath?}", async ({ body }) =>
  jobView(await launchTest(body)));

route("POST", "/api/sync", "Importer l'historique Leek Wars des poireaux suivis et de tous mes comptes. Body : {leekIds?, limit?, farmerFights?}", async ({ body }) => jobView(await sync(body)));
route("POST", "/api/fights/import", "Importer des combats précis. Body : {ids: number[], force?}", async ({ body }) => {
  const ids = (body.ids ?? []).map(Number).filter(Boolean);
  const out = [];
  for (const id of ids) out.push((await importFight(id, { source: "manual", force: !!body.force })) ?? { id, alreadyStored: true });
  return { imported: out };
});

route("GET", "/api/jobs", "Tâches de fond (lancements, synchro)", () => [...jobs.values()].reverse().map(jobView));
route("GET", "/api/jobs/:id", "Détail d'une tâche", ({ params }) => {
  const j = jobs.get(Number(params.id));
  if (!j) throw new HttpError(404, "Tâche inconnue");
  return { ...jobView(j), log: j.log };
});

route("GET", "/api/fights", "Liste des combats. Query : leek | account (perspective), result, context, type, opponent, tag, source, bugs, since, until, q, last, limit, offset", ({ query }) => {
  const list = filterFights(query);
  const offset = Number(query.offset) || 0;
  const limit = clamp(Number(query.limit) || 50, 1, 1000);
  return { total: list.length, offset, limit, fights: list.slice(offset, offset + limit) };
});

/** Point de vue sur un combat : poireau demandé, sinon le compte actif s'il a participé, sinon un autre de mes comptes, un poireau suivi, le premier. */
function fightPerspective(raw, leek) {
  const participants = [...(raw.leeks1 || []), ...(raw.leeks2 || [])];
  const fids = myFarmerIds();
  const active = activeFarmerId();
  const tracked = new Set(db.trackedLeeks().map((t) => t.id));
  const myFarmerInFight = participants.some((l) => l.farmer === active) ? active : participants.find((l) => fids.has(l.farmer))?.farmer;
  if (leek && participants.some((l) => l.id === Number(leek))) return { leekId: Number(leek) };
  if (myFarmerInFight) return { farmerId: myFarmerInFight };
  return { leekId: (participants.find((l) => tracked.has(l.id)) ?? participants[0])?.id };
}

/** Client du compte qui a participé au combat (logs IA), sinon du compte actif. */
function fightClient(raw) {
  // Les bots (combats de test) n'ont pas d'éleveur : `farmer` absent.
  const mine = [...(raw?.leeks1 || []), ...(raw?.leeks2 || [])].map((l) => (l.farmer ? db.account(l.farmer) : null)).find(Boolean);
  return mine ? clientFor(mine) : lwActive();
}

route("GET", "/api/fights/:id", "Résumé + analyse détaillée d'un combat (importé à la volée). Query : leek = point de vue (n'importe quel poireau du combat)", async ({ params, query }) => {
  const id = Number(params.id);
  if (!db.hasFight(id) || query.refresh) await importFight(id, { source: "manual", force: true });
  const raw = db.raw(id);
  if (!raw) throw new HttpError(404, "Combat introuvable ou pas encore terminé");
  const participants = [...(raw.leeks1 || []), ...(raw.leeks2 || [])];
  const fids = myFarmerIds();
  const tracked = new Set(db.trackedLeeks().map((t) => t.id));
  const perspective = fightPerspective(raw, query.leek);
  const { summary, analysis } = await analysisOf(id, perspective);
  const meta = db.fightMeta(id);
  return {
    summary: { ...summary, note: meta?.note ?? "", tags: meta?.tags ?? [], source: meta?.source },
    analysis,
    perspective,
    participants: participants.map((l) => ({ id: l.id, name: l.name, farmer: l.farmer, tracked: tracked.has(l.id), mine: fids.has(l.farmer) })),
    url: `https://leekwars.com/fight/${id}`,
  };
});

route("GET", "/api/fights/:id/raw", "Données brutes Leek Wars du combat", ({ params }) => {
  const raw = db.raw(Number(params.id));
  if (!raw) throw new HttpError(404, "Combat non stocké");
  return raw;
});

route("GET", "/api/fights/:id/replay", "Données pour rejouer un combat : carte, entités, actions et noms des puces / armes utilisées", async ({ params }) => {
  const id = Number(params.id);
  if (!db.hasFight(id)) await importFight(id, { source: "manual" });
  const raw = db.raw(id);
  if (!raw?.data?.actions) throw new HttpError(404, "Combat introuvable ou pas encore terminé");
  const cat = await getCatalog();
  const chips = {};
  const weapons = {};
  for (const a of raw.data.actions) {
    if (a[0] === 12) {
      const tpl = a.length === 4 ? a[1] : a[3];
      chips[tpl] = cat.chips.get(tpl)?.name ?? null;
    } else if (a[0] === 13) {
      weapons[a[1]] = cat.weapons.get(a[1])?.name ?? null;
    }
  }
  const { map, leeks, actions } = raw.data;
  return {
    id, map, actions, chips, weapons,
    entities: leeks.map((l) => ({
      // Invocations : nom interne (« puny_bulb ») rendu lisible.
      id: l.id, name: l.summon ? String(l.name).replace(/_/g, " ") : l.name, level: l.level, skin: l.skin, hat: l.hat ?? null, metal: !!l.metal, face: l.face ?? 0,
      team: l.team, life: l.life, cell: l.cellPos, summon: !!l.summon, type: l.type, farmer: l.farmer ?? null,
    })),
  };
});

route("GET", "/api/fights/:id/logs", "Logs IA du combat (debug()), via le compte qui y a participé", async ({ params }) =>
  fightClient(db.raw(Number(params.id))).fightLogs(params.id));

// ---------------------------------------------------------------------------
// Analyse IA d'un combat (Claude / ChatGPT)
// ---------------------------------------------------------------------------

function aiSettingsView() {
  const s = aiSettings(db);
  return {
    provider: resolveProvider(s, null),
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, models: p.models, model: s.models[id], keyMasked: maskKey(s.keys[id]), configured: !!s.keys[id] }])),
    prompt: s.prompt ?? DEFAULT_PROMPT,
    customPrompt: !!s.prompt,
    defaultPrompt: DEFAULT_PROMPT,
    includeCode: s.includeCode,
  };
}

route("GET", "/api/ai/settings", "Analyse IA : fournisseur (anthropic | openai), clés masquées, modèles, prompt courant et prompt par défaut", () => aiSettingsView());

route("PUT", "/api/ai/settings", "Analyse IA : réglages. Body : {provider?, anthropicKey?, openaiKey? (vérifiées ; \"\" = supprimer), anthropicModel?, openaiModel?, prompt? (null ou \"\" = prompt par défaut), includeCode?}", async ({ body }) => {
  const next = { ...(db.get("ai") ?? {}) };
  for (const p of Object.keys(PROVIDERS)) {
    if (body[`${p}Key`] === undefined) continue;
    const key = String(body[`${p}Key`] ?? "").trim();
    if (key) await checkKey(p, key);
    next[`${p}Key`] = key || null;
    if (key && !next.provider) next.provider = p;
  }
  if (body.provider !== undefined) {
    if (body.provider && !PROVIDERS[body.provider]) throw new HttpError(400, `Fournisseur inconnu : ${body.provider}`);
    next.provider = body.provider || null;
  }
  for (const p of Object.keys(PROVIDERS)) if (body[`${p}Model`] !== undefined) next[`${p}Model`] = String(body[`${p}Model`] ?? "").trim() || null;
  if (body.prompt !== undefined) {
    const prompt = String(body.prompt ?? "").trim();
    next.prompt = prompt && prompt !== DEFAULT_PROMPT.trim() ? prompt : null;
  }
  if (body.includeCode !== undefined) next.includeCode = !!body.includeCode;
  db.set("ai", next);
  return aiSettingsView();
});

let lsErrors = null;
/** Messages des erreurs LeekScript (public/lw/leekscript-errors.json, copié dans dist/ au build). */
function leekscriptErrors() {
  if (lsErrors) return lsErrors;
  for (const f of [path.join(DIST, "lw", "leekscript-errors.json"), path.join(ROOT, "public", "lw", "leekscript-errors.json")]) {
    try {
      return (lsErrors = JSON.parse(fs.readFileSync(f, "utf8")));
    } catch {
      /* emplacement suivant */
    }
  }
  return {};
}

const aiRunning = new Set();

route("GET", "/api/fights/:id/ai-analysis", "Analyses IA déjà faites pour ce combat (la plus récente d'abord) + réglages IA", ({ params }) => ({
  analyses: db.aiAnalyses(Number(params.id)),
  settings: aiSettingsView(),
  running: aiRunning.has(Number(params.id)),
}));

route("POST", "/api/fights/:id/ai-analysis", "Analyse un combat avec Claude ou ChatGPT (facturé sur la clé configurée) : note de code, note de RPG, note globale et commentaires. Body : {leek? (point de vue), provider?, model?, prompt? (sinon celui des réglages), includeCode?, dryRun? (renvoie le message sans appeler le modèle)}", async ({ params, body }) => {
  const id = Number(params.id);
  const settings = aiSettings(db);
  const provider = resolveProvider(settings, body.provider) ?? (body.dryRun ? body.provider || "anthropic" : null);
  if (!provider) throw new HttpError(400, "Aucune clé d'IA configurée : ajoutez une clé Claude ou ChatGPT dans Paramètres.", "no_ai_key");
  if (aiRunning.has(id)) throw new HttpError(409, "Une analyse de ce combat est déjà en cours.");
  if (!db.hasFight(id)) await importFight(id, { source: "manual" });
  const raw = db.raw(id);
  if (!raw?.data?.actions) throw new HttpError(404, "Combat introuvable ou pas encore terminé");
  const perspective = fightPerspective(raw, body.leek);
  const { summary, analysis } = await analysisOf(id, perspective);
  if (!analysis) throw new HttpError(404, "Analyse du combat indisponible");
  aiRunning.add(id);
  try {
    const digest = fightDigest({ summary: { ...summary, contextLabel: CONTEXTS[summary.context], typeLabel: TYPES[summary.type] }, analysis, raw });
    const entityName = (eid) => analysis.entities.find((e) => e.id === eid)?.name ?? `#${eid}`;
    let logs = null;
    try {
      logs = formatLogs(await fightClient(raw).fightLogs(id), raw.data.actions, entityName, leekscriptErrors());
    } catch (e) {
      console.warn(`Logs du combat ${id} indisponibles pour l'analyse IA : ${e.message}`);
    }
    // Code source : seulement pour mes poireaux du point de vue (lu via le compte propriétaire).
    let code = { files: [], truncated: false, errors: [], reason: "Code source non demandé : juge l'IA sur son comportement en combat." };
    if (body.includeCode ?? settings.includeCode) {
      const sources = [];
      for (const leekId of summary.myLeeks ?? []) {
        const o = await ownerOf(leekId).catch(() => null);
        if (o?.leek.ai_path) sources.push({ leekName: o.leek.name, aiPath: o.leek.ai_path, client: o.client, tree: o.farmer.ai_tree });
      }
      code = sources.length
        ? await collectAiCode(sources)
        : { ...code, reason: "Code source indisponible (poireau d'un autre joueur ou sans IA) : juge l'IA sur son comportement en combat." };
    }
    const prompt = String(body.prompt ?? "").trim() || settings.prompt || DEFAULT_PROMPT;
    const model = String(body.model ?? "").trim() || settings.models[provider];
    const user = buildUserMessage({ digest, logs, code });
    if (body.dryRun) return { dryRun: true, provider, model, prompt, user, chars: prompt.length + user.length };
    const started = Date.now();
    const res = await runAnalysis({ provider, apiKey: settings.keys[provider], model, prompt, user });
    const mainMine = analysis.entities.find((e) => e.mine && !e.summon);
    return db.putAiAnalysis({
      fightId: id,
      perspective: summary.perspective,
      provider,
      model: res.model,
      prompt,
      result: res.result,
      meta: {
        usage: res.usage,
        durationMs: Date.now() - started,
        customPrompt: prompt.trim() !== DEFAULT_PROMPT.trim(),
        perspectiveName: perspective.leekId ? mainMine?.name ?? null : db.account(perspective.farmerId)?.name ?? null,
        logs: logs ? { total: logs.total, kept: logs.kept, errors: logs.errors, warnings: logs.warnings } : null,
        code: { files: code.files.map((f) => f.path), truncated: code.truncated, errors: code.errors },
      },
    });
  } finally {
    aiRunning.delete(id);
  }
});

route("DELETE", "/api/fights/:id/ai-analysis/:aid", "Supprime une analyse IA d'un combat", ({ params }) => {
  if (!db.removeAiAnalysis(Number(params.id), Number(params.aid))) throw new HttpError(404, "Analyse introuvable");
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Tournois
// ---------------------------------------------------------------------------

route("GET", "/api/tournaments", "Tournois récents de mes éleveurs, de mes poireaux et des poireaux suivis, avec leur parcours (rounds : 1 gagné, -1 éliminé, 0 en attente)", async () => ({
  tournaments: await myTournaments(),
}));

route("GET", "/api/tournaments/:id", "Arbre d'un tournoi (manches, combats, participants ; mine = à moi). Importe en arrière-plan les combats terminés de mes poireaux et des poireaux suivis", async ({ params }) =>
  tournamentView(Number(params.id)));

// ---------------------------------------------------------------------------
// Boss et arène
// ---------------------------------------------------------------------------

route("GET", "/api/bosses", "Boss (niveau, arme) et top 5 de leur classement au nombre de tours", async () => {
  const { bosses } = await publicLw.bosses();
  return {
    bosses: await Promise.all((bosses ?? []).map(async (b) => {
      let top = [];
      try {
        top = ((await publicLw.bossRanking(b.id, 1, 1)).ranking ?? []).slice(0, 5)
          .map((r) => ({ rank: r.rank, farmer: r.name, turns: r.turns, leeks: r.leeks, levels: r.levels, fight: r.fight }));
      } catch (e) {
        console.warn(`Classement du boss ${b.id} indisponible : ${e.message}`);
      }
      return { id: b.id, name: b.name, label: String(b.name).replace(/_/g, " "), level: b.level, top };
    })),
  };
});

route("POST", "/api/fights/boss", "Combats contre un boss avec mes poireaux (même compte, 8 max ; consomme les combats du jour). Body : {bossId, leekIds, count?, batch? (Leek Wars+)}", async ({ body }) =>
  jobView(await launchBoss(body)));

route("GET", "/api/arena", "Salle d'attente des arènes pour chacun de mes comptes (inscrits, décompte, modes) et renouvellement automatique de l'inscription", async () => {
  const out = [];
  for (const account of db.accounts()) {
    const keep = arenaKeepAlive.get(account.id);
    try {
      const a = await clientFor(account).arena();
      out.push({
        accountId: account.id, accountName: account.name, registered: !!a.registered, count: a.count, countdown: a.countdown,
        minPlayers: a.min_players, maxPlayers: a.max_players, minLevel: a.min_level, modes: a.modes,
        leeks: Object.values(a.leeks ?? {}).map((l) => ({ id: l.id, name: l.name, level: l.level, talent: l.talent, skin: l.skin, hat: l.hat, metal: l.metal, face: l.face, preference: l.preference })),
        keepAlive: keep ? { leekId: keep.leekId, leekName: keep.leekName, preference: keep.preference, since: keep.since } : null,
      });
    } catch (e) {
      out.push({ accountId: account.id, accountName: account.name, error: e.message });
    }
  }
  return { arenas: out };
});

route("POST", "/api/arena/register", "Inscrit un de mes poireaux (niveau 20+) dans la salle d'attente des arènes. Body : {leekId, preference? (-1 suivre les autres, -2 tous les modes, 0 BR, 1 guerre, 2 chasse au trésor, 3 colosse), keep? (renouvelle l'inscription jusqu'à 3 h)}", async ({ body }) =>
  registerArena(body));

route("POST", "/api/arena/leave", "Retire un compte de la salle d'attente des arènes. Body : {accountId}", async ({ body }) => {
  const account = accountOrActive(body.accountId);
  stopArenaKeepAlive(account.id);
  await clientFor(account).arenaLeave();
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Équipe
// ---------------------------------------------------------------------------

route("GET", "/api/compositions", "Compositions d'équipe de mes comptes, avec les combats d'équipe restants", async () => {
  const out = [];
  for (const account of db.accounts()) {
    try {
      const { garden } = await clientFor(account).garden();
      for (const c of garden.my_compositions ?? []) {
        out.push({
          id: c.id, name: c.name, team: c.team_name, teamId: c.team_id, level: c.level, totalLevel: c.total_level, talent: c.talent, leekCount: c.leek_count,
          accountId: account.id, accountName: account.name, teamFights: garden.team_fights, maxTeamFights: garden.max_team_fights,
        });
      }
    } catch (e) {
      console.warn(`Compositions de ${account.name} indisponibles : ${e.message}`);
    }
  }
  return { compositions: out };
});

route("GET", "/api/opponents/composition/:id", "Compositions adverses proposées pour une de mes compositions. Query : account? (compte qui la joue)", async ({ params, query }) => {
  const { client } = await compositionOwner(Number(params.id), query.account);
  const { opponents } = await client.compositionOpponents(Number(params.id));
  return {
    opponents: (opponents ?? []).map((o) => ({ id: o.id, name: o.name, team: o.team_name, teamId: o.team_id, level: o.level, totalLevel: o.total_level, talent: o.talent, leekCount: o.leek_count })),
  };
});

route("POST", "/api/fights/team", "Lancer des combats d'équipe (consomme les combats d'équipe du jour). Body : {compositionId, accountId? (compte qui la joue), targetId?, strategy?: weakest|strongest|closest|random, count?, batch? (Leek Wars+)}", async ({ body }) =>
  jobView(await launchTeam(body)));

// ---------------------------------------------------------------------------
// Console multi-comptes
// ---------------------------------------------------------------------------

/** Répartition des combats restants d'un compte entre ses poireaux (plafond par poireau : max_solo_fights). */
function spendPlan(farmer, garden) {
  const leeks = Object.values(farmer.leeks ?? {}).sort((a, b) => a.id - b.id);
  const done = (id) => Number(garden.solo_fights?.[id] ?? 0);
  const cap = (l) => Math.max(0, (garden.max_solo_fights ?? Infinity) - done(l.id));
  let left = garden.fights;
  const plan = leeks.map((l) => ({ leekId: l.id, name: l.name, level: l.level, count: 0, cap: cap(l) }));
  // Tour à tour, un combat par poireau tant qu'il en reste et que le plafond le permet.
  while (left > 0 && plan.some((p) => p.count < p.cap)) {
    for (const p of plan) if (left > 0 && p.count < p.cap) (p.count++, left--);
  }
  return { leeks: plan, unassigned: left };
}

route("GET", "/api/console", "Vue de tous mes comptes : combats restants (solo, équipe, BR), talent, poireaux, tournoi, bilan du jour et répartition proposée des combats restants", async () => {
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const out = [];
  for (const account of db.accounts()) {
    try {
      const f = await farmerOf(account);
      const { garden } = await clientFor(account).garden();
      const today = db.summaries(`f${account.id}`, { since: startOfDay });
      out.push({
        id: account.id, name: f.name, active: account.id === activeFarmerId(), talent: f.talent, lwplus: !!f.lwplus,
        garden: {
          fights: garden.fights, maxFights: garden.max_fights, teamFights: garden.team_fights, maxTeamFights: garden.max_team_fights,
          brFights: garden.battle_royale_fights, maxBrFights: garden.max_battle_royale_fights, maxSoloPerLeek: garden.max_solo_fights ?? null,
        },
        tournamentRegistered: !!f.tournament?.registered,
        leeks: Object.values(f.leeks ?? {}).map((l) => ({ ...leekView(l), inGarden: l.in_garden ?? null })),
        today: { fights: today.length, wins: today.filter((x) => x.result === "win").length, losses: today.filter((x) => x.result === "loss").length },
        plan: spendPlan(f, garden),
      });
    } catch (e) {
      out.push({ id: account.id, name: account.name, error: e.message });
    }
  }
  return { accounts: out };
});

route("POST", "/api/console/spend", "Dépense les combats restants des comptes choisis : combats solo répartis entre leurs poireaux, puis le reste (plafond solo atteint) en combats éleveur si farmer (consomme les combats du jour, sur demande explicite). Body : {accountIds?: (tous par défaut), strategy?, batch?, farmer?}", async ({ body }) => {
  const ids = body.accountIds?.length ? new Set(body.accountIds.map(Number)) : null;
  const strategy = body.strategy ?? "weakest";
  const jobsOut = [];
  for (const account of db.accounts()) {
    if (ids && !ids.has(account.id)) continue;
    const f = await farmerOf(account, true);
    const { garden } = await clientFor(account).garden();
    const plan = spendPlan(f, garden);
    for (const p of plan.leeks) {
      if (!p.count) continue;
      jobsOut.push(jobView(await launchSolo({ leekId: p.leekId, strategy, count: p.count, batch: !!body.batch })));
    }
    if (body.farmer && plan.unassigned > 0) {
      jobsOut.push(jobView(launchFarmer({ accountId: account.id, strategy, count: plan.unassigned, batch: !!body.batch })));
    }
  }
  return { jobs: jobsOut };
});

// ---------------------------------------------------------------------------
// Méta par niveau
// ---------------------------------------------------------------------------

route("GET", "/api/meta", "Méta calculée (dernier calcul en cache) : poireaux du haut du classement autour d'un niveau, quartiles des caractéristiques, armes et puces les plus jouées. Query : level, spread?", ({ query }) => {
  const level = Number(query.level);
  if (!level) throw new HttpError(400, "level requis");
  return db.get(`meta:${level}:${clamp(Number(query.spread) || 10, 0, 100)}`) ?? null;
});

route("POST", "/api/meta", "Calcule la méta d'un niveau (tâche de fond : classement public + profils publics, en cache 12 h). Body : {level, spread? (10), count? (30), leekId? (mon poireau à comparer)}", ({ body }) =>
  jobView(launchMeta(body)));

route("PATCH", "/api/fights/:id", "Annoter un combat. Body : {note?, tags?}", ({ params, body }) => {
  const s = db.annotate(Number(params.id), body);
  if (!s) throw new HttpError(404, "Combat non stocké");
  return s;
});

route("DELETE", "/api/fights/:id", "Supprimer un combat du stockage local", ({ params }) => {
  db.removeFight(Number(params.id));
  return { ok: true };
});

route("GET", "/api/stats", "Statistiques agrégées. Mêmes filtres que /api/fights (leek | account = perspective)", ({ query }) =>
  computeStats(filterFights(query), query.leek ? Number(query.leek) : null));

route("GET", "/api/compare", "Compare deux jeux de filtres. Query : a=<querystring>, b=<querystring> (ex. un poireau vs un autre, un compte vs un autre)", ({ query }) => {
  const parse = (s) => Object.fromEntries(new URLSearchParams(String(s ?? "")));
  const qa = parse(query.a);
  const qb = parse(query.b);
  const sa = computeStats(filterFights(qa), qa.leek ? Number(qa.leek) : null);
  const sb = computeStats(filterFights(qb), qb.leek ? Number(qb.leek) : null);
  const pick = (s) => ({ total: s.total, averages: s.averages, bugs: s.bugs });
  return { a: pick(sa), b: pick(sb) };
});

route("GET", "/api/settings", "Paramètres : comptes (clés masquées), stockage", async () => {
  const dbFile = path.join(DATA, "leekwars.db");
  return {
    accounts: await accountsView(),
    envKey: { present: !!ENV_API_KEY, masked: maskKey(ENV_API_KEY) },
    storage: { file: dbFile, size: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0, fights: db.fightCount() },
  };
});

route("POST", "/api/backup", "Copie de la base SQLite dans backups/ (dossier des données)", () => {
  const dir = path.join(DATA, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `leekwars-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  db.backup(file);
  return { file, size: fs.statSync(file).size };
});

route("*", "/api/lw/*", "Proxy authentifié (compte actif) vers l'API Leek Wars : /api/lw/<module>/<fonction>[/params] (GET) ou body (POST/PUT/DELETE)", async ({ method, params, body }) => {
  const p = params[0] ?? "";
  const client = lwActive();
  if (method === "GET") {
    const [mod, fn, ...args] = p.split("/").filter(Boolean);
    return client.call("GET", `${mod}/${fn}`, args.map(decodeURIComponent));
  }
  return client.call(method, p, body ?? {});
});

function jobView(j) {
  return {
    id: j.id, kind: j.kind, status: j.status, params: j.params, progress: j.progress,
    fights: j.fights, error: j.error, startedAt: j.startedAt, endedAt: j.endedAt, lastLog: j.log.at(-1) ?? null,
  };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  const type = req.headers["content-type"] ?? "";
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Corps JSON invalide");
  }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".json": "application/json" };

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Interface non construite : lancez `npm run build` (ou `npm run dev` pour le mode développement sur :1420).\nAPI disponible sous /api");
    return;
  }
  let file = path.join(DIST, decodeURIComponent(pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

// Initialisation asynchrone (reprise des clés) : les requêtes attendent qu'elle soit terminée.
const ready = migrateKeys()
  .then(() => reanalyze())
  .catch((e) => console.error("Initialisation :", e.message));

// Accès à l'API depuis un navigateur : seulement l'interface (application Tauri, Vite en dev, ce serveur lui-même).
// Sans ce filtre, n'importe quel site ouvert dans le navigateur pourrait piloter l'API locale (lancer des combats,
// dépenser du capital, des analyses IA payantes…). Les clients sans navigateur (curl, scripts) n'envoient pas
// d'en-tête Origin et restent acceptés. LWL_ALLOWED_ORIGINS (séparées par des virgules) en ajoute d'autres.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ALLOWED_ORIGINS = new Set([
  "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
  "http://localhost:1420", "http://127.0.0.1:1420",
  ...[...LOOPBACK].map((h) => `http://${h}:${PORT}`),
  ...(process.env.LWL_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
]);

/** Refus (message) d'une requête d'API venue d'ailleurs que de l'interface, sinon null. */
function rejectedAccess(req) {
  // Rebinding DNS : un domaine qui pointerait vers 127.0.0.1 garderait son propre nom dans Host.
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
  if (LOOPBACK.has(HOST) && !LOOPBACK.has(host)) return `Hôte non autorisé : ${host || "(absent)"}`;
  const origin = req.headers.origin;
  if (origin) return ALLOWED_ORIGINS.has(origin) ? null : `Origine non autorisée : ${origin}`;
  // Requêtes sans Origin émises par une autre page (balise <img>, lien…) : signalées par Sec-Fetch-Site.
  return req.headers["sec-fetch-site"] === "cross-site" ? "Requête intersite non autorisée" : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (!url.pathname.startsWith("/api")) return serveStatic(req, res, url.pathname);
  const origin = req.headers.origin;
  const cors = origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify(data));
  };
  const denied = rejectedAccess(req);
  if (denied) return send(403, { error: `${denied}. L'API locale n'accepte que l'interface LeekWars Local et les clients sans navigateur.`, code: "forbidden_origin" });
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...cors,
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }
  try {
    await ready;
    for (const r of routes) {
      if (r.method !== "*" && r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      if (r.pattern.endsWith("*")) params[0] = m[r.keys.length + 1];
      const body = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) ? await readBody(req) : {};
      const query = Object.fromEntries(url.searchParams);
      return send(200, await r.handler({ method: req.method, params, query, body }));
    }
    send(404, { error: `Route inconnue : ${req.method} ${url.pathname}. Voir GET /api` });
  } catch (e) {
    const status = e instanceof HttpError || e instanceof AiError ? e.status : e instanceof LeekWarsError ? 502 : 500;
    if (status >= 500) console.error(e);
    send(status, { error: e.message, code: e.code ?? undefined, details: e.body ?? undefined });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`LeekWarsLocal → http://${HOST}:${PORT}  (doc API : http://${HOST}:${PORT}/api, base : ${path.join(DATA, "leekwars.db")})`);
});
