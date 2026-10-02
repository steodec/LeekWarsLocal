<script setup lang="ts">
// Courbe(s) SVG sur un seul axe Y, avec réticule + infobulle au survol.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export interface Series { name: string; color: string; points: { x: number; y: number }[]; step?: boolean }
const props = defineProps<{
  series: Series[];
  height?: number;
  formatX?: (x: number) => string;
  formatY?: (y: number) => string;
  yMin?: number;
  yMax?: number;
}>();

const root = ref<HTMLElement>();
const width = ref(600);
let ro: ResizeObserver | undefined;
onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(240, e.contentRect.width)));
  ro.observe(root.value!);
});
onBeforeUnmount(() => ro?.disconnect());

const H = computed(() => props.height ?? 220);
const pad = { l: 48, r: 16, t: 12, b: 26 };
const fx = (x: number) => (props.formatX ? props.formatX(x) : String(x));
const fy = (y: number) => (props.formatY ? props.formatY(y) : String(Math.round(y)));

const all = computed(() => props.series.flatMap((s) => s.points));
const xDomain = computed(() => {
  const xs = all.value.map((p) => p.x);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
});
const yDomain = computed(() => {
  const ys = all.value.map((p) => p.y);
  let lo = props.yMin ?? (ys.length ? Math.min(...ys) : 0);
  let hi = props.yMax ?? (ys.length ? Math.max(...ys) : 1);
  if (lo === hi) { lo -= 1; hi += 1; }
  return [lo, hi];
});
const sx = (x: number) => {
  const [a, b] = xDomain.value;
  return pad.l + ((x - a) / (b - a || 1)) * (width.value - pad.l - pad.r);
};
const sy = (y: number) => {
  const [a, b] = yDomain.value;
  return pad.t + (1 - (y - a) / (b - a)) * (H.value - pad.t - pad.b);
};

const yTicks = computed(() => {
  const [a, b] = yDomain.value;
  const step = niceStep((b - a) / 4);
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(v);
  return out;
});
const xTicks = computed(() => {
  const [a, b] = xDomain.value;
  const n = Math.max(2, Math.min(6, Math.floor(width.value / 110)));
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
});
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const paths = computed(() =>
  props.series.map((s) => {
    let d = "";
    s.points.forEach((p, i) => {
      const X = sx(p.x), Y = sy(p.y);
      if (i === 0) d += `M${X},${Y}`;
      else if (s.step) d += `H${X}V${Y}`;
      else d += `L${X},${Y}`;
    });
    return { ...s, d };
  }),
);

const hoverX = ref<number | null>(null);
function onMove(e: MouseEvent) {
  const box = (e.currentTarget as SVGElement).getBoundingClientRect();
  const px = e.clientX - box.left;
  const xs = [...new Set(all.value.map((p) => p.x))];
  if (!xs.length) return;
  hoverX.value = xs.reduce((best, x) => (Math.abs(sx(x) - px) < Math.abs(sx(best) - px) ? x : best), xs[0]);
}
const hoverRows = computed(() => {
  if (hoverX.value == null) return [];
  return props.series
    .map((s) => {
      // Valeur au x survolé (ou dernière valeur connue avant).
      let p = null as { x: number; y: number } | null;
      for (const q of s.points) if (q.x <= hoverX.value!) p = q;
      return p ? { name: s.name, color: s.color, y: p.y } : null;
    })
    .filter(Boolean) as { name: string; color: string; y: number }[];
});
const tipLeft = computed(() => (hoverX.value == null ? 0 : Math.min(sx(hoverX.value) + 12, width.value - 170)));
</script>

<template>
  <div ref="root" class="chart">
    <div v-if="series.length > 1" class="legend small">
      <span v-for="s in series" :key="s.name"><i :style="{ background: s.color }"></i>{{ s.name }}</span>
    </div>
    <svg :width="width" :height="H" @mousemove="onMove" @mouseleave="hoverX = null" role="img">
      <g class="grid">
        <line v-for="t in yTicks" :key="'y' + t" :x1="pad.l" :x2="width - pad.r" :y1="sy(t)" :y2="sy(t)" />
      </g>
      <g class="axis">
        <text v-for="t in yTicks" :key="'yl' + t" :x="pad.l - 6" :y="sy(t) + 4" text-anchor="end">{{ fy(t) }}</text>
        <text v-for="(t, i) in xTicks" :key="'xl' + i" :x="sx(t)" :y="H - 6" :text-anchor="i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'">{{ fx(t) }}</text>
      </g>
      <path v-for="p in paths" :key="p.name" :d="p.d" :stroke="p.color" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <g v-if="hoverX != null">
        <line class="cross" :x1="sx(hoverX)" :x2="sx(hoverX)" :y1="pad.t" :y2="H - pad.b" />
        <circle v-for="r in hoverRows" :key="r.name" :cx="sx(hoverX)" :cy="sy(r.y)" r="4" :fill="r.color" stroke="var(--surface-1)" stroke-width="2" />
      </g>
    </svg>
    <div v-if="hoverX != null && hoverRows.length" class="tip" :style="{ left: tipLeft + 'px' }">
      <strong>{{ fx(hoverX) }}</strong>
      <div v-for="r in hoverRows" :key="r.name" class="tiprow">
        <i :style="{ background: r.color }"></i><span class="secondary">{{ r.name }}</span><span class="mono">{{ fy(r.y) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart { position: relative; width: 100%; }
svg { display: block; overflow: visible; }
.grid line { stroke: var(--grid); stroke-width: 1; }
.axis text { fill: var(--text-muted); font-size: 11px; }
.cross { stroke: var(--text-muted); stroke-dasharray: 3 3; }
.legend { display: flex; gap: 14px; margin-bottom: 6px; color: var(--text-secondary); }
.legend i, .tiprow i { display: inline-block; width: 10px; height: 3px; margin-right: 6px; vertical-align: 3px; }
.tip { position: absolute; top: 24px; pointer-events: none; background: var(--surface-3); border: 1px solid var(--border); padding: 6px 10px; font-size: 12px; min-width: 150px; box-shadow: var(--shadow-pixel-small); }
.tiprow { display: flex; align-items: center; gap: 4px; }
.tiprow .mono { margin-left: auto; padding-left: 12px; }
</style>
