// ===============================================
// WERKLIJST.JS – Rock Werchter Shiften
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, doc, setDoc, onSnapshot,
    query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Data Definitions ─────────────────────────────────────────────────────────

const FESTIVAL_DAYS = [
    { id: 'do_2jul', label: 'Donderdag', date: '2 juli',  calDate: '20260702' },
    { id: 'vr_3jul', label: 'Vrijdag',   date: '3 juli',  calDate: '20260703' },
    { id: 'za_4jul', label: 'Zaterdag',  date: '4 juli',  calDate: '20260704' },
    { id: 'zo_5jul', label: 'Zondag',    date: '5 juli',  calDate: '20260705' },
];

// startH/endH in 24h; overnightEnd = true means end is next calendar day
const SHIFT_SLOTS = [
    { suffix: 'shift1', time: '08:00 – 14:00', max: 3, startH: '080000', endH: '140000', overnightEnd: false },
    { suffix: 'shift2', time: '14:00 – 19:00', max: 5, startH: '140000', endH: '190000', overnightEnd: false },
    { suffix: 'shift3', time: '19:00 – 00:00', max: 5, startH: '190000', endH: '000000', overnightEnd: true  },
    { suffix: 'shift4', time: '00:00 – 06:00', max: 5, startH: '000000', endH: '060000', overnightEnd: false },
];

const SPECIAL_SHIFTS = [
    {
        id:        'opbouw_30jun',
        label:     'Opbouw',
        date:      'Dinsdag 30 juni',
        time:      'Vanaf 18:00',
        note:      'Einduur niet bepaald – kan uitlopen',
        isSpecial: true,
        calDate:   '20260630', calStart: '180000', calEnd: '220000',
    },
    {
        id:        'inrichting_1jul',
        label:     'Inrichting tent',
        date:      'Woensdag 1 juli',
        time:      'Vanaf 09:00',
        note:      'Einduur niet bepaald – kan uitlopen',
        isSpecial: true,
        calDate:   '20260701', calStart: '090000', calEnd: '170000',
    },
    {
        id:        'afbouw_7jul',
        label:     'Afbouw & Opruim',
        date:      'Maandag 7 juli',
        time:      'Vanaf 16:00',
        note:      'Einduur niet bepaald – kan uitlopen',
        isSpecial: true,
        calDate:   '20260707', calStart: '160000', calEnd: '200000',
    },
];

// ── State ─────────────────────────────────────────────────────────────────────

let currentUser     = null;
let currentUserData = null;
let shiftsData      = {};      // shiftId → { persons: [...] }
let pendingShiftId  = null;
let unsubShifts     = null;
let toastTimer      = null;

// ── Auth ──────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
    document.getElementById('loadingSpinner').style.display = 'none';

    if (!user) {
        document.getElementById('authGuard').style.display = 'flex';
        document.getElementById('loginLink').textContent   = 'LOGIN';
        return;
    }

    currentUser = user;

    try {
        const snap = await getDocs(
            query(collection(db, 'users'), where('uid', '==', user.uid))
        );
        if (!snap.empty) {
            currentUserData = snap.docs[0].data();
            document.getElementById('loginLink').textContent = 'PROFIEL';
        }
    } catch (e) {
        console.error('User load error:', e);
    }

    document.getElementById('mainContent').style.display = 'block';
    buildSchedule();
    listenToShifts();
});

// ── Firestore listener ────────────────────────────────────────────────────────

function listenToShifts() {
    if (unsubShifts) unsubShifts();

    unsubShifts = onSnapshot(
        collection(db, 'werchter_shifts'),
        (snapshot) => {
            shiftsData = {};
            snapshot.forEach(d => { shiftsData[d.id] = d.data(); });
            renderAll();
        },
        (err) => {
            console.error('Shifts listener error:', err);
            showToast('Fout bij laden van shiften: ' + err.message, 'error');
        }
    );
}

// ── Build DOM (runs once after auth) ─────────────────────────────────────────

