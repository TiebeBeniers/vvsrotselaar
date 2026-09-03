#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// bump-sw-cache.js — Verhoogt automatisch het cache-versienummer
// in sw.js vóór elke hosting-deploy.
//
// Wordt aangeroepen via de "predeploy" hook in firebase.json, dus
// dit hoeft NOOIT manueel gedraaid te worden — het gebeurt vanzelf
// bij elke `firebase deploy` / `firebase deploy --only hosting`.
//
// Verhoogt zowel CACHE_NAME (vvs-static-vNN) als PAGES_CACHE
// (vvs-pages-vNN) samen, en werkt het "Last updated"-commentaar bij.
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'sw.js');

if (!fs.existsSync(SW_PATH)) {
    console.error(`[bump-sw-cache] sw.js niet gevonden op ${SW_PATH} — niets aangepast.`);
    process.exit(1);
}

let content = fs.readFileSync(SW_PATH, 'utf8');

const match = content.match(/vvs-static-v(\d+)/);
if (!match) {
    console.error('[bump-sw-cache] Kon geen "vvs-static-vNN"-patroon vinden in sw.js — niets aangepast.');
    console.error('[bump-sw-cache] Pas dit script aan als de naamgeving van CACHE_NAME gewijzigd is.');
    process.exit(1);
}

const nextVersion = parseInt(match[1], 10) + 1;

const now = new Date();
const stamp = now.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' - ' + now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', hour12: false });

content = content
    .replace(/vvs-static-v\d+/g, `vvs-static-v${nextVersion}`)
    .replace(/vvs-pages-v\d+/g,  `vvs-pages-v${nextVersion}`)
    .replace(/\/\/\s*Last updated .*/i, `//Last updated ${stamp}`);

fs.writeFileSync(SW_PATH, content, 'utf8');
console.log(`[bump-sw-cache] sw.js cache-versie bijgewerkt: v${nextVersion} (${stamp})`);