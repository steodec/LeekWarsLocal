// Point d'entrée du serveur. node:sqlite émet un ExperimentalWarning au chargement :
// on le filtre ici, avant de charger le reste (les imports statiques d'index.js sont hoistés).
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => (String(warning).includes("SQLite") ? undefined : emit.call(process, warning, ...rest));

import("./index.js");
