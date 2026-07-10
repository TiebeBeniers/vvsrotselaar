// ===============================================
// VVS-MIGRATE.JS — Eenmalig migratiescript
// Voer dit UIT in de browser-console op admin.html (als admin).
// Migreert bestaande Firestore-data naar schema v2.
//
// WAT DOET DIT SCRIPT:
//   1. Migreert users: hernoemt velden naar nieuwe namen,
//      verplaatst stats naar stats-map,
//      verplaatst validFrom/validUntil/wachtwoord naar information-map,
//      consolideert rol/rollen/rechten/categorie/ploegen → permissions/team.
//   2. Migreert events: kopieert events van `events` collection
//      naar `matches/{id}/events` subcollection en verwijdert de oude.
// ===============================================

import { db } from './firebase-config.js';
import {
    collection, getDocs, doc, setDoc, deleteDoc,
    writeBatch, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPermissions(data) {
    const perms = new Set();

    // Rol / rollen
    const rollen = Array.isArray(data.rollen) && data.rollen.length > 0
        ? data.rollen
        : (data.rol ? [data.rol] : ['speler']);

    rollen.forEach(r => {
        if (r === 'admin')    perms.add('admin');
        if (r === 'speler')   perms.add('speler');
        if (r === 'tijdelijk') perms.add('tijdelijk');
        if (r === 'bestuurslid') perms.add('admin'); // bestuurslid was feitelijk admin
    });

    if (!perms.has('admin') && !perms.has('tijdelijk')) {
        perms.add('speler');
    }

    // Extern
    if (data.categorie === 'extern' || data.rol === 'tijdelijk') {
        perms.add('tijdelijk');
        perms.add('extern');
        perms.delete('speler');
    }

    // Rechten
    const rechten = Array.isArray(data.rechten) ? data.rechten : [];
    rechten.forEach(r => {
        if (r === 'score_invullen') perms.add('score_invullen');
        if (r === 'afgevaardigde') {
            const team = data.afgevaardigdeTeam || '*';
            perms.add(`afgevaardigde:${team}`);
        }
        if (r === 'werken') perms.add('werken');
    });

    // Toegang (tijdelijke accounts)
    const toegang = Array.isArray(data.toegang) ? data.toegang : [];
    toegang.forEach(t => {
        if (t === 'rockwerchter') perms.add('rockwerchter');
        if (t === 'werken')       perms.add('werken');
        if (t === 'score_invullen') perms.add('score_invullen');
    });

    return [...perms];
}

function buildTeams(data) {
    if (Array.isArray(data.ploegen) && data.ploegen.length > 0) {
        return data.ploegen.filter(p => p && p !== 'extern');
    }
    if (data.categorie && data.categorie !== 'extern') {
        return [data.categorie];
    }
    return [];
}

function buildStats(data) {
    return {
        goals:       data.goals        ?? 0,
        assists:     data.assists      ?? 0,
        matches:     data.matchen      ?? 0,
        minutes:     data.minuten      ?? 0,
        yellowCard:  data.geelKaarten  ?? 0,
        redCard:     data.roodKaarten  ?? 0,
        motmPoints:  data.motmPunten   ?? 0,
        motmHistory: data.motmHistory  ?? [],
    };
}

// ── Migreer users ─────────────────────────────────────────────────────────────

export async function migrateUsers(dryRun = true) {
    console.log(`[MIGRATE USERS] ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    const snap = await getDocs(collection(db, 'users'));
    let count = 0;

    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const uid  = data.uid || docSnap.id;

        const newDoc = {
            uid,
            name:        data.naam  || data.name  || '',
            email:       data.email || '',
            telnr:       data.telefoon || data.telnr || '',
            team:        buildTeams(data),
            permissions: buildPermissions(data),
            stats:       buildStats(data),
        };

        if (data.registered) newDoc.registered = data.registered;
        if (data.aangemaaktOp) newDoc.registered = data.aangemaaktOp;
        if (data.note) newDoc.note = data.note;

        // External info map
        const isExtern = (data.categorie === 'extern' || data.rol === 'tijdelijk');
        if (isExtern && (data.validFrom || data.validUntil || data.wachtwoord)) {
            newDoc.information = {
                validFrom:   data.validFrom   || null,
                validUntil:  data.validUntil  || null,
                wachtwoord:  data.wachtwoord  || '',
            };
        }

        console.log(`[USER] ${uid} → name="${newDoc.name}" teams=[${newDoc.team}] perms=[${newDoc.permissions}]`);

        if (!dryRun) {
            // Gebruik uid als doc-ID (doc was al uid als ID in nieuwe structuur)
            await setDoc(doc(db, 'users', uid), newDoc);
            // Verwijder oud doc als doc-ID anders was
            if (docSnap.id !== uid) {
                await deleteDoc(doc(db, 'users', docSnap.id));
                console.log(`  Oud doc ${docSnap.id} verwijderd`);
            }
        }
        count++;
    }

    console.log(`[MIGRATE USERS] ${count} users verwerkt.`);
    return count;
}

// ── Migreer events naar subcollection ────────────────────────────────────────

export async function migrateEvents(dryRun = true) {
    console.log(`[MIGRATE EVENTS] ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    const snap = await getDocs(collection(db, 'events'));
    let moved = 0, skipped = 0;

    // Groepeer per matchId
    const byMatch = {};
    snap.forEach(d => {
        const data = d.data();
        const mid  = data.matchId;
        if (!mid) { console.warn('Event zonder matchId:', d.id); skipped++; return; }
        if (!byMatch[mid]) byMatch[mid] = [];
        byMatch[mid].push({ id: d.id, ref: d.ref, data });
    });

    for (const [matchId, events] of Object.entries(byMatch)) {
        console.log(`[EVENTS] Match ${matchId}: ${events.length} events`);
        for (const ev of events) {
            const { matchId: _m, ...rest } = ev.data; // matchId is impliciét in pad
            if (!dryRun) {
                await setDoc(doc(db, 'matches', matchId, 'events', ev.id), rest);
                await deleteDoc(ev.ref);
            }
            moved++;
        }
    }

    console.log(`[MIGRATE EVENTS] ${moved} events verplaatst, ${skipped} overgeslagen.`);
    return { moved, skipped };
}

// ── Alles in één keer ─────────────────────────────────────────────────────────

export async function migrateAll(dryRun = true) {
    console.log('====== VVS MIGRATIE START', dryRun ? '(DRY RUN)' : '(LIVE — ECHTE SCHRIJFACTIES)' , '======');
    const users  = await migrateUsers(dryRun);
    const events = await migrateEvents(dryRun);
    console.log('====== VVS MIGRATIE KLAAR ======');
    console.log(`Users: ${users} | Events verplaatst: ${events.moved}`);
}

// Gebruik in console:
//   import { migrateAll } from './vvs-migrate.js';
//   await migrateAll(true);   // dry run eerst
//   await migrateAll(false);  // dan live