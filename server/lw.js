// Client minimal de l'API Leek Wars (https://leekwars.com/api).
// Authentification : clé API (scope "player") en Bearer, avec repli sur un
// token de session obtenu via login/mot de passe si la clé est absente.

const BASE = "https://leekwars.com/api";

export class LeekWarsError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class LeekWarsClient {
  constructor({ apiKey, login, password } = {}) {
    this.apiKey = apiKey || null;
    this.login = login || null;
    this.password = password || null;
    this.sessionToken = null;
    // File d'attente : appels sérialisés et espacés selon la limite du compte
    // (10 requêtes/s avec LW+, 5 sinon ; 5 tant que le statut n'est pas connu).
    this.queue = Promise.resolve();
    this.lwplus = false;
    this.lastRequestAt = 0;
    this.maxRetries = 5;
  }

  get requestsPerSecond() {
    return this.lwplus ? 10 : 5;
  }

  /** Statut LW+ du compte (champ `farmer.lwplus`), qui fixe la limite de requêtes. */
  setLwPlus(lwplus) {
    this.lwplus = !!lwplus;
  }

  /** Attend que l'intervalle minimal depuis la requête précédente soit écoulé. */
  async throttle() {
    const wait = this.lastRequestAt + 1000 / this.requestsPerSecond - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  /** Change la clé API à chaud (ex. saisie dans l'interface). */
  setApiKey(apiKey) {
    this.apiKey = apiKey || null;
    this.sessionToken = null;
  }

  async token() {
    if (this.apiKey) return this.apiKey;
    if (this.sessionToken) return this.sessionToken;
    if (!this.login || !this.password) return null;
    const res = await this.raw("POST", "farmer/login-token", { login: this.login, password: this.password }, null);
    if (!res.token) throw new LeekWarsError("Connexion Leek Wars impossible : " + JSON.stringify(res), 401, res);
    this.sessionToken = res.token;
    return this.sessionToken;
  }

  /** Appel brut : GET → paramètres dans le chemin, sinon corps form-urlencoded. */
  async raw(method, path, params = {}, token) {
    method = method.toUpperCase();
    let url = `${BASE}/${path.replace(/^\/+/, "")}`;
    const init = { method, headers: {} };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (method === "GET") {
      const values = Array.isArray(params) ? params : Object.values(params ?? {});
      if (values.length) url += "/" + values.map((v) => encodeURIComponent(String(v))).join("/");
    } else {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params ?? {})) {
        body.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      init.headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = body;
    }
    const run = async () => {
      // Réessaie les 429 (rate limit) avec un recul exponentiel, en respectant Retry-After.
      for (let attempt = 0; ; attempt++) {
        await this.throttle();
        const res = await fetch(url, init);
        const text = await res.text();
        let json;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }
        const rateLimited = res.status === 429 || /too_many_requests/i.test(String(json?.error ?? ""));
        if (rateLimited && attempt < this.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 1000 * 2 ** attempt);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (!res.ok || (json && json.error)) {
          throw new LeekWarsError(`${method} ${path} → ${res.status} ${json?.error ?? text.slice(0, 200)}`, res.status, json);
        }
        return json;
      }
    };
    // Sérialise les appels (l'espacement est géré par throttle()).
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async call(method, path, params = {}) {
    return this.raw(method, path, params, await this.token());
  }

  get(path, ...args) {
    return this.call("GET", path, args);
  }

  post(path, params) {
    return this.call("POST", path, params);
  }

  // --- Raccourcis utilisés par le serveur ---
  me() { return this.get("farmer/get-from-token"); }
  garden() { return this.get("garden/get"); }
  leek(id) { return this.get("leek/get-private", id); }
  leekOpponents(leekId) { return this.get("garden/get-leek-opponents", leekId); }
  farmerOpponents() { return this.get("garden/get-farmer-opponents"); }
  fight(id) { return this.get("fight/get", id); }
  fightLogs(id) { return this.get("fight/get-logs", id); }
  leekHistory(leekId) { return this.get("history/get-leek-history", leekId); }
  farmerHistory(farmerId) { return this.get("history/get-farmer-history", farmerId); }
  startSoloFight(leekId, targetId) { return this.post("garden/start-solo-fight", { leek_id: leekId, target_id: targetId }); }
  startSoloFightBatch(leekId, count) { return this.post("garden/start-solo-fight-batch", { leek_id: leekId, count }); }
  startFarmerFight(targetId) { return this.post("garden/start-farmer-fight", { target_id: targetId }); }
  startSoloChallenge(leekId, targetId, seed = 0, side = "random") {
    return this.post("garden/start-solo-challenge", { leek_id: leekId, target_id: targetId, seed, side });
  }
  // Tests d'IA : la clé API lit et lance les scénarios de l'éditeur (leur édition exige une session).
  testScenarios() { return this.get("test-scenario/get-all"); }
  startTestFight(scenarioId, aiPath) { return this.post("ai/test-scenario", { scenario_id: scenarioId, ai_id: aiPath }); }
  // Équipe : compositions de mon équipe (garden/get → my_compositions).
  compositionOpponents(compositionId) { return this.get("garden/get-composition-opponents", compositionId); }
  startTeamFight(compositionId, targetId) { return this.post("garden/start-team-fight", { composition_id: compositionId, target_id: targetId }); }
  startTeamFightBatch(compositionId, count) { return this.post("garden/start-team-fight-batch", { composition_id: compositionId, count }); }
  // Boss : `participants` = ids de mes poireaux ; les lots sont réservés à Leek Wars+.
  bosses() { return this.get("boss/get-all"); }
  startBossFight(bossId, participants) { return this.post("garden/start-boss-fight", { boss_id: bossId, participants }); }
  startBossFightBatch(bossId, participants, count) { return this.post("garden/start-boss-fight-batch", { boss_id: bossId, participants, count }); }
  // Arène : l'inscription expire (`expires_in`), il faut la renouveler pour rester dans la salle d'attente.
  arena() { return this.get("arena/get"); }
  arenaRegister(leekId, preference) { return this.post("arena/register", { leek_id: leekId, preference }); }
  arenaLeave() { return this.post("arena/leave", {}); }
  // Données publiques.
  tournament(id) { return this.get("tournament/get", id); }
  /** Classement : `category` leek | farmer | team | level-<N> (poireaux de niveau ≤ N)… ; `country` "null" = tous. */
  ranking(category, order, page = 1, country = "null") { return this.get("ranking/get", category, order, page, country); }
  /** Classement d'un boss ; `mode` 1 = tours, 2 = poireaux, 3 = premiers, 4 = puissance. */
  bossRanking(bossId, mode = 1, page = 1) { return this.get("ranking/boss", bossId, mode, page); }
  chips() { return this.get("chip/get-all"); }
  weapons() { return this.get("weapon/get-all"); }
}
