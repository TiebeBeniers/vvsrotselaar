// ===============================================
// ADMIN2.JS – Werklijst Beheren
// V.V.S Rotselaar
// Beheer van Rock Werchter shiften via Firestore
// collection: werchter_shifts
// doc id: shift identifier
// doc data: { label, date, time, max, persons:[{uid,naam,responsible}] }
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, doc, getDoc, getDocs, setDoc, deleteDoc,
    query, where, onSnapshot, orderBy
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Admin2.js loaded');

// ── Hamburger ─────────────────────────────────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');
if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
    navMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    }));
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let shiftsCache     = {};   // id → { label, date, time, max, persons }

// ── Auth guard ────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }

    currentUser = user;

    try {
        const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
        if (snap.empty) { window.location.href = 'index.html'; return; }
        currentUserData = snap.docs[0].data();
        if (currentUserData.rol !== 'admin') { window.location.href = 'index.html'; return; }
    } catch (e) {
        console.error('Auth check error:', e);
        return;
    }

    listenToShifts();
});

// ── Firestore real-time listener ──────────────────────────────────────────────
function listenToShifts() {
    onSnapshot(collection(db, 'werchter_shifts'), (snapshot) => {
        shiftsCache = {};
        snapshot.forEach(d => { shiftsCache[d.id] = { id: d.id, ...d.data() }; });
        renderWerklijst();
    }, (err) => {
        console.error('Shifts snapshot error:', err);
        document.getElementById('werklijstAdminGrid').innerHTML =
            '<p class="text-center error-text">Fout bij laden: ' + err.message + '</p>';
    });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderWerklijst() {
    const grid = document.getElementById('werklijstAdminGrid');
    if (!grid) return;

    const shifts = Object.values(shiftsCache);

    if (shifts.length === 0) {
        grid.innerHTML = '<div class="werklijst-empty"><p>Nog geen shiften aangemaakt. Klik op "+ Shift Toevoegen" om te beginnen.</p></div>';
        return;
    }

    // Sort by date then time
    shifts.sort((a, b) => {
        const da = new Date((a.date || '2099-01-01') + 'T' + parseTimeStart(a.time));
        const db_ = new Date((b.date || '2099-01-01') + 'T' + parseTimeStart(b.time));
        return da - db_;
    });

    grid.innerHTML = '';
    shifts.forEach(shift => {
        const card = createShiftCard(shift);
        grid.appendChild(card);
    });
}

function parseTimeStart(timeStr) {
    // "08:00 – 14:00" → "08:00"
    if (!timeStr) return '00:00';
    return timeStr.split('–')[0].trim().split(' ')[0].trim() || '00:00';
}

function createShiftCard(shift) {
    const persons = shift.persons || [];
    const maxText = shift.max ? `max. ${shift.max}` : 'onbeperkt';
    const dateFormatted = shift.date
        ? new Date(shift.date).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })
        : '';

    const card = document.createElement('div');
    card.className = 'shift-admin-card';
    card.dataset.id = shift.id;

    card.innerHTML = `
        <div class="shift-admin-header">
            <div>
                <div class="shift-admin-title">${shift.label || shift.id}</div>
                <div class="shift-admin-meta">
                    ${dateFormatted ? dateFormatted + ' &nbsp;·&nbsp; ' : ''}${shift.time || ''}
                    &nbsp;·&nbsp; ${persons.length} persoon${persons.length !== 1 ? 'en' : ''} / ${maxText}
                </div>
            </div>
            <div class="shift-admin-actions-header">
                <button class="icon-btn edit" data-action="edit" data-id="${shift.id}">✏️ Bewerken</button>
                <button class="icon-btn delete" data-action="delete" data-id="${shift.id}">🗑 Verwijderen</button>
            </div>
        </div>
        <div class="shift-admin-body">
            <div class="shift-person-list" id="plist-${shift.id}">
                ${persons.length === 0
                    ? '<p style="color:var(--text-gray);font-size:0.85rem;font-style:italic;">Nog niemand ingeschreven.</p>'
                    : persons.map(p => personRow(shift.id, p)).join('')}
            </div>
            <div class="shift-add-person">
                <input type="text" class="add-name-input" placeholder="Naam toevoegen…" data-shift="${shift.id}">
                <button class="add-person-btn" data-shift="${shift.id}">+ Toevoegen</button>
            </div>
        </div>
    `;

    // Edit shift
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openShiftModal(shift));

    // Delete shift
    card.querySelector('[data-action="delete"]').addEventListener('click', () => confirmDeleteShift(shift));

    // Remove person buttons
    card.querySelectorAll('[data-action="remove-person"]').forEach(btn => {
        btn.addEventListener('click', () => {
            removePerson(shift.id, btn.dataset.uid, btn.dataset.naam);
        });
    });

    // Add person button
    card.querySelector('.add-person-btn').addEventListener('click', () => {
        const input = card.querySelector('.add-name-input');
        addPersonByName(shift.id, input.value.trim());
        input.value = '';
    });

    // Also allow Enter key on input
    card.querySelector('.add-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const input = e.target;
            addPersonByName(shift.id, input.value.trim());
            input.value = '';
        }
    });

    return card;
}

function personRow(shiftId, p) {
    const respLabel = p.responsible ? '<span class="person-role">(verantwoordelijke)</span>' : '';
    // uid is present for real accounts, absent for manually-added names
    const removeAttr = p.uid
        ? `data-action="remove-person" data-uid="${p.uid}" data-naam="${p.naam}"`
        : `data-action="remove-person" data-uid="" data-naam="${p.naam}"`;
    const nameClass = p.responsible ? 'person-name is-responsible' : 'person-name';

    return `
        <div class="shift-person-row">
            <span class="${nameClass}">${p.naam}${respLabel}</span>
            <button class="remove-person-btn" ${removeAttr} title="Verwijder ${p.naam}">✕</button>
        </div>
    `;
}

