// Stockage SQLite (node:sqlite, intégré à Node ≥ 22.13 — aucune dépendance).
//
// Tables :
//   fights          un combat (méta + données brutes gzip) + notes/tags
//   fight_leeks     index poireau ↔ combat (tous les participants, pour retrouver les combats d'un poireau)
//   participations  résumé d'analyse d'un combat pour une perspective : "f<farmerId>" (mon compte) ou "l<leekId>" (un poireau suivi)
//   tracked_leeks   poireaux suivis (les miens ou n'importe quel autre, pour analyse)
//   accounts        comptes Leek Wars (un éleveur + sa clé API) ; un seul est actif à la fois
//   kv              réglages et méta (farmerId, lastSync, catalogue…)
//   capital_log     dépenses de capital faites via l'outil
//   ai_analyses     analyses d'un combat par un modèle de langage (Claude / ChatGPT), historique conservé
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// L'avertissement "ExperimentalWarning" de node:sqlite est filtré dans server/main.js.
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fights (
  id INTEGER PRIMARY KEY,
  date INTEGER NOT NULL,
  context INTEGER, type INTEGER, status INTEGER, winner INTEGER,
  seed INTEGER, tournament INTEGER, duration INTEGER,
  leeks1 TEXT NOT NULL, leeks2 TEXT NOT NULL,
  raw BLOB,
  note TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  imported_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fights_date ON fights(date);

CREATE TABLE IF NOT EXISTS fight_leeks (
  fight_id INTEGER NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
  leek_id INTEGER NOT NULL,
  farmer_id INTEGER,
  side INTEGER,
  PRIMARY KEY (fight_id, leek_id)
);
CREATE INDEX IF NOT EXISTS fight_leeks_leek ON fight_leeks(leek_id);

CREATE TABLE IF NOT EXISTS participations (
  fight_id INTEGER NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
  perspective TEXT NOT NULL,
  date INTEGER NOT NULL,
  result TEXT NOT NULL,
  version INTEGER NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (fight_id, perspective)
);
CREATE INDEX IF NOT EXISTS participations_p ON participations(perspective, date);

CREATE TABLE IF NOT EXISTS tracked_leeks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  farmer_id INTEGER,
  farmer_name TEXT,
  owned INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  info TEXT
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,           -- id de l'éleveur Leek Wars
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capital_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leek_id INTEGER NOT NULL,
  date INTEGER NOT NULL,
  bonuses TEXT NOT NULL,
  capital INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fight_id INTEGER NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
  perspective TEXT NOT NULL,
  date INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  result TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ai_analyses_fight ON ai_analyses(fight_id, date);
`;

const pack = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
const unpack = (buf) => (buf ? JSON.parse(zlib.gunzipSync(buf).toString("utf8")) : null);
const now = () => Math.floor(Date.now() / 1000);

export class Db {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    this.st = {};
  }

  q(sql) {
    return (this.st[sql] ??= this.db.prepare(sql));
  }

  tx(fn) {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // --- kv ---
  get(key) {
    const row = this.q("SELECT value FROM kv WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : undefined;
  }

  set(key, value) {
    this.q("INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  // --- combats ---
  hasFight(id) {
    return !!this.q("SELECT 1 FROM fights WHERE id = ? AND status = 2").get(id);
  }

  fightCount() {
    return this.q("SELECT COUNT(*) n FROM fights").get().n;
  }

  /** Enregistre un combat brut (les notes/tags existants sont conservés). */
  putFight(raw, source) {
    const leeks = (n) => JSON.stringify((raw[`leeks${n}`] || []).map((l) => ({ id: l.id, name: l.name, level: l.level, talent: l.talent, farmer: l.farmer })));
    this.tx(() => {
      this.q(`INSERT INTO fights(id, date, context, type, status, winner, seed, tournament, duration, leeks1, leeks2, raw, source, imported_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET date = excluded.date, context = excluded.context, type = excluded.type, status = excluded.status,
                winner = excluded.winner, seed = excluded.seed, tournament = excluded.tournament, duration = excluded.duration,
                leeks1 = excluded.leeks1, leeks2 = excluded.leeks2, raw = excluded.raw, source = COALESCE(fights.source, excluded.source)`).run(
        raw.id, raw.date, raw.context ?? null, raw.type ?? null, raw.status ?? null, raw.winner ?? null, raw.seed ?? null,
        raw.tournament ?? null, raw.report?.duration ?? null, leeks(1), leeks(2), raw.status === 2 ? pack(raw) : null, source ?? null, now(),
      );
      this.q("DELETE FROM fight_leeks WHERE fight_id = ?").run(raw.id);
      for (const side of [1, 2]) {
        for (const l of raw[`leeks${side}`] || []) {
          this.q("INSERT OR IGNORE INTO fight_leeks(fight_id, leek_id, farmer_id, side) VALUES (?, ?, ?, ?)").run(raw.id, l.id, l.farmer ?? null, side);
        }
      }
    });
  }

  raw(id) {
    const row = this.q("SELECT raw FROM fights WHERE id = ?").get(id);
    return row ? unpack(row.raw) : null;
  }

  fightMeta(id) {
    const row = this.q("SELECT id, note, tags, source FROM fights WHERE id = ?").get(id);
    return row ? { ...row, tags: JSON.parse(row.tags) } : null;
  }

  annotate(id, { note, tags }) {
    if (!this.fightMeta(id)) return null;
    if (typeof note === "string") this.q("UPDATE fights SET note = ? WHERE id = ?").run(note, id);
    if (Array.isArray(tags)) {
      const clean = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
      this.q("UPDATE fights SET tags = ? WHERE id = ?").run(JSON.stringify(clean), id);
    }
    return this.fightMeta(id);
  }

  removeFight(id) {
    this.q("DELETE FROM fights WHERE id = ?").run(id);
  }

  /** Ids des combats terminés où ce poireau apparaît. */
  fightIdsOfLeek(leekId) {
    return this.q("SELECT fl.fight_id id FROM fight_leeks fl JOIN fights f ON f.id = fl.fight_id WHERE fl.leek_id = ? AND f.status = 2")
      .all(leekId)
      .map((r) => r.id);
  }

  fightIdsOfFarmer(farmerId) {
    return this.q("SELECT DISTINCT fl.fight_id id FROM fight_leeks fl JOIN fights f ON f.id = fl.fight_id WHERE fl.farmer_id = ? AND f.status = 2")
      .all(farmerId)
      .map((r) => r.id);
  }

  allFightIds() {
    return this.q("SELECT id FROM fights WHERE status = 2").all().map((r) => r.id);
  }

  // --- participations (résumés par perspective) ---
  putParticipation(summary, version) {
    this.q(`INSERT INTO participations(fight_id, perspective, date, result, version, summary) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(fight_id, perspective) DO UPDATE SET date = excluded.date, result = excluded.result, version = excluded.version, summary = excluded.summary`)
      .run(summary.id, summary.perspective, summary.date, summary.result, version, JSON.stringify(summary));
  }

  removeParticipations(perspective) {
    return this.q("DELETE FROM participations WHERE perspective = ?").run(perspective).changes;
  }

  outdatedFightIds(version) {
    return this.q("SELECT DISTINCT fight_id id FROM participations WHERE version <> ?").all(version).map((r) => r.id);
  }

  /** Résumés d'une perspective, fusionnés avec les notes/tags du combat. Filtres SQL simples ; le reste en JS. */
  summaries(perspective, { since, until } = {}) {
    let sql = `SELECT p.summary, f.note, f.tags, f.source FROM participations p JOIN fights f ON f.id = p.fight_id WHERE p.perspective = ?`;
    const args = [perspective];
    if (since) (sql += " AND p.date >= ?"), args.push(since);
    if (until) (sql += " AND p.date <= ?"), args.push(until);
    return this.db
      .prepare(sql)
      .all(...args)
      .map((r) => ({ ...JSON.parse(r.summary), note: r.note, tags: JSON.parse(r.tags), source: r.source }));
  }

  summary(fightId, perspective) {
    const r = this.q(`SELECT p.summary, f.note, f.tags, f.source FROM participations p JOIN fights f ON f.id = p.fight_id WHERE p.fight_id = ? AND p.perspective = ?`).get(fightId, perspective);
    return r ? { ...JSON.parse(r.summary), note: r.note, tags: JSON.parse(r.tags), source: r.source } : null;
  }

  perspectivesOf(fightId) {
    return this.q("SELECT perspective FROM participations WHERE fight_id = ?").all(fightId).map((r) => r.perspective);
  }

  countByPerspective() {
    return Object.fromEntries(this.q("SELECT perspective, COUNT(*) n FROM participations GROUP BY perspective").all().map((r) => [r.perspective, r.n]));
  }

  // --- poireaux suivis ---
  trackedLeeks() {
    return this.q("SELECT * FROM tracked_leeks ORDER BY position, added_at").all().map((r) => ({ ...r, owned: !!r.owned, info: r.info ? JSON.parse(r.info) : null }));
  }

  trackLeek({ id, name, farmerId, farmerName, owned, info }) {
    const pos = this.q("SELECT COALESCE(MAX(position), -1) + 1 p FROM tracked_leeks").get().p;
    this.q(`INSERT INTO tracked_leeks(id, name, farmer_id, farmer_name, owned, position, added_at, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, farmer_id = excluded.farmer_id, farmer_name = excluded.farmer_name,
              owned = excluded.owned, info = excluded.info`)
      .run(id, name, farmerId ?? null, farmerName ?? null, owned ? 1 : 0, pos, now(), info ? JSON.stringify(info) : null);
  }

  untrackLeek(id) {
    this.q("DELETE FROM tracked_leeks WHERE id = ?").run(id);
  }

  reorderTracked(ids) {
    this.tx(() => ids.forEach((id, i) => this.q("UPDATE tracked_leeks SET position = ? WHERE id = ?").run(i, id)));
  }

  // --- comptes ---
  accounts() {
    return this.q("SELECT * FROM accounts ORDER BY position, added_at").all();
  }

  account(id) {
    return this.q("SELECT * FROM accounts WHERE id = ?").get(id) ?? null;
  }

  putAccount({ id, name, apiKey }) {
    const pos = this.q("SELECT COALESCE(MAX(position), -1) + 1 p FROM accounts").get().p;
    this.q(`INSERT INTO accounts(id, name, api_key, position, added_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, api_key = excluded.api_key`).run(id, name, apiKey, pos, now());
  }

  removeAccount(id) {
    this.q("DELETE FROM accounts WHERE id = ?").run(id);
  }

  reorderAccounts(ids) {
    this.tx(() => ids.forEach((id, i) => this.q("UPDATE accounts SET position = ? WHERE id = ?").run(i, id)));
  }

  // --- capital ---
  logCapital(leekId, bonuses, capital) {
    this.q("INSERT INTO capital_log(leek_id, date, bonuses, capital) VALUES (?, ?, ?, ?)").run(leekId, now(), JSON.stringify(bonuses), capital);
  }

  capitalLog(leekId) {
    const rows = leekId
      ? this.q("SELECT * FROM capital_log WHERE leek_id = ? ORDER BY date DESC").all(leekId)
      : this.q("SELECT * FROM capital_log ORDER BY date DESC").all();
    return rows.map((r) => ({ ...r, bonuses: JSON.parse(r.bonuses) }));
  }

  // --- analyses IA ---
  putAiAnalysis({ fightId, perspective, provider, model, prompt, result, meta }) {
    const id = this.q("INSERT INTO ai_analyses(fight_id, perspective, date, provider, model, prompt, result, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(fightId, perspective, now(), provider, model, prompt, JSON.stringify(result), JSON.stringify(meta ?? {})).lastInsertRowid;
    return this.aiAnalyses(fightId).find((a) => a.id === Number(id));
  }

  /** Analyses d'un combat, la plus récente d'abord. */
  aiAnalyses(fightId) {
    return this.q("SELECT * FROM ai_analyses WHERE fight_id = ? ORDER BY date DESC, id DESC").all(fightId)
      .map((r) => ({ id: r.id, fightId: r.fight_id, perspective: r.perspective, date: r.date, provider: r.provider, model: r.model, prompt: r.prompt, result: JSON.parse(r.result), meta: JSON.parse(r.meta) }));
  }

  removeAiAnalysis(fightId, id) {
    return this.q("DELETE FROM ai_analyses WHERE fight_id = ? AND id = ?").run(fightId, id).changes;
  }

  /** Fichiers SQLite pour la sauvegarde. */
  backup(dest) {
    this.db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  }

  /**
   * Fusionne une autre base (ex. l'ancien emplacement data/ du projet) : ajoute ce qui manque, ne remplace rien.
   * Les comptes déjà présents gardent leur clé (l'ancienne a pu être régénérée entre-temps).
   */
  mergeFrom(file) {
    this.db.exec(`ATTACH '${file.replace(/'/g, "''")}' AS src`);
    try {
      return this.tx(() => {
        const run = (sql) => this.db.prepare(sql).run().changes;
        const FIGHT_COLS = "id, date, context, type, status, winner, seed, tournament, duration, leeks1, leeks2, raw, note, tags, source, imported_at";
        const out = {
          fights: run(`INSERT OR IGNORE INTO fights(${FIGHT_COLS}) SELECT ${FIGHT_COLS} FROM src.fights`),
          notes: run(`UPDATE fights SET note = (SELECT s.note FROM src.fights s WHERE s.id = fights.id)
                      WHERE note = '' AND EXISTS (SELECT 1 FROM src.fights s WHERE s.id = fights.id AND s.note <> '')`),
          tags: run(`UPDATE fights SET tags = (SELECT s.tags FROM src.fights s WHERE s.id = fights.id)
                     WHERE tags = '[]' AND EXISTS (SELECT 1 FROM src.fights s WHERE s.id = fights.id AND s.tags <> '[]')`),
          accounts: run("INSERT OR IGNORE INTO accounts(id, name, api_key, position, added_at) SELECT id, name, api_key, position, added_at FROM src.accounts"),
          tracked: run("INSERT OR IGNORE INTO tracked_leeks(id, name, farmer_id, farmer_name, owned, position, added_at, info) SELECT id, name, farmer_id, farmer_name, owned, position, added_at, info FROM src.tracked_leeks"),
          capital: run(`INSERT INTO capital_log(leek_id, date, bonuses, capital) SELECT s.leek_id, s.date, s.bonuses, s.capital FROM src.capital_log s
                        WHERE NOT EXISTS (SELECT 1 FROM capital_log c WHERE c.leek_id = s.leek_id AND c.date = s.date AND c.bonuses = s.bonuses)`),
        };
        run("INSERT OR IGNORE INTO fight_leeks(fight_id, leek_id, farmer_id, side) SELECT fight_id, leek_id, farmer_id, side FROM src.fight_leeks WHERE fight_id IN (SELECT id FROM fights)");
        run("INSERT OR IGNORE INTO participations(fight_id, perspective, date, result, version, summary) SELECT fight_id, perspective, date, result, version, summary FROM src.participations WHERE fight_id IN (SELECT id FROM fights)");
        // L'ancienne clé unique ("apiKey") serait reprise au démarrage et écraserait une clé plus récente.
        run("INSERT OR IGNORE INTO kv(key, value) SELECT key, value FROM src.kv WHERE key <> 'apiKey'");
        return out;
      });
    } finally {
      this.db.exec("DETACH src");
    }
  }

  // --- migration depuis l'ancien stockage JSON (data/index.json + data/fights/*.json) ---
  migrateFromJson(dir) {
    const indexFile = path.join(dir, "index.json");
    if (!fs.existsSync(indexFile) || this.get("migratedFromJson")) return null;
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    const fightsDir = path.join(dir, "fights");
    let n = 0;
    for (const s of Object.values(index.fights ?? {})) {
      const file = path.join(fightsDir, `${s.id}.json`);
      if (!fs.existsSync(file)) continue;
      this.putFight(JSON.parse(fs.readFileSync(file, "utf8")), s.source);
      this.annotate(s.id, { note: s.note ?? "", tags: s.tags ?? [] });
      n++;
    }
    const meta = index.meta ?? {};
    if (meta.farmerId) this.set("farmerId", meta.farmerId);
    if (meta.lastSync) this.set("lastSync", meta.lastSync);
    for (const c of meta.capitalLog ?? []) this.q("INSERT INTO capital_log(leek_id, date, bonuses, capital) VALUES (?, ?, ?, ?)").run(c.leekId, c.date, JSON.stringify(c.bonuses), c.capital);
    const settingsFile = path.join(dir, "settings.json");
    const legacyTracked = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")).trackedLeeks : null;
    this.set("migratedFromJson", { at: Date.now(), fights: n });
    // L'ancien stockage est conservé à part, au cas où.
    const legacy = path.join(dir, "legacy-json");
    fs.mkdirSync(legacy, { recursive: true });
    for (const name of ["index.json", "settings.json", "fights"]) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) fs.renameSync(p, path.join(legacy, name));
    }
    return { fights: n, legacyTracked };
  }
}