function buildSchedule() {
    // Festival grid
    const fGrid = document.getElementById('festivalGrid');
    fGrid.innerHTML = FESTIVAL_DAYS.map(day => `
        <div class="wl-day-column">
            <div class="wl-day-header wl-collapsible" id="hdr-${day.id}">
                <div class="wl-day-header-inner">
                    <div class="day-name">${day.label}</div>
                    <div class="day-date">${day.date}</div>
                </div>
                <span class="wl-collapse-icon">&#9650;</span>
            </div>
            <div class="wl-day-shifts" id="shifts-${day.id}">
                ${SHIFT_SLOTS.map(slot => {
                    const id = `${day.id}_${slot.suffix}`;
                    return `
                    <div class="wl-shift-card" id="card-${id}">
                        <div class="wl-shift-time">${slot.time}</div>
                        <div class="wl-shift-capacity">
                            <span id="cap-${id}">0/${slot.max}</span>
                            <div class="wl-cap-bar">
                                <div class="wl-cap-bar-fill" id="bar-${id}" style="width:0%"></div>
                            </div>
                        </div>
                        <div class="wl-shift-people" id="people-${id}"></div>
                        <button class="wl-btn btn-sign-in" id="btn-${id}">Aanmelden</button>
                    </div>`;
                }).join('')}
            </div>
        </div>
    `).join('');

    // Special grid
    const sGrid = document.getElementById('specialGrid');
    sGrid.innerHTML = SPECIAL_SHIFTS.map(s => `
        <div class="wl-day-column">
            <div class="wl-day-header">
                <div class="day-name">${s.label}</div>
                <div class="day-date">${s.date}</div>
            </div>
            <div class="wl-day-shifts">
                <div class="wl-shift-card" id="card-${s.id}">
                    <div class="wl-shift-time">${s.time}</div>
                    <p class="wl-shift-note">${s.note}</p>
                    <div class="wl-shift-people" id="people-${s.id}"></div>
                    <button class="wl-btn btn-sign-in" id="btn-${s.id}">Aanmelden</button>
                </div>
            </div>
        </div>
    `).join('');

    // Attach click listeners to every shift card & button
    getAllShiftDefs().forEach(({ id }) => {
        const card = document.getElementById(`card-${id}`);
        const btn  = document.getElementById(`btn-${id}`);

        if (card) card.addEventListener('click', () => handleClick(id));
        if (btn)  btn.addEventListener('click', (e) => {
            e.stopPropagation();   // prevent card click firing as well
            handleClick(id);
        });
    });

    // Collapse toggle – only meaningful on mobile (CSS hides icon on desktop)
    FESTIVAL_DAYS.forEach(day => {
        const hdr    = document.getElementById(`hdr-${day.id}`);
        const shifts = document.getElementById(`shifts-${day.id}`);
        if (!hdr || !shifts) return;
        hdr.addEventListener('click', () => {
            const collapsed = shifts.classList.toggle('wl-collapsed');
            hdr.classList.toggle('wl-header-collapsed', collapsed);
        });
    });
}

// Helper – flat list of all shift definitions
function getAllShiftDefs() {
    const festival = FESTIVAL_DAYS.flatMap(day =>
        SHIFT_SLOTS.map(slot => ({ id: `${day.id}_${slot.suffix}`, max: slot.max }))
    );
    const special = SPECIAL_SHIFTS.map(s => ({ id: s.id, max: null }));
    return [...festival, ...special];
}

// ── Render (called on every Firestore update) ─────────────────────────────────

function renderAll() {
    FESTIVAL_DAYS.forEach(day => {
        SHIFT_SLOTS.forEach(slot => {
            renderCard(`${day.id}_${slot.suffix}`, slot.max);
        });
    });
    SPECIAL_SHIFTS.forEach(s => renderCard(s.id, null));
}

