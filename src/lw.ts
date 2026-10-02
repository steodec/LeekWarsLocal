// Ressources graphiques de Leek Wars (public/lw/, récupérées par `npm run assets`).
import { reactive } from "vue";

export const LW_SITE = "https://leekwars.com";
const BASE = `${import.meta.env.BASE_URL}lw/`;

export const chipIcon = (name: string) => `${BASE}chip/${name}.png`;
export const weaponIcon = (name: string) => `${BASE}weapon/${name}.png`;
export const itemIcon = (kind: string, name: string) => (kind === "weapon" ? weaponIcon(name) : chipIcon(name));
export const characIcon = (charac: string) => `${BASE}charac/${charac}.png`;
export const lwImage = (file: string) => `${BASE}${file}`;

/** Stade d'apparence d'un poireau selon son niveau (miroir de LeekWars.getLeekAppearance). */
export function leekAppearance(level: number): number {
  const steps = [10, 20, 50, 80, 100, 150, 200, 250, 300, 301];
  const i = steps.findIndex((s) => level < s);
  return i === -1 ? 11 : i + 1;
}

/** Taille de l'image du poireau par stade (miroir de LEEK_SIZES). */
export const LEEK_SIZES: Record<number, { width: number; height: number }> = {
  1: { width: 86, height: 136 }, 2: { width: 116, height: 143 }, 3: { width: 115, height: 151 }, 4: { width: 133, height: 159 },
  5: { width: 144, height: 166 }, 6: { width: 149, height: 174 }, 7: { width: 144, height: 181 }, 8: { width: 156, height: 189 },
  9: { width: 160, height: 196 }, 10: { width: 174, height: 204 }, 11: { width: 180, height: 211 },
};

const SKINS: Record<number, string> = {
  1: "green", 2: "blue", 3: "yellow", 4: "red", 5: "orange", 6: "magenta", 7: "cyan", 8: "purple",
  9: "multi", 10: "rasta", 11: "white", 12: "black", 13: "alpha", 14: "apple", 15: "gold", 16: "pink",
  17: "grey", 18: "turquoise", 19: "celestialblue", 20: "marine", 21: "greenfluo", 22: "brown", 23: "blackandwhite",
  24: "whiteandblack", 25: "ghost", 26: "salmon", 27: "radioactive", 28: "sand", 29: "teal", 30: "matcha", 31: "peach",
  32: "fire", 33: "venimous", 34: "greyscale", 35: "frozen", 36: "dalton", 37: "charlie", 38: "mariniere", 39: "france",
  40: "iron", 41: "diamond", 42: "mafia", 43: "bordeaux", 44: "terracotta", 45: "emerald",
  46: "amethyst", 47: "sapphire", 48: "topaz", 49: "ruby", 50: "opal",
};
const FACES = ["", "_happy", "_angry"];

export interface LeekLook { level: number; skin?: number | null; hat?: number | null; hatItem?: number | null; metal?: boolean | null; face?: number | null }

/** SVG du poireau : la version de face standard est embarquée, les variantes (métal, visage) viennent du site. */
export function leekSvg(l: LeekLook, remote = false) {
  const variant = (l.metal ? "_metal" : "") + (FACES[l.face ?? 0] ?? "");
  const name = `leek_${leekAppearance(l.level)}_front_${SKINS[l.skin ?? 1] ?? SKINS[1]}${variant}.svg`;
  return remote || variant ? `${LW_SITE}/image/leek/svg/${name}` : `${BASE}leek/${name}`;
}

export interface HatInfo { name: string; item: number; width: number; height: number; crop: number; px_width: number; px_height: number }

/** Chapeaux (id du modèle → image et placement), chargés une fois. */
export const hats = reactive<{ byId: Record<number, HatInfo>; byItem: Record<number, number> }>({ byId: {}, byItem: {} });
fetch(`${BASE}hats.json`)
  .then((r) => (r.ok ? r.json() : {}))
  .then((data: Record<string, HatInfo>) => {
    for (const [id, h] of Object.entries(data)) {
      hats.byId[Number(id)] = h;
      if (h.item) hats.byItem[h.item] = Number(id);
    }
  })
  .catch(() => {});

export function hatOf(l: LeekLook): HatInfo | null {
  const id = l.hat ?? (l.hatItem ? hats.byItem[l.hatItem] : null);
  return id ? hats.byId[id] ?? null : null;
}
export const hatImage = (h: HatInfo) => `${BASE}hat/${h.name}.png`;
