// ===============================================
// ADMIN2.JS – Werklijsten Beheren
// V.V.S Rotselaar
// Firestore structuur:
//   werklijsten/{id}            → { naam, active, createdAt }
//   werklijsten/{id}/shifts/{id} → { label, date, time, max, note, section, persons }
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, doc, addDoc, getDocs, setDoc, deleteDoc,
    query, where, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Hamburger ──────────────────────────────────────────────────────────────────
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

// ── State ──────────────────────────────────────────────────────────────────────
let werklijstenCache   = {};   // id → { id, naam, active, createdAt }
let shiftsCache        = {};   // shiftId → shift data (for current editing werklijst)
let editingWerklijstId = null;
let unsubWerklijsten   = null;
let unsubShifts        = null;

// ── Auth guard ─────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }

    try {
        const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
        if (snap.empty) { window.location.href = 'index.html'; return; }
        const data = snap.docs[0].data();
        if (data.rol !== 'admin') { window.location.href = 'index.html'; return; }
    } catch (e) {
        console.error('Auth check error:', e);
        return;
    }

    listenToWerklijsten();
});

// ── Werklijsten listener ────────────────────────────────────────────────────────
function listenToWerklijsten() {
    if (unsubWerklijsten) unsubWerklijsten();
    unsubWerklijsten = onSnapshot(
        collection(db, 'werklijsten'),
        (snap) => {
            werklijstenCache = {};
            snap.forEach(d => { werklijstenCache[d.id] = { id: d.id, ...d.data() }; });
            renderWerklijstenList();
        },
        (err) => {
            console.error('Werklijsten snapshot error:', err);
            showToast('❌ Fout bij laden: ' + err.message, 'error');
        }
    );
}

