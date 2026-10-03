# LeekWars Local — notes pour Claude

Outil local de gestion/analyse des combats Leek Wars. Voir README.md pour le détail des routes.

## Utiliser l'API (pour lancer et analyser des combats)

- Serveur : `npm run server` (ou `npm start` pour builder l'UI aussi) → `http://127.0.0.1:3737`. Vérifier avec `curl -s localhost:3737/api/status`.
- Doc des routes : `curl -s localhost:3737/api`.
- Comptes : plusieurs comptes Leek Wars (table `accounts`, une clé API chacun ; `GET/POST /api/accounts`). Un compte est actif (`PUT /api/accounts/active`) : vue éleveur par défaut (`?account=<farmerId>` pour un autre) et combats éleveur. Les actions sur un poireau utilisent automatiquement le compte propriétaire. Sans compte : 401 `code: "no_api_key"`. Ne jamais afficher une clé en entier.
- Poireaux suivis : `GET /api/leeks` (table `tracked_leeks`). `owned: false` = poireau d'un autre joueur suivi pour analyse (pas de lancement ni de capital). `POST /api/leeks/tracked {id}` suit n'importe quel poireau et importe son historique.
- Perspectives : `/api/fights`, `/api/stats` sans `leek` = mon éleveur ; avec `?leek=<id>` = du point de vue de ce poireau suivi. `/api/fights/:id?leek=<id>` accepte n'importe quel participant.
- Lancer des combats = consomme les combats quotidiens du compte (`garden.fights` dans `/api/status`). Ne pas lancer de combats sans que l'utilisateur l'ait demandé.
- Les lancements sont asynchrones : `POST /api/fights/solo` renvoie une tâche, suivre `GET /api/jobs/:id` jusqu'à `status: "done"`, puis lire `GET /api/fights/:id`.
- Pour évaluer une modification d'IA : lancer N combats, puis `GET /api/compare?a=until%3D<ts>&b=since%3D<ts>` (filtres en query string encodée), ou des défis à seed fixe (`/api/fights/challenge`) pour rejouer exactement la même situation.
- Tests d'IA : `POST /api/fights/test {leekId, ais?: ["lambda","normal","confirmed","expert"], count?}` lance des combats de test (gratuits, contexte 0, source `test`) contre les bots. La clé API (rôle player) lit (`test-scenario/get-all`) et lance (`ai/test-scenario`) les scénarios, mais leur création/modification exige une session : il faut un scénario par IA créé dans l'éditeur Leek Wars (poireau en équipe 1, bot avec l'IA en équipe 2). `GET /api/fights/test?leekId=` montre lesquels manquent.
- Caractéristiques : `GET /api/leeks/:id/characteristics`, simuler avec `POST …/characteristics/preview`. `POST /api/leeks/:id/characteristics` dépense du capital (irréversible) : uniquement sur demande explicite. `bonuses` = points de caractéristique à ajouter (pas du capital).
- Analyse d'un combat : `analysis.entities[]` (dégâts, soins, PT/PM par tour, bugs, ops, objets), `analysis.turnsLog`, `analysis.lifeTimeline`.
- Logs IA : `GET /api/fights/:id/logs` (via le compte qui a participé ; vides si l'IA n'appelle pas debug()). Types 2/7 avertissement, 3/8 erreur (6-8 : code d'erreur LeekScript en `log[3]`, messages dans `public/lw/leekscript-errors.json`), 5 pause, 4/9/10 marqueurs. Mise en forme : `src/fightlogs.ts`.
- Replay : `GET /api/fights/:id/replay` → `src/components/FightReplay.vue` (carte en losanges, géométrie de `leek-wars/src/model/field.ts`).

## Code

- `server/lw.js` client API Leek Wars (clé API en Bearer ; scope "player").
- `server/analyze.js` parse `fight.data.actions` — codes repris de `leek-wars/src/model/action.ts`. Les actions de puce référencent le **template** de la puce ; l'inventaire d'un poireau référence l'**item**. `analyzeFight(raw, {farmerId}|{leekId}, catalog)`. Incrémenter `ANALYSIS_VERSION` quand le format change : les participations sont recalculées au démarrage.
- `server/db.js` SQLite (`%APPDATA%\com.steodec.leekwarslocal\leekwars.db` en dev comme dans l'appli Tauri, `LWL_DATA_DIR` pour surcharger ; l'ancienne `data/leekwars.db` du projet est fusionnée une fois via `Db.mergeFrom`, `node:sqlite`) : `fights` (brut gzip + notes/tags), `fight_leeks` (index poireau↔combat), `participations` (résumé par perspective `f<farmerId>` / `l<leekId>`), `tracked_leeks`, `kv`, `capital_log`. Migration auto depuis l'ancien JSON.
- `server/capital.js` coûts en capital par paliers (miroir de `leek-wars/src/model/costs.ts`).
- `server/stats.js` agrégats (dont `byBuild`, `byOppProfile`). `src/` interface Vue (routage par hash, pas de dépendance hors Vue). Thème Leek Wars v3 dans `src/style.css` ; images dans `public/lw/` (`npm run assets`, `scripts/fetch-lw-assets.mjs`), chemins dans `src/lw.ts`, composants `LeekImage` (peau/chapeau/niveau) et `ItemIcon` (puce/arme/caractéristique, par `name` interne Leek Wars).
