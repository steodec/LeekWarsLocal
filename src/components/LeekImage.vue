<script setup lang="ts">
// Poireau dessiné comme sur Leek Wars (géométrie de leek-wars/src/component/leek-image.vue, sans l'arme) :
// SVG du poireau selon niveau + peau, chapeau posé dessus. `head` : vignette carrée (feuilles + chapeau).
import { computed, ref, watch } from "vue";
import { LEEK_SIZES, hatImage, hatOf, leekAppearance, leekSvg, type LeekLook } from "../lw";

const props = defineProps<{ leek: LeekLook; size?: number; head?: boolean }>();

const HEAD_RATIO = 0.62;
const HEAD_BLEED = 1.4;
const HEAD_NECK = 0.06;

const clipId = `leek-clip-${Math.random().toString(36).slice(2, 10)}`;

const remote = ref(false);
watch(() => [props.leek.level, props.leek.skin, props.leek.metal, props.leek.face], () => (remote.value = false));
const src = computed(() => leekSvg(props.leek, remote.value));

const size = computed(() => LEEK_SIZES[leekAppearance(props.leek.level ?? 1)]);
const hat = computed(() => hatOf(props.leek));
const hatW = computed(() => (hat.value ? size.value.height * 0.8 * hat.value.width : 0));
const hatH = computed(() => (hat.value ? hatW.value * (hat.value.px_height / hat.value.px_width) : 0));
const above = computed(() => (hat.value ? Math.max(0, hatH.value - hatH.value * hat.value.height) : 0));
const crop = computed(() => hat.value?.crop ?? 0);

const leekX = computed(() => Math.max(0, hatW.value / 2 - size.value.width / 2));
const leekY = computed(() => above.value);
const hatX = computed(() => Math.max(0, size.value.width / 2 - hatW.value / 2));
const width = computed(() => Math.max(size.value.width, hatW.value));
const height = computed(() => size.value.height + above.value);
const clipHeight = computed(() => (props.head ? Math.max(0, HEAD_RATIO + HEAD_NECK - crop.value) : 1));

const viewBox = computed(() => {
  if (!props.head) return `0 0 ${width.value} ${height.value}`;
  const box = Math.max(size.value.width, size.value.height * HEAD_RATIO) * HEAD_BLEED;
  const cx = width.value / 2;
  const cy = leekY.value + (size.value.height * (HEAD_RATIO + HEAD_NECK)) / 2;
  return `${cx - box / 2} ${cy - box / 2} ${box} ${box}`;
});
const px = computed(() => props.size ?? (props.head ? 32 : 120));
</script>

<template>
  <svg
    class="leek-image"
    :class="{ head }"
    :viewBox="viewBox"
    :height="px"
    :width="head ? px : (px * width) / height"
    role="img"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="clipId" clipPathUnits="objectBoundingBox">
        <rect x="0" :y="crop" width="1" :height="clipHeight" />
      </clipPath>
    </defs>
    <image :href="src" :x="leekX" :y="leekY" :width="size.width" :height="size.height" :clip-path="hat || head ? `url(#${clipId})` : undefined" @error="remote = true" />
    <image v-if="hat" :href="hatImage(hat)" :x="hatX" y="0" :width="hatW" :height="hatH" />
  </svg>
</template>

<style scoped>
.leek-image { display: inline-block; vertical-align: middle; flex: none; overflow: visible; }
.leek-image.head { overflow: hidden; }
</style>
