<script setup lang="ts">
// Analyse d'un combat par Claude / ChatGPT : note de code, note de RPG, note globale, commentaires.
import { computed, onUnmounted, ref, watch } from "vue";
import { api } from "../api";
import { fmtDate, fmtNum } from "../format";

interface Section { summary: string; strengths: string[]; issues: string[] }
interface Result {
  codeScore: number | null;
  rpgScore: number | null;
  globalScore: number | null;
  verdict: string;
  code: Section;
  rpg: Section;
  keyMoments: { turn: number; text: string }[];
  recommendations: { priority: string; area: string; title: string; detail: string }[];
}
interface Analysis {
  id: number;
  date: number;
  provider: string;
  model: string;
  prompt: string;
  perspective: string;
  result: Result;
  meta: {
    usage?: { input: number | null; output: number | null };
    durationMs?: number;
    customPrompt?: boolean;
    perspectiveName?: string | null;
    logs?: { total: number; kept: number; errors: number; warnings: number } | null;
    code?: { files: string[]; truncated: boolean; errors: string[] };
  };
}
interface AiSettings {
  provider: string | null;
  providers: Record<string, { label: string; model: string; configured: boolean }>;
  prompt: string;
  customPrompt: boolean;
  defaultPrompt: string;
  includeCode: boolean;
}

const props = defineProps<{ fightId: number; leek: number | null }>();

const analyses = ref<Analysis[]>([]);
const settings = ref<AiSettings | null>(null);
const selected = ref<number | null>(null);
const error = ref("");
const running = ref(false);
const elapsed = ref(0);
const editPrompt = ref(false);
const prompt = ref("");
const includeCode = ref(true);
const promptInfo = ref("");
const preview = ref<{ provider: string; model: string; chars: number; user: string } | null>(null);
const previewing = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    const res = await api.get(`/api/fights/${props.fightId}/ai-analysis`);
    analyses.value = res.analyses;
    settings.value = res.settings;
    if (!editPrompt.value) prompt.value = res.settings.prompt;
    includeCode.value = res.settings.includeCode;
    selected.value = res.analyses[0]?.id ?? null;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
load();
watch(() => props.fightId, load);
onUnmounted(() => timer && clearInterval(timer));

const current = computed(() => analyses.value.find((a) => a.id === selected.value) ?? null);
const provider = computed(() => (settings.value?.provider ? settings.value.providers[settings.value.provider] : null));
const promptChanged = computed(() => !!settings.value && prompt.value.trim() !== settings.value.prompt.trim());

async function analyze() {
  running.value = true;
  error.value = "";
  elapsed.value = 0;
  const start = Date.now();
  timer = setInterval(() => (elapsed.value = Math.round((Date.now() - start) / 1000)), 1000);
  try {
    const a: Analysis = await api.post(`/api/fights/${props.fightId}/ai-analysis`, {
      leek: props.leek ?? undefined,
      prompt: editPrompt.value ? prompt.value : undefined,
      includeCode: includeCode.value,
    });
    analyses.value = [a, ...analyses.value];
    selected.value = a.id;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    running.value = false;
    if (timer) clearInterval(timer);
    timer = null;
  }
}

async function showPreview() {
  if (preview.value) return (preview.value = null);
  previewing.value = true;
  try {
    preview.value = await api.post(`/api/fights/${props.fightId}/ai-analysis`, {
      leek: props.leek ?? undefined,
      prompt: editPrompt.value ? prompt.value : undefined,
      includeCode: includeCode.value,
      dryRun: true,
    });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    previewing.value = false;
  }
}

async function savePrompt(reset = false) {
  try {
    settings.value = await api.put("/api/ai/settings", { prompt: reset ? null : prompt.value });
    prompt.value = settings.value!.prompt;
    promptInfo.value = reset ? "Prompt d'origine rétabli." : "Prompt enregistré : il sera utilisé pour les prochaines analyses.";
    setTimeout(() => (promptInfo.value = ""), 2500);
  } catch (e: any) {
    error.value = e.message;
  }
}

async function remove(a: Analysis) {
  await api.del(`/api/fights/${props.fightId}/ai-analysis/${a.id}`);
  analyses.value = analyses.value.filter((x) => x.id !== a.id);
  selected.value = analyses.value[0]?.id ?? null;
}

const level = (s: number | null) => (s == null ? "none" : s >= 75 ? "good" : s >= 60 ? "ok" : s >= 40 ? "warn" : "bad");
const levelLabel = (s: number | null) => (s == null ? "–" : s >= 90 ? "Excellent" : s >= 75 ? "Bon" : s >= 60 ? "Correct" : s >= 40 ? "Faible" : "Très faible");
const PRIORITY: Record<string, number> = { haute: 0, moyenne: 1, basse: 2 };
const recommendations = computed(() => [...(current.value?.result.recommendations ?? [])].sort((a, b) => (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1)));
const PROVIDER_LABEL: Record<string, string> = { anthropic: "Claude", openai: "ChatGPT" };
</script>

