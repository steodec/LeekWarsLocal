# Sécurité

## Versions maintenues

Seule la **dernière version** publiée reçoit des correctifs de sécurité. L'application se met à jour toute seule
(vérification au démarrage puis toutes les 6 heures) : installez la mise à jour proposée dès qu'elle apparaît.

| Version | Correctifs de sécurité |
|---|---|
| Dernière release | ✅ |
| Versions précédentes | ❌ |

## Signaler une faille

**N'ouvrez pas d'issue publique** : elle exposerait les utilisateurs avant que la faille soit corrigée.

Utilisez le [signalement privé de GitHub](https://github.com/steodec/LeekWarsLocal/security/advisories/new)
(onglet *Security* → *Report a vulnerability*). Seul le mainteneur voit le rapport.

Indiquez si possible :

- la version concernée et le mode d'utilisation (application installée ou projet lancé en développement) ;
- ce qu'un attaquant peut faire et dans quelles conditions ;
- les étapes pour reproduire, ou une preuve de concept minimale ;
- une piste de correction, si vous en avez une.

**N'incluez jamais de vraie clé API** (Leek Wars, Claude, ChatGPT) dans le rapport : utilisez des valeurs fictives.

LeekWars Local est un projet bénévole : je réponds dès que possible, en général sous quelques jours. Une fois la faille
corrigée et la version publiée, l'avis de sécurité est rendu public, avec vos remerciements si vous le souhaitez.

## Périmètre

Sont concernés :

- l'**API locale** (`server/`) : accès depuis une page web tierce, contournement du filtrage d'origine, lecture des clés
  API, actions non voulues sur le compte Leek Wars (combats, capital) ou sur une clé d'IA ;
- l'**application de bureau** (`src-tauri/`) et son **système de mise à jour** (signature des mises à jour, fichier
  `latest.json`) ;
- la **chaîne de publication** (workflows GitHub Actions, scripts de release) ;
- le stockage local des données et des clés.

Ne sont pas concernés :

- le jeu Leek Wars et son API : à signaler à l'équipe de [Leek Wars](https://leekwars.com) ;
- les API d'Anthropic ou d'OpenAI ;
- une faille qui suppose déjà le contrôle de la machine ou de la session Windows de l'utilisateur.

## Modèle de sécurité

Pour situer un rapport, voici ce que l'application garantit et ce qu'elle ne garantit pas :

- Le serveur local n'écoute que sur `127.0.0.1` (sauf si `LWL_HOST` est changé volontairement). Il refuse les requêtes envoyées par une page web autre que l'interface
  (filtrage de l'en-tête `Origin` et de `Host`) ; les clients sans navigateur (curl, scripts locaux) sont acceptés.
- Les clés API (Leek Wars, Claude, ChatGPT) sont stockées **en clair** dans la base locale
  (`%APPDATA%\com.steodec.leekwarslocal\leekwars.db`), protégée seulement par les droits de la session Windows. Elles ne
  sont jamais renvoyées en entier à l'interface, et ne sont envoyées qu'à leur service respectif.
- Les mises à jour sont signées ; l'application refuse une mise à jour dont la signature ne correspond pas. La clé de
  signature n'est accessible qu'au workflow de publication, après approbation manuelle du mainteneur.
