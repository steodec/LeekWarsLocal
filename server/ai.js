// Analyse d'un combat par un modèle de langage (Claude ou ChatGPT).
//
// Le prompt (modifiable dans l'interface) fixe le rôle et les critères de notation ; les données du combat
// (résumé, entités, tour par tour, logs IA, code source de l'IA si le poireau est à moi) sont jointes en JSON
// dans le message utilisateur, et le format de réponse est imposé par un schéma JSON (sorties structurées).
//
// Appels HTTP directs (fetch) plutôt que les SDK : deux fournisseurs, et le serveur est empaqueté sans dépendance.

export const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", defaultModel: "claude-opus-5-5", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5", "claude-fable-5-1"] },
  openai: { label: "ChatGPT (OpenAI)", defaultModel: "gpt-5", models: ["gpt-5", "gpt-5-mini"] },
};

export const DEFAULT_PROMPT = `Tu es un expert de Leek Wars, le jeu de programmation où des poireaux s'affrontent au tour par tour sur une carte en losanges, pilotés par une IA écrite par leur éleveur (LeekScript, ou TypeScript compilé). Tu analyses un combat du point de vue du joueur (« moi », entités marquées \`mine: true\`) pour l'aider à progresser.

Rappels de jeu utiles :
- Chaque tour, une entité dispose de PT (points de tour, pour les armes et puces) et de PM (points de mouvement). Des PT inutilisés sont presque toujours une perte.
- Les caractéristiques (force, sagesse, agilité, résistance, science, magie, fréquence) orientent le build : force → dégâts d'armes/puces offensives, sagesse → soins et vie, résistance → boucliers, science → durée/puissance des effets, magie → poisons, agilité → critiques et renvoi, fréquence → ordre de jeu.
- Les « bugs » sont des erreurs d'exécution de l'IA ; les opérations (ops) mesurent son coût CPU (une IA trop gourmande peut être coupée).
- Les échecs (fails) sont des utilisations ratées (portée, ligne de vue, cible invalide…), souvent le signe d'une logique de ciblage ou de placement à revoir.

Donne trois notes sur 100 :
1. **Note de code** : qualité de l'IA en tant que programme. Robustesse (bugs, erreurs et avertissements dans les logs), efficacité (ops), exploitation des ressources (PT/PM utilisés, puces et armes pertinentes, actions ratées), logique de décision (ciblage, ordre des actions, gestion des cooldowns, réaction à la situation). Si le code source est fourni, juge aussi sa structure, sa lisibilité et les erreurs de logique que tu y repères, en citant les fichiers et fonctions concernés.
2. **Note de RPG** : qualité du poireau en tant que personnage. Pertinence du build (répartition des caractéristiques, vie, PT, PM) face à cet adversaire, choix de l'équipement (armes, puces), synergies, placement et tactique (distance, couverture, gestion de la vie, soins, boucliers, invocations).
3. **Note globale** : appréciation d'ensemble du combat qui tient compte du résultat, des deux notes ci-dessus et de la difficulté de l'adversaire (niveau, talent). Une défaite contre bien plus fort peut rester correcte ; une victoire facile n'est pas forcément excellente.

Échelle : 90+ excellent, 75-89 bon, 60-74 correct avec des points à revoir, 40-59 faible, < 40 très problématique.

Sois concret et factuel : appuie chaque constat sur des chiffres du combat (tour, dégâts, PT, objet, ligne de log, extrait de code). Pas de généralités. Termine par des recommandations actionnables, classées par priorité, en indiquant pour les changements d'IA quoi modifier précisément.

Réponds en français.`;

const LIST = { type: "array", items: { type: "string" } };
const SECTION = {
  type: "object",
  properties: { summary: { type: "string" }, strengths: LIST, issues: LIST },
  required: ["summary", "strengths", "issues"],
  additionalProperties: false,
};

