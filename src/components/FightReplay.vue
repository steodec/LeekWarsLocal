<script setup lang="ts">
// Rejoue un combat à partir de fight.data : carte en losanges (géométrie de leek-wars/src/model/field.ts),
// poireaux, déplacements, puces / armes, dégâts et soins, avec le journal des actions et les logs IA.
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import LeekImage from "./LeekImage.vue";
import { chipIcon, weaponIcon } from "../lw";
import { itemLabel } from "../format";
import type { LogLine } from "../fightlogs";

export interface ReplayEntity {
  id: number; name: string; level: number; skin: number; hat: number | null; metal: boolean; face: number;
  team: number; life: number; cell: number; summon: boolean;
}
export interface ReplayData {
  map: { width: number; height: number; obstacles: Record<string, number> };
  entities: ReplayEntity[];
  actions: any[][];
  chips: Record<string, string | null>;
  weapons: Record<string, string | null>;
}

const props = defineProps<{ data: ReplayData; logs: LogLine[]; mySide: 1 | 2 | null }>();

// Codes d'actions (leek-wars/src/model/action.ts), comme dans server/analyze.js.
const A = {
  PLAYER_DEAD: 5, NEW_TURN: 6, LEEK_TURN: 7, SUMMON: 9, MOVE_TO: 10, USE_CHIP: 12, SET_WEAPON: 13, USE_WEAPON: 16,
  LIFE_LOST: 101, CARE: 103, BOOST_VITA: 104, RESURRECTION: 105, NOVA_DAMAGE: 107, DAMAGE_RETURN: 108,
  LIFE_DAMAGE: 109, POISON_DAMAGE: 110, AFTEREFFECT: 111, NOVA_VITALITY: 112, SAY: 203,
};
const DAMAGE = new Set([A.LIFE_LOST, A.LIFE_DAMAGE, A.DAMAGE_RETURN, A.POISON_DAMAGE, A.AFTEREFFECT]);

// --- Géométrie : case → position (x, y) en demi-tuiles, puis en pixels ---
const TW = 44;
const TH = 22;
const TOP = 64; // place au-dessus de la première rangée pour les poireaux
const W = computed(() => props.data.map.width);
const nbCells = computed(() => (W.value * 2 - 1) * props.data.map.height - (W.value - 1));
function cellXY(cell: number) {
  const mod = W.value * 2 - 1;
  let x = (cell % mod) * 2;
  let y = Math.floor(cell / mod) * 2;
  if (x > mod) {
    x = x % mod;
    y++;
  }
  return { x: (x * TW) / 2 + TW / 2, y: (y * TH) / 2 + TH / 2 + TOP };
}
const cells = computed(() => Array.from({ length: nbCells.value }, (_, id) => ({ id, ...cellXY(id), obstacle: id in props.data.map.obstacles })));
const boardW = computed(() => Math.max(...cells.value.map((c) => c.x)) + TW / 2);
const boardH = computed(() => Math.max(...cells.value.map((c) => c.y)) + TH / 2);
const diamond = (x: number, y: number) => `${x},${y - TH / 2} ${x + TW / 2},${y} ${x},${y + TH / 2} ${x - TW / 2},${y}`;

// --- État du combat après `step` actions ---
interface EntState { cell: number; life: number; maxLife: number; alive: boolean; shown: boolean }
interface State { step: number; turn: number; current: number | null; ents: Record<number, EntState>; weapon: Record<number, number>; say: { entity: number; text: string } | null }
const byId = computed(() => Object.fromEntries(props.data.entities.map((e) => [e.id, e])) as Record<number, ReplayEntity>);

function initial(): State {
  const ents: Record<number, EntState> = {};
  for (const e of props.data.entities) ents[e.id] = { cell: e.cell, life: e.life, maxLife: e.life, alive: true, shown: !e.summon };
  return { step: 0, turn: 1, current: null, ents, weapon: {}, say: null };
}

