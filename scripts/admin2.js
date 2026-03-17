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
    collection, doc, addDoc, getDocs, getDoc, setDoc, deleteDoc,
    query, where, onSnapshot, serverTimestamp, writeBatch, updateDoc
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
                <button class="icon-btn rename-btn" data-id="${wl.id}"><img src="assets/edit.png" class="icon" alt=""> Naam</button>
                <button class="icon-btn shifts-btn" data-id="${wl.id}">Shiften Beheren</button>
                <button class="icon-btn delete delete-wl-btn" data-id="${wl.id}"><img src="assets/delete.png" class="icon-lg" alt=""></button>
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
                <button class="icon-btn edit sac-edit" title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
                <button class="icon-btn delete sac-delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
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
                showToast('<img src="assets/delete.png" class="icon-lg" alt=""> Werklijst verwijderd.', 'success');
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

// ── Data reset confirm modal ────────────────────────────────────────────────────

function generateCode(length = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function showDataResetConfirm({ label, teamLabel, onConfirmed }) {
    let modal = document.getElementById('dataResetConfirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dataResetConfirmModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3 style="color:var(--danger);">⚠ Bevestig reset</h3>
                <p id="drcDescription" style="margin-bottom:1.25rem;color:var(--text-gray);line-height:1.6;"></p>
                <div class="data-reset-code-box">
                    <span>Typ deze code om te bevestigen:</span>
                    <strong id="drcCode" class="data-reset-code"></strong>
                </div>
                <div class="form-group" style="margin-top:0.75rem;">
                    <input type="text" id="drcInput" autocomplete="off" autocorrect="off"
                        spellcheck="false" placeholder="Typ de code hier"
                        style="letter-spacing:0.15em;font-weight:700;font-size:1.05rem;">
                </div>
                <p id="drcError" style="color:var(--danger);font-size:0.88rem;min-height:1.2rem;margin-bottom:0.5rem;"></p>
                <div class="modal-actions">
                    <button class="modal-btn cancel" id="drcCancelBtn">Annuleren</button>
                    <button class="modal-btn danger" id="drcConfirmBtn">Verwijderen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
    }

    const code       = generateCode();
    const input      = modal.querySelector('#drcInput');
    const errorEl    = modal.querySelector('#drcError');
    const codeEl     = modal.querySelector('#drcCode');
    const descEl     = modal.querySelector('#drcDescription');
    const confirmBtn = modal.querySelector('#drcConfirmBtn');
    const cancelBtn  = modal.querySelector('#drcCancelBtn');

    descEl.textContent = `Je staat op het punt om de ${label} van de ${teamLabel} te verwijderen. Dit kan NIET ongedaan worden gemaakt.`;
    codeEl.textContent = code;
    input.value        = '';
    errorEl.textContent = '';
    confirmBtn.disabled = true;

    // Enable confirm only when input matches
    input.oninput = () => {
        const match = input.value.trim().toUpperCase() === code;
        confirmBtn.disabled = !match;
        if (errorEl.textContent && match) errorEl.textContent = '';
    };

    cancelBtn.onclick = () => modal.classList.remove('active');

    confirmBtn.onclick = () => {
        if (input.value.trim().toUpperCase() !== code) {
            errorEl.textContent = 'Code komt niet overeen.';
            return;
        }
        modal.classList.remove('active');
        onConfirmed();
    };

    modal.classList.add('active');
    setTimeout(() => input.focus(), 50);
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

// ── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.tab + 'Tab');
        if (target) target.classList.add('active');
    });
});

// ── Data reset ───────────────────────────────────────────────────────────────

const SUBCOLLECTIONS = ['availability', 'playerMinutes', 'lineup', 'events'];

/**
 * Delete all documents in a subcollection of a match using a batch.
 * Returns the number of deletes queued.
 */
async function queueMatchSubcollectionDeletes(batch, matchId, subName) {
    const snap = await getDocs(collection(db, 'matches', matchId, subName));
    snap.forEach(d => batch.delete(d.ref));
    return snap.size;
}

/**
 * Delete global events linked to a matchId.
 */
