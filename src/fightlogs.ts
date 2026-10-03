// Logs IA d'un combat (fight/get-logs) : { <éleveur>: { <index d'action>: [[entité, type, message, …], …] } }.
// Règles d'affichage reprises de leek-wars/src/model/leekwars.ts (logClass / logColor / logText).
import { lwImage } from "./lw";

export type RawLogs = Record<string, Record<string, unknown[][]>>;

export interface LogLine {
  action: number;
  index: number;
  entity: number;
  type: number;
  text: string;
  kind: "warning" | "error" | "pause" | null;
  color: string;
}

// Types 4 (marqueur de case), 9 (texte sur case) et 10 (effacement des marqueurs) ne sont pas des lignes de console.
const MARKERS = new Set([4, 9, 10]);

let errorMessages: Promise<Record<string, string>> | null = null;
/** Messages des erreurs LeekScript (public/lw/leekscript-errors.json, généré par `npm run assets`). */
export function leekscriptErrors() {
  errorMessages ??= fetch(lwImage("leekscript-errors.json"))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return errorMessages;
}

const kindOf = (type: number): LogLine["kind"] =>
  type === 2 || type === 7 || type === 11 ? "warning" : type === 3 || type === 8 ? "error" : type === 5 ? "pause" : null;

/** Couleur d'un debugC (entier RGB). */
const colorOf = (log: unknown[]) =>
  log[1] === 1 && log.length > 3 && typeof log[3] === "number" && log[3] >= 0 ? `#${(log[3] & 0xffffff).toString(16).padStart(6, "0")}` : "";

function textOf(log: unknown[], errors: Record<string, string>) {
  const type = log[1] as number;
  if (type === 5) return "pause()";
  if (type === 11) return "Trop de debug : les suivants sont ignorés";
  if (type >= 6 && type <= 8) {
    const params = (log[4] as unknown[]) ?? [];
    const template = errors[String(log[3])] ?? `Erreur LeekScript ${log[3]}`;
    const message = template.replace(/\{(\d+)\}/g, (_, i) => String(Array.isArray(params) ? params[Number(i)] ?? "" : ""));
    return log[2] ? `${message}\n${log[2]}` : message;
  }
  return String(log[2] ?? "");
}

/** Lignes de console, dans l'ordre du combat (tous éleveurs confondus). */
export function logLines(raw: RawLogs | null, errors: Record<string, string>): LogLine[] {
  const out: LogLine[] = [];
  for (const farmerLogs of Object.values(raw ?? {})) {
    for (const [action, logs] of Object.entries(farmerLogs ?? {})) {
      logs.forEach((log, index) => {
        const type = log[1] as number;
        if (MARKERS.has(type)) return;
        out.push({ action: Number(action), index, entity: log[0] as number, type, text: textOf(log, errors), kind: kindOf(type), color: colorOf(log) });
      });
    }
  }
  return out.sort((a, b) => a.action - b.action || a.index - b.index);
}