function apply(s: State, a: any[]) {
  const e = (id: number) => s.ents[id];
  switch (a[0]) {
    case A.NEW_TURN: s.turn = a[1]; break;
    case A.LEEK_TURN: s.current = a[1]; s.say = null; break;
    case A.MOVE_TO: if (e(a[1])) e(a[1]).cell = a[2]; break;
    case A.SUMMON: if (e(a[2])) Object.assign(e(a[2]), { cell: a[3], shown: true, alive: true }); break;
    case A.SET_WEAPON: if (s.current != null) s.weapon[s.current] = a[1]; break;
    case A.CARE: if (e(a[1])) e(a[1]).life = Math.min(e(a[1]).maxLife, e(a[1]).life + a[2]); break;
    case A.BOOST_VITA: if (e(a[1])) { e(a[1]).maxLife += a[2]; e(a[1]).life += a[2]; } break;
    case A.NOVA_VITALITY: if (e(a[1])) e(a[1]).maxLife += a[2]; break;
    case A.NOVA_DAMAGE: if (e(a[1])) { e(a[1]).maxLife -= a[2]; e(a[1]).life = Math.min(e(a[1]).life, e(a[1]).maxLife); } break;
    case A.RESURRECTION: if (e(a[2])) Object.assign(e(a[2]), { cell: a[3], life: a[4], maxLife: a[5], alive: true, shown: true }); break;
    case A.PLAYER_DEAD: if (e(a[1])) e(a[1]).alive = false; break;
    case A.SAY: if (s.current != null) s.say = { entity: s.current, text: String(a[1]) }; break;
    default: if (DAMAGE.has(a[0]) && e(a[1])) e(a[1]).life = Math.max(0, e(a[1]).life - a[2]);
  }
  s.step++;
}

const state = reactive<State>(initial());
function seek(step: number) {
  const s = initial();
  const n = Math.max(0, Math.min(step, props.data.actions.length));
  for (let i = 0; i < n; i++) apply(s, props.data.actions[i]);
  Object.assign(state, s);
  fx.line = null;
  fx.floaters = [];
}

// --- Effets visuels de l'action courante (pendant la lecture) ---
interface Floater { key: number; entity: number; text: string; kind: string }
const fx = reactive({ line: null as null | { from: number; to: number; icon: string | null; result: number }, target: null as number | null, floaters: [] as Floater[] });
let floaterSeq = 0;
function addFloater(entity: number, text: string, kind: string) {
  const f = { key: ++floaterSeq, entity, text, kind };
  fx.floaters.push(f);
  setTimeout(() => (fx.floaters = fx.floaters.filter((x) => x.key !== f.key)), 1200);
}
function effects(a: any[], before: State) {
  const caster = before.current;
  if (a[0] === A.USE_CHIP || a[0] === A.USE_WEAPON) {
    const chip = a[0] === A.USE_CHIP;
    const target = chip ? a[2] : a.length === 3 ? a[1] : a[2];
    const name = chip ? props.data.chips[a.length === 4 ? a[1] : a[3]] : props.data.weapons[before.weapon[caster ?? -1]];
    const result = chip ? (a.length === 4 ? a[3] : a[4]) : a.length === 3 ? a[2] : a[4];
    if (caster != null) fx.line = { from: state.ents[caster]?.cell ?? target, to: target, icon: name ? (chip ? chipIcon(name) : weaponIcon(name)) : null, result };
    fx.target = target;
  } else if (a[0] === A.LEEK_TURN || a[0] === A.MOVE_TO) {
    fx.line = null;
    fx.target = null;
  }
  if (DAMAGE.has(a[0])) addFloater(a[1], `-${a[2]}`, a[0] === A.POISON_DAMAGE ? "poison" : "damage");
  else if (a[0] === A.CARE || a[0] === A.BOOST_VITA) addFloater(a[1], `+${a[2]}`, "heal");
  else if (a[0] === A.NOVA_DAMAGE) addFloater(a[1], `-${a[2]} max`, "nova");
}

// --- Lecture ---
const playing = ref(false);
const speed = ref(1);
let timer: ReturnType<typeof setTimeout> | null = null;
const DELAYS: Record<number, number> = { [A.MOVE_TO]: 420, [A.USE_CHIP]: 650, [A.USE_WEAPON]: 650, [A.SUMMON]: 450, [A.PLAYER_DEAD]: 600, [A.LEEK_TURN]: 300, [A.NEW_TURN]: 350, [A.SAY]: 700 };
const delayOf = (a: any[]) => DELAYS[a[0]] ?? (DAMAGE.has(a[0]) || a[0] === A.CARE ? 180 : 0);

