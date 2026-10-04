// Méta par niveau : synthèse des poireaux du haut du classement autour d'un niveau
// (caractéristiques, armes et puces les plus jouées), comparée à un de mes poireaux.

export const META_STATS = ["life", "strength", "wisdom", "agility", "resistance", "science", "magic", "frequency", "tp", "mp"];

/** Profil public d'un poireau (leek/get) réduit à ce qui compte pour la méta. */
export function leekProfile(l, catalog) {
  return {
    id: l.id,
    name: l.name,
    level: l.level,
    talent: l.talent,
    farmer: l.farmer?.name ?? null,
    skin: l.skin ?? 1, hat: l.hat ?? null, metal: !!l.metal, face: l.face ?? 0,
    // Totaux (base + capital + équipement), comme sur la fiche Leek Wars.
    stats: Object.fromEntries(META_STATS.map((s) => [s, l[`total_${s}`] ?? l[s] ?? 0])),
    chips: (l.chips ?? []).map((c) => catalog.chipsById.get(c.template)?.name ?? `#${c.template}`),
    weapons: (l.weapons ?? []).map((w) => catalog.weaponsByItem.get(w.template)?.name ?? `#${w.template}`),
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

function popularity(profiles, field, mine) {
  const counts = new Map();
  for (const p of profiles) for (const name of new Set(p[field])) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count, pct: Math.round((100 * count) / profiles.length), mine: !!mine?.[field].includes(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Agrège les profils : quartiles par caractéristique, popularité des armes et puces, écarts avec `mine`. */
export function aggregateMeta(profiles, mine = null) {
  const stats = Object.fromEntries(
    META_STATS.map((s) => {
      const values = profiles.map((p) => p.stats[s]).sort((a, b) => a - b);
      const median = quantile(values, 0.5);
      return [s, { p25: quantile(values, 0.25), median, p75: quantile(values, 0.75), mine: mine?.stats[s] ?? null }];
    }),
  );
  return {
    stats,
    chips: popularity(profiles, "chips", mine),
    weapons: popularity(profiles, "weapons", mine),
    // Ce que la majorité joue et que mon poireau n'a pas.
    missing: mine
      ? [...popularity(profiles, "weapons", mine), ...popularity(profiles, "chips", mine)].filter((x) => !x.mine && x.pct >= 50)
      : [],
  };
}
