// Analyse d'un combat Leek Wars à partir de `fight.data.actions`.
// Codes d'actions repris du client officiel (leek-wars/src/model/action.ts).

export const ANALYSIS_VERSION = 10;

const A = {
  START_FIGHT: 0, PLAYER_DEAD: 5, NEW_TURN: 6, LEEK_TURN: 7, END_TURN: 8, SUMMON: 9,
  MOVE_TO: 10, KILL: 11, USE_CHIP: 12, SET_WEAPON: 13, USE_WEAPON: 16,
  TP_LOST: 100, LIFE_LOST: 101, MP_LOST: 102, CARE: 103, BOOST_VITA: 104, RESURRECTION: 105,
  NOVA_DAMAGE: 107, DAMAGE_RETURN: 108, LIFE_DAMAGE: 109, POISON_DAMAGE: 110, AFTEREFFECT: 111,
  NOVA_VITALITY: 112, SAY: 203, ADD_WEAPON_EFFECT: 301, ADD_CHIP_EFFECT: 302, REMOVE_EFFECT: 303,
  BUG: 1002,
};

const EFFECT_POISON = 13;
const EFFECT_AFTEREFFECT = 25;

export const CONTEXTS = { 0: "test", 1: "défi", 2: "potager", 3: "tournoi", 4: "battle royale" };
export const TYPES = { 0: "solo", 1: "éleveur", 2: "équipe", 3: "battle royale", 4: "boss", 5: "guerre", 6: "chasse au trésor", 7: "colosse" };

/**
 * Analyse un combat du point de vue d'un éleveur (tous ses poireaux) ou d'un poireau précis (n'importe lequel).
 * @param {any} fight   réponse brute de fight/get
 * @param {{farmerId?: number, leekId?: number}} perspective  "moi" = les entités de cet éleveur, ou ce poireau + ses invocations
 * @param {{chips: Map<number, any>, weapons: Map<number, any>}} catalog  index par template
 */
export function analyzeFight(fight, perspective, catalog) {
  const { farmerId = null, leekId = null } = perspective;
  const side = leekId ? leekSide(fight, leekId) : mySide(fight, farmerId);
  const summary = {
    id: fight.id,
    date: fight.date,
    context: fight.context,
    type: fight.type,
    status: fight.status,
    winner: fight.winner,
    seed: fight.seed ?? null,
    tournament: fight.tournament ?? null,
    leeks1: (fight.leeks1 || []).map(pickLeek),
    leeks2: (fight.leeks2 || []).map(pickLeek),
    mySide: side,
    sideNames: sideNames(fight),
    result: resultOf(fight, side),
    duration: fight.report?.duration ?? null,
    analysisVersion: ANALYSIS_VERSION,
  };
  const sideLeeks = side ? summary[`leeks${side}`] : [];
  const own = leekId ? sideLeeks.filter((l) => l.id === leekId) : sideLeeks.filter((l) => l.farmer === farmerId);
  summary.myLeeks = (own.length ? own : sideLeeks).map((l) => l.id);
  summary.perspective = leekId ? `l${leekId}` : `f${farmerId}`;
  summary.opponents = side ? summary[`leeks${side === 1 ? 2 : 1}`] : [];
  // Battle royale : tout le monde est dans le même camp, les adversaires sont les autres participants.
  if (side && !summary.opponents.length) summary.opponents = sideLeeks.filter((l) => !summary.myLeeks.includes(l.id));

  // Gains (talent / xp / habs) depuis le rapport.
  if (fight.report && side) {
    const mine = (fight.report[`leeks${side}`] || []).filter((l) => summary.myLeeks.includes(l.id));
    summary.talentGain = sum(mine.map((l) => l.talent_gain || 0));
    summary.xp = sum(mine.map((l) => l.xp || 0));
    summary.money = sum(mine.map((l) => l.money || 0));
    summary.talentAfter = mine[0]?.talent ?? null;
  }

  if (fight.status !== 2 || !fight.data?.actions) return { summary, analysis: null };

  const analysis = analyzeActions(fight, { farmerId, leekId }, side, catalog);
  summary.me = analysis.teams.mine;
  summary.them = analysis.teams.theirs;
  summary.turns = analysis.turns;
  // Battle royale : un seul "camp" côté API, chaque poireau a sa propre équipe et `winner` est l'équipe gagnante.
  if (side && !(fight[`leeks${side === 1 ? 2 : 1}`] || []).length) {
    const myTeam = analysis.entities.find((e) => e.mine && !e.summon)?.team;
    summary.result = fight.winner === 0 ? "draw" : fight.winner === myTeam ? "win" : "loss";
  }
  // Builds (caractéristiques en combat, équipement compris) pour les analyses par répartition.
  const buildOf = (e) => (e ? { level: e.level, life: e.maxLifeStart, tp: e.tp, mp: e.mp, ...e.stats } : null);
  const mainMine = analysis.entities.find((e) => e.mine && !e.summon);
  const mainOpp = analysis.entities.find((e) => !e.ally && !e.summon);
  summary.myBuild = buildOf(mainMine);
  summary.oppBuild = buildOf(mainOpp);
  return { summary, analysis };
}

