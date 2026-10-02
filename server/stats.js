// Statistiques agrégées sur les résumés de combats stockés.

/**
 * @param {any[]} fights résumés filtrés (terminés)
 * @param {number|null} leekId poireau de référence (pour les écarts de niveau)
 */
export function computeStats(fights, leekId = null) {
  const done = fights.filter((f) => ["win", "loss", "draw"].includes(f.result)).sort((a, b) => a.date - b.date);
  const record = () => ({ fights: 0, wins: 0, losses: 0, draws: 0, winrate: 0 });
  const add = (r, f) => {
    r.fights++;
    if (f.result === "win") r.wins++;
    else if (f.result === "loss") r.losses++;
    else r.draws++;
    r.winrate = pct(r.wins, r.fights);
    return r;
  };

  const total = record();
  const byContext = {};
  const byType = {};
  const byDay = {};
  const byLevelDiff = {};
  const byTalentDiff = {};
  const byDuration = {};
  const opponents = {};
  const byBuild = {};
  const byOppProfile = {};
  const items = {};
  const talent = [];
  const sums = { damageDealt: 0, damageTaken: 0, heal: 0, tpUnusedPerTurn: 0, bugs: 0, ops: 0, turns: 0, lifeLeftPct: 0, analysed: 0 };
  const bugFights = [];

  for (const f of done) {
    add(total, f);
    add((byContext[f.context] ??= record()), f);
    add((byType[f.type] ??= record()), f);
    const day = new Date(f.date * 1000).toISOString().slice(0, 10);
    add((byDay[day] ??= { day, ...record() }), f);

    const mine = f[`leeks${f.mySide}`] ?? [];
    const me = (leekId && mine.find((l) => l.id === leekId)) || mine[0];
    const opps = f.opponents ?? [];
    if (me && opps.length) {
      const oppLevel = avgOf(opps.map((o) => o.level));
      const oppTalent = avgOf(opps.map((o) => o.talent));
      if (me.level != null && oppLevel != null) add((byLevelDiff[levelBucket(oppLevel - me.level)] ??= record()), f);
      if (me.talent != null && oppTalent != null) add((byTalentDiff[talentBucket(oppTalent - me.talent)] ??= record()), f);
    }
    if (f.turns != null) add((byDuration[durationBucket(f.turns)] ??= record()), f);
    const myBuild = (leekId && f.myBuilds?.[leekId]) || f.myBuild;
    if (myBuild) {
      const key = buildKey(myBuild);
      const r = (byBuild[key] ??= { bucket: key, build: myBuild, first: f.date, last: f.date, ...record() });
      add(r, f);
      r.last = Math.max(r.last, f.date);
      r.first = Math.min(r.first, f.date);
      r.build = myBuild;
    }
    if (f.oppBuild) add((byOppProfile[profileOf(f.oppBuild)] ??= record()), f);
    if (f.talentAfter != null) talent.push({ date: f.date, talent: f.talentAfter, id: f.id });

    for (const o of opps) {
      const r = (opponents[o.id] ??= { id: o.id, name: o.name, level: o.level, talent: o.talent, skin: o.skin, hat: o.hat, metal: o.metal, face: o.face, ...record(), lastFight: 0 });
      add(r, f);
      r.level = o.level;
      r.talent = o.talent;
      r.lastFight = Math.max(r.lastFight, f.date);
    }

    if (f.me) {
      sums.analysed++;
      sums.damageDealt += f.me.damageDealt;
      sums.damageTaken += f.me.damageTaken;
      sums.heal += f.me.heal;
      sums.tpUnusedPerTurn += f.me.tpUnusedPerTurn;
      sums.bugs += f.me.bugs;
      sums.ops += f.me.ops;
      sums.turns += f.turns ?? 0;
      sums.lifeLeftPct += f.me.lifeLeftPct;
      if (f.me.bugs > 0) bugFights.push(f.id);
      for (const it of f.me.items ?? []) {
        const k = `${it.kind}:${it.name}`;
        const r = (items[k] ??= { kind: it.kind, name: it.name, fightsUsed: 0, uses: 0, damage: 0, heal: 0, kills: 0, crits: 0, fails: 0, wins: 0 });
        r.fightsUsed++;
        r.uses += it.uses;
        r.damage += it.damage;
        r.heal += it.heal;
        r.kills += it.kills;
        r.crits += it.crits;
        r.fails += it.fails;
        if (f.result === "win") r.wins++;
      }
    }
  }

  const n = Math.max(1, sums.analysed);
  const itemList = Object.values(items)
    .map((r) => ({
      ...r,
      usageRate: pct(r.fightsUsed, sums.analysed),
      winrateWhenUsed: pct(r.wins, r.fightsUsed),
      usesPerFight: round(r.uses / r.fightsUsed),
      damagePerUse: r.uses ? round(r.damage / r.uses) : 0,
      critRate: pct(r.crits, r.uses),
    }))
    .sort((a, b) => b.uses - a.uses);

  const oppList = Object.values(opponents).sort((a, b) => b.fights - a.fights || b.lastFight - a.lastFight);

  return {
    total,
    streak: streak(done),
    recent: {
      last10: lastN(done, 10),
      last50: lastN(done, 50),
    },
    averages: {
      turns: round(sums.turns / n),
      damageDealt: round(sums.damageDealt / n),
      damageTaken: round(sums.damageTaken / n),
      heal: round(sums.heal / n),
      tpUnusedPerTurn: round(sums.tpUnusedPerTurn / n),
      lifeLeftPct: round(sums.lifeLeftPct / n),
      ops: Math.round(sums.ops / n),
    },
    bugs: { total: sums.bugs, fights: bugFights.length, fightIds: bugFights.slice(-20) },
    byContext,
    byType,
    byDay: Object.values(byDay),
    byLevelDiff: orderBuckets(byLevelDiff, LEVEL_BUCKETS),
    byTalentDiff: orderBuckets(byTalentDiff, TALENT_BUCKETS),
    byDuration: orderBuckets(byDuration, DURATION_BUCKETS),
    talent,
    // Builds les plus récents d'abord. La vie et le niveau sont exclus de la clé (ils évoluent à chaque niveau).
    byBuild: Object.values(byBuild).sort((a, b) => b.last - a.last).slice(0, 12),
    byOppProfile: PROFILES.filter((p) => byOppProfile[p]).map((p) => ({ bucket: p, ...byOppProfile[p] })),
    items: itemList,
    nemeses: oppList.filter((o) => o.losses > 0).sort((a, b) => b.losses - a.losses || a.winrate - b.winrate).slice(0, 15),
    opponents: oppList.slice(0, 100),
  };
}

