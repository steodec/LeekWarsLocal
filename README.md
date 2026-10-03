# LeekWars Local

**[⬇ Télécharger LeekWars Local pour Windows](https://github.com/steodec/LeekWarsLocal/releases/latest/download/LeekWarsLocal-setup.exe)**
· [toutes les versions](https://github.com/steodec/LeekWarsLocal/releases)

Interface locale pour **gérer, lancer et analyser** ses combats Leek Wars, avec une **API REST locale**
utilisable depuis l'interface, un script, ou Claude.

- Serveur Node sans dépendance (`server/`) : parle à l'API Leek Wars, stocke les combats dans une base **SQLite** (`%APPDATA%\com.steodec.leekwarslocal\leekwars.db`, partagée avec l'application de bureau ; `LWL_DATA_DIR` pour changer de dossier ; via `node:sqlite` intégré à Node ≥ 22.13), les analyse.
- Interface Vue 3 (`src/`) : tableau de bord, lancement de combats, liste filtrable, détail d'un combat, statistiques.
  Thème et images de Leek Wars (poireaux avec peau et chapeau, puces, armes, caractéristiques, police pixel), thème clair / sombre / auto.
- Coquille Tauri (`src-tauri/`) optionnelle.

## Démarrage

```bash
npm install
npm start                 # build de l'interface + serveur → http://127.0.0.1:3737
```

Développement (rechargement à chaud) : `npm run server` dans un terminal, `npm run dev` dans un autre → http://localhost:1420
(Vite redirige `/api` vers le serveur). En application de bureau : `npm run server` puis `npm run tauri dev`.

Au premier lancement, ajoutez votre **clé API Leek Wars** dans la page **Paramètres** (elle est vérifiée avant d'être enregistrée).
Plusieurs comptes peuvent être ajoutés, comme sur Leek Wars : un sélecteur dans l'en-tête change le compte actif. Ensuite,
puis cliquez sur **Synchroniser** pour importer l'historique de vos poireaux. Les poireaux suivis se gèrent dans la page **Poireaux**.

Alternative : copier `.env.example` en `.env` et y mettre `LEEKWARS_API_KEY` (la clé saisie dans l'interface reste prioritaire).

Les images et polices de Leek Wars sont dans `public/lw/` ; pour les mettre à jour : `npm run assets`
(clone léger de [leek-wars/leek-wars](https://github.com/leek-wars/leek-wars), licence GPL v3, + SVG des poireaux depuis leekwars.com).

## Application de bureau (.exe à partager)

```bash
npm run tauri build
```

Produit l'installateur `src-tauri/target/release/bundle/nsis/LeekWars Local_<version>_x64-setup.exe` : un seul fichier à envoyer.
Il installe l'application pour l'utilisateur courant (sans droits admin) et WebView2 si besoin.

- Le serveur Node est compilé en exécutable autonome (`npm run build:server` : esbuild + Node SEA + postject) et embarqué comme
  *sidecar* Tauri : l'application le lance à l'ouverture et l'arrête à la fermeture. Rien à installer (pas de Node).
- Les données vont dans `%APPDATA%\com.steodec.leekwarslocal\` (base `leekwars.db`), comme avec `npm run server` : une seule base quel que soit le serveur lancé. Une ancienne
  base `data/leekwars.db` du projet y est fusionnée une fois au démarrage. Chaque utilisateur saisit **sa** clé API dans Paramètres.
- L'exécutable n'est pas signé : Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » → « Informations complémentaires » → « Exécuter quand même ».

## Mises à jour

- **Application installée** : elle vérifie les mises à jour au démarrage puis toutes les 6 h ; une bannière propose
  « Mettre à jour et redémarrer » (aussi dans Paramètres → Mises à jour). Les mises à jour sont signées (plugin updater Tauri) :
  une version non signée par notre clé est refusée. Une version antérieure à 0.3.0 doit être réinstallée une fois à la main.
- **Copie de travail** (`npm run server`) : `npm run update` fait `git pull --ff-only`, `npm install` si les dépendances ont changé,
  puis reconstruit l'interface. Redémarrer ensuite le serveur.
- **Publier une version** :

  ```bash
  npm run release -- minor          # ou patch, major, 1.2.3
  ```

  Incrémente la version partout, commit « Version X.Y.Z » et push. Le workflow GitHub Actions `.github/workflows/release.yml`
  construit alors l'installeur signé sur `windows-latest` et crée la release `vX.Y.Z` (installeur, `.sig`, `latest.json` lu par
  l'updater, et `LeekWarsLocal-setup.exe` pour le lien de téléchargement stable). Il ne publie que si la release de la version de
  `package.json` n'existe pas encore ; sur une pull request il se contente de construire.
- **Clé de signature** : secret `TAURI_SIGNING_PRIVATE_KEY` du dépôt, copie locale `~/.tauri/leekwarslocal.key`. **À sauvegarder** :
  sans elle, plus aucune mise à jour ne peut être publiée pour les applis déjà installées. Ne jamais la committer.

## Ce que fait l'interface

| Page | Contenu |
|---|---|
| Tableau de bord | combats restants, taux de victoire (global / 10 / 50 derniers), série, évolution du talent, bêtes noires, derniers combats |
| Lancer | combats solo / éleveur (N combats, choix d'adversaire : plus faible, plus proche en talent, plus fort, aléatoire, ou lot API), défis avec seed |
| Combats | liste filtrable (résultat, contexte, type, adversaire, tag, bugs IA), import d'un combat par ID |
| Détail | PV par tour, stats par entité (dégâts, soins, PT/PM utilisés par tour, crit., bugs, opérations), objets utilisés, tour par tour, notes et tags, « Rejouer en défi » avec le même seed, logs IA |
| Analyse | taux de victoire par écart de niveau / talent / durée / contexte, profil de l'adversaire, build, efficacité des puces et armes, bilan par adversaire |
| Poireaux | poireaux suivis : **les miens** (lancement, capital) ou **n'importe quel autre** pour analyse (ID ou lien, ou « + Suivre » sur un adversaire). L'ajout importe son historique ; retrait avec purge optionnelle, ordre |
| Paramètres | **comptes Leek Wars** (ajout par clé API vérifiée, compte actif, changement de clé, retrait), taille de la base, sauvegarde |
| Caractéristiques | base / capital investi / équipement / total, planificateur +/− avec coût réel par paliers, validation (dépense du capital), historique des builds avec leur taux de victoire |

## API locale

Doc auto-générée : `GET http://127.0.0.1:3737/api`.

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/status` | éleveur, poireaux, combats restants, tâches en cours |
| GET | `/api/leeks` | poireaux suivis (`owned` = à moi) + poireaux du compte non suivis |
| POST · PUT | `/api/leeks/tracked` | `{id}` suivre n'importe quel poireau (ID ou lien ; lance l'import de son historique) · `{ids:[…]}` réordonner |
| DELETE | `/api/leeks/tracked/:id` | ne plus suivre (`?purge=1` supprime aussi ses combats stockés) |
| GET | `/api/leeks/:id` | détail privé d'un poireau (équipement nommé) |
| GET | `/api/leeks/:id/characteristics` | caractéristiques détaillées + coût du prochain achat |
| POST | `/api/leeks/:id/characteristics/preview` | `{bonuses:{strength:10,…}}` simule sans dépenser |
| POST | `/api/leeks/:id/characteristics` | `{bonuses:{…}}` dépense le capital (vérifie paliers et capital avant d'appeler Leek Wars) |
| GET | `/api/capital-log` | dépenses de capital faites via l'outil |
| GET | `/api/opponents/:leekId` · `/api/opponents/farmer` | adversaires proposés (+ bilan local) |
| POST | `/api/fights/solo` | `{leekId, targetId?, strategy?, count?, batch?}` → tâche |
| POST | `/api/fights/farmer` | `{targetId?, strategy?, count?, batch?}` → tâche |
| POST | `/api/fights/challenge` | `{leekId, targetId, seed?, side?, count?}` → tâche |
| GET | `/api/fights/test` | IA de test (lambda, normal, confirmed, expert), bots et scénarios de l'éditeur ; `?leekId=` → scénario retenu par IA |
| POST | `/api/fights/test` | `{leekId, ais?, scenarioIds?, count?, aiPath?}` → tâche : combats de test gratuits contre les bots, via les scénarios de l'éditeur (la clé API ne peut pas les créer) |
| GET | `/api/jobs` · `/api/jobs/:id` | suivi des tâches (progression, combats, logs) |
| POST | `/api/sync` | `{leekIds?, limit?}` importe l'historique |
| POST | `/api/fights/import` | `{ids:[…], force?}` |
| GET | `/api/fights` | `leek` = point de vue (sans : mon éleveur) ; filtres : `leek, result, context, type, opponent, tag, source, bugs, since, until, q, last, limit, offset` |
| GET | `/api/fights/:id` | résumé + analyse complète, `?leek=` = point de vue (n'importe quel participant), `?refresh=1` re-télécharge |
| GET | `/api/fights/:id/raw` · `/api/fights/:id/logs` | données brutes / logs IA |
| PATCH | `/api/fights/:id` | `{note?, tags?}` |
| DELETE | `/api/fights/:id` | retire du stockage local |
| GET | `/api/stats` | agrégats (mêmes filtres que `/api/fights`) |
| GET | `/api/compare?a=<query>&b=<query>` | compare deux jeux de filtres (ex. avant/après une modif d'IA) |
| GET · POST | `/api/accounts` | liste des comptes (clés masquées, combats restants) · `{apiKey, activate?}` ajoute un compte (suit ses poireaux, importe son historique) |
| PUT | `/api/accounts/active` · `/api/accounts/:id/key` · `/api/accounts/order` | `{id}` compte actif · `{apiKey}` nouvelle clé du même éleveur · `{ids}` ordre |
| DELETE | `/api/accounts/:id` | retire un compte (ses poireaux restent suivis en analyse, combats conservés) |
| GET | `/api/settings` | comptes, présence d'une clé .env, stockage |
| POST | `/api/backup` | copie de la base dans `backups/` (dossier des données) |
| * | `/api/lw/<module>/<fonction>` | proxy authentifié vers n'importe quelle route de l'API Leek Wars |

Exemples :

```bash
curl -s localhost:3737/api/status
curl -s -X POST localhost:3737/api/fights/solo -H 'Content-Type: application/json' -d '{"leekId":92037,"count":5,"strategy":"closest"}'
curl -s "localhost:3737/api/stats?leek=92037&last=50"
curl -s "localhost:3737/api/compare?a=since%3D1790700000%26until%3D1790800000&b=since%3D1790800000"
```

## Notes

- L'ancien stockage local du projet (`data/` : `leekwars.db`, sauvegardes, ancien stockage JSON dans `data/legacy-json/`) et `.env` sont ignorés par git.
- Chaque combat est stocké une fois (données brutes compressées) ; un résumé d'analyse est calculé par point de vue : mon éleveur et chaque poireau suivi qui y participe.
- Les poireaux qui ne sont pas à moi sont en lecture seule : pas de lancement de combat ni de capital.
- Les PT « inutilisés » sont estimés à partir du coût des objets ; les bonus de PT temporaires ne sont pas comptés.
- Certains combats sont refusés par Leek Wars (`fight_with_secret_trophy`) et ne peuvent pas être importés.
