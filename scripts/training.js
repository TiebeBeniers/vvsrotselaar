// ===============================================
// TRAINING.JS — Trainingsplanning
// V.V.S Rotselaar
//
// Firestore structuur:
//   trainingen/{id} → {
//     titel, team, datum (YYYY-MM-DD), startTijd, eindTijd,
//     locatie, nota, aanwezigen: [{ uid, naam }]
//   }
//
// Aanwezigheid:
//   - Ingelogde leden kunnen zich aan/afmelden
//   - Admin kan trainingen aanmaken/bewerken (in admin2.html)
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, getDocs, doc, setDoc, onSnapshot, orderBy
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── State ──────────────────────────────────────────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let trainingen      = [];          // all loaded for current week
let currentFilter   = 'all';
let currentWeekStart = getMonday(new Date());
let unsubTrainingen  = null;

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    const authGuard = document.getElementById('authGuard');
    const loading   = document.getElementById('trainingLoading');
    const main      = document.getElementById('trainingMain');

    if (user) {
        if (loginLink) loginLink.textContent = 'PROFIEL';
        currentUser = user;

        try {
            const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!snap.empty) currentUserData = snap.docs[0].data();
        } catch (_) {}

        loading.style.display = 'none';
        main.style.display    = 'block';
        initWeekNav();
        listenTrainingen();
    } else {
        currentUser = null; currentUserData = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
        loading.style.display = 'none';
        authGuard.style.display = 'flex';
    }
});

// ── Week helpers ──────────────────────────────────────────────────────────────
function getMonday(d) {
    const dt = new Date(d);
    const day = dt.getDay() || 7;
    dt.setDate(dt.getDate() - day + 1);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function isoDate(d) {
    return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}

function formatWeekLabel(monday) {
    const sunday = addDays(monday, 6);
    return monday.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })
        + ' – '
        + sunday.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Week navigation ───────────────────────────────────────────────────────────
function initWeekNav() {
    document.getElementById('weekLabel').textContent = formatWeekLabel(currentWeekStart);

    document.getElementById('prevWeekBtn').addEventListener('click', () => {
        currentWeekStart = addDays(currentWeekStart, -7);
        document.getElementById('weekLabel').textContent = formatWeekLabel(currentWeekStart);
        listenTrainingen();
    });

    document.getElementById('nextWeekBtn').addEventListener('click', () => {
        currentWeekStart = addDays(currentWeekStart, 7);
        document.getElementById('weekLabel').textContent = formatWeekLabel(currentWeekStart);
        listenTrainingen();
    });

    document.querySelectorAll('.tr-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tr-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.team;
            renderCalendar();
        });
    });
}

// ── Firestore listener ────────────────────────────────────────────────────────
function listenTrainingen() {
    if (unsubTrainingen) unsubTrainingen();

    const weekEnd = isoDate(addDays(currentWeekStart, 6));
    const weekStart = isoDate(currentWeekStart);

    unsubTrainingen = onSnapshot(
        query(
            collection(db, 'trainingen'),
            where('datum', '>=', weekStart),
            where('datum', '<=', weekEnd),
            orderBy('datum', 'asc')
        ),
        snap => {
            trainingen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderCalendar();
        },
        err => { console.error('Trainingen error:', err); }
    );
}

// ── Render calendar ───────────────────────────────────────────────────────────
const DAY_NAMES = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const TEAM_COLOR = {
    veteranen: '#0047AB',
    zaterdag:  '#28A745',
    zondag:    '#DC3545',
    all:       '#666',
};