function renderCard(shiftId, max) {
    const persons  = shiftsData[shiftId]?.persons || [];
    const card     = document.getElementById(`card-${shiftId}`);
    const peopleEl = document.getElementById(`people-${shiftId}`);
    const btn      = document.getElementById(`btn-${shiftId}`);

    if (!card || !peopleEl || !btn) return;

    const isSigned = persons.some(p => p.uid === currentUser?.uid);
    const isFull   = max !== null && persons.length >= max;

    // Card state classes
    card.className = [
        'wl-shift-card',
        isSigned ? 'is-signed' : '',
        isFull   ? 'is-full'   : '',
    ].filter(Boolean).join(' ');

    // Capacity bar (festival shifts only)
    const capEl = document.getElementById(`cap-${shiftId}`);
    const barEl = document.getElementById(`bar-${shiftId}`);
    if (capEl && barEl && max !== null) {
        capEl.textContent  = `${persons.length}/${max}`;
        barEl.style.width  = Math.min(100, (persons.length / max) * 100) + '%';
        barEl.className    = 'wl-cap-bar-fill' + (isFull ? ' full' : '');
    }

    // Name list (vertical)
    peopleEl.innerHTML = persons.map(p => {
        const isMe = p.uid === currentUser?.uid;
        const cls  = p.responsible
            ? 'wl-person chip-responsible'
            : (isMe ? 'wl-person chip-me' : 'wl-person');
        return `<div class="${cls}">${p.responsible ? '★ ' : ''}${p.naam}</div>`;
    }).join('');

    // Button label & style
    if (isSigned) {
        btn.className   = 'wl-btn btn-sign-out';
        btn.textContent = 'Afmelden';
    } else {
        btn.className   = 'wl-btn btn-sign-in';
        btn.textContent = isFull ? 'Toch aanmelden' : 'Aanmelden';
        // Remove calendar button if user is no longer signed in
        removeCalendarButton(shiftId);
    }
}

// ── Interaction ───────────────────────────────────────────────────────────────

function isSpecialShift(shiftId) {
    return SPECIAL_SHIFTS.some(s => s.id === shiftId);
}

function handleClick(shiftId) {
    if (!currentUser) return;

    const persons  = shiftsData[shiftId]?.persons || [];
    const isSigned = persons.some(p => p.uid === currentUser.uid);

    if (isSigned) {
        removeFromShift(shiftId);
        return;
    }

    // Special shifts (opbouw/afbouw) never ask about responsible
    if (isSpecialShift(shiftId)) {
        addToShift(shiftId, false);
        return;
    }

    const hasResponsible = persons.some(p => p.responsible);
    if (hasResponsible) {
        addToShift(shiftId, false);
    } else {
        pendingShiftId = shiftId;
        document.getElementById('modalBackdrop').classList.add('active');
    }
}

async function addToShift(shiftId, asResponsible) {
    if (!currentUser || !currentUserData) return;

    const naam     = currentUserData.naam || currentUserData.email || 'Vrijwilliger';
    const existing = shiftsData[shiftId]?.persons || [];

    if (existing.some(p => p.uid === currentUser.uid)) return;

    const updated = [...existing, {
        uid:         currentUser.uid,
        naam:        naam,
        responsible: asResponsible,
    }];

    try {
        await setDoc(doc(db, 'werchter_shifts', shiftId), { persons: updated }, { merge: true });
        showToast(
            asResponsible
                ? '✅ Ingeschreven als verantwoordelijke!'
                : '✅ Ingeschreven voor shift!',
            'success'
        );
        showCalendarButton(shiftId);
    } catch (e) {
        console.error('addToShift error:', e);
        showToast('❌ Fout bij aanmelden: ' + e.message, 'error');
    }
}