const LEVEL_BUCKETS = ["≤ -10", "-9 à -5", "-4 à -1", "0", "+1 à +4", "+5 à +9", "≥ +10"];
function levelBucket(d) {
  d = Math.round(d);
  if (d <= -10) return LEVEL_BUCKETS[0];
  if (d <= -5) return LEVEL_BUCKETS[1];
  if (d < 0) return LEVEL_BUCKETS[2];
  if (d === 0) return LEVEL_BUCKETS[3];
  if (d < 5) return LEVEL_BUCKETS[4];
  if (d < 10) return LEVEL_BUCKETS[5];
  return LEVEL_BUCKETS[6];
}

const TALENT_BUCKETS = ["≤ -200", "-199 à -100", "-99 à -1", "0 à +99", "+100 à +199", "≥ +200"];
function talentBucket(d) {
  if (d <= -200) return TALENT_BUCKETS[0];
  if (d <= -100) return TALENT_BUCKETS[1];
  if (d < 0) return TALENT_BUCKETS[2];
  if (d < 100) return TALENT_BUCKETS[3];
  if (d < 200) return TALENT_BUCKETS[4];
  return TALENT_BUCKETS[5];
}

const DURATION_BUCKETS = ["1-5", "6-10", "11-20", "21-40", "41-63", "64+"];
function durationBucket(t) {
  if (t <= 5) return DURATION_BUCKETS[0];
  if (t <= 10) return DURATION_BUCKETS[1];
  if (t <= 20) return DURATION_BUCKETS[2];
  if (t <= 40) return DURATION_BUCKETS[3];
  if (t <= 63) return DURATION_BUCKETS[4];
  return DURATION_BUCKETS[5];
}

const BUILD_STATS = [
  ["strength", "FOR"], ["wisdom", "SAG"], ["agility", "AGI"], ["resistance", "RÉS"],
  ["science", "SCI"], ["magic", "MAG"], ["frequency", "FRÉ"], ["tp", "PT"], ["mp", "PM"],
];
function buildKey(b) {
  return BUILD_STATS.filter(([k]) => b[k] && !(k === "frequency" && b[k] === 100)).map(([k, l]) => `${l} ${b[k]}`).join(" · ") || "—";
}

const PROFILE_LABELS = { strength: "Force", wisdom: "Sagesse", agility: "Agilité", resistance: "Résistance", science: "Science", magic: "Magie" };
const PROFILES = [...Object.values(PROFILE_LABELS), "Mixte", "Aucune stat"];
/** Profil dominant d'un adversaire : la stat offensive/défensive principale, "Mixte" si deux stats sont proches. */
function profileOf(b) {
  const vals = Object.keys(PROFILE_LABELS).map((k) => [k, b[k] || 0]).sort((x, y) => y[1] - x[1]);
  if (vals[0][1] === 0) return "Aucune stat";
  if (vals[1][1] >= vals[0][1] * 0.75) return "Mixte";
  return PROFILE_LABELS[vals[0][0]];
}

function orderBuckets(map, order) {
  return order.filter((k) => map[k]).map((k) => ({ bucket: k, ...map[k] }));
}

function streak(done) {
  if (!done.length) return { result: null, count: 0 };
  const last = done[done.length - 1].result;
  let count = 0;
  for (let i = done.length - 1; i >= 0 && done[i].result === last; i--) count++;
  return { result: last, count };
}

function lastN(done, k) {
  const slice = done.slice(-k);
  const wins = slice.filter((f) => f.result === "win").length;
  return { fights: slice.length, wins, winrate: pct(wins, slice.length) };
}

const avgOf = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (a, b) => (b ? round((100 * a) / b) : 0);
const round = (x) => Math.round(x * 100) / 100;
