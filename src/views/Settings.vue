<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import { state, refreshStatus, switchAccount, trackJob, type Account } from "../state";
import { fmtNum } from "../format";

interface Settings {
  accounts: Account[];
  envKey: { present: boolean; masked: string | null };
  storage: { file: string; size: number; fights: number };
}

const s = ref<Settings | null>(null);
const newKey = ref("");
const show = ref(false);
const busy = ref(false);
const error = ref("");
const info = ref("");
const backup = ref("");
const editing = ref<number | null>(null);
const replaceKey = ref("");
const removing = ref<Account | null>(null);

async function load() {
  try {
    s.value = await api.get("/api/settings");
  } catch (e: any) {
    error.value = e.message;
  }
}
load();

async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = "";
  info.value = "";
  try {
    await fn();
    await load();
    await refreshStatus();
    state.dataVersion++;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const add = () =>
  run(async () => {
    const res = await api.post("/api/accounts", { apiKey: newKey.value, activate: !s.value?.accounts.length });
    if (res.job) trackJob(res.job);
    newKey.value = "";
    show.value = false;
    info.value = res.existed
      ? `Clé mise à jour pour le compte ${res.account.name}.`
      : `Compte ${res.account.name} ajouté (${res.account.leeks} poireau(x), suivis automatiquement). Import de son historique en cours…`;
  });

const activate = (a: Account) =>
  run(async () => {
    await switchAccount(a.id);
    info.value = `${a.name} est maintenant le compte actif.`;
  });

const saveKey = (a: Account) =>
  run(async () => {
    await api.put(`/api/accounts/${a.id}/key`, { apiKey: replaceKey.value });
    info.value = `Clé de ${a.name} remplacée.`;
    editing.value = null;
    replaceKey.value = "";
  });

const confirmRemove = () =>
  run(async () => {
    const a = removing.value!;
    await api.del(`/api/accounts/${a.id}`);
    info.value = `Compte ${a.name} retiré. Ses poireaux restent suivis en analyse et ses combats sont conservés.`;
    removing.value = null;
  });

const doBackup = () =>
  run(async () => {
    const res = await api.post("/api/backup");
    backup.value = `${res.file} (${fmtNum(res.size / 1024 / 1024, 1)} Mo)`;
  });
</script>

<template>
  <section class="row"><h1>Paramètres</h1></section>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="info" class="card ok">✓ {{ info }}</div>

  <section class="card" v-if="s">
    <h2>Comptes Leek Wars</h2>
    <p class="small muted" style="margin-top: -6px">
      Comme sur Leek Wars, vous pouvez avoir plusieurs comptes. Le compte <b>actif</b> sert de vue « éleveur » par défaut et pour les
      combats éleveur ; les actions sur un poireau (combats, capital, défis) passent automatiquement par le compte qui le possède.
    </p>

    <div v-if="!s.accounts.length" class="empty">Aucun compte : ajoutez une clé API ci-dessous pour commencer.</div>
    <div class="accounts">
      <div v-for="a in s.accounts" :key="a.id" class="account" :class="{ active: a.active }">
        <div class="row">
          <div>
            <b>{{ a.name }}</b> <span class="muted small">#{{ a.id }}</span>
            <span v-if="a.active" class="tag act">actif</span>
            <div class="small secondary">
              Clé <code>{{ a.keyMasked }}</code> ·
              <span v-if="a.ok" class="good">✓ {{ a.leeks }} poireau(x){{ a.garden ? ` · ⚔ ${a.garden.fights}/${a.garden.maxFights} combats` : "" }}</span>
              <span v-else class="bad">✕ {{ a.error }}</span>
            </div>
          </div>
          <span class="spacer"></span>
          <button v-if="!a.active" :disabled="busy" @click="activate(a)">Rendre actif</button>
          <button class="ghost" :disabled="busy" @click="editing = editing === a.id ? null : a.id; replaceKey = ''">Changer la clé</button>
          <button class="danger" :disabled="busy" @click="removing = a">Retirer</button>
        </div>
        <div v-if="editing === a.id" class="row" style="margin-top: 8px">
          <input v-model="replaceKey" type="password" autocomplete="off" placeholder="Nouvelle clé API de ce compte" style="flex: 1; min-width: 220px" @keyup.enter="replaceKey && saveKey(a)" />
          <button class="primary" :disabled="busy || !replaceKey.trim()" @click="saveKey(a)">Vérifier et enregistrer</button>
        </div>
        <div v-if="removing?.id === a.id" class="confirm">
          <div>Retirer le compte <b>{{ a.name }}</b> ? Ses poireaux restent suivis (en analyse) et ses combats sont conservés.</div>
          <span class="spacer"></span>
          <button @click="removing = null">Annuler</button>
          <button class="primary" :disabled="busy" @click="confirmRemove">Retirer</button>
        </div>
      </div>
    </div>

    <h3 style="margin: 18px 0 8px">Ajouter un compte</h3>
    <div class="row">
      <input v-model="newKey" :type="show ? 'text' : 'password'" autocomplete="off" spellcheck="false" placeholder="Clé API du compte à ajouter" style="flex: 1; min-width: 240px" @keyup.enter="newKey && add()" />
      <button class="ghost" @click="show = !show" :aria-label="show ? 'Masquer la clé' : 'Afficher la clé'">{{ show ? "Masquer" : "Afficher" }}</button>
      <button class="primary" :disabled="busy || !newKey.trim()" @click="add">{{ busy ? "Vérification…" : "Ajouter le compte" }}</button>
    </div>
    <p class="small muted">
      Chaque clé est testée auprès de Leek Wars avant d'être enregistrée. Les clés sont stockées en clair dans la base locale
      (<code>leekwars.db</code>, ignorée par git) et ne sont jamais renvoyées en entier à l'interface.
      <template v-if="s.envKey.present"> La clé du fichier <code>.env</code> ({{ s.envKey.masked }}) a été reprise comme compte au premier démarrage.</template>
    </p>
  </section>

  <section class="card" v-if="s">
    <h2>Stockage</h2>
    <div class="secondary">Base SQLite : <code>{{ s.storage.file }}</code></div>
    <div class="secondary">{{ fmtNum(s.storage.fights) }} combat(s) · {{ fmtNum(s.storage.size / 1024 / 1024, 1) }} Mo</div>
    <div class="row" style="margin-top: 10px">
      <button :disabled="busy" @click="doBackup">Sauvegarder la base</button>
      <span v-if="backup" class="small good">✓ {{ backup }}</span>
    </div>
  </section>
</template>

<style scoped>
.accounts { display: flex; flex-direction: column; gap: 8px; }
.account { padding: 10px 12px; border: 1px solid var(--border); background: var(--surface-2); }
.account.active { border-color: var(--accent); }
.tag.act { color: var(--accent); margin-left: 6px; }
.good { color: var(--good); }
.bad { color: var(--critical); }
.ok { border-color: var(--good); color: var(--good); }
.confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; padding: 10px; border: 1px solid var(--warning); background: color-mix(in srgb, var(--warning) 8%, transparent); }
</style>
