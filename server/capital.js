// Coûts en capital des caractéristiques — miroir de leek-wars/src/model/costs.ts.
// Chaque "achat" coûte `capital` points et rapporte `sup` points de caractéristique ;
// le palier applicable dépend du nombre de points déjà ajoutés (`step`).

const STAT6 = [
  { step: 0, capital: 1, sup: 2 },
  { step: 200, capital: 1, sup: 1 },
  { step: 400, capital: 2, sup: 1 },
  { step: 600, capital: 3, sup: 1 },
];
const linear = (from, inc, n) => Array.from({ length: n }, (_, i) => ({ step: i, capital: from + inc * i, sup: 1 }));

export const COSTS = {
  life: [
    { step: 0, capital: 1, sup: 4 },
    { step: 1000, capital: 1, sup: 3 },
    { step: 2000, capital: 1, sup: 2 },
  ],
  strength: STAT6,
  wisdom: STAT6,
  agility: STAT6,
  resistance: STAT6,
  science: STAT6,
  magic: STAT6,
  frequency: [{ step: 0, capital: 1, sup: 1 }],
  cores: linear(20, 10, 9),
  ram: linear(20, 10, 9),
  tp: linear(30, 5, 15),
  mp: linear(20, 20, 9),
};

export const CHARACTERISTICS = Object.keys(COSTS);

/** Valeur de base d'une caractéristique au niveau donné (sans capital ni équipement). */
export function baseStat(level, stat) {
  switch (stat) {
    case "life": return 100 + (level - 1) * 3;
    case "frequency": return 100;
    case "cores": return 1;
    case "ram": return 6;
    case "tp": return 10;
    case "mp": return 3;
    default: return 0;
  }
}

/** Capital total gagné à un niveau (formule serveur). */
export function totalCapitalForLevel(level) {
  let capital = 50 + (level - 1) * 5 + Math.floor(level / 100) * 45;
  if (level === 301) capital += 95;
  return capital;
}

/** Palier applicable quand `added` points ont déjà été ajoutés, ou null si la caractéristique est au maximum. */
export function stepAt(stat, added) {
  const steps = COSTS[stat];
  let i = 0;
  for (; i < steps.length; i++) if (steps[i].step > added) break;
  i--;
  // Pour les caractéristiques à paliers indexés (cores, ram, tp, mp), au-delà du dernier palier : maximum atteint.
  if (steps.length > 1 && steps.every((s, k) => s.step === k) && added >= steps.length) return null;
  return steps[i];
}

/**
 * Coût pour passer de `added` à `added + bonus` points ajoutés.
 * @returns {{capital: number, valid: boolean, reached: number}} valid=false si `bonus` ne tombe pas sur un palier atteignable.
 */
export function costOf(stat, added, bonus) {
  let capital = 0;
  let total = 0;
  while (total < bonus) {
    const s = stepAt(stat, added + total);
    if (!s) return { capital, valid: false, reached: total };
    capital += s.capital;
    total += s.sup;
  }
  return { capital, valid: total === bonus, reached: total };
}

/**
 * Points obtenus en dépensant au plus `budget` capital à partir de `added` points déjà ajoutés
 * (achats successifs au palier courant, comme les boutons +1 / +10 / +100 de Leek Wars).
 * @returns {{bonus: number, capital: number}} capital = capital réellement dépensé (≤ budget).
 */
export function bonusForCapital(stat, added, budget) {
  let capital = 0;
  let bonus = 0;
  for (;;) {
    const s = stepAt(stat, added + bonus);
    if (!s || capital + s.capital > budget) break;
    capital += s.capital;
    bonus += s.sup;
  }
  return { bonus, capital };
}

/** Montants de capital proposés par l'interface (comme Leek Wars). */
export const CAPITAL_STEPS = [1, 10, 100];

/** Achat suivant / précédent possible, pour les boutons +/− de l'interface. */
export function neighbours(stat, added, bonus) {
  const next = stepAt(stat, added + bonus);
  // Retrait : on rejoue les achats depuis `added` pour retrouver le dernier.
  let prev = null;
  let total = 0;
  while (total < bonus) {
    const s = stepAt(stat, added + total);
    if (!s) break;
    prev = s;
    total += s.sup;
  }
  return { next: next ? { sup: next.sup, capital: next.capital } : null, prev: prev ? { sup: prev.sup, capital: prev.capital } : null };
}

/**
 * Vue complète des caractéristiques d'un poireau (réponse de leek/get-private) + plan de répartition.
 * `bonuses` : points à ajouter par caractéristique ; `spend` : capital à dépenser (converti en points, prioritaire).
 */
export function characteristicsView(leek, bonuses = {}, spend = {}) {
  const stats = {};
  let planned = 0;
  let valid = true;
  for (const c of CHARACTERISTICS) {
    const base = baseStat(leek.level, c);
    const current = leek[c] ?? base; // base + capital déjà investi
    const added = Math.max(0, current - base);
    const equipment = (leek[`total_${c}`] ?? current) - current;
    const bonus =
      spend[c] != null
        ? bonusForCapital(c, added, Math.max(0, Math.floor(Number(spend[c]) || 0))).bonus
        : Math.max(0, Math.round(Number(bonuses[c]) || 0));
    const cost = costOf(c, added, bonus);
    if (!cost.valid) valid = false;
    planned += cost.capital;
    stats[c] = {
      base,
      added,
      equipment,
      current,
      total: current + equipment,
      capitalInvested: costOf(c, 0, added).capital,
      bonus,
      bonusCost: cost.capital,
      bonusValid: cost.valid,
      after: current + equipment + bonus,
      ...neighbours(c, added, bonus),
    };
  }
  const capital = leek.capital ?? 0;
  // Effet des boutons +1 / +10 / +100 : capital ajouté à celui déjà prévu, plafonné au capital restant.
  const remaining = capital - planned;
  for (const c of CHARACTERISTICS) {
    const s = stats[c];
    s.adds = {};
    for (const n of CAPITAL_STEPS) {
      const r = bonusForCapital(c, s.added, s.bonusCost + Math.min(n, Math.max(0, remaining)));
      s.adds[n] = r.bonus > s.bonus ? { bonus: r.bonus, gain: r.bonus - s.bonus, capital: r.capital - s.bonusCost } : null;
    }
  }
  return {
    leekId: leek.id,
    name: leek.name,
    level: leek.level,
    capital,
    totalCapital: totalCapitalForLevel(leek.level),
    planned,
    remaining: capital - planned,
    valid: valid && planned <= capital,
    stats,
  };
}
