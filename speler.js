// ===============================================
// SPELERSPROFIEL - speler.js
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Cache configuratie ────────────────────────────────────────────────────────
//
// Profieldata:          5 minuten  — stats kunnen na een wedstrijd veranderen
// Wedstrijdgeschiedenis: 10 minuten — verandert zelden, bevat veel reads
//
const CACHE_TTL_PROFILE = 5  * 60 * 1000;   // 5 min in ms
const CACHE_TTL_HISTORY = 10 * 60 * 1000;   // 10 min in ms

function cacheKey(type, uid) {
    return `vvs_${type}_${uid}`;
}

function cacheGet(type, uid, ttl) {
    try {
        const raw = localStorage.getItem(cacheKey(type, uid));
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > ttl) {
            localStorage.removeItem(cacheKey(type, uid));
            return null;
        }
        return data;
    } catch (_) { return null; }
}

function cacheSet(type, uid, data) {
    try {
        localStorage.setItem(cacheKey(type, uid), JSON.stringify({ ts: Date.now(), data }));
    } catch (_) { /* quota overschreden of privémodus — geen probleem */ }
}

function cacheInvalidate(type, uid) {
    try { localStorage.removeItem(cacheKey(type, uid)); } catch (_) {}
}

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

let currentUser  = null;
let profileDocId = null;
let isOwnProfile = false;

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
    document.getElementById('heroNaam').textContent = userData.naam || 'Onbekend';
    document.getElementById('infoNaam').textContent      = userData.naam      || '—';
    document.getElementById('infoEmail').textContent     = userData.email     || '—';
    document.getElementById('infoCategorie').textContent = capitalize(userData.categorie);

    const uidEl = document.getElementById('infoUid');
    if (uidEl) {
        const tooltip = uidEl.querySelector('.uid-help');
        uidEl.textContent = userData.uid || '—';
        if (tooltip) uidEl.appendChild(tooltip);
    }

    document.getElementById('statGoals').textContent   = userData.goals        ?? 0;
    document.getElementById('statAssists').textContent = userData.assists      ?? 0;
    document.getElementById('statMatches').textContent = userData.matchen      ?? 0;
    document.getElementById('statMinutes').textContent = userData.minuten      ?? 0;
    document.getElementById('statYellow').textContent  = userData.geelKaarten  ?? 0;
    document.getElementById('statRed').textContent     = userData.roodKaarten  ?? 0;

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

// ── Profieldata laden (met cache) ─────────────────────────────────────────────

async function loadProfile(targetUid) {
    // 1. Probeer cache eerst
    const cached = cacheGet('profile', targetUid, CACHE_TTL_PROFILE);
    if (cached) {
        console.log('[cache] profiel geladen uit localStorage voor', targetUid);
        profileDocId = cached._docId;
        fillProfile(cached);
        showOnly('playerProfile');
        // Laad geschiedenis ook uit cache (of Firestore als cache leeg/verlopen)
        loadMatchHistory(targetUid);
        return;
    }

    // 2. Cache miss — haal op uit Firestore
    console.log('[firestore] profiel ophalen voor', targetUid);
    const q    = query(collection(db, 'users'), where('uid', '==', targetUid));
    const snap = await getDocs(q);

    if (snap.empty) {
        showOnly('stateNotFound');
        return;
    }

    profileDocId    = snap.docs[0].id;
    const userData  = { uid: targetUid, _docId: profileDocId, ...snap.docs[0].data() };

    // Sla op in cache
    cacheSet('profile', targetUid, userData);

    fillProfile(userData);
    showOnly('playerProfile');
    loadMatchHistory(targetUid);
}

// ── Wedstrijdgeschiedenis (met cache) ─────────────────────────────────────────

async function loadMatchHistory(targetUid) {
    const container = document.getElementById('matchHistoryContainer');
    if (!container) return;

    // 1. Probeer cache eerst
    const cached = cacheGet('history', targetUid, CACHE_TTL_HISTORY);
    if (cached) {
        console.log('[cache] wedstrijdgeschiedenis geladen uit localStorage voor', targetUid);
        if (cached.length === 0) renderNoHistory(container);
        else renderMatchHistory(cached, container);
        return;
    }

    // 2. Cache miss — haal op uit Firestore
    console.log('[firestore] wedstrijdgeschiedenis ophalen voor', targetUid);
    try {
        const matchesSnap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'finished')
        ));

        if (matchesSnap.empty) {
            cacheSet('history', targetUid, []);
            renderNoHistory(container);
            return;
        }

        const allMatches = [];
        matchesSnap.forEach(d => allMatches.push({ id: d.id, ...d.data() }));
        allMatches.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));

        const recentMatches = [];
        for (const matchDoc of allMatches) {
            if (recentMatches.length >= 3) break;

            const availDoc = await getDocs(
                query(
                    collection(db, 'matches', matchDoc.id, 'availability'),
                    where('available', '==', true)
                )
            );

            const wasPresent = availDoc.docs.some(d =>
                d.id === targetUid || d.data().uid === targetUid
            );
            if (wasPresent) recentMatches.push(matchDoc);
        }

        // Sla resultaat op in cache (ook als leeg, om herhaalde lege queries te vermijden)
        cacheSet('history', targetUid, recentMatches);

        if (recentMatches.length === 0) renderNoHistory(container);
        else renderMatchHistory(recentMatches, container);

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

        let resultClass = 'draw', resultLabel = 'G';
        if (typeof scoreOns === 'number' && typeof scoreOpp === 'number') {
            if (scoreOns > scoreOpp)      { resultClass = 'win';  resultLabel = 'W'; }
            else if (scoreOns < scoreOpp) { resultClass = 'loss'; resultLabel = 'V'; }
        }

        let datumStr = match.datum || '';
        try {
            if (datumStr) {
                const d = new Date(datumStr + 'T00:00:00');
                datumStr = d.toLocaleDateString('nl-BE', {
                    day: 'numeric', month: 'long', year: 'numeric'
                });
            }
        } catch (_) {}

        const card = document.createElement('div');
        card.className = `match-history-card ${resultClass}`;
        card.innerHTML = `
            <div class="match-result-badge ${resultClass}">${resultLabel}</div>
            <div class="match-history-info">
                <div class="match-history-teams">
                    ${match.thuisploeg} &mdash; ${match.uitploeg}
                </div>
                <div class="match-history-meta">${datumStr}${match.team ? ' &middot; ' + capitalize(match.team) : ''}</div>
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
        const params    = new URLSearchParams(window.location.search);
        const targetUid = params.get('uid') || user.uid;
        isOwnProfile    = targetUid === user.uid;

        // Bij eigen profiel: invalideer de profielcache na een wedstrijd.
        // Controle: als de cache ouder is dan de TTL wordt hij sowieso ververst.
        // Extra forceer-refresh als URL-param ?refresh=1 aanwezig is
        // (live.js kan dit toevoegen na wedstrijdeinde).
        if (params.get('refresh') === '1') {
            cacheInvalidate('profile', targetUid);
            cacheInvalidate('history', targetUid);
        }

        await loadProfile(targetUid);

    } catch (err) {
        console.error('Fout bij laden profiel:', err);
        showOnly('stateNotFound');
    }
});