async function queueEventsForMatch(batch, matchId) {
    const snap = await getDocs(
        query(collection(db, 'events'), where('matchId', '==', matchId))
    );
    snap.forEach(d => batch.delete(d.ref));
    return snap.size;
}

async function resetStats(team) {
    const snap = await getDocs(collection(db, 'users'));
    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(d => {
        const data = d.data();
        if (team !== 'all' && data.categorie !== team) return;
        batch.update(d.ref, {
            goals: 0, assists: 0, matchen: 0,
            minuten: 0, geelKaarten: 0, roodKaarten: 0
        });
        count++;
    });
    if (count === 0) return 0;
    await batch.commit();
    return count;
}

async function resetMatches(team) {
    const matchSnap = await getDocs(collection(db, 'matches'));
    const toDelete = [];
    matchSnap.forEach(d => {
        const data = d.data();
        if (team === 'all' || data.categorie === team || data.ploeg === team) {
            toDelete.push(d);
        }
    });

    if (toDelete.length === 0) return 0;

    // Firestore batches are limited to 500 ops — chunk if needed
    const MAX_BATCH = 400;
    let ops = [];

    for (const matchDoc of toDelete) {
        const mid = matchDoc.id;
        // Collect all sub-doc refs
        for (const sub of SUBCOLLECTIONS) {
            const subSnap = await getDocs(collection(db, 'matches', mid, sub));
            subSnap.forEach(d => ops.push(d.ref));
        }
        // Global events collection
        const evSnap = await getDocs(
            query(collection(db, 'events'), where('matchId', '==', mid))
        );
        evSnap.forEach(d => ops.push(d.ref));
        // The match doc itself (last so subcollections go first)
        ops.push(matchDoc.ref);
    }

    // Commit in chunks of MAX_BATCH
    for (let i = 0; i < ops.length; i += MAX_BATCH) {
        const batch = writeBatch(db);
        ops.slice(i, i + MAX_BATCH).forEach(ref => batch.delete(ref));
        await batch.commit();
    }

    return toDelete.length;
}

async function resetRanking(team) {
    const snap = await getDocs(collection(db, 'ranking'));
    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(d => {
        const data = d.data();
        if (team !== 'all' && data.categorie !== team && data.ploeg !== team) return;
        batch.delete(d.ref);
        count++;
    });
    if (count === 0) return 0;
    await batch.commit();
    return count;
}