/** Format de réponse imposé au modèle (les deux fournisseurs acceptent ce sous-ensemble de JSON Schema). */
export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    codeScore: { type: "integer", description: "Note de code sur 100" },
    rpgScore: { type: "integer", description: "Note de RPG sur 100" },
    globalScore: { type: "integer", description: "Note globale sur 100" },
    verdict: { type: "string", description: "Résumé du combat en une ou deux phrases" },
    code: { ...SECTION, description: "Analyse de l'IA (code)" },
    rpg: { ...SECTION, description: "Analyse du poireau (build, équipement, tactique)" },
    keyMoments: {
      type: "array",
      description: "Moments décisifs du combat",
      items: {
        type: "object",
        properties: { turn: { type: "integer" }, text: { type: "string" } },
        required: ["turn", "text"],
        additionalProperties: false,
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["haute", "moyenne", "basse"] },
          area: { type: "string", enum: ["code", "rpg"] },
          title: { type: "string" },
          detail: { type: "string" },
        },
        required: ["priority", "area", "title", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["codeScore", "rpgScore", "globalScore", "verdict", "code", "rpg", "keyMoments", "recommendations"],
  additionalProperties: false,
};

const FORMAT_NOTE =
  "Réponds uniquement avec un objet JSON conforme au schéma demandé (codeScore, rpgScore, globalScore : entiers de 0 à 100 ; verdict ; code et rpg : {summary, strengths[], issues[]} ; keyMoments[] : {turn, text} ; recommendations[] : {priority: haute|moyenne|basse, area: code|rpg, title, detail}).";

// ---------------------------------------------------------------------------
// Réglages (kv "ai")
// ---------------------------------------------------------------------------

export function aiSettings(db) {
  const s = db.get("ai") ?? {};
  return {
    provider: s.provider && PROVIDERS[s.provider] ? s.provider : null,
    keys: { anthropic: s.anthropicKey ?? null, openai: s.openaiKey ?? null },
    models: { anthropic: s.anthropicModel || PROVIDERS.anthropic.defaultModel, openai: s.openaiModel || PROVIDERS.openai.defaultModel },
    prompt: s.prompt || null,
    includeCode: s.includeCode !== false,
  };
}

/** Fournisseur à utiliser : celui demandé, sinon celui choisi dans les réglages, sinon le premier qui a une clé. */
export function resolveProvider(settings, wanted) {
  const order = [wanted, settings.provider, "anthropic", "openai"].filter(Boolean);
  return order.find((p) => PROVIDERS[p] && settings.keys[p]) ?? null;
}

// ---------------------------------------------------------------------------
// Données du combat envoyées au modèle
// ---------------------------------------------------------------------------

const MAX_LOG_LINES = 400;
const MAX_LOG_CHARS = 40_000;
const MAX_CODE_CHARS = 200_000;