function forward() {
  const a = props.data.actions[state.step];
  if (!a) return false;
  const before = { ...state, weapon: { ...state.weapon } };
  apply(state, a);
  effects(a, before);
  return true;
}
function tick() {
  timer = null;
  if (!playing.value) return;
  // Les actions sans durée (effets, fin de tour…) passent d'un coup jusqu'à la prochaine action visible.
  let wait = 0;
  while (!wait) {
    const a = props.data.actions[state.step];
    if (!a || !forward()) {
      playing.value = false;
      return;
    }
    wait = delayOf(a);
  }
  timer = setTimeout(tick, wait / speed.value);
}
function play() {
  if (state.step >= props.data.actions.length) seek(0);
  playing.value = true;
  if (!timer) tick();
}
function pause() {
  playing.value = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
onBeforeUnmount(pause);

/** Étape suivante / précédente : jusqu'à la prochaine action « visible ». */
function stepBy(dir: 1 | -1) {
  pause();
  if (dir === 1) {
    let a;
    while ((a = props.data.actions[state.step]) && forward() && !delayOf(a));
  } else {
    // Revient juste après l'action visible qui précède la dernière jouée.
    let j = state.step - 2;
    while (j >= 0 && !delayOf(props.data.actions[j])) j--;
    seek(j + 1);
  }
}
const turnStarts = computed(() => props.data.actions.flatMap((a, i) => (a[0] === A.NEW_TURN ? [i] : [])));
function turnBy(dir: 1 | -1) {
  pause();
  const starts = turnStarts.value;
  const target = dir === 1 ? starts.find((i) => i >= state.step) : [...starts].reverse().find((i) => i < state.step - 1);
  seek(target == null ? (dir === 1 ? props.data.actions.length : 0) : target + 1);
}
watch(() => props.data, () => { pause(); seek(0); });

// --- Affichage ---
const myTeam = computed(() => props.mySide ?? 1);
const teamColor = (team: number) => (team === myTeam.value ? "var(--series-me)" : "var(--series-them)");
const visible = computed(() =>
  props.data.entities
    .filter((e) => state.ents[e.id]?.shown)
    .map((e) => ({ ...e, ...state.ents[e.id], ...cellXY(state.ents[e.id].cell) }))
    .sort((a, b) => a.y - b.y),
);
const name = (id: number | null | undefined) => (id != null ? byId.value[id]?.name ?? `#${id}` : "?");
const chipName = (tpl: number) => itemLabel(props.data.chips[tpl] ?? `puce ${tpl}`);
const RESULT = (r: number) => (r === 2 ? " — critique !" : r === 1 ? "" : " — échec");

/** Phrase pour le journal (null : action non affichée). */
function describe(a: any[], current: number | null, weapon: Record<number, number>): string | null {
  switch (a[0]) {
    case A.NEW_TURN: return `— Tour ${a[1]} —`;
    case A.MOVE_TO: return `${name(a[1])} se déplace (${Array.isArray(a[3]) ? a[3].length : "?"} PM)`;
    case A.USE_CHIP: return `${name(current)} utilise ${chipName(a.length === 4 ? a[1] : a[3])}${RESULT(a.length === 4 ? a[3] : a[4])}`;
    case A.USE_WEAPON: return `${name(current)} tire avec ${itemLabel(props.data.weapons[weapon[current ?? -1]] ?? "son arme")}${RESULT(a.length === 3 ? a[2] : a[4])}`;
    case A.SET_WEAPON: return `${name(current)} prend ${itemLabel(props.data.weapons[a[1]] ?? "une arme")}`;
    case A.SUMMON: return `${name(a[1])} invoque ${name(a[2])}`;
    case A.PLAYER_DEAD: return `☠ ${name(a[1])} meurt`;
    case A.RESURRECTION: return `${name(a[1])} ressuscite ${name(a[2])}`;
    case A.SAY: return `${name(current)} : « ${a[1]} »`;
    default:
      if (DAMAGE.has(a[0])) return `${name(a[1])} perd ${a[2]} PV${a[0] === A.POISON_DAMAGE ? " (poison)" : a[0] === A.DAMAGE_RETURN ? " (renvoi)" : ""}`;
      if (a[0] === A.CARE) return `${name(a[1])} récupère ${a[2]} PV`;
      return null;
  }
}

/** Journal jusqu'à l'étape courante : actions décrites et logs IA, dans l'ordre. */
const journal = computed(() => {
  const out: { key: string; text: string; cls: string; color?: string; entity?: number }[] = [];
  const s = initial();
  const logsByAction = new Map<number, LogLine[]>();
  for (const l of props.logs) (logsByAction.get(l.action) ?? logsByAction.set(l.action, []).get(l.action)!).push(l);
  for (let i = 0; i < state.step; i++) {
    const a = props.data.actions[i];
    const text = describe(a, s.current, s.weapon);
    apply(s, a);
    if (text) out.push({ key: `a${i}`, text, cls: a[0] === A.NEW_TURN ? "turn" : a[0] === A.PLAYER_DEAD ? "dead" : "action" });
    for (const l of logsByAction.get(i) ?? []) out.push({ key: `l${i}-${l.index}`, text: l.text, cls: `log ${l.kind ?? ""}`, color: l.color, entity: l.entity });
  }
  return out.slice(-150);
});
const journalEl = ref<HTMLElement | null>(null);
watch(() => journal.value.length, () => nextTick(() => journalEl.value && (journalEl.value.scrollTop = journalEl.value.scrollHeight)));

const progress = computed({
  get: () => state.step,
  set: (v: number) => {
    pause();
    seek(Number(v));
  },
});
</script>

<template>
  <div class="replay">
    <div class="board-wrap">
      <svg class="board" :viewBox="`0 0 ${boardW} ${boardH}`" preserveAspectRatio="xMidYMid meet">
        <polygon v-for="c in cells" :key="c.id" :points="diamond(c.x, c.y)" class="tile" :class="{ obstacle: c.obstacle, target: c.id === fx.target }">
          <title>Case {{ c.id }}</title>
        </polygon>
        <line v-if="fx.line" class="shot" :class="{ fail: fx.line.result !== 1 && fx.line.result !== 2, crit: fx.line.result === 2 }"
          :x1="cellXY(fx.line.from).x" :y1="cellXY(fx.line.from).y - 18" :x2="cellXY(fx.line.to).x" :y2="cellXY(fx.line.to).y" />
        <g v-for="e in visible" :key="e.id" class="entity" :class="{ dead: !e.alive, current: e.id === state.current }"
          :style="{ transform: `translate(${e.x}px, ${e.y}px)` }">
          <ellipse rx="15" ry="7" :fill="teamColor(e.team)" class="foot" />
          <foreignObject x="-40" :y="e.summon ? -40 : -58" width="80" :height="e.summon ? 40 : 58">
            <div class="sprite"><LeekImage :leek="e" :size="e.summon ? 34 : 52" /></div>
          </foreignObject>
          <g v-if="e.alive" :transform="`translate(-18, ${e.summon ? -48 : -66})`">
            <rect width="36" height="5" class="life-bg" />
            <rect :width="36 * Math.max(0, e.life) / Math.max(1, e.maxLife)" height="5" :fill="teamColor(e.team)" />
          </g>
          <text v-for="f in fx.floaters.filter((x) => x.entity === e.id)" :key="f.key" class="floater" :class="f.kind" y="-40" text-anchor="middle">{{ f.text }}</text>
          <foreignObject v-if="state.say?.entity === e.id" x="-80" y="-112" width="160" height="40">
            <div class="say">{{ state.say.text }}</div>
          </foreignObject>
        </g>
        <image v-if="fx.line?.icon" :href="fx.line.icon" width="26" height="26"
          :x="(cellXY(fx.line.from).x + cellXY(fx.line.to).x) / 2 - 13" :y="(cellXY(fx.line.from).y + cellXY(fx.line.to).y) / 2 - 22" />
      </svg>
    </div>

    <aside class="side">
      <div class="hud">
        <b>Tour {{ state.turn }}</b>
        <span class="secondary" v-if="state.current != null"> · {{ name(state.current) }}</span>
      </div>
      <div class="lives">
        <div v-for="e in data.entities.filter((x) => state.ents[x.id]?.shown)" :key="e.id" class="life-row" :class="{ dead: !state.ents[e.id].alive }">
          <span class="dot" :style="{ background: teamColor(e.team) }"></span>
          <span class="life-name">{{ e.name }}</span>
          <span class="mono small">{{ Math.max(0, state.ents[e.id].life) }}/{{ state.ents[e.id].maxLife }}</span>
        </div>
      </div>
      <div ref="journalEl" class="journal">
        <div v-for="j in journal" :key="j.key" :class="j.cls" :style="j.color ? { color: j.color } : undefined">
          <template v-if="j.entity != null">[{{ name(j.entity) }}] </template>{{ j.text }}
        </div>
        <div v-if="!journal.length" class="muted small">Lancez la lecture : actions et logs IA s'affichent ici.</div>
      </div>
    </aside>

    <div class="controls">
      <button @click="turnBy(-1)" title="Tour précédent">⏮</button>
      <button @click="stepBy(-1)" title="Action précédente">◀</button>
      <button class="primary" @click="playing ? pause() : play()">{{ playing ? "⏸ Pause" : "▶ Lecture" }}</button>
      <button @click="stepBy(1)" title="Action suivante">▶</button>
      <button @click="turnBy(1)" title="Tour suivant">⏭</button>
      <input class="seek" type="range" min="0" :max="data.actions.length" v-model.number="progress" />
      <select v-model.number="speed" title="Vitesse">
        <option :value="0.5">×0,5</option><option :value="1">×1</option><option :value="2">×2</option><option :value="4">×4</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.replay { display: grid; grid-template-columns: minmax(0, 1fr) 280px; grid-template-rows: auto auto; gap: 10px; }
.board-wrap { background: var(--surface-2); border: 1px solid var(--border); padding: 6px; min-width: 0; }
.board { width: 100%; height: auto; max-height: 560px; display: block; }
.tile { fill: color-mix(in srgb, var(--good) 10%, var(--surface-2)); stroke: var(--border); stroke-width: 1; }
.tile.obstacle { fill: color-mix(in srgb, var(--text-muted) 55%, var(--surface-2)); }
.tile.target { fill: color-mix(in srgb, var(--warning) 45%, var(--surface-2)); }
.entity { transition: transform 0.38s ease-in-out; }
.entity.dead { opacity: 0.25; filter: grayscale(1); }
.entity.current .foot { stroke: var(--text); stroke-width: 2; }
.foot { opacity: 0.55; }
.sprite { width: 80px; height: 100%; display: flex; align-items: flex-end; justify-content: center; }
.life-bg { fill: rgba(0, 0, 0, 0.45); }
.shot { stroke: var(--warning); stroke-width: 3; stroke-dasharray: 6 4; animation: dash 0.5s linear infinite; }
.shot.crit { stroke: var(--critical); stroke-width: 4; }
.shot.fail { stroke: var(--text-muted); opacity: 0.6; }
@keyframes dash { to { stroke-dashoffset: -20; } }
.floater { font: bold 15px var(--font-display, inherit); paint-order: stroke; stroke: rgba(0, 0, 0, 0.7); stroke-width: 3px; animation: rise 1.2s ease-out forwards; }
.floater.damage { fill: #ff5a4a; }
.floater.poison { fill: #b56cff; }
.floater.heal { fill: #7cff6b; }
.floater.nova { fill: #ff9a3c; }
@keyframes rise { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-34px); opacity: 0; } }
.say { background: var(--surface); color: var(--text); border: 1px solid var(--border); font-size: 11px; padding: 2px 6px; border-radius: 6px; text-align: center; overflow: hidden; text-overflow: ellipsis; max-height: 36px; }
.side { display: flex; flex-direction: column; gap: 8px; min-height: 0; max-height: 580px; }
.hud { font-size: 15px; }
.lives { display: flex; flex-direction: column; gap: 3px; }
.life-row { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.life-row.dead { opacity: 0.4; text-decoration: line-through; }
.life-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.journal { flex: 1; min-height: 160px; overflow: auto; background: var(--surface-2); border: 1px solid var(--border); padding: 6px 8px; font-size: 12px; font-family: var(--font-mono, monospace); white-space: pre-wrap; }
.journal .turn { color: var(--text-muted); margin-top: 6px; }
.journal .action { color: var(--text-secondary); }
.journal .dead { color: var(--critical); font-weight: bold; }
.journal .log { color: var(--text); }
.journal .warning { color: var(--warning); }
.journal .error { color: var(--critical); }
.journal .pause { color: var(--series-me); }
.controls { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.seek { flex: 1; min-width: 160px; }
@media (max-width: 900px) {
  .replay { grid-template-columns: 1fr; }
  .side { max-height: none; }
}
</style>