<template>
  <section class="card ai">
    <div class="row head">
      <h2>Analyse IA</h2>
      <select v-if="analyses.length > 1" v-model.number="selected" class="small" aria-label="Analyses précédentes">
        <option v-for="a in analyses" :key="a.id" :value="a.id">
          {{ fmtDate(a.date) }} · {{ PROVIDER_LABEL[a.provider] ?? a.provider }} · {{ a.result.globalScore ?? "?" }}/100
        </option>
      </select>
      <span class="spacer"></span>
      <template v-if="provider">
        <label class="row small secondary" style="gap: 6px" title="Joindre le code source de l'IA (vos poireaux uniquement) pour une note de code plus précise">
          <input type="checkbox" v-model="includeCode" :disabled="running" /> Inclure le code de l'IA
        </label>
        <button class="ghost" :disabled="running" @click="editPrompt = !editPrompt">{{ editPrompt ? "Masquer le prompt" : "Modifier le prompt" }}</button>
        <button class="primary" :disabled="running" @click="analyze">
          {{ running ? `Analyse en cours… ${elapsed} s` : current ? "Relancer l'analyse" : "Analyser le combat" }}
        </button>
      </template>
    </div>

    <div v-if="settings && !provider && current" class="small muted" style="margin-bottom: 10px">
      Aucune clé Claude ou ChatGPT configurée : <a href="#/settings">ajoutez-en une dans Paramètres</a> pour relancer une analyse.
    </div>
    <div v-else-if="settings && !provider" class="empty">
      Configurez une clé API Claude ou ChatGPT pour obtenir une analyse de ce combat (note de code, note de RPG, note globale et conseils).
      <div style="margin-top: 10px"><a class="btn" href="#/settings">Ajouter une clé dans Paramètres →</a></div>
    </div>
    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="provider && editPrompt" class="prompt">
      <div class="row small secondary">
        <span>Prompt envoyé à {{ provider.label }} ({{ provider.model }}). Les données du combat, les logs et le code sont ajoutés automatiquement, ainsi que le format de réponse.</span>
      </div>
      <textarea v-model="prompt" rows="14" spellcheck="false" :disabled="running"></textarea>
      <div class="row">
        <span class="small secondary">{{ promptChanged ? "Modifié : utilisé pour la prochaine analyse." : settings?.customPrompt ? "Prompt personnalisé." : "Prompt par défaut." }}</span>
        <span v-if="promptInfo" class="small good">✓ {{ promptInfo }}</span>
        <span class="spacer"></span>
        <button class="ghost" :disabled="previewing" @click="showPreview">{{ preview ? "Masquer les données" : previewing ? "Préparation…" : "Voir les données envoyées" }}</button>
        <button v-if="settings?.customPrompt || promptChanged" class="ghost" @click="savePrompt(true)">Rétablir le prompt d'origine</button>
        <button :disabled="!promptChanged" @click="savePrompt()">Enregistrer comme prompt par défaut</button>
      </div>
      <div v-if="preview" class="preview">
        <div class="small secondary">{{ fmtNum(preview.chars) }} caractères (≈ {{ fmtNum(Math.round(preview.chars / 3.5 / 1000)) }} k tokens) envoyés à {{ preview.model }}.</div>
        <pre>{{ preview.user }}</pre>
      </div>
    </div>

    <div v-if="running && !current" class="muted small waiting">
      Le modèle lit le combat{{ includeCode ? " et le code de l'IA" : "" }}. Cela peut prendre une à deux minutes.
    </div>

    <template v-if="current">
      <div class="scores">
        <div class="score" :class="level(current.result.codeScore)">
          <div class="label">Code</div>
          <div class="value display">{{ current.result.codeScore ?? "–" }}<span>/100</span></div>
          <div class="bar"><i :style="{ width: (current.result.codeScore ?? 0) + '%' }"></i></div>
          <div class="hint">{{ levelLabel(current.result.codeScore) }}</div>
        </div>
        <div class="score global" :class="level(current.result.globalScore)">
          <div class="label">Note globale</div>
          <div class="value display">{{ current.result.globalScore ?? "–" }}<span>/100</span></div>
          <div class="bar"><i :style="{ width: (current.result.globalScore ?? 0) + '%' }"></i></div>
          <div class="hint">{{ levelLabel(current.result.globalScore) }}</div>
        </div>
        <div class="score" :class="level(current.result.rpgScore)">
          <div class="label">RPG</div>
          <div class="value display">{{ current.result.rpgScore ?? "–" }}<span>/100</span></div>
          <div class="bar"><i :style="{ width: (current.result.rpgScore ?? 0) + '%' }"></i></div>
          <div class="hint">{{ levelLabel(current.result.rpgScore) }}</div>
        </div>
      </div>

      <p v-if="current.result.verdict" class="verdict">{{ current.result.verdict }}</p>

      <div class="grid cols-2">
        <div v-for="part in (['code', 'rpg'] as const)" :key="part" class="part">
          <h3>{{ part === "code" ? "Code de l'IA" : "Poireau (build, équipement, tactique)" }}</h3>
          <p class="text">{{ current.result[part].summary }}</p>
          <ul v-if="current.result[part].strengths.length" class="points">
            <li v-for="(s, i) in current.result[part].strengths" :key="'s' + i" class="plus">{{ s }}</li>
          </ul>
          <ul v-if="current.result[part].issues.length" class="points">
            <li v-for="(s, i) in current.result[part].issues" :key="'i' + i" class="minus">{{ s }}</li>
          </ul>
        </div>
      </div>

      <div v-if="current.result.keyMoments.length" class="part">
        <h3>Moments clés</h3>
        <ul class="moments">
          <li v-for="(m, i) in current.result.keyMoments" :key="i"><span class="tag">Tour {{ m.turn }}</span> {{ m.text }}</li>
        </ul>
      </div>

      <div v-if="recommendations.length" class="part">
        <h3>Recommandations</h3>
        <div v-for="(r, i) in recommendations" :key="i" class="reco" :class="'p-' + r.priority">
          <div class="row">
            <span class="prio">{{ r.priority }}</span>
            <span class="tag">{{ r.area === "code" ? "code" : "RPG" }}</span>
            <b>{{ r.title }}</b>
          </div>
          <p class="text">{{ r.detail }}</p>
        </div>
      </div>

      <div class="row small muted foot">
        <span>
          {{ PROVIDER_LABEL[current.provider] ?? current.provider }} · {{ current.model }} · {{ fmtDate(current.date) }}
          <template v-if="current.meta.perspectiveName"> · point de vue {{ current.meta.perspectiveName }}</template>
          <template v-if="current.meta.usage?.input"> · {{ fmtNum(current.meta.usage.input) }} + {{ fmtNum(current.meta.usage.output) }} tokens</template>
          <template v-if="current.meta.durationMs"> · {{ fmtNum(current.meta.durationMs / 1000, 0) }} s</template>
          <template v-if="current.meta.customPrompt"> · prompt personnalisé</template>
          · {{ current.meta.code?.files.length ? `${current.meta.code.files.length} fichier(s) de code${current.meta.code.truncated ? " (tronqué)" : ""}` : "sans le code" }}
        </span>
        <span class="spacer"></span>
        <button class="ghost small" @click="remove(current)">Supprimer cette analyse</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head { margin-bottom: 10px; }