/** Lignes de log lisibles (même règles que src/fightlogs.ts), groupées par tour. */
export function formatLogs(rawLogs, actions, entityName, errors = {}) {
  const turnAt = [];
  let turn = 1;
  (actions ?? []).forEach((a, i) => {
    if (a[0] === 6) turn = a[1];
    turnAt[i] = turn;
  });
  const lines = [];
  for (const farmerLogs of Object.values(rawLogs ?? {})) {
    for (const [action, logs] of Object.entries(farmerLogs ?? {})) {
      (logs ?? []).forEach((log, index) => {
        const type = log[1];
        if (type === 4 || type === 9 || type === 10) return; // marqueurs de case
        let text;
        if (type === 5) text = "pause()";
        else if (type === 11) text = "Trop de debug : les suivants sont ignorés";
        else if (type >= 6 && type <= 8) {
          const params = Array.isArray(log[4]) ? log[4] : [];
          const template = errors[String(log[3])] ?? `Erreur LeekScript ${log[3]}`;
          text = template.replace(/\{(\d+)\}/g, (_, i) => String(params[Number(i)] ?? "")) + (log[2] ? `\n${log[2]}` : "");
        } else text = String(log[2] ?? "");
        const kind = type === 2 || type === 7 || type === 11 ? "AVERTISSEMENT" : type === 3 || type === 8 ? "ERREUR" : null;
        lines.push({ action: Number(action), index, turn: turnAt[Number(action)] ?? 0, entity: entityName(log[0]), kind, text });
      });
    }
  }
  lines.sort((a, b) => a.action - b.action || a.index - b.index);
  const issues = lines.filter((l) => l.kind);
  // Erreurs et avertissements d'abord (toujours gardés), puis les debug() dans l'ordre jusqu'au plafond.
  const kept = new Set(issues);
  let chars = issues.reduce((s, l) => s + l.text.length, 0);
  for (const l of lines) {
    if (kept.size >= MAX_LOG_LINES || chars > MAX_LOG_CHARS) break;
    if (kept.has(l)) continue;
    kept.add(l);
    chars += l.text.length;
  }
  const out = lines.filter((l) => kept.has(l)).map((l) => `[tour ${l.turn}] [${l.entity}]${l.kind ? ` ${l.kind} :` : ""} ${l.text}`);
  return { total: lines.length, errors: issues.filter((l) => l.kind === "ERREUR").length, warnings: issues.filter((l) => l.kind === "AVERTISSEMENT").length, kept: out.length, lines: out };
}

/** Résumé compact du combat pour le modèle (pas les actions brutes : trop volumineuses). */
export function fightDigest({ summary, analysis, raw }) {
  const ents = analysis.entities;
  const nameOf = (id) => ents.find((e) => e.id === id)?.name ?? `#${id}`;
  const side = (e) => (e.mine ? "moi" : e.ally ? "allié" : "adversaire");
  return {
    combat: {
      id: summary.id,
      date: new Date(summary.date * 1000).toISOString(),
      contexte: summary.contextLabel ?? summary.context,
      type: summary.typeLabel ?? summary.type,
      resultat: { win: "victoire", loss: "défaite", draw: "égalité" }[summary.result] ?? summary.result,
      tours: analysis.turns,
      seed: summary.seed,
      gains: { talent: summary.talentGain ?? null, xp: summary.xp ?? null, habs: summary.money ?? null },
    },
    camps: [1, 2].map((n) => ({
      camp: n,
      moi: summary.mySide === n,
      vainqueur: raw.winner === n,
      poireaux: (raw[`leeks${n}`] || []).map((l) => ({ nom: l.name, niveau: l.level, talent: l.talent })),
    })),
    entites: ents.map((e) => ({
      id: e.id, nom: e.name, camp: side(e), invocation: e.summon, invoquePar: e.summoner != null ? nameOf(e.summoner) : undefined,
      niveau: e.level, vie: { max: e.maxLife, finale: e.finalLife }, pt: e.tp, pm: e.mp, caracteristiques: e.stats,
      degatsInfliges: e.damageDealt, dontPoison: e.poisonDealt, degatsRenvoyes: e.returnDealt, degatsSubis: e.damageTaken,
      soins: e.heal, soinsRecus: e.healReceived, kills: e.kills, mortAuTour: e.deathTurn, tueePar: e.killer != null ? nameOf(e.killer) : undefined,
      toursJoues: e.turnsPlayed, ptUtilisesParTour: e.tpUsedPerTurn, ptInutilisesParTour: e.tpUnusedPerTurn, pmUtilisesParTour: e.mpUsedPerTurn,
      utilisationsPuces: e.chipUses, tirs: e.weaponUses, critiques: e.crits, echecs: e.fails, bugs: e.bugs, operations: e.ops,
      objets: e.items.map((it) => ({ type: it.kind === "chip" ? "puce" : "arme", nom: it.name, utilisations: it.uses, degats: it.damage, soins: it.heal, critiques: it.crits, echecs: it.fails, kills: it.kills })),
    })),
    morts: analysis.kills.map((k) => ({ tour: k.turn, victime: nameOf(k.victim), tueur: nameOf(k.killer) })),
    vieParTour: analysis.lifeTimeline.map((t) => ({ tour: t.turn, ...Object.fromEntries(Object.entries(t.life).map(([id, v]) => [nameOf(Number(id)), v])) })),
    tourParTour: analysis.turnsLog.map((t) => ({ tour: t.turn, entite: nameOf(t.entity), ptUtilises: t.tpUsed, pmUtilises: t.mpUsed, degats: t.damage, puces: t.chips, tirs: t.weapons })),
    note: "PT utilisés estimés à partir du coût des objets (bonus de PT temporaires non comptés).",
  };
}