function pickLeek(l) {
  return { id: l.id, name: l.name, level: l.level, talent: l.talent, farmer: l.farmer, ...appearance(l) };
}

/** Apparence (images Leek Wars) : peau, chapeau (id du modèle), métal, visage. */
function appearance(l) {
  return { skin: l.skin ?? 1, hat: l.hat ?? null, metal: !!l.metal, face: l.face ?? 0 };
}

/**
 * Nom de chaque camp comme dans l'historique Leek Wars : poireau (solo), « (éleveur) », « [équipe] ».
 * `null` en battle royale (pas de camps). L'API fournit `team1_name`/`team2_name` déjà formatés.
 */
function sideNames(fight) {
  if (fight.type === 3) return null;
  // Arènes (guerre, chasse au trésor, colosse) : effectifs plutôt que la liste des poireaux.
  const count = (n, word) => `${(fight[`leeks${n}`] || []).length} ${word}`;
  if (fight.type === 5) return [count(1, "poireaux"), count(2, "poireaux")];
  if (fight.type === 6) return [count(1, "poireaux"), count(2, "coffres")];
  if (fight.type === 7) return [count(1, "poireaux"), fight.leeks2?.[0]?.name ?? "Colosse"];
  const name = (n) => {
    if (fight[`team${n}_name`]) return fight[`team${n}_name`];
    const leeks = fight[`leeks${n}`] || [];
    if (fight.type === 1) {
      const farmers = fight[`farmers${n}`] || {};
      const f = farmers[fight[`farmer${n}`]] ?? Object.values(farmers)[0];
      if (f?.name) return `(${f.name})`;
    }
    if (fight.type === 2 && fight[`team${n}`]?.name) return `[${fight[`team${n}`].name}]`;
    if (fight.type === 4 && n === 1) return `${leeks.length} poireaux`;
    return leeks.map((l) => l.name).join(", ") || null;
  };
  return [name(1), name(2)];
}

function leekSide(fight, leekId) {
  if ((fight.leeks1 || []).some((l) => l.id === leekId)) return 1;
  if ((fight.leeks2 || []).some((l) => l.id === leekId)) return 2;
  return null;
}

function mySide(fight, farmerId) {
  if (fight.farmers1 && fight.farmers1[farmerId]) return 1;
  if (fight.farmers2 && fight.farmers2[farmerId]) return 2;
  if ((fight.leeks1 || []).some((l) => l.farmer === farmerId)) return 1;
  if ((fight.leeks2 || []).some((l) => l.farmer === farmerId)) return 2;
  return null;
}

function resultOf(fight, side) {
  if (fight.status !== 2) return "pending";
  if (fight.winner === 0 || fight.winner === -1) return fight.winner === 0 ? "draw" : "pending";
  if (!side) return fight.winner === 1 ? "team1" : "team2";
  return fight.winner === side ? "win" : "loss";
}