// ── Add person by name (no account required) ──────────────────────────────────
async function addPersonByName(shiftId, naam) {
    if (!naam) return;

    const shift = shiftsCache[shiftId];
    if (!shift) return;

    const existing = shift.persons || [];

    // Prevent duplicates (case-insensitive)
    if (existing.some(p => p.naam.toLowerCase() === naam.toLowerCase())) {
        showToast('Deze naam staat er al in.', 'error');
        return;
    }

    const updated = [...existing, { uid: '', naam, responsible: false }];

    try {
        await setDoc(doc(db, 'werchter_shifts', shiftId), { persons: updated }, { merge: true });
        showToast(`✅ ${naam} toegevoegd.`, 'success');
    } catch (e) {
        console.error('addPersonByName error:', e);
        showToast('❌ Fout: ' + e.message, 'error');
    }
}

// ── Remove person ─────────────────────────────────────────────────────────────
async function removePerson(shiftId, uid, naam) {
    if (!confirm(`Weet je zeker dat je ${naam} van deze shift wilt verwijderen?`)) return;

    const shift = shiftsCache[shiftId];
    if (!shift) return;

    const updated = (shift.persons || []).filter(p => {
        if (uid) return p.uid !== uid;
        return p.naam !== naam;  // for manually added names without uid
    });

    try {
        await setDoc(doc(db, 'werchter_shifts', shiftId), { persons: updated }, { merge: true });
        showToast(`↩️ ${naam} verwijderd van shift.`, 'success');
    } catch (e) {
        console.error('removePerson error:', e);
        showToast('❌ Fout: ' + e.message, 'error');
    }
}

// ── Shift modal (add / edit) ──────────────────────────────────────────────────
const shiftModal       = document.getElementById('shiftModal');
const shiftForm        = document.getElementById('shiftForm');
const shiftModalCancel = document.getElementById('shiftModalCancel');

function openShiftModal(shift = null) {
    document.getElementById('shiftModalTitle').textContent = shift ? 'Shift Bewerken' : 'Shift Toevoegen';
    document.getElementById('shiftId').value    = shift ? shift.id : '';
    document.getElementById('shiftLabel').value = shift ? (shift.label || '') : '';
    document.getElementById('shiftDate').value  = shift ? (shift.date || '') : '';
    document.getElementById('shiftTime').value  = shift ? (shift.time || '') : '';
    document.getElementById('shiftMax').value   = shift ? (shift.max || '') : '';
    shiftModal.classList.add('active');
}

document.getElementById('addShiftBtn').addEventListener('click', () => openShiftModal());

if (shiftModalCancel) {
    shiftModalCancel.addEventListener('click', () => shiftModal.classList.remove('active'));
}

shiftModal.addEventListener('click', (e) => {
    if (e.target === shiftModal) shiftModal.classList.remove('active');
});

if (shiftForm) {
    shiftForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id    = document.getElementById('shiftId').value.trim();
        const label = document.getElementById('shiftLabel').value.trim();
        const date  = document.getElementById('shiftDate').value;
        const time  = document.getElementById('shiftTime').value.trim();
        const maxRaw = document.getElementById('shiftMax').value;
        const max   = maxRaw ? parseInt(maxRaw) : null;

        // Generate a readable ID from the label if new
        const shiftId = id || slugify(label + '_' + date);

        const submitBtn = shiftForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Bezig...';

        try {
            const existing = shiftsCache[shiftId] || {};
            const data = {
                label,
                date,
                time,
                max,
                persons: existing.persons || [],
            };

            await setDoc(doc(db, 'werchter_shifts', shiftId), data);
            showToast('✅ Shift opgeslagen!', 'success');
            shiftModal.classList.remove('active');
        } catch (err) {
            console.error('Save shift error:', err);
            showToast('❌ Fout bij opslaan: ' + err.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Opslaan';
        }
    });
}

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 60);
}

// ── Confirm delete shift ──────────────────────────────────────────────────────
function confirmDeleteShift(shift) {
    const confirmModal   = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete  = document.getElementById('confirmDelete');
    const confirmCancel  = document.getElementById('confirmCancel');

    confirmMessage.textContent = `Weet je zeker dat je de shift "${shift.label || shift.id}" wilt verwijderen? Alle inschrijvingen gaan verloren.`;
    confirmModal.classList.add('active');

    confirmCancel.onclick = () => confirmModal.classList.remove('active');

    confirmDelete.onclick = async () => {
        try {
            await deleteDoc(doc(db, 'werchter_shifts', shift.id));
            showToast('🗑 Shift verwijderd.', 'success');
            confirmModal.classList.remove('active');
        } catch (err) {
            console.error('Delete shift error:', err);
            showToast('❌ Fout bij verwijderen: ' + err.message, 'error');
        }
    };
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    // Reuse wl-toast if present, else create one
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `
            position:fixed; bottom:1.75rem; right:1.75rem;
            background:var(--text-dark); color:var(--white);
            padding:0.75rem 1.3rem; border-radius:9px;
            font-size:0.88rem; font-weight:600; z-index:9999;
            transform:translateY(80px); opacity:0;
            transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
            box-shadow:0 4px 16px rgba(0,0,0,0.18);
            pointer-events:none;
        `;
        document.body.appendChild(t);
    }

    t.textContent = msg;
    t.style.background = type === 'success'
        ? 'var(--success)'
        : type === 'error'
            ? 'var(--danger)'
            : 'var(--text-dark)';
    t.style.transform = 'translateY(0)';
    t.style.opacity   = '1';

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        t.style.transform = 'translateY(80px)';
        t.style.opacity   = '0';
    }, 3000);
}
