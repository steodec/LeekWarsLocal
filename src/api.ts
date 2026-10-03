// Client de l'API locale (server/index.js). En dev, Vite proxifie /api vers :3737.
// Dans Tauri (origine tauri:// ou http://tauri.localhost sous Windows), on vise directement le serveur local lancé par l'application.
export const inTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || window.location.hostname === "tauri.localhost" || !window.location.protocol.startsWith("http"));
const BASE = inTauri ? "http://127.0.0.1:3737" : "";

export class ApiError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, data.code);
  return data as T;
}

export const api = {
  get: <T = any>(path: string) => req<T>("GET", path),
  post: <T = any>(path: string, body: unknown = {}) => req<T>("POST", path, body),
  patch: <T = any>(path: string, body: unknown) => req<T>("PATCH", path, body),
  put: <T = any>(path: string, body: unknown) => req<T>("PUT", path, body),
  del: <T = any>(path: string) => req<T>("DELETE", path),
};

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface LeekRef {
  id: number;
  name: string;
  level: number;
  talent: number;
  /** Apparence (images Leek Wars) */
  skin?: number;
  hat?: number | null;
  metal?: boolean;
  face?: number;
}

export interface TeamAgg {
  damageDealt: number;
  damageTaken: number;
  heal: number;
  kills: number;
  summons: number;
  bugs: number;
  crits: number;
  fails: number;
  tpUnusedPerTurn: number;
  mpUsedPerTurn: number;
  ops: number;
  lifeLeftPct: number;
  items: ItemAgg[];
}

export interface ItemAgg {
  kind: "chip" | "weapon";
  name: string;
  uses: number;
  crits: number;
  fails: number;
  damage: number;
  heal: number;
  kills: number;
}

export interface FightSummary {
  id: number;
  date: number;
  context: number;
  type: number;
  status: number;
  winner: number;
  seed: number | null;
  leeks1: LeekRef[];
  leeks2: LeekRef[];
  mySide: 1 | 2 | null;
  /** Nom des camps (poireau, « (éleveur) », « [équipe] ») ; null en battle royale. */
  sideNames?: [string | null, string | null] | null;
  myLeeks: number[];
  opponents: LeekRef[];
  result: "win" | "loss" | "draw" | "pending";
  duration: number | null;
  turns?: number;
  talentGain?: number;
  talentAfter?: number;
  xp?: number;
  money?: number;
  me?: TeamAgg;
  them?: TeamAgg;
  note: string;
  tags: string[];
  source?: string;
}

export const CONTEXTS: Record<number, string> = { 0: "test", 1: "défi", 2: "potager", 3: "tournoi", 4: "battle royale" };
export const TYPES: Record<number, string> = { 0: "solo", 1: "éleveur", 2: "équipe", 3: "battle royale", 4: "boss", 5: "guerre", 6: "chasse au trésor", 7: "colosse" };
export const RESULTS: Record<string, string> = { win: "Victoire", loss: "Défaite", draw: "Égalité", pending: "En cours" };