/**
 * Code source des IA (projets du dossier de l'IA d'entrée) via `ai/read`, plafonné.
 * `sources` : [{ leekName, aiPath, client, tree }]. Renvoie { files, truncated, errors }.
 */
export async function collectAiCode(sources) {
  const files = [];
  const errors = [];
  const seen = new Set();
  let chars = 0;
  let truncated = false;
  for (const { leekName, aiPath, client, tree } of sources) {
    if (!aiPath) continue;
    const root = aiPath.includes("/") ? aiPath.split("/")[0] + "/" : "";
    // Fichier d'entrée d'abord, puis le reste du projet (fichiers de code non vides).
    const paths = [aiPath, ...(tree?.files ?? [])
      .filter((f) => f.path !== aiPath && (!root || f.path.startsWith(root)) && /\.(ts|leek|ls|js)$/i.test(f.path) && f.total_chars > 0)
      .map((f) => f.path)
      .sort()];
    for (const p of paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (chars >= MAX_CODE_CHARS) {
        truncated = true;
        break;
      }
      try {
        const res = await client.call("POST", "ai/read", { path: p });
        let code = String(res.code ?? "");
        if (chars + code.length > MAX_CODE_CHARS) {
          code = code.slice(0, MAX_CODE_CHARS - chars) + "\n/* … tronqué … */";
          truncated = true;
        }
        chars += code.length;
        files.push({ leek: leekName, path: p, entrypoint: p === aiPath, code });
      } catch (e) {
        errors.push(`${p} : ${e.message}`);
      }
    }
  }
  return { files, truncated, errors };
}

