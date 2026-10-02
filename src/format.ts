export const fmtDate = (ts: number) =>
  new Date(ts * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null ? "–" : n.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fmtPct = (n: number | null | undefined) => (n == null ? "–" : `${fmtNum(n, 1)} %`);

export const fmtOps = (n: number | null | undefined) => {
  if (n == null) return "–";
  if (n >= 1e6) return `${fmtNum(n / 1e6, 1)} M`;
  if (n >= 1e3) return `${fmtNum(n / 1e3, 1)} k`;
  return fmtNum(n);
};

/** Nom d'objet Leek Wars ("puny_bulb") → libellé lisible. */
export const itemLabel = (name: string) => name.replace(/_/g, " ");
