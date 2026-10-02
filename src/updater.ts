// Mises à jour de l'application de bureau (plugin updater Tauri, releases GitHub signées).
// Hors Tauri (npm run server / vite), tout est inactif : on met à jour avec `npm run update`.
import { reactive } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { inTauri } from "./api";

type Phase = "idle" | "checking" | "available" | "downloading" | "installing" | "uptodate" | "error";

export const updater = reactive({
  enabled: inTauri,
  phase: "idle" as Phase,
  current: "",
  version: "",
  notes: "",
  progress: 0, // 0 → 1 pendant le téléchargement
  error: "",
  dismissed: false,
});

let pending: Update | null = null;

export async function checkForUpdate() {
  if (!inTauri || ["checking", "downloading", "installing"].includes(updater.phase)) return;
  updater.phase = "checking";
  updater.error = "";
  try {
    updater.current ||= await getVersion();
    pending = await check();
    if (pending) {
      updater.version = pending.version;
      updater.notes = pending.body ?? "";
      updater.phase = "available";
      updater.dismissed = false;
    } else {
      updater.phase = "uptodate";
    }
  } catch (e) {
    updater.phase = "error";
    updater.error = e instanceof Error ? e.message : String(e);
  }
}

export async function installUpdate() {
  if (!pending) return;
  updater.phase = "downloading";
  updater.progress = 0;
  try {
    let total = 0;
    let received = 0;
    await pending.download((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        received += ev.data.chunkLength;
        if (total) updater.progress = received / total;
      }
    });
    updater.phase = "installing";
    // Libère leekwars-server.exe pour que l'installeur puisse le remplacer.
    await invoke("stop_server");
    await pending.install();
    await relaunch(); // sous Windows l'installeur relance l'appli lui-même
  } catch (e) {
    updater.phase = "error";
    updater.error = e instanceof Error ? e.message : String(e);
  }
}

/** Vérifie au démarrage puis toutes les 6 heures. */
export function startUpdateChecks() {
  if (!inTauri) return;
  getVersion().then((v) => (updater.current = v)).catch(() => {});
  checkForUpdate();
  setInterval(checkForUpdate, 6 * 3600_000);
}
