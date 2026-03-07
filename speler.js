// ===============================================
// SPELERSPROFIEL - speler.js
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import {
    onAuthStateChanged,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword,
    sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
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

// Detecteer page refresh → negeer localStorage cache zodat verse data geladen wordt
const PAGE_REFRESHED = (() => {
    try {
        const nav = performance.getEntriesByType?.('navigation')?.[0];
        if (nav?.type === 'reload') {
            if (!sessionStorage.getItem('vvs_refreshed')) {
                sessionStorage.setItem('vvs_refreshed', '1');
                return true;
            }
        } else {
            sessionStorage.removeItem('vvs_refreshed');
        }
    } catch (_) {}
    return false;
})();
function cacheGet(type, uid, ttl) {
    if (PAGE_REFRESHED) return null;
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

// ── Wachtwoord wijzigen ───────────────────────────────────────────────────────

function showPasswordSection() {
    const title = document.getElementById('passwordSectionTitle');
    const card  = document.getElementById('passwordCard');
    if (title) title.style.display = '';
    if (card)  card.style.display  = '';
}

function setPasswordStatus(elId, type, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.display = 'block';
    el.className = `password-status ${type}`;
    el.textContent = msg;
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// Toon/verberg wachtwoord knoppen
document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        const eyeOpen   = btn.querySelector('.eye-open');
        const eyeClosed = btn.querySelector('.eye-closed');
        if (eyeOpen && eyeClosed) {
            eyeOpen.style.display   = isPassword ? 'none'  : '';
            eyeClosed.style.display = isPassword ? ''      : 'none';
        }
    });
});

// Wachtwoord opslaan
const savePasswordBtn = document.getElementById('savePasswordBtn');
if (savePasswordBtn) {
    savePasswordBtn.addEventListener('click', async () => {
        const current  = document.getElementById('currentPassword').value;
        const newPw    = document.getElementById('newPassword').value;
        const confirm  = document.getElementById('confirmPassword').value;

        if (!current || !newPw || !confirm) {
            setPasswordStatus('passwordStatus', 'error', 'Vul alle velden in.');
            return;
        }
        if (newPw.length < 6) {
            setPasswordStatus('passwordStatus', 'error', 'Nieuw wachtwoord moet minimaal 6 tekens bevatten.');
            return;
        }
        if (newPw !== confirm) {
            setPasswordStatus('passwordStatus', 'error', 'De twee nieuwe wachtwoorden komen niet overeen.');
            return;
        }

        savePasswordBtn.disabled = true;
        savePasswordBtn.textContent = 'Bezig…';

        try {
            const user       = auth.currentUser;
            const credential = EmailAuthProvider.credential(user.email, current);

            // Herverificatie vereist door Firebase voor gevoelige acties
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPw);

            // Velden leegmaken
            ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

            setPasswordStatus('passwordStatus', 'success', '✅ Wachtwoord succesvol gewijzigd!');
        } catch (err) {
            console.error('Password update error:', err);
            let msg = 'Er ging iets mis. Probeer opnieuw.';
            if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                msg = 'Huidig wachtwoord is incorrect.';
            } else if (err.code === 'auth/too-many-requests') {
                msg = 'Te veel pogingen. Probeer later opnieuw of gebruik de reset-link.';
            } else if (err.code === 'auth/weak-password') {
                msg = 'Nieuw wachtwoord is te zwak. Kies een sterker wachtwoord.';
            }
            setPasswordStatus('passwordStatus', 'error', msg);
        } finally {
            savePasswordBtn.disabled = false;
            savePasswordBtn.textContent = '🔒 Wachtwoord opslaan';
        }
    });
}

// Reset-link via e-mail
const sendResetEmailBtn = document.getElementById('sendResetEmailBtn');
let resetEmailCooldown = 0; // timestamp waarop cooldown eindigt

if (sendResetEmailBtn) {
    sendResetEmailBtn.addEventListener('click', async () => {
        // Check cooldown
        const remaining = Math.ceil((resetEmailCooldown - Date.now()) / 1000);
        if (remaining > 0) {
            setPasswordStatus('resetEmailStatus', 'error', `Wacht nog ${remaining} seconden voor je opnieuw een reset-link aanvraagt.`);
            return;
        }

        const user = auth.currentUser;
        if (!user?.email) {
            setPasswordStatus('resetEmailStatus', 'error', 'Geen e-mailadres gevonden.');
            return;
        }

        sendResetEmailBtn.disabled = true;
        sendResetEmailBtn.textContent = 'Bezig…';

        try {
            await sendPasswordResetEmail(auth, user.email);
            resetEmailCooldown = Date.now() + 30_000;
            setPasswordStatus('resetEmailStatus', 'success',
                `✅ Reset-link verstuurd naar ${user.email}. Controleer ook je spam.`);

            // Countdown on button
            let secs = 30;
            const interval = setInterval(() => {
                secs--;
                if (secs <= 0) {
                    clearInterval(interval);
                    sendResetEmailBtn.disabled = false;
                    sendResetEmailBtn.textContent = '📧 Reset-link sturen naar mijn e-mail';
                } else {
                    sendResetEmailBtn.textContent = `⏳ Opnieuw sturen (${secs}s)`;
                }
            }, 1000);

        } catch (err) {
            console.error('Reset email error:', err.code, err.message);
            let msg = `Fout (${err.code}): ${err.message}`;
            if (err.code === 'auth/unauthorized-continue-uri' || err.code === 'auth/invalid-continue-uri') {
                msg = 'Domein niet toegestaan. Voeg je domein toe onder Authentication → Settings → Authorized domains.';
            } else if (err.code === 'auth/too-many-requests') {
                msg = 'Te veel pogingen. Probeer later opnieuw.';
            } else if (err.code === 'auth/network-request-failed') {
                msg = 'Netwerkfout. Controleer je internetverbinding.';
            } else if (err.code === 'auth/user-not-found') {
                msg = 'Geen account gevonden met dit e-mailadres.';
            }
            setPasswordStatus('resetEmailStatus', 'error', msg);
            sendResetEmailBtn.disabled = false;
            sendResetEmailBtn.textContent = '📧 Reset-link sturen naar mijn e-mail';
        }
    });
}

// ── Profieldata laden (met cache) ─────────────────────────────────────────────

async function loadProfile(targetUid) {
    // 1. Probeer cache eerst
    const cached = cacheGet('profile', targetUid, CACHE_TTL_PROFILE);
    if (cached) {
        console.log('[cache] profiel geladen uit localStorage voor', targetUid);
        profileDocId = cached._docId;
        fillProfile(cached);
        showOnly('playerProfile');
        if (isOwnProfile) showPasswordSection();
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
    if (isOwnProfile) showPasswordSection();
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