function renderCalendar() {
    const cal       = document.getElementById('trainingCalendar');
    const noSection = document.getElementById('noTrainings');
    cal.innerHTML   = '';

    const filtered = currentFilter === 'all'
        ? trainingen
        : trainingen.filter(t => t.team === currentFilter);

    if (filtered.length === 0) {
        noSection.style.display = 'block';
        return;
    }
    noSection.style.display = 'none';

    // Group by date
    const byDate = {};
    filtered.forEach(t => {
        if (!byDate[t.datum]) byDate[t.datum] = [];
        byDate[t.datum].push(t);
    });

    Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).forEach(([datum, items]) => {
        const d       = new Date(datum + 'T12:00');
        const dayName = DAY_NAMES[d.getDay() === 0 ? 6 : d.getDay() - 1];
        const dateFmt = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' });

        const dayCol = document.createElement('div');
        dayCol.className = 'tr-day-column';

        dayCol.innerHTML = `
            <div class="tr-day-header">
                <span class="tr-day-name">${dayName}</span>
                <span class="tr-day-date">${dateFmt}</span>
            </div>
            <div class="tr-day-sessions" id="sessions-${datum}"></div>`;

        cal.appendChild(dayCol);

        const sessionsEl = dayCol.querySelector(`#sessions-${datum}`);
        items.forEach(t => sessionsEl.appendChild(buildTrainingCard(t)));
    });
}

function buildTrainingCard(t) {
    const card = document.createElement('div');
    card.className = 'tr-session-card';
    card.style.setProperty('--team-color', TEAM_COLOR[t.team] || '#0047AB');

    const aanwezigen  = t.aanwezigen || [];
    const isSigned    = aanwezigen.some(p => p.uid === currentUser?.uid);
    const teamLabel   = { veteranen: 'Veteranen', zaterdag: 'Zaterdag', zondag: 'Zondag' }[t.team] || t.team;
    const tijdLabel   = [t.startTijd, t.eindTijd].filter(Boolean).join(' – ');

    card.innerHTML = `
        <div class="tr-card-header">
            <span class="tr-card-time">${tijdLabel}</span>
            <span class="tr-card-team-badge" style="background:var(--team-color)">${teamLabel}</span>
        </div>
        <div class="tr-card-titel">${t.titel || 'Training'}</div>
        ${t.locatie ? `<div class="tr-card-locatie">📍 ${t.locatie}</div>` : ''}
        ${t.nota ? `<div class="tr-card-nota">${t.nota}</div>` : ''}
        <div class="tr-card-aanwezigen">
            <span class="tr-aanwezigen-count">${aanwezigen.length} aanwezig${aanwezigen.length !== 1 ? '' : ''}</span>
            <div class="tr-aanwezigen-list">${aanwezigen.map(p =>
                `<span class="tr-aanwezig-chip${p.uid === currentUser?.uid ? ' me' : ''}">${p.naam}</span>`
            ).join('')}</div>
        </div>
        <button class="tr-aanmeld-btn ${isSigned ? 'signed' : ''}" data-id="${t.id}">
            ${isSigned ? '✓ Aangemeld' : 'Aanmelden'}
        </button>`;

    card.querySelector('.tr-aanmeld-btn').addEventListener('click', () => toggleAanwezigheid(t));
    return card;
}

// ── Toggle aanwezigheid ───────────────────────────────────────────────────────
async function toggleAanwezigheid(training) {
    if (!currentUser || !currentUserData) {
        showToast('Je moet ingelogd zijn.', 'error'); return;
    }

    const naam       = currentUserData.naam || currentUserData.email || 'Lid';
    const aanwezigen = [...(training.aanwezigen || [])];
    const idx        = aanwezigen.findIndex(p => p.uid === currentUser.uid);

    if (idx === -1) {
        aanwezigen.push({ uid: currentUser.uid, naam });
    } else {
        aanwezigen.splice(idx, 1);
    }

    try {
        await setDoc(doc(db, 'trainingen', training.id), { aanwezigen }, { merge: true });
        showToast(idx === -1 ? '✅ Aangemeld!' : '↩️ Afgemeld.', 'success');
    } catch (e) {
        showToast('❌ Fout: ' + e.message, 'error'); console.error(e);
    }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('trToast');
    if (!t) return;
    t.textContent = msg;
    t.className   = 'tr-toast show' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'tr-toast'; }, 3000);
}
