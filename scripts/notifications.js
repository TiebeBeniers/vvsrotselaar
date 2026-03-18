// ===============================================
// NOTIFICATIONS.JS
// V.V.S Rotselaar – Beschikbaarheidsherinneringen
//
// Controleert bij inloggen of de gebruiker nog beschikbaarheid
// moet invullen voor wedstrijden binnen de komende 72 uur.
// Toont een niet-opdringerige banner onderaan de pagina.
//
// Voeg toe aan elke pagina waar spelers ingelogd zijn:
//   <script type="module" src="scripts/notifications.js"></script>
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, getDoc, doc }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const DISMISSED_KEY  = 'vvs_notif_dismissed'; // { matchId: timestamp }
const CHECK_INTERVAL = 60 * 60 * 1000;         // Max 1x per uur controleren
const LAST_CHECK_KEY = 'vvs_notif_last_check';
const WINDOW_HOURS   = 72;

// ── Dismiss-cache: per match bijhouden (24u) ─────────────────────────────────
function isDismissed(matchId) {
    try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        if (!raw) return false;
        const map = JSON.parse(raw);
        const ts  = map[matchId];
        if (!ts) return false;
        // Dismissed vervalt na 24u (zodat herinnering terugkomt als niet ingevuld)
        return Date.now() - ts < 24 * 60 * 60 * 1000;
    } catch (_) { return false; }
}

function dismissMatch(matchId) {
    try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        const map = raw ? JSON.parse(raw) : {};
        map[matchId] = Date.now();
        // Opruimen: verwijder oude entries
        Object.keys(map).forEach(k => {
            if (Date.now() - map[k] > 48 * 60 * 60 * 1000) delete map[k];
        });
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
    } catch (_) {}
}

// ── Rate limiting: niet elke pageload een Firestore-read ─────────────────────
function shouldCheck() {
    try {
        const last = parseInt(localStorage.getItem(LAST_CHECK_KEY) || '0');
        return Date.now() - last > CHECK_INTERVAL;
    } catch (_) { return true; }
}

function markChecked() {
    try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch (_) {}
}

// ── Banner bouwen en tonen ────────────────────────────────────────────────────
function showBanner(matches) {
    document.getElementById('notifBanner')?.remove();

    const TEAM_PAGES = {
        zaterdag:  'zaterdag.html',
        zondag:    'zondag.html',
        veteranen: 'veteranen.html'
    };
    const TEAM_LABELS = {
        zaterdag:  'Zaterdag',
        zondag:    'Zondag',
        veteranen: 'Veteranen'
    };

    const banner = document.createElement('div');
    banner.className = 'notif-banner';
    banner.id = 'notifBanner';

    const matchCards = matches.map(m => {
        const dt      = new Date(`${m.datum}T${m.uur || '00:00'}`);
        const dag     = dt.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
        const uur     = m.uur || '';
        const pagina  = TEAM_PAGES[m.team] || 'index.html';
        const ploeg   = TEAM_LABELS[m.team] || m.team || '';
        const uren    = Math.round((dt - Date.now()) / 3_600_000);
        const urgency = uren <= 24 ? '🔴' : '🟡';
        return `
            <div class="notif-match-card">
                <div class="notif-match-top">
                    <span class="notif-urgency">${urgency}</span>
                    <span class="notif-match-teams">${m.thuisploeg} – ${m.uitploeg}</span>
                </div>
                <div class="notif-match-meta">
                    <span class="notif-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        ${dag}
                    </span>
                    ${uur ? `<span class="notif-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        ${uur}
                    </span>` : ''}
                    <span class="notif-meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                        ${ploeg}
                    </span>
                </div>
                <a class="notif-match-btn" href="${pagina}#nextMatchSection">Beschikbaarheid invullen →</a>
            </div>`;
    }).join('');

    banner.innerHTML = `
        <div class="notif-banner-header">
            <div class="notif-banner-title-row">
                <span class="notif-banner-icon">🔔</span>
                <span class="notif-banner-title">Beschikbaarheid nog niet ingevuld</span>
                <button class="notif-banner-close" id="notifClose" title="Sluiten">✕</button>
            </div>
            <p class="notif-banner-text">Je hebt binnenkort een wedstrijd, vul je beschikbaarheid in.</p>
            <div class="notif-banner-matches">${matchCards}</div>
        </div>`;

    document.body.appendChild(banner);

    // Slide in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => banner.classList.add('visible'));
    });

    // Sluiten
    document.getElementById('notifClose').addEventListener('click', () => {
        banner.classList.remove('visible');
        matches.forEach(m => dismissMatch(m.id));
        setTimeout(() => banner.remove(), 400);
    });

    // Auto-hide na 12 seconden
    setTimeout(() => {
        if (banner.isConnected) banner.classList.remove('visible');
    }, 12_000);
}

// ── Hoofdlogica ───────────────────────────────────────────────────────────────
async function checkAvailability(user) {
    if (!shouldCheck()) return;
    markChecked();

    try {
        // Haal het gebruikersprofiel op (team + naam)
        const usersSnap = await getDocs(
            query(collection(db, 'users'), where('uid', '==', user.uid))
        );
        if (usersSnap.empty) return;

        const userData = usersSnap.docs[0].data();
        const team = userData.categorie || userData.team;
        if (!team) return;

        // Wedstrijden binnen de komende 72u (status = planned)
        const now       = new Date();
        const cutoff    = new Date(now.getTime() + WINDOW_HOURS * 3_600_000);
        const todayStr  = now.toISOString().slice(0, 10);   // 'YYYY-MM-DD'
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        const matchSnap = await getDocs(
            query(
                collection(db, 'matches'),
                where('team',   '==', team),
                where('status', '==', 'planned'),
                where('datum',  '>=', todayStr),
                where('datum',  '<=', cutoffStr)
            )
        );

        if (matchSnap.empty) return;

        // Filter: alleen wedstrijden die echt binnen 72u zijn (tijdscheck)
        // én waarvoor de gebruiker geen beschikbaarheid heeft ingevuld
        const missing = [];

        for (const matchDoc of matchSnap.docs) {
            const m  = { id: matchDoc.id, ...matchDoc.data() };
            const dt = new Date(`${m.datum}T${m.uur || '00:00'}`);

            // Strikte tijdcheck (datum-filter is soms een dag ruimer)
            if (dt <= now || dt > cutoff) continue;

            // Al gedismissed?
            if (isDismissed(m.id)) continue;

            // Beschikbaarheid al ingevuld?
            const avRef  = doc(db, 'matches', m.id, 'availability', user.uid);
            const avSnap = await getDoc(avRef);
            if (!avSnap.exists()) {
                missing.push(m);
            }
        }

        if (missing.length > 0) {
            showBanner(missing);
        }

    } catch (err) {
        // Stille fout — notificaties zijn niet kritiek
        console.warn('Notificatiecheck mislukt:', err);
    }
}

// ── Auth listener ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Kleine vertraging zodat de pagina eerst laadt
        setTimeout(() => checkAvailability(user), 2000);
    } else {
        document.getElementById('notifBanner')?.remove();
    }
});