function analyzeActions(fight, { farmerId, leekId }, side, catalog) {
  const data = fight.data;
  const realIds = new Map(); // entité → id réel du poireau
  for (const l of [...(fight.leeks1 || []), ...(fight.leeks2 || [])]) realIds.set(`${l.farmer}:${l.name}`, l.id);

  const entities = data.leeks.map((e) => ({
    id: e.id,
    leekId: e.summon ? null : realIds.get(`${e.farmer}:${e.name}`) ?? null,
    name: e.name,
    team: e.team,
    mine: false,
    ally: false,
    summon: !!e.summon,
    summoner: null,
    level: e.level,
    ...(e.summon ? {} : appearance(e)),
    maxLife: e.life,
    maxLifeStart: e.life,
    life: e.life,
    tp: e.tp,
    mp: e.mp,
    stats: {
      strength: e.strength, wisdom: e.wisdom, agility: e.agility, resistance: e.resistance,
      science: e.science, magic: e.magic, frequency: e.frequency,
    },
    damageDealt: 0,
    damageTaken: 0,
    poisonDealt: 0,
    returnDealt: 0,
    heal: 0,
    healReceived: 0,
    kills: 0,
    deathTurn: null,
    killer: null,
    turnsPlayed: 0,
    tpUsed: 0,
    mpUsed: 0,
    chipUses: 0,
    weaponUses: 0,
    crits: 0,
    fails: 0,
    bugs: 0,
    says: 0,
    ops: data.ops?.[e.id] ?? null,
    items: {},
    weapon: null,
  }));
  // "Moi" = les entités de l'éleveur, ou le poireau suivi + ses invocations (pré-passe sur les SUMMON).
  const summoner = new Map();
  for (const a of data.actions) if (a[0] === A.SUMMON) summoner.set(a[2], a[1]);
  const rawById = new Map(data.leeks.map((e) => [e.id, e]));
  const isMine = (id, depth = 0) => {
    const ent = entities.find((x) => x.id === id);
    if (!ent || depth > 5) return false;
    if (leekId) return ent.summon ? isMine(summoner.get(id), depth + 1) : ent.leekId === leekId;
    return rawById.get(id)?.farmer === farmerId;
  };
  for (const e of entities) {
    e.mine = isMine(e.id);
    e.summoner = summoner.get(e.id) ?? null;
  }
  // Alliés = même équipe (coéquipiers en combat d'équipe).
  const myTeam = entities.find((e) => e.mine)?.team ?? side;
  for (const e of entities) e.ally = e.team === myTeam;
  const byId = new Map(entities.map((e) => [e.id, e]));
  const get = (id) => byId.get(id) ?? null;

  const effects = new Map(); // effectId → { caster, target, type, item }
  const turnsLog = []; // [{turn, entity, tpUsed, mpUsed, actions:[...]}]
  const lifeTimeline = [];
  const kills = [];
  const snapshot = (turn) => {
    const life = {};
    for (const e of entities) life[e.id] = Math.max(0, e.life);
    lifeTimeline.push({ turn, life });
  };

  let turn = 0;
  let current = null; // entité qui joue
  let currentTurn = null;
  let lastItem = null; // { key, entity } — dernier objet utilisé, pour attribuer les dégâts

  const itemStat = (entity, kind, template) => {
    const def = kind === "chip" ? catalog.chips.get(template) : catalog.weapons.get(template);
    const name = def?.name ?? `${kind} #${template}`;
    const key = `${kind}:${name}`;
    entity.items[key] ??= { kind, name, template, cost: def?.cost ?? null, uses: 0, crits: 0, fails: 0, damage: 0, heal: 0, kills: 0 };
    return entity.items[key];
  };

  const dealDamage = (attacker, target, value, kind) => {
    if (!target) return;
    target.life -= value;
    target.damageTaken += value;
    if (!attacker) return;
    const ally = attacker.team === target.team;
    if (!ally) attacker.damageDealt += value;
    if (kind === "poison") attacker.poisonDealt += value;
    if (kind === "return") attacker.returnDealt += value;
    if (kind === "direct" && lastItem && lastItem.entity === attacker && !ally) lastItem.stat.damage += value;
  };

  for (const a of data.actions) {
    const t = a[0];
    switch (t) {
      case A.NEW_TURN:
        if (turn > 0) snapshot(turn);
        turn = a[1];
        break;
      case A.LEEK_TURN: {
        if (turn === 0) turn = 1;
        current = get(a[1]);
        lastItem = null;
        if (current) {
          current.turnsPlayed++;
          currentTurn = { turn, entity: current.id, tpUsed: 0, mpUsed: 0, chips: [], weapons: 0, damage: 0 };
          turnsLog.push(currentTurn);
        }
        break;
      }
      case A.END_TURN:
        current = null;
        currentTurn = null;
        break;
      case A.MOVE_TO: {
        const e = get(a[1]);
        const n = Array.isArray(a[3]) ? a[3].length : 0;
        if (e) e.mpUsed += n;
        if (currentTurn && e && e.id === currentTurn.entity) currentTurn.mpUsed += n;
        break;
      }
      case A.SET_WEAPON:
        if (current) {
          current.weapon = a[1];
          // Changer d'arme coûte 1 PT.
          current.tpUsed += 1;
          if (currentTurn) currentTurn.tpUsed += 1;
          lastItem = null;
        }
        break;
      case A.USE_CHIP: {
        if (!current) break;
        const result = a.length === 4 ? a[3] : a[4];
        const template = a.length === 4 ? a[1] : a[3];
        const stat = itemStat(current, "chip", template);
        countUse(current, stat, result, "chip", currentTurn);
        lastItem = { entity: current, stat };
        if (currentTurn) currentTurn.chips.push(stat.name);
        break;
      }
      case A.USE_WEAPON: {
        if (!current) break;
        const result = a.length === 3 ? a[2] : a[4];
        const stat = itemStat(current, "weapon", current.weapon ?? 0);
        countUse(current, stat, result, "weapon", currentTurn);
        lastItem = { entity: current, stat };
        if (currentTurn) currentTurn.weapons++;
        break;
      }
      case A.LIFE_LOST:
      case A.LIFE_DAMAGE:
        dealDamage(current, get(a[1]), a[2], "direct");
        if (currentTurn && current && get(a[1])?.team !== current.team) currentTurn.damage += a[2];
        break;
      case A.NOVA_DAMAGE: {
        const target = get(a[1]);
        if (target) target.maxLife -= a[2];
        if (current && target && current.team !== target.team) current.damageDealt += a[2];
        break;
      }
      case A.DAMAGE_RETURN: {
        // Le renvoi de dégâts est infligé à l'attaquant (current) par la cible qu'il a frappée.
        const target = get(a[1]);
        const source = lastReturnSource(effects, target, entities);
        dealDamage(source, target, a[2], "return");
        break;
      }
      case A.POISON_DAMAGE:
      case A.AFTEREFFECT: {
        const target = get(a[1]);
        const type = t === A.POISON_DAMAGE ? EFFECT_POISON : EFFECT_AFTEREFFECT;
        const eff = [...effects.values()].find((x) => x.target === a[1] && x.type === type);
        const caster = eff ? get(eff.caster) : t === A.AFTEREFFECT ? current : null;
        dealDamage(caster, target, a[2], "poison");
        if (eff?.stat && caster && target && caster.team !== target.team) eff.stat.damage += a[2];
        break;
      }
      case A.CARE: {
        const target = get(a[1]);
        if (target) {
          target.life = Math.min(target.maxLife, target.life + a[2]);
          target.healReceived += a[2];
        }
        if (current) {
          current.heal += a[2];
          if (lastItem && lastItem.entity === current) lastItem.stat.heal += a[2];
        }
        break;
      }
      case A.BOOST_VITA:
      case A.NOVA_VITALITY: {
        const target = get(a[1]);
        if (target) {
          target.maxLife += a[2];
          if (t === A.BOOST_VITA) target.life += a[2];
        }
        break;
      }
      case A.SUMMON: {
        const summon = get(a[2]);
        if (summon) summon.summoner = a[1];
        break;
      }
      case A.RESURRECTION: {
        const target = get(a[2]);
        if (target) {
          target.life = a[4];
          target.maxLife = a[5];
          target.deathTurn = null;
        }
        break;
      }
      case A.PLAYER_DEAD: {
        const victim = get(a[1]);
        const killer = a.length > 2 ? get(a[2]) : current;
        if (victim) {
          victim.deathTurn = turn;
          victim.killer = killer?.id ?? null;
          victim.life = 0;
        }
        if (killer && victim && killer.team !== victim.team) {
          killer.kills++;
          if (lastItem && lastItem.entity === killer) lastItem.stat.kills++;
        }
        kills.push({ turn, victim: victim?.id ?? a[1], killer: killer?.id ?? null });
        break;
      }
      case A.ADD_WEAPON_EFFECT:
      case A.ADD_CHIP_EFFECT: {
        const [, item, id, caster, target, type] = a;
        const casterEntity = get(caster);
        const kind = t === A.ADD_CHIP_EFFECT ? "chip" : "weapon";
        let stat = null;
        if (casterEntity) {
          const def = kind === "chip" ? catalog.chips.get(item) : catalog.weapons.get(item);
          const key = `${kind}:${def?.name ?? `${kind} #${item}`}`;
          stat = casterEntity.items[key] ?? null;
        }
        effects.set(id, { caster, target, type, item, stat });
        break;
      }
      case A.REMOVE_EFFECT:
        effects.delete(a[1]);
        break;
      case A.BUG: {
        const e = get(a[1]);
        if (e) e.bugs++;
        break;
      }
      case A.SAY:
        if (current) current.says++;
        break;
    }
  }
  snapshot(turn);

  for (const e of entities) {
    e.items = Object.values(e.items).sort((x, y) => y.uses - x.uses);
    e.tpUsedPerTurn = e.turnsPlayed ? round(e.tpUsed / e.turnsPlayed) : 0;
    e.tpUnusedPerTurn = e.turnsPlayed ? round(Math.max(0, e.tp - e.tpUsed / e.turnsPlayed)) : 0;
    e.mpUsedPerTurn = e.turnsPlayed ? round(e.mpUsed / e.turnsPlayed) : 0;
    e.finalLife = Math.max(0, e.life);
    delete e.life;
  }

  const teamAgg = (mine) => {
    const team = entities.filter((e) => (mine ? e.mine : !e.ally));
    const leeks = team.filter((e) => !e.summon);
    return {
      damageDealt: sum(team.map((e) => e.damageDealt)),
      damageTaken: sum(leeks.map((e) => e.damageTaken)),
      heal: sum(team.map((e) => e.heal)),
      kills: sum(team.map((e) => e.kills)),
      summons: team.filter((e) => e.summon).length,
      bugs: sum(leeks.map((e) => e.bugs)),
      crits: sum(team.map((e) => e.crits)),
      fails: sum(team.map((e) => e.fails)),
      tpUnusedPerTurn: avg(leeks.map((e) => e.tpUnusedPerTurn)),
      mpUsedPerTurn: avg(leeks.map((e) => e.mpUsedPerTurn)),
      ops: sum(leeks.map((e) => e.ops ?? 0)),
      lifeLeftPct: round(
        (100 * sum(leeks.map((e) => e.finalLife))) / Math.max(1, sum(leeks.map((e) => e.maxLife))),
      ),
      items: mergeItems(team),
    };
  };

  return {
    version: ANALYSIS_VERSION,
    turns: turn,
    entities,
    kills,
    lifeTimeline,
    turnsLog,
    teams: { mine: teamAgg(true), theirs: teamAgg(false) },
  };
}

