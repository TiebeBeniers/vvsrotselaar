import { db } from './firebase-config.js';
import {
    addDoc, collection, doc, getDocs, setDoc, Timestamp, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export function canManageMatch(user, userData, match) {
    if (!user || !userData || !match || (userData.permissions || []).includes('supporter')) return false;
    const permissions = userData.permissions || [];
    return permissions.includes('admin')
        || permissions.includes('score_invullen')
        || permissions.includes('afgevaardigde:*')
        || permissions.includes(`afgevaardigde:${match.team}`)
        || (match.aangeduidePersonen || []).includes(user.uid);
}

export function renderTeamMatchActions(match, user, userData, container) {
    if (!container || !canManageMatch(user, userData, match) || match.status !== 'planned') return;

    const kickoff = new Date(`${match.datum}T${match.uur || '00:00'}`);
    const now = new Date();
    const availableFrom = new Date(kickoff.getTime() - 24 * 60 * 60 * 1000);
    const startFrom = new Date(kickoff.getTime() - 30 * 60 * 1000);
    const startUntil = new Date(kickoff.getTime() + 10 * 60 * 1000);
    if (now < availableFrom || now > startUntil) return;

    const actions = document.createElement('div');
    actions.className = 'team-match-actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'team-match-action-secondary';
    editButton.textContent = match.lineupDraftConfirmed ? 'Opstelling wijzigen' : 'Opstelling invullen';
    editButton.addEventListener('click', () => openLineupEditor(match, actions, user, userData));
    actions.appendChild(editButton);

    if (match.lineupDraftConfirmed) {
        const note = document.createElement('span');
        note.className = 'team-match-lineup-saved';
        note.textContent = '✓ Opstelling opgeslagen';
        actions.appendChild(note);
    }

    if (match.lineupDraftConfirmed && now >= startFrom) {
        const startButton = document.createElement('button');
        startButton.type = 'button';
        startButton.className = 'team-match-action-primary';
        startButton.textContent = '▶ Start wedstrijd';
        startButton.addEventListener('click', () => startTeamMatch(match, startButton, user, userData));
        actions.appendChild(startButton);
    }

    container.appendChild(actions);
}

async function openLineupEditor(match, actions, user, userData) {
    let players;
    try {
        const snapshot = await getDocs(collection(db, 'matches', match.id, 'availability'));
        players = snapshot.docs
            .filter(player => player.data().available)
            .map(player => ({
                uid: player.id,
                name: player.data().displayName || player.id
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
        showMessage(actions, `Spelers laden is mislukt: ${error.message}`, true);
        return;
    }

    let modal = document.getElementById('teamLineupModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'teamLineupModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content lineup-modal-content">
            <h3>Opstelling — ${escapeHtml(match.thuisploeg)} – ${escapeHtml(match.uitploeg)}</h3>
            <p class="lineup-subtitle">Kies exact 11 basisspelers en maximaal 5 wisselspelers.</p>
            <div class="team-lineup-player-list"></div>
            <p class="team-lineup-feedback" role="status"></p>
            <div class="modal-actions">
                <button class="modal-btn cancel" type="button">Annuleren</button>
                <button class="modal-btn confirm" type="button">Opstelling opslaan</button>
            </div>
        </div>`;

    const list = modal.querySelector('.team-lineup-player-list');
    const feedback = modal.querySelector('.team-lineup-feedback');
    const saved = match.lineupDraft || {};
    for (const player of players) {
        const row = document.createElement('label');
        row.className = 'team-lineup-player';
        const name = document.createElement('span');
        name.textContent = player.name;
        const select = document.createElement('select');
        select.dataset.uid = player.uid;
        select.dataset.name = player.name;
        select.innerHTML = `
            <option value="niet_geselecteerd">Niet geselecteerd</option>
            <option value="starter">Basis</option>
            <option value="bench">Wissel</option>`;
        select.value = saved[player.uid]?.status || 'niet_geselecteerd';
        row.append(name, select);
        list.appendChild(row);
    }

    if (!players.length) feedback.textContent = 'Er zijn nog geen spelers beschikbaar voor deze wedstrijd.';
    modal.querySelector('.cancel').addEventListener('click', () => modal.classList.remove('active'));
    modal.onclick = event => {
        if (event.target === modal) modal.classList.remove('active');
    };
    modal.querySelector('.confirm').addEventListener('click', async event => {
        const button = event.currentTarget;
        const selections = [...list.querySelectorAll('select')];
        const starters = selections.filter(select => select.value === 'starter');
        const subs = selections.filter(select => select.value === 'bench');
        if (starters.length !== 11 || subs.length > 5) {
            feedback.textContent = `Selecteer exact 11 basisspelers. Je hebt er ${starters.length} en ${subs.length} wisselspelers.`;
            feedback.classList.add('error');
            return;
        }

        button.disabled = true;
        button.textContent = 'Opslaan...';
        const lineupDraft = Object.fromEntries(selections.map(select => [
            select.dataset.uid,
            { name: select.dataset.name, status: select.value }
        ]));
        try {
            await updateDoc(doc(db, 'matches', match.id), { lineupDraft, lineupDraftConfirmed: true });
            modal.classList.remove('active');
            const actionParent = actions.parentElement;
            actions.remove();
            renderTeamMatchActions({ ...match, lineupDraft, lineupDraftConfirmed: true }, user, userData, actionParent);
        } catch (error) {
            feedback.textContent = `Opstelling opslaan is mislukt: ${error.message}`;
            feedback.classList.add('error');
            button.disabled = false;
            button.textContent = 'Opstelling opslaan';
        }
    });
    modal.classList.add('active');
}

async function startTeamMatch(match, button, user, userData) {
    if (!canManageMatch(user, userData, match)) return;
    if (!window.confirm(`Start ${match.thuisploeg} – ${match.uitploeg}?`)) return;

    button.disabled = true;
    button.textContent = 'Wedstrijd starten...';
    const matchRef = doc(db, 'matches', match.id);
    try {
        const lineup = match.lineupDraft || {};
        if (Object.values(lineup).filter(player => player.status === 'starter').length !== 11) {
            throw new Error('De opgeslagen opstelling bevat niet exact 11 basisspelers.');
        }

        const scheduled = new Date(`${match.datum}T${match.uur || '00:00'}`);
        const startedAt = (Date.now() - scheduled.getTime()) / 60_000 > 10
            ? Timestamp.fromDate(scheduled)
            : Timestamp.fromDate(new Date());
        await updateDoc(matchRef, {
            status: 'live',
            startedAt,
            scoreThuis: 0,
            scoreUit: 0,
            phase: 1,
            halfTimeReached: false,
            extraTimeStarted: false,
            etHalfTimeReached: false,
            pausedAt: null,
            resumeStartedAt: null,
            etStartedAt: null,
            etResumeStartedAt: null,
            lineupConfirmed: true,
            lineup
        });

        await Promise.all(Object.entries(lineup)
            .filter(([, player]) => player.status === 'starter')
            .map(([uid, player]) => setDoc(doc(db, 'matches', match.id, 'playerMinutes', uid), {
                uid, name: player.name, minuteOn: 0, minuteOff: null
            })));
        await addDoc(collection(db, 'matches', match.id, 'events'), {
            minuut: 0, half: 1, type: 'aftrap', ploeg: 'center', speler: '', timestamp: serverTimestamp()
        });

        window.location.href = `live.html?match=${encodeURIComponent(match.id)}`;
    } catch (error) {
        console.error('Wedstrijd starten mislukt:', error);
        button.disabled = false;
        button.textContent = '▶ Start wedstrijd';
        showMessage(button.parentElement, `Wedstrijd starten is mislukt: ${error.message}`, true);
    }
}

function showMessage(container, message, isError = false) {
    let note = container.querySelector('.team-match-action-message');
    if (!note) {
        note = document.createElement('p');
        note.className = 'team-match-action-message';
        container.appendChild(note);
    }
    note.textContent = message;
    note.classList.toggle('error', isError);
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}
