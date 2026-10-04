# Contribuer à LeekWars Local

Merci de votre intérêt ! Bugs, idées, corrections, nouvelles analyses : toutes les contributions sont les bienvenues.

## Signaler un bug ou proposer une idée

Ouvrez une [issue](https://github.com/steodec/LeekWarsLocal/issues/new/choose) avec le modèle qui correspond.
Pour un bug, indiquez la version (Paramètres → Mises à jour), ce que vous avez fait, ce que vous attendiez et ce qui
s'est passé. Un numéro de combat Leek Wars aide beaucoup pour tout ce qui touche à l'analyse.

**Ne collez jamais une clé API** (Leek Wars, Claude, ChatGPT) dans une issue, un log ou une capture d'écran.

Une faille de sécurité ne se signale pas dans une issue publique : utilisez le
[signalement privé](https://github.com/steodec/LeekWarsLocal/security/advisories/new).

## Mettre en place le projet

Prérequis : Node ≥ 22.13 (pour `node:sqlite`), et pour l'application de bureau Rust et les
[prérequis de Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run server            # API locale → http://127.0.0.1:3737 (doc : /api)
npm run dev               # interface avec rechargement à chaud → http://localhost:1420
```

En application de bureau : `npm run server` puis `npm run tauri dev`. Les données de dev sont les mêmes que celles de
l'application installée (`%APPDATA%\com.steodec.leekwarslocal\`) ; pour travailler sur une base à part :
`LWL_DATA_DIR=./data-dev npm run server`.

Avant d'ouvrir une PR, vérifiez que tout compile :

```bash
npm run build             # vérification des types (vue-tsc) + build de l'interface
```

## Organisation du code

- `server/` : serveur Node **sans dépendance** (API Leek Wars, SQLite via `node:sqlite`, analyse des combats). Il est
  embarqué tel quel dans l'application : n'ajoutez pas de paquet npm côté serveur.
- `server/analyze.js` : lecture des actions d'un combat. Si le format de l'analyse change, incrémentez
  `ANALYSIS_VERSION` (les résumés sont recalculés au démarrage).
- `src/` : interface Vue 3, routage par hash, pas d'autre dépendance que Vue. Thème Leek Wars dans `src/style.css`.
- `src-tauri/` : application de bureau (Tauri 2).

Le fichier [CLAUDE.md](CLAUDE.md) détaille l'API locale et les conventions ; le [README](README.md) liste les routes.

## Style

- Le projet est en **français** : interface, messages d'erreur, commentaires, messages de commit.
- Suivez le style du code voisin (nommage, densité de commentaires). Commentez le *pourquoi*, pas le *quoi*.
- Pas de dépendance nouvelle sans en discuter d'abord dans une issue.
- Ne lancez pas de vrais combats ni d'analyses IA payantes dans des scripts de test : ils consomment les combats du jour
  ou les crédits de la personne qui les exécute. Préférez les combats de test (gratuits) et `dryRun` pour l'analyse IA.

## Pull requests

1. Forkez le dépôt et créez une branche depuis `main`.
2. Une PR = un sujet. Décrivez ce qui change et comment vous l'avez vérifié (le modèle de PR vous guide).
3. Le contrôle **`build`** doit être vert pour fusionner. Pour une première contribution, le mainteneur doit approuver le
   lancement de la CI : c'est normal, ça peut prendre un peu de temps.
4. **Ne changez pas le numéro de version** : les versions sont publiées par le mainteneur (`npm run release`).
5. Les changements dans `.github/`, `scripts/`, `src-tauri/` et `package*.json` touchent à la construction et à la
   signature de l'application : expliquez-les précisément, ils seront relus avec attention.

## Licence

LeekWars Local est sous licence [GNU GPL v3](LICENSE). En proposant une contribution, vous acceptez qu'elle soit
distribuée sous cette même licence.