// ── Render werklijsten list ─────────────────────────────────────────────────────
function renderWerklijstenList() {
    const container = document.getElementById('werklijstenList');
    if (!container) return;

    const items = Object.values(werklijstenCache).sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return (a.naam || '').localeCompare(b.naam || '');
    });

    if (items.length === 0) {
        container.innerHTML = `
            <div class="werklijst-empty-state">
                <p>Nog geen werklijsten aangemaakt. Klik op "+ Werklijst Toevoegen" om te beginnen.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    items.forEach(wl => {
        const el = document.createElement('div');
        el.className = `wl-list-card ${wl.active ? 'wl-active' : ''}`;
        el.innerHTML = `
            <div class="wl-list-card-info">
                ${wl.active ? '<span class="wl-active-badge">● ACTIEF</span>' : ''}
                <span class="wl-list-name">${wl.naam || '(geen naam)'}</span>
            </div>
            <div class="wl-list-actions">
                ${!wl.active ? `<button class="icon-btn activate-btn" data-id="${wl.id}">✔ Activeren</button>` : ''}
                <button class="icon-btn rename-btn" data-id="${wl.id}">✏️ Naam</button>
                <button class="icon-btn shifts-btn" data-id="${wl.id}">📋 Shiften</button>
                <button class="icon-btn delete delete-wl-btn" data-id="${wl.id}">🗑</button>
            </div>
        `;

        if (!wl.active) {
            el.querySelector('.activate-btn').addEventListener('click', () => activateWerklijst(wl.id));
        }
        el.querySelector('.rename-btn').addEventListener('click', () => openWerklijstModal(wl));
        el.querySelector('.shifts-btn').addEventListener('click', () => openShiftsEditor(wl.id));
        el.querySelector('.delete-wl-btn').addEventListener('click', () => confirmDeleteWerklijst(wl));

        container.appendChild(el);
    });
}

// ── Activate werklijst ──────────────────────────────────────────────────────────
async function activateWerklijst(id) {
    try {
        // Deactivate all
        const deactivates = Object.values(werklijstenCache).map(wl =>
            setDoc(doc(db, 'werklijsten', wl.id), { active: false }, { merge: true })
        );
        await Promise.all(deactivates);
        // Activate selected
        await setDoc(doc(db, 'werklijsten', id), { active: true }, { merge: true });
        showToast('✅ Werklijst geactiveerd!', 'success');
    } catch (e) {
        console.error('activateWerklijst error:', e);
        showToast('❌ Fout: ' + e.message, 'error');
    }
}

// ── Open shifts editor ──────────────────────────────────────────────────────────
function openShiftsEditor(werklijstId) {
    editingWerklijstId = werklijstId;
    const wl = werklijstenCache[werklijstId];

    document.getElementById('werklijstenView').style.display = 'none';
    document.getElementById('shiftsEditorView').style.display = 'block';
    document.getElementById('shiftsEditorTitle').textContent  = wl?.naam || 'Werklijst';
    document.getElementById('shiftsEditorActive').style.display = wl?.active ? 'inline-flex' : 'none';

    if (unsubShifts) unsubShifts();
    shiftsCache = {};
    document.getElementById('shiftsEditorGrid').innerHTML = '<div class="loading">Laden…</div>';

    unsubShifts = onSnapshot(
        collection(db, 'werklijsten', werklijstId, 'shifts'),
        (snap) => {
            shiftsCache = {};
            snap.forEach(d => { shiftsCache[d.id] = { id: d.id, ...d.data() }; });
            renderShiftsEditor();
        },
        (err) => {
            console.error('Shifts snapshot error:', err);
            document.getElementById('shiftsEditorGrid').innerHTML =
                `<p class="error-text text-center">Fout bij laden: ${err.message}</p>`;
        }
    );
}

// ── Close shifts editor ─────────────────────────────────────────────────────────
function closeShiftsEditor() {
    if (unsubShifts) { unsubShifts(); unsubShifts = null; }
    editingWerklijstId = null;
    shiftsCache = {};
    document.getElementById('werklijstenView').style.display = 'block';
    document.getElementById('shiftsEditorView').style.display = 'none';
}

document.getElementById('backToWerklijstenBtn')?.addEventListener('click', closeShiftsEditor);

// ── Render shifts editor (grouped by date) ─────────────────────────────────────
function renderShiftsEditor() {
    const grid = document.getElementById('shiftsEditorGrid');
    if (!grid) return;

    const shifts = Object.values(shiftsCache);

    if (shifts.length === 0) {
        grid.innerHTML = `
            <div class="werklijst-empty-state">
                <p>Nog geen shiften voor deze werklijst. Klik op "+ Shift Toevoegen".</p>
            </div>`;
        return;
    }

    // Sort by date then start time
    shifts.sort((a, b) => {
        const ka = (a.date || '9999') + parseTimeStart(a.time);
        const kb = (b.date || '9999') + parseTimeStart(b.time);
        return ka.localeCompare(kb);
    });

    // Group by date
    const byDate = {};
    shifts.forEach(s => {
        const key = s.date || '__geen_datum__';
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(s);
    });

    grid.innerHTML = '';

    Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([date, dayShifts]) => {
            let dateLabel = 'Datum onbekend';
            if (date !== '__geen_datum__') {
                const d = new Date(date + 'T12:00:00');
                dateLabel = d.toLocaleDateString('nl-BE', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                });
                // Capitalize first letter
                dateLabel = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
            }

            const dayGroup = document.createElement('div');
            dayGroup.className = 'shifts-day-group';
            dayGroup.innerHTML = `
                <div class="shifts-day-header">
                    <div class="shifts-day-header-left">
                        <span class="shifts-day-icon">📅</span>
                        <h4>${dateLabel}</h4>
                        <span class="shifts-day-count">${dayShifts.length} shift${dayShifts.length !== 1 ? 'en' : ''}</span>
                    </div>
                </div>
                <div class="shifts-day-cards"></div>
            `;

            const cardsEl = dayGroup.querySelector('.shifts-day-cards');
            dayShifts.forEach(shift => cardsEl.appendChild(createShiftCard(shift)));
            grid.appendChild(dayGroup);
        });
}

// ── Create shift card ───────────────────────────────────────────────────────────
function parseTimeStart(t) {
    if (!t) return '00:00';
    return t.split(/[–—\-]/)[0].trim() || '00:00';
}

function createShiftCard(shift) {
    const persons  = shift.persons || [];
    const maxLabel = shift.max ? `${persons.length} / ${shift.max}` : `${persons.length} / ∞`;
    const catTag = shift.category ? `<span class="shift-cat-tag">${shift.category}</span>` : '';

    const reqResp  = shift.requireResponsible ?? true;
    const showLbl  = shift.showLabel ?? false;
    const respBadge  = reqResp
        ? `<span class="shift-opt-badge badge-on"  title="Verantwoordelijke vereist">★ Verantw.</span>`
        : `<span class="shift-opt-badge badge-off" title="Geen verantwoordelijke">★ Uit</span>`;
    const labelBadge = showLbl
        ? `<span class="shift-opt-badge badge-on"  title="Label zichtbaar">🏷️ Label</span>`
        : `<span class="shift-opt-badge badge-off" title="Label verborgen">🏷️ Verborgen</span>`;

    const card = document.createElement('div');
    card.className = 'shift-admin-card';
    card.dataset.id = shift.id;

    card.innerHTML = `
        <div class="shift-admin-header">
            <div class="shift-admin-header-info">
                <div class="shift-admin-title">${shift.label || shift.id} ${catTag}</div>
                <div class="shift-admin-meta">
                    <span class="meta-time">${shift.time || ''}</span>
                    <span class="meta-sep">·</span>
                    <span class="meta-count">${maxLabel} pers.</span>
                    <span class="meta-sep">·</span>
                    ${respBadge}${labelBadge}
                </div>
                ${shift.note ? `<div class="shift-admin-note">${shift.note}</div>` : ''}
            </div>
            <div class="shift-admin-actions-header">
                <button class="icon-btn edit sac-edit" title="Bewerken">✏️</button>
                <button class="icon-btn delete sac-delete" title="Verwijderen">🗑</button>
            </div>
        </div>
        <div class="shift-admin-body">
            <div class="shift-person-list" id="plist-${shift.id}">
                ${persons.length === 0
                    ? '<p class="no-persons-msg">Nog niemand ingeschreven.</p>'
                    : persons.map(p => personRow(p)).join('')}
            </div>
            <div class="shift-add-person">
                <input type="text" class="add-name-input" placeholder="Naam toevoegen…" autocomplete="off">
                <button class="add-person-btn" type="button">+ Toevoegen</button>
            </div>
        </div>
    `;

    card.querySelector('.sac-edit').addEventListener('click', () => openShiftModal(shift));
    card.querySelector('.sac-delete').addEventListener('click', () => confirmDeleteShift(shift));

    card.querySelectorAll('.remove-person-btn').forEach(btn => {
        btn.addEventListener('click', () => removePerson(shift.id, btn.dataset.uid, btn.dataset.naam));
    });

    const input = card.querySelector('.add-name-input');
    const btn   = card.querySelector('.add-person-btn');

    btn.addEventListener('click', () => {
        addPersonByName(shift.id, input.value.trim());
        input.value = '';
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPersonByName(shift.id, input.value.trim());
            input.value = '';
        }
    });

    return card;
}

function personRow(p) {
    const respLabel = p.responsible ? ' <span class="person-role">(verantw.)</span>' : '';
    const nameClass = p.responsible ? 'person-name is-responsible' : 'person-name';
    return `
        <div class="shift-person-row">
            <span class="${nameClass}">${p.naam}${respLabel}</span>
            <button class="remove-person-btn" data-uid="${p.uid || ''}" data-naam="${p.naam}" title="Verwijder ${p.naam}">✕</button>
        </div>`;
}

// ── Add / Remove person ─────────────────────────────────────────────────────────
async function addPersonByName(shiftId, naam) {
    if (!naam || !editingWerklijstId) return;
    const shift = shiftsCache[shiftId];
    if (!shift) return;
    const existing = shift.persons || [];
    if (existing.some(p => p.naam.toLowerCase() === naam.toLowerCase())) {
        showToast('Deze naam staat er al in.', 'error');
        return;
    }
    try {
        await setDoc(
            doc(db, 'werklijsten', editingWerklijstId, 'shifts', shiftId),
            { persons: [...existing, { uid: '', naam, responsible: false }] },
            { merge: true }
        );
        showToast(`✅ ${naam} toegevoegd.`, 'success');
    } catch (e) {
        console.error('addPersonByName error:', e);
        showToast('❌ ' + e.message, 'error');
    }
}

async function removePerson(shiftId, uid, naam) {
    if (!confirm(`Weet je zeker dat je ${naam} wilt verwijderen van deze shift?`)) return;
    const shift = shiftsCache[shiftId];
    if (!shift || !editingWerklijstId) return;
    const updated = (shift.persons || []).filter(p => uid ? p.uid !== uid : p.naam !== naam);
    try {
        await setDoc(
            doc(db, 'werklijsten', editingWerklijstId, 'shifts', shiftId),
            { persons: updated },
            { merge: true }
        );
        showToast(`↩️ ${naam} verwijderd.`, 'success');
    } catch (e) {
        console.error('removePerson error:', e);
        showToast('❌ ' + e.message, 'error');
    }
}

// ── Werklijst modal (nieuw / hernoemen) ────────────────────────────────────────
const werklijstModal = document.getElementById('werklijstModal');
const werklijstForm  = document.getElementById('werklijstForm');

function openWerklijstModal(wl = null) {
    document.getElementById('werklijstModalTitle').textContent = wl ? 'Werklijst Hernoemen' : 'Werklijst Toevoegen';
    document.getElementById('werklijstId').value   = wl ? wl.id : '';
    document.getElementById('werklijstNaam').value = wl ? (wl.naam || '') : '';
    werklijstModal.classList.add('active');
}

document.getElementById('addWerklijstBtn')?.addEventListener('click', () => openWerklijstModal());
document.getElementById('werklijstModalCancel')?.addEventListener('click', () => werklijstModal.classList.remove('active'));
werklijstModal?.addEventListener('click', e => { if (e.target === werklijstModal) werklijstModal.classList.remove('active'); });

werklijstForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id   = document.getElementById('werklijstId').value.trim();
    const naam = document.getElementById('werklijstNaam').value.trim();
    if (!naam) return;

    const btn = werklijstForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        if (id) {
            await setDoc(doc(db, 'werklijsten', id), { naam }, { merge: true });
            showToast('✅ Werklijst hernoemd!', 'success');
        } else {
            await addDoc(collection(db, 'werklijsten'), { naam, active: false, createdAt: serverTimestamp() });
            showToast('✅ Werklijst aangemaakt!', 'success');
        }
        werklijstModal.classList.remove('active');
    } catch (err) {
        console.error('Werklijst save error:', err);
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

// ── Shift modal (nieuw / bewerken) ─────────────────────────────────────────────
const shiftModal = document.getElementById('shiftModal');
const shiftForm  = document.getElementById('shiftForm');

function openShiftModal(shift = null) {
    document.getElementById('shiftModalTitle').textContent = shift ? 'Shift Bewerken' : 'Shift Toevoegen';
    document.getElementById('shiftId').value        = shift ? shift.id : '';
    document.getElementById('shiftLabel').value     = shift ? (shift.label    || '') : '';
    document.getElementById('shiftDate').value      = shift ? (shift.date     || '') : '';
    document.getElementById('shiftTime').value      = shift ? (shift.time     || '') : '';
    document.getElementById('shiftMax').value       = shift ? (shift.max      || '') : '';
    document.getElementById('shiftNote').value      = shift ? (shift.note     || '') : '';
    document.getElementById('shiftCategory').value  = shift ? (shift.category || '') : '';

    // Toggles – requireResponsible standaard AAN, showLabel standaard UIT
    const rrEl = document.getElementById('shiftRequireResponsible');
    const slEl = document.getElementById('shiftShowLabel');
    if (rrEl) rrEl.checked = shift ? (shift.requireResponsible ?? true)  : true;
    if (slEl) slEl.checked = shift ? (shift.showLabel          ?? false) : false;

    // Vul de datalist met bestaande categorieën voor autocomplete
    const categories = [...new Set(
        Object.values(shiftsCache).map(s => s.category).filter(Boolean)
    )];
    const dl = document.getElementById('categoryList');
    if (dl) dl.innerHTML = categories.map(c => `<option value="${c}">`).join('');

    shiftModal.classList.add('active');
}

document.getElementById('addShiftBtn')?.addEventListener('click', () => openShiftModal());
document.getElementById('shiftModalCancel')?.addEventListener('click', () => shiftModal.classList.remove('active'));
shiftModal?.addEventListener('click', e => { if (e.target === shiftModal) shiftModal.classList.remove('active'); });

shiftForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingWerklijstId) { showToast('❌ Geen werklijst geselecteerd.', 'error'); return; }

    const id       = document.getElementById('shiftId').value.trim();
    const label    = document.getElementById('shiftLabel').value.trim();
    const date     = document.getElementById('shiftDate').value;
    const time     = document.getElementById('shiftTime').value.trim();
    const maxRaw   = document.getElementById('shiftMax').value;
    const max      = maxRaw ? parseInt(maxRaw, 10) : null;
    const note     = document.getElementById('shiftNote').value.trim();
    const category = document.getElementById('shiftCategory').value.trim();
    const requireResponsible = document.getElementById('shiftRequireResponsible')?.checked ?? true;
    const showLabel          = document.getElementById('shiftShowLabel')?.checked ?? false;

    const shiftId = id || slugify(`${label}_${date}`);

    const btn = shiftForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        const existing = shiftsCache[shiftId] || {};
        await setDoc(
            doc(db, 'werklijsten', editingWerklijstId, 'shifts', shiftId),
            { label, date, time, max, note, category, requireResponsible, showLabel, persons: existing.persons || [] }
        );
        showToast('✅ Shift opgeslagen!', 'success');
        shiftModal.classList.remove('active');
    } catch (err) {
        console.error('Save shift error:', err);
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
}

// ── Confirm modals ──────────────────────────────────────────────────────────────
function confirmDeleteWerklijst(wl) {
    openConfirm(
        `Weet je zeker dat je werklijst "${wl.naam}" wilt verwijderen? Alle shiften en inschrijvingen gaan verloren.`,
        async () => {
            try {
                // Delete subcollection shifts first (client-side)
                const shiftsSnap = await getDocs(collection(db, 'werklijsten', wl.id, 'shifts'));
                await Promise.all(shiftsSnap.docs.map(d => deleteDoc(d.ref)));
                await deleteDoc(doc(db, 'werklijsten', wl.id));
                showToast('🗑 Werklijst verwijderd.', 'success');
            } catch (err) {
                console.error('Delete werklijst error:', err);
                showToast('❌ Fout: ' + err.message, 'error');
            }
        }
    );
}

function confirmDeleteShift(shift) {
    openConfirm(
        `Weet je zeker dat je de shift "${shift.label || shift.id}" wilt verwijderen? Alle inschrijvingen gaan verloren.`,
        async () => {
            try {
                await deleteDoc(doc(db, 'werklijsten', editingWerklijstId, 'shifts', shift.id));
                showToast('🗑 Shift verwijderd.', 'success');
            } catch (err) {
                console.error('Delete shift error:', err);
                showToast('❌ Fout: ' + err.message, 'error');
            }
        }
    );
}

function openConfirm(message, onConfirm) {
    const confirmModal  = document.getElementById('confirmModal');
    const confirmMsg    = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');

    confirmMsg.textContent = message;
    confirmModal.classList.add('active');

    // Clone to remove old listeners
    const newDeleteBtn = confirmDelete.cloneNode(true);
    confirmDelete.parentNode.replaceChild(newDeleteBtn, confirmDelete);
    const newCancelBtn = confirmCancel.cloneNode(true);
    confirmCancel.parentNode.replaceChild(newCancelBtn, confirmCancel);

    newDeleteBtn.addEventListener('click', async () => {
        confirmModal.classList.remove('active');
        await onConfirm();
    });
    newCancelBtn.addEventListener('click', () => confirmModal.classList.remove('active'));
}

// ── Toast ───────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `position:fixed;bottom:1.75rem;right:1.75rem;background:var(--text-dark);color:var(--white);
            padding:0.75rem 1.3rem;border-radius:9px;font-size:0.88rem;font-weight:600;z-index:9999;
            transform:translateY(80px);opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);
            box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;max-width:320px;`;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--text-dark)';
    t.style.transform  = 'translateY(0)';
    t.style.opacity    = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.transform = 'translateY(80px)'; t.style.opacity = '0'; }, 3500);
}