.head h2 { margin: 0; }
.prompt { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; padding: 10px; border: 1px solid var(--border); background: var(--surface-2); }
.prompt textarea { width: 100%; font-family: var(--font-mono, monospace); font-size: 12px; line-height: 1.45; resize: vertical; }
.preview pre { max-height: 360px; overflow: auto; white-space: pre-wrap; font-size: 11px; background: var(--surface-1); border: 1px solid var(--border); padding: 8px; margin: 6px 0 0; }
.waiting { padding: 16px 0; }
.scores { display: grid; grid-template-columns: 1fr 1.25fr 1fr; gap: 14px; align-items: end; }
@media (max-width: 640px) { .scores { grid-template-columns: 1fr; } }
.score { --c: var(--neutral); background: var(--surface-1); border: 1px solid var(--border-strong); box-shadow: var(--shadow-pixel-small); padding: 12px 14px; text-align: center; }
.score.global { padding: 16px 14px; border-color: var(--c); }
.score.good { --c: var(--good); }
.score.ok { --c: var(--link); }
.score.warn { --c: var(--warning); }
.score.bad { --c: var(--critical); }
.score .label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.score .value { font-size: 34px; color: var(--c); line-height: 1.1; margin-top: 2px; }
.score.global .value { font-size: 48px; }
.score .value span { font-size: 14px; color: var(--text-muted); margin-left: 2px; }
.score .bar { height: 6px; background: var(--surface-3); margin: 8px 0 4px; }
.score .bar i { display: block; height: 100%; background: var(--c); }
.score .hint { font-size: 12px; color: var(--text-secondary); }
.verdict { font-size: 15px; margin: 16px 0 4px; padding-left: 10px; border-left: 3px solid var(--accent); }
.part { margin-top: 14px; }
.part h3 { margin: 0 0 6px; }
.text { white-space: pre-wrap; margin: 0 0 6px; color: var(--text-primary); }
.points { list-style: none; padding: 0; margin: 6px 0; }
.points li { position: relative; padding-left: 20px; margin: 4px 0; }
.points li::before { position: absolute; left: 0; font-weight: 700; }
.points .plus::before { content: "+"; color: var(--good); }
.points .minus::before { content: "−"; color: var(--critical); }
.moments { list-style: none; padding: 0; margin: 0; }
.moments li { margin: 4px 0; }
.reco { padding: 8px 10px; border: 1px solid var(--border); border-left: 3px solid var(--neutral); background: var(--surface-2); margin-bottom: 8px; }
.reco .text { margin: 4px 0 0; color: var(--text-secondary); }
.reco.p-haute { border-left-color: var(--critical); }
.reco.p-moyenne { border-left-color: var(--warning); }
.reco.p-basse { border-left-color: var(--good); }
.prio { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted); }
.foot { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 8px; }
.good { color: var(--good); }
</style>