export function buildUserMessage({ digest, logs, code }) {
  const parts = ["# Données du combat (JSON)", "```json", JSON.stringify(digest), "```"];
  parts.push("", "# Logs de l'IA");
  if (!logs) parts.push("Logs indisponibles (poireau d'un autre joueur ou erreur de lecture).");
  else if (!logs.total) parts.push("Aucun log : l'IA n'a rien affiché et aucune erreur n'a été levée.");
  else {
    parts.push(`${logs.total} ligne(s), dont ${logs.errors} erreur(s) et ${logs.warnings} avertissement(s).${logs.kept < logs.total ? ` Seules ${logs.kept} lignes sont reprises (erreurs et avertissements en priorité).` : ""}`);
    parts.push("```", logs.lines.join("\n"), "```");
  }
  parts.push("", "# Code source de l'IA");
  if (!code?.files.length) parts.push(code?.reason ?? "Code source non fourni : juge l'IA sur son comportement en combat.");
  else {
    if (code.truncated) parts.push("Attention : le code est volumineux et a été tronqué ; certains fichiers manquent.");
    for (const f of code.files) parts.push("", `## ${f.path}${f.entrypoint ? " (fichier d'entrée)" : ""} — IA de ${f.leek}`, "```", f.code, "```");
  }
  parts.push("", FORMAT_NOTE);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Appels aux fournisseurs
// ---------------------------------------------------------------------------

export class AiError extends Error {
  constructor(message, status = 502, code = "ai_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const TIMEOUT = 5 * 60_000;

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new AiError(e.name === "TimeoutError" ? "Le modèle n'a pas répondu à temps (5 min)." : `Connexion impossible : ${e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message ?? data.error ?? `HTTP ${res.status}`;
    throw new AiError(`${res.status === 401 ? "Clé refusée" : "Erreur du fournisseur"} (${res.status}) : ${msg}`, res.status === 401 ? 400 : 502);
  }
  return data;
}

// Repli serveur en cas de refus des classifieurs de sécurité, sur les modèles qui l'acceptent.
const FALLBACK_MODELS = /^claude-(opus-5|fable-5-1|sonnet-5-5)/;

async function callAnthropic({ apiKey, model, system, user }) {
  const fallback = FALLBACK_MODELS.test(model);
  const data = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01", ...(fallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}) },
    {
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
      ...(fallback ? { fallbacks: "default" } : {}),
    },
  );
  if (data.stop_reason === "refusal") throw new AiError(`Le modèle a refusé l'analyse${data.stop_details?.explanation ? ` : ${data.stop_details.explanation}` : "."}`);
  if (data.stop_reason === "max_tokens") throw new AiError("Réponse tronquée (limite de longueur atteinte).");
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, model: data.model ?? model, usage: { input: data.usage?.input_tokens ?? null, output: data.usage?.output_tokens ?? null } };
}

async function callOpenAI({ apiKey, model, system, user }) {
  const data = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "fight_analysis", strict: true, schema: RESULT_SCHEMA } },
    },
  );
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new AiError(`Le modèle a refusé l'analyse : ${choice.message.refusal}`);
  if (choice?.finish_reason === "length") throw new AiError("Réponse tronquée (limite de longueur atteinte).");
  return { text: choice?.message?.content ?? "", model: data.model ?? model, usage: { input: data.usage?.prompt_tokens ?? null, output: data.usage?.completion_tokens ?? null } };
}

function parseResult(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    try {
      obj = m ? JSON.parse(m[0]) : null;
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== "object") throw new AiError("Réponse du modèle illisible (JSON attendu).");
  const score = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(100, Math.round(Number(x)))) : null);
  const section = (s) => ({ summary: String(s?.summary ?? ""), strengths: [].concat(s?.strengths ?? []).map(String), issues: [].concat(s?.issues ?? []).map(String) });
  return {
    codeScore: score(obj.codeScore),
    rpgScore: score(obj.rpgScore),
    globalScore: score(obj.globalScore),
    verdict: String(obj.verdict ?? ""),
    code: section(obj.code),
    rpg: section(obj.rpg),
    keyMoments: [].concat(obj.keyMoments ?? []).map((k) => ({ turn: Number(k?.turn) || 0, text: String(k?.text ?? "") })),
    recommendations: [].concat(obj.recommendations ?? []).map((r) => ({ priority: String(r?.priority ?? "moyenne"), area: String(r?.area ?? ""), title: String(r?.title ?? ""), detail: String(r?.detail ?? "") })),
  };
}

export async function runAnalysis({ provider, apiKey, model, prompt, user }) {
  const call = provider === "openai" ? callOpenAI : callAnthropic;
  const res = await call({ apiKey, model, system: prompt, user });
  return { result: parseResult(res.text), model: res.model, usage: res.usage };
}

/** Vérifie une clé sans coût (liste des modèles). */
export async function checkKey(provider, apiKey) {
  const url = provider === "openai" ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models";
  const headers = provider === "openai" ? { Authorization: `Bearer ${apiKey}` } : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new AiError(`Connexion impossible : ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) throw new AiError("Clé refusée par le fournisseur.", 400, "bad_key");
  if (!res.ok) throw new AiError(`Vérification impossible (HTTP ${res.status}).`);
  const data = await res.json().catch(() => ({}));
  return (data.data ?? []).map((m) => m.id).filter(Boolean);
}
