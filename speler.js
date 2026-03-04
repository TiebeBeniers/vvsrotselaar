// ===============================================
// SPELERSPROFIEL - speler.js
// V.V.S Rotselaar
// ===============================================
// Functionaliteiten:
//   - Laadt profiel via uid-veld query (zelfde als auth.js)
//   - Profielfoto uploaden naar Firebase Storage, url opslaan in Firestore
//   - Wedstrijdgeschiedenis: laatste 3 wedstrijden waarbij user aanwezig was
//   - URL-parameter ?uid=... voor admins die andermans profiel bekijken
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// ── Hamburger ─────────────────────────────────────────────────────────────────

const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');

if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
    navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        });
    });
}

// ── State ─────────────────────────────────────────────────────────────────────

let currentUser     = null;
let profileDocId    = null;   // Firestore document ID van het geladen profiel
let isOwnProfile    = false;  // true als de ingelogde user zijn eigen profiel bekijkt

// ── Helpers ───────────────────────────────────────────────────────────────────

function capitalize(str) {
    if (!str) return '—';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function showOnly(id) {
    ['stateLoading', 'stateNotLoggedIn', 'stateNotFound', 'playerProfile']
        .forEach(s => {
            const el = document.getElementById(s);
            if (el) el.style.display = s === id ? '' : 'none';
        });
}

// ── UI vullen ─────────────────────────────────────────────────────────────────

function fillProfile(userData) {
    // Hero
    document.getElementById('heroNaam').textContent = userData.naam || 'Onbekend';

    // Info card
    document.getElementById('infoNaam').textContent      = userData.naam      || '—';
    document.getElementById('infoEmail').textContent     = userData.email     || '—';
    document.getElementById('infoCategorie').textContent = capitalize(userData.categorie);
    // Stel UID in maar behoud de tooltip-span die er al in de HTML achter staat
    const uidEl = document.getElementById('infoUid');
    if (uidEl) {
        const tooltip = uidEl.querySelector('.uid-help');
        uidEl.textContent = userData.uid || '—';
        if (tooltip) uidEl.appendChild(tooltip);
    }

    // Statistieken (vallen terug op 0 als veld nog niet bestaat)
    document.getElementById('statGoals').textContent   = userData.goals        ?? 0;
    document.getElementById('statAssists').textContent = userData.assists      ?? 0;
    document.getElementById('statMatches').textContent = userData.matchen      ?? 0;
    document.getElementById('statMinutes').textContent = userData.minuten      ?? 0;
    document.getElementById('statYellow').textContent  = userData.geelKaarten  ?? 0;
    document.getElementById('statRed').textContent     = userData.roodKaarten  ?? 0;

    // Profielfoto
    setAvatarDisplay(userData.fotoUrl || null);

}

function setAvatarDisplay(url) {
    const circle = document.getElementById('avatarCircle');
    if (!circle) return;
    if (url) {
        circle.innerHTML = `<img src="${url}" alt="Profielfoto">`;
    } else {
        circle.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
            </svg>`;
    }
}

// ── Profielfoto upload — voorlopig uitgeschakeld ─────────────────────────────

// ── Wedstrijdgeschiedenis ─────────────────────────────────────────────────────

async function loadMatchHistory(targetUid) {
    const container = document.getElementById('matchHistoryContainer');
    if (!container) return;

    try {
        // Haal alle afgewerkte wedstrijden op, sorteer lokaal op datum (geen index nodig)
        const matchesSnap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'finished')
        ));

        if (matchesSnap.empty) {
            renderNoHistory(container);
            return;
        }

        // Sorteer lokaal op datum, meest recent eerst
        const allMatches = [];
        matchesSnap.forEach(d => allMatches.push({ id: d.id, ...d.data() }));
        allMatches.sort((a, b) => {
            const da = a.datum || '';
            const db_ = b.datum || '';
            return db_.localeCompare(da);
        });

        const recentMatches = [];
        for (const matchDoc of allMatches) {
            if (recentMatches.length >= 3) break;

            // Controleer of het availability-document voor deze uid bestaat
            // De uid is het document-ID in de availability subcollectie
            const availDoc = await getDocs(
                query(
                    collection(db, 'matches', matchDoc.id, 'availability'),
                    where('available', '==', true)
                )
            );

            // uid kan het doc-ID zijn (normale spelers) of een veld zijn
            const wasPresent = availDoc.docs.some(d =>
                d.id === targetUid || d.data().uid === targetUid
            );
            if (wasPresent) {
                recentMatches.push(matchDoc);
            }
        }

        if (recentMatches.length === 0) {
            renderNoHistory(container);
            return;
        }

        renderMatchHistory(recentMatches, container);
    } catch (err) {
        console.error('Fout bij laden wedstrijdgeschiedenis:', err);
        container.innerHTML = `
            <div class="coming-soon">
                <div class="coming-icon">&#128194;</div>
                <p>Wedstrijdgeschiedenis kon niet worden geladen.</p>
            </div>`;
    }
}

function renderNoHistory(container) {
    container.innerHTML = `
        <div class="coming-soon">
            <div class="coming-icon">&#128194;</div>
            <p>Nog geen wedstrijden gevonden waarbij deze speler aanwezig was.</p>
        </div>`;
}

function renderMatchHistory(matches, container) {
    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'match-history-list';

    matches.forEach(match => {
        const isHome   = (match.thuisploeg || '').toLowerCase().includes('rotselaar');
        const scoreOns = isHome ? (match.scoreThuis ?? '?') : (match.scoreUit ?? '?');
        const scoreOpp = isHome ? (match.scoreUit   ?? '?') : (match.scoreThuis ?? '?');
        const opponent = isHome ? match.uitploeg : match.thuisploeg;

        let resultClass = 'draw';
        let resultLabel = 'G';
        if (typeof scoreOns === 'number' && typeof scoreOpp === 'number') {
            if (scoreOns > scoreOpp)      { resultClass = 'win';  resultLabel = 'W'; }
            else if (scoreOns < scoreOpp) { resultClass = 'loss'; resultLabel = 'V'; }
        }

        // Datum formatteren
        let datumStr = match.datum || '';
        try {
            if (datumStr) {
                const d = new Date(datumStr + 'T00:00:00');
                datumStr = d.toLocaleDateString('nl-BE', {
                    day: 'numeric', month: 'long', year: 'numeric'
                });
            }
        } catch (_) { /* gebruik raw string */ }

        const teamLabel = capitalize(match.team);

        const card = document.createElement('div');
        card.className = `match-history-card ${resultClass}`;
        card.innerHTML = `
            <div class="match-result-badge ${resultClass}">${resultLabel}</div>
            <div class="match-history-info">
                <div class="match-history-teams">
                    ${match.thuisploeg} &mdash; ${match.uitploeg}
                </div>
                <div class="match-history-meta">${datumStr}${teamLabel ? ' &middot; ' + teamLabel : ''}</div>
            </div>
            <div class="match-history-score">${match.scoreThuis ?? '?'}&ndash;${match.scoreUit ?? '?'}</div>
        `;
        list.appendChild(card);
    });

    container.appendChild(list);
}

// ── Auth + profiel laden ──────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');

    if (!user) {
        currentUser = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
        showOnly('stateNotLoggedIn');
        return;
    }

    currentUser = user;
    if (loginLink) loginLink.textContent = 'PROFIEL';

    try {
        // Bepaal welk profiel we tonen: eigen profiel of via ?uid= parameter
        const params    = new URLSearchParams(window.location.search);
        const targetUid = params.get('uid') || user.uid;
        isOwnProfile    = targetUid === user.uid;

        // Zoek Firestore-document via uid-veld (zelfde structuur als auth.js)
        const q    = query(collection(db, 'users'), where('uid', '==', targetUid));
        const snap = await getDocs(q);

        if (snap.empty) {
            showOnly('stateNotFound');
            return;
        }

        profileDocId = snap.docs[0].id;
        const userData = { uid: targetUid, ...snap.docs[0].data() };

        fillProfile(userData);
        showOnly('playerProfile');

        // Laad wedstrijdgeschiedenis asynchroon
        loadMatchHistory(targetUid);

    } catch (err) {
        console.error('Fout bij laden profiel:', err);
        showOnly('stateNotFound');
    }
});