function countUse(entity, stat, result, kind, currentTurn) {
  stat.uses++;
  if (kind === "chip") entity.chipUses++;
  else entity.weaponUses++;
  if (result === 2) {
    stat.crits++;
    entity.crits++;
  } else if (result !== 1) {
    stat.fails++;
    entity.fails++;
  }
  const cost = stat.cost ?? 0;
  entity.tpUsed += cost;
  if (currentTurn) currentTurn.tpUsed += cost;
}

function lastReturnSource(effects, target, entities) {
  // DAMAGE_RETURN : la cible (a[1]) subit des dégâts renvoyés par un porteur d'effet "renvoi" (type 20).
  for (const eff of effects.values()) {
    if (eff.type === 20 && target && eff.target !== target.id) {
      return entities.find((e) => e.id === eff.target) ?? null;
    }
  }
  return null;
}

function mergeItems(team) {
  const out = {};
  for (const e of team) {
    for (const it of e.items) {
      const k = `${it.kind}:${it.name}`;
      out[k] ??= { kind: it.kind, name: it.name, uses: 0, crits: 0, fails: 0, damage: 0, heal: 0, kills: 0 };
      for (const f of ["uses", "crits", "fails", "damage", "heal", "kills"]) out[k][f] += it[f];
    }
  }
  return Object.values(out).sort((a, b) => b.uses - a.uses);
}

const sum = (xs) => xs.reduce((s, x) => s + (x || 0), 0);
const avg = (xs) => (xs.length ? round(sum(xs) / xs.length) : 0);
const round = (x) => Math.round(x * 100) / 100;