// Wire up reset buttons
document.querySelectorAll('.data-reset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const team   = btn.dataset.team;
        const teamLabel = team === 'all' ? 'alle ploegen' : team;

        const actionLabels = {
            stats:   'spelersstatistieken',
            matches: 'wedstrijden & events',
            ranking: 'rangschikking'
        };

        showDataResetConfirm({
            label:      actionLabels[action],
            teamLabel,
            onConfirmed: async () => {
                const statusEl = document.getElementById('dataResetStatus');
                statusEl.innerHTML = '<p style="color:var(--text-gray)">Bezig…</p>';
                document.querySelectorAll('.data-reset-btn').forEach(b => b.disabled = true);
                try {
                    let count = 0;
                    if (action === 'stats')   count = await resetStats(team);
                    if (action === 'matches') count = await resetMatches(team);
                    if (action === 'ranking') count = await resetRanking(team);
                    statusEl.innerHTML = `<p style="color:var(--success);font-weight:600;">✓ Klaar — ${count} record(s) verwijderd/gereset.</p>`;
                    showToast('Reset geslaagd', 'success');
                } catch (e) {
                    console.error('Reset error:', e);
                    statusEl.innerHTML = `<p style="color:var(--danger);font-weight:600;">Fout: ${e.message}</p>`;
                    showToast('Fout bij reset', 'error');
                } finally {
                    document.querySelectorAll('.data-reset-btn').forEach(b => b.disabled = false);
                }
            }
        });
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SPONSORS BEHEREN
// Firestore: sponsors/{id} → { naam, beschrijving, website, websiteLabel,
//                               afbeeldingNaam, volgorde }
// ═══════════════════════════════════════════════════════════════════════════════

let sponsorsCache = {};   // id → sponsor data
let unsubSponsors = null;

// ── Start real-time listener when tab is opened ─────────────────────────────
function startSponsorsListener() {
    if (unsubSponsors) return;   // already listening
    unsubSponsors = onSnapshot(
        collection(db, 'sponsors'),
        (snap) => {
            sponsorsCache = {};
            snap.forEach(d => { sponsorsCache[d.id] = { id: d.id, ...d.data() }; });
            renderSponsorsList();
        },
        (err) => {
            console.error('Sponsors snapshot error:', err);
            showToast('❌ Fout bij laden sponsors: ' + err.message, 'error');
        }
    );
}

// ── Render list ─────────────────────────────────────────────────────────────
function renderSponsorsList() {
    const container = document.getElementById('sponsorsList');
    if (!container) return;

    const items = Object.values(sponsorsCache)
        .sort((a, b) => (a.volgorde ?? 999) - (b.volgorde ?? 999));

    if (items.length === 0) {
        container.innerHTML = `
            <div class="werklijst-empty-state">
                <p>Nog geen sponsors. Klik op "+ Sponsor Toevoegen" om te beginnen.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    items.forEach((sponsor, idx) => {
        const card = document.createElement('div');
        card.className = 'sponsor-admin-card';
        card.innerHTML = `
            <div class="sponsor-admin-logo">
                ${sponsor.afbeeldingNaam
                    ? `<img src="assets/${sponsor.afbeeldingNaam}" alt="${htmlEscAdmin(sponsor.naam)}" onerror="this.style.display='none'">`
                    : `<div class="sponsor-admin-logo-placeholder">📷</div>`}
            </div>
            <div class="sponsor-admin-info">
                <strong class="sponsor-admin-name">${htmlEscAdmin(sponsor.naam)}</strong>
                ${sponsor.beschrijving
                    ? `<p class="sponsor-admin-desc">${htmlEscAdmin(sponsor.beschrijving)}</p>`
                    : ''}
                ${sponsor.website
                    ? `<a href="${htmlEscAdmin(sponsor.website)}" target="_blank" rel="noopener noreferrer"
                          class="sponsor-admin-link">${htmlEscAdmin(sponsor.websiteLabel || sponsor.website)}</a>`
                    : ''}
                ${sponsor.afbeeldingNaam
                    ? `<span class="sponsor-admin-img-tag">🖼 ${htmlEscAdmin(sponsor.afbeeldingNaam)}</span>`
                    : ''}
            </div>
            <div class="sponsor-admin-actions">
                <button class="icon-btn" title="Omhoog" data-move="up"   ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button class="icon-btn" title="Omlaag" data-move="down" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="icon-btn edit"   title="Bewerken"><img src="assets/edit.png" class="icon-lg" alt=""></button>
                <button class="icon-btn delete" title="Verwijderen"><img src="assets/delete.png" class="icon-lg" alt=""></button>
            </div>`;

        card.querySelector('[data-move="up"]')?.addEventListener('click',
            () => moveSponsor(sponsor.id, items, idx, -1));
        card.querySelector('[data-move="down"]')?.addEventListener('click',
            () => moveSponsor(sponsor.id, items, idx, +1));
        card.querySelector('.edit').addEventListener('click',
            () => openSponsorModal(sponsor));
        card.querySelector('.delete').addEventListener('click',
            () => confirmDeleteSponsor(sponsor));

        container.appendChild(card);
    });
}

// ── Move sponsor (reorder) ───────────────────────────────────────────────────
async function moveSponsor(id, items, idx, delta) {
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= items.length) return;

    // Swap volgorde values
    const a = items[idx];
    const b = items[newIdx];
    try {
        await Promise.all([
            setDoc(doc(db, 'sponsors', a.id), { volgorde: newIdx }, { merge: true }),
            setDoc(doc(db, 'sponsors', b.id), { volgorde: idx   }, { merge: true }),
        ]);
    } catch (e) {
        console.error('moveSponsor error:', e);
        showToast('❌ Volgorde aanpassen mislukt: ' + e.message, 'error');
    }
}

// ── Delete sponsor ────────────────────────────────────────────────────────────
function confirmDeleteSponsor(sponsor) {
    const confirmModal   = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete  = document.getElementById('confirmDelete');
    const confirmCancel  = document.getElementById('confirmCancel');
    if (!confirmModal) return;

    confirmMessage.textContent = `Sponsor "${sponsor.naam}" definitief verwijderen?`;
    confirmModal.classList.add('active');

    const cleanup = () => confirmModal.classList.remove('active');
    confirmCancel.onclick = cleanup;
    confirmModal.onclick  = e => { if (e.target === confirmModal) cleanup(); };

    confirmDelete.onclick = async () => {
        cleanup();
        try {
            await deleteDoc(doc(db, 'sponsors', sponsor.id));
            showToast('↩️ Sponsor verwijderd.', 'success');
            localStorage.removeItem('vvs_sponsors_cache');
        } catch (e) {
            console.error('deleteSponsor error:', e);
            showToast('❌ ' + e.message, 'error');
        }
    };
}

// ── Sponsor modal (nieuw / bewerken) ─────────────────────────────────────────
const sponsorModal  = document.getElementById('sponsorModal');
const sponsorForm   = document.getElementById('sponsorForm');

function openSponsorModal(sponsor = null) {
    document.getElementById('sponsorModalTitle').textContent = sponsor ? 'Sponsor Bewerken' : 'Sponsor Toevoegen';
    document.getElementById('sponsorId').value             = sponsor ? sponsor.id              : '';
    document.getElementById('sponsorNaam').value           = sponsor ? (sponsor.naam           || '') : '';
    document.getElementById('sponsorBeschrijving').value   = sponsor ? (sponsor.beschrijving   || '') : '';
    document.getElementById('sponsorWebsite').value        = sponsor ? (sponsor.website        || '') : '';
    document.getElementById('sponsorWebsiteLabel').value   = sponsor ? (sponsor.websiteLabel   || '') : '';
    document.getElementById('sponsorAfbeelding').value     = sponsor ? (sponsor.afbeeldingNaam || '') : '';
    sponsorModal.classList.add('active');
}

document.getElementById('addSponsorBtn')?.addEventListener('click', () => openSponsorModal());
document.getElementById('sponsorModalCancel')?.addEventListener('click', () => sponsorModal.classList.remove('active'));
sponsorModal?.addEventListener('click', e => { if (e.target === sponsorModal) sponsorModal.classList.remove('active'); });

sponsorForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id              = document.getElementById('sponsorId').value.trim();
    const naam            = document.getElementById('sponsorNaam').value.trim();
    const beschrijving    = document.getElementById('sponsorBeschrijving').value.trim();
    const website         = document.getElementById('sponsorWebsite').value.trim();
    const websiteLabel    = document.getElementById('sponsorWebsiteLabel').value.trim();
    const afbeeldingNaam  = document.getElementById('sponsorAfbeelding').value.trim();

    if (!naam) return;

    const btn = sponsorForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Bezig…';

    try {
        if (id) {
            // Update bestaande sponsor
            await setDoc(doc(db, 'sponsors', id), {
                naam, beschrijving, website, websiteLabel, afbeeldingNaam
            }, { merge: true });
            showToast('✅ Sponsor bijgewerkt!', 'success');
        // Cache op sponsors.html ongeldig maken
        localStorage.removeItem('vvs_sponsors_cache');
        } else {
            // Nieuwe sponsor — volgorde = einde van de lijst
            const maxVolgorde = Object.values(sponsorsCache)
                .reduce((m, s) => Math.max(m, s.volgorde ?? 0), -1);
            await addDoc(collection(db, 'sponsors'), {
                naam, beschrijving, website, websiteLabel, afbeeldingNaam,
                volgorde: maxVolgorde + 1,
                createdAt: serverTimestamp()
            });
            showToast('✅ Sponsor toegevoegd!', 'success');
        // Cache op sponsors.html ongeldig maken
        localStorage.removeItem('vvs_sponsors_cache');
        }
        sponsorModal.classList.remove('active');
    } catch (err) {
        console.error('Sponsor save error:', err);
        showToast('❌ Fout: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Opslaan';
    }
});

// ── HTML escape helper ────────────────────────────────────────────────────────
function htmlEscAdmin(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Hook into tab switching to lazily start the listener ─────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'sponsors') {
        btn.addEventListener('click', startSponsorsListener);
    }
});