async function removeFromShift(shiftId) {
    if (!currentUser) return;

    const updated = (shiftsData[shiftId]?.persons || [])
        .filter(p => p.uid !== currentUser.uid);

    try {
        await setDoc(doc(db, 'werchter_shifts', shiftId), { persons: updated }, { merge: true });
        showToast('↩️ Afgemeld voor shift.', 'success');
    } catch (e) {
        console.error('removeFromShift error:', e);
        showToast('❌ Fout bij afmelden: ' + e.message, 'error');
    }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function closeModal() {
    document.getElementById('modalBackdrop').classList.remove('active');
    pendingShiftId = null;
}

document.getElementById('btnYesResponsible').addEventListener('click', () => {
    // Capture BEFORE closeModal resets pendingShiftId
    const shiftId = pendingShiftId;
    closeModal();
    if (shiftId) addToShift(shiftId, true);
});

document.getElementById('btnNoResponsible').addEventListener('click', () => {
    // Capture BEFORE closeModal resets pendingShiftId
    const shiftId = pendingShiftId;
    closeModal();
    if (shiftId) addToShift(shiftId, false);
});

document.getElementById('btnModalCancel').addEventListener('click', closeModal);

document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});

// ── Calendar ──────────────────────────────────────────────────────────────────

function showCalendarButton(shiftId) {
    const btn = document.getElementById(`btn-${shiftId}`);
    if (!btn) return;

    // Insert calendar button right after the action button
    const existing = document.getElementById(`cal-${shiftId}`);
    if (existing) return; // already shown

    const calBtn = document.createElement('button');
    calBtn.className = 'wl-btn btn-calendar';
    calBtn.id        = `cal-${shiftId}`;
    calBtn.innerHTML = '📅 Toevoegen aan agenda';
    calBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadICS(shiftId);
    });

    btn.parentNode.insertBefore(calBtn, btn.nextSibling);
}

function removeCalendarButton(shiftId) {
    const calBtn = document.getElementById(`cal-${shiftId}`);
    if (calBtn) calBtn.remove();
}

function addDays(dateStr, days) {
    // dateStr = 'YYYYMMDD', returns 'YYYYMMDD'
    const y = parseInt(dateStr.slice(0, 4));
    const m = parseInt(dateStr.slice(4, 6)) - 1;
    const d = parseInt(dateStr.slice(6, 8));
    const dt = new Date(y, m, d + days);
    const pad = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}

function downloadICS(shiftId) {
    let title, dtStart, dtEnd, description;

    // Festival shift?
    let found = false;
    outer: for (const day of FESTIVAL_DAYS) {
        for (const slot of SHIFT_SLOTS) {
            const id = `${day.id}_${slot.suffix}`;
            if (id !== shiftId) continue;

            // The 00:00–06:00 shift: start date is the NEXT calendar day
            const startDate = slot.startH === '000000'
                ? addDays(day.calDate, 1)
                : day.calDate;
            const endDate = slot.overnightEnd
                ? addDays(day.calDate, 1)
                : startDate;

            dtStart     = `${startDate}T${slot.startH}`;
            dtEnd       = `${endDate}T${slot.endH}`;
            title       = `VVS Rotselaar – Rock Werchter (${slot.time})`;
            description = `Shift Rock Werchter – ${day.label} ${day.date}\\nV.V.S Rotselaar`;
            found = true;
            break outer;
        }
    }

    if (!found) {
        // Special shift
        const s = SPECIAL_SHIFTS.find(s => s.id === shiftId);
        if (!s) return;
        dtStart     = `${s.calDate}T${s.calStart}`;
        dtEnd       = `${s.calDate}T${s.calEnd}`;
        title       = `VVS Rotselaar – ${s.label} Rock Werchter`;
        description = `${s.label} Rock Werchter – ${s.date}\\nEinduur kan uitlopen.\\nV.V.S Rotselaar`;
    }

    const uid  = `werchter-${shiftId}-${Date.now()}@vvsrotselaar.be`;
    const now  = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//VVS Rotselaar//Werklijst//NL',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `SUMMARY:${title}`,
        `DESCRIPTION:${description}`,
        'LOCATION:Rock Werchter\\, Werchter\\, België',
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `werchter-${shiftId}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = '') {
    const t = document.getElementById('wlToast');
    t.textContent = msg;
    t.className   = ['wl-toast', 'show', type ? 'toast-' + type : ''].filter(Boolean).join(' ');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'wl-toast'; }, 3000);
}

// ── Hamburger menu ────────────────────────────────────────────────────────────

const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');

if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
    navMenu.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        });
    });
}

console.log('Werklijst.js loaded');
