<script setup lang="ts">
import { updater, installUpdate } from "../updater";
</script>

<template>
  <div v-if="updater.enabled && !updater.dismissed && ['available', 'downloading', 'installing'].includes(updater.phase)" class="card update">
    <template v-if="updater.phase === 'available'">
      <span><b>LeekWars Local {{ updater.version }}</b> est disponible (version actuelle {{ updater.current }}).</span>
      <button class="primary" @click="installUpdate">Mettre à jour et redémarrer</button>
      <button class="ghost" @click="updater.dismissed = true">Plus tard</button>
    </template>
    <span v-else-if="updater.phase === 'downloading'">Téléchargement de la version {{ updater.version }}… {{ Math.round(updater.progress * 100) }} %</span>
    <span v-else>Installation de la version {{ updater.version }}, l'application va redémarrer…</span>
  </div>
</template>

<style scoped>
.update { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-color: var(--accent); }
</style>
