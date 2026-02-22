// ===============================================
// LIVE MATCH PAGE - V.V.S Rotselaar
// ===============================================
// Phase system:
//   phase 1 = 1e helft reguliere tijd
//   phase 2 = 2e helft reguliere tijd
//   phase 3 = 1e helft verlengingen (ET)
//   phase 4 = 2e helft verlengingen (ET)
//
// Match status: 'live' | 'rust' | 'finished'
// Extra Firestore fields:
//   halfTimeReached      bool      – regular HT button clicked
//   extraTimeStarted     bool      – verlengingen button clicked
//   etHalfTimeReached    bool      – ET HT button clicked
//   phase                number    – current phase (1–4)
//   startedAt            Timestamp – kick-off
//   pausedAt             Timestamp – when paused (freeze timer)
//   resumeStartedAt      Timestamp – start 2nd regular half
//   etStartedAt          Timestamp – start 1st ET half
//   etResumeStartedAt    Timestamp – start 2nd ET half
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, onSnapshot, getDocs,
    doc, updateDoc, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Live.js loaded');

// ── Global state ──────────────────────────────────────────────────────────────

let currentUser     = null;
let currentUserData = null;
let currentMatch    = null;
let currentMatchId  = null;
let matchListener   = null;
let eventsListener  = null;
let displayInterval = null;
let hasAccess       = false;

// Players for home (VVS) side only — away is always manual
let homePlayers = [];

// Yellow card counts per player name, rebuilt from events
let yellowCardCounts = {};

const ET_HALF_DURATION = 15;

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

// ── Auth ──────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    if (user) {
        currentUser = user;
        try {
            const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!snap.empty) {
                currentUserData = snap.docs[0].data();
                if (loginLink) loginLink.textContent = 'PROFIEL';
            }
        } catch (e) { console.error('Error loading user data:', e); }
    } else {
        currentUser = null;
        currentUserData = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
    }
    loadLiveMatch();
});

// ── Load live match ───────────────────────────────────────────────────────────

async function loadLiveMatch() {
    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('status', 'in', ['live', 'rust'])
        ));
        if (snap.empty) { window.location.href = 'index.html'; return; }

        currentMatchId = snap.docs[0].id;
        currentMatch   = snap.docs[0].data();

        checkAccess();
        setupMatchListener();
        setupEventsListener();
        updateMatchDisplay();
        startDisplayInterval();

        if (hasAccess) await loadAvailablePlayers();
    } catch (e) {
        console.error('Error loading live match:', e);
        alert('Fout bij laden wedstrijd: ' + e.message);
    }
}

function checkAccess() {
    const panel = document.getElementById('controlPanel');
    if (!currentUser || !currentUserData || !currentMatch) {
        hasAccess = false;
        if (panel) panel.style.display = 'none';
        return;
    }
    const isBestuurslid = currentUserData.categorie === 'bestuurslid';
    const isDesignated  = currentMatch.aangeduidePersonen?.includes(currentUser.uid);
    hasAccess = isBestuurslid || isDesignated;
    if (hasAccess) {
        if (panel) panel.style.display = 'block';
        setupControlButtons();
    } else {
        if (panel) panel.style.display = 'none';
    }
}

// ── Load available players ────────────────────────────────────────────────────

async function loadAvailablePlayers() {
    if (!currentMatchId) return;
    try {
        const snap = await getDocs(collection(db, 'matches', currentMatchId, 'availability'));
        homePlayers = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.available) homePlayers.push({ uid: d.id, name: data.displayName || d.id });
        });
        homePlayers.sort((a, b) => a.name.localeCompare(b.name));
        console.log('Home players loaded:', homePlayers.length);
    } catch (e) { console.error('Error loading players:', e); }
}

// ── Real-time listeners ───────────────────────────────────────────────────────

function setupMatchListener() {
    if (matchListener) matchListener();
    matchListener = onSnapshot(doc(db, 'matches', currentMatchId), snap => {
        if (snap.exists()) {
            currentMatch = snap.data();
            updateMatchDisplay();
            updateControlButtonStates();
        }
    });
}

function setupEventsListener() {
    if (eventsListener) eventsListener();
    eventsListener = onSnapshot(
        query(collection(db, 'events'), where('matchId', '==', currentMatchId)),
        snap => {
            const counts = {};
            snap.forEach(d => {
                const ev = d.data();
                if ((ev.type === 'yellow' || ev.type === 'yellow2red') && ev.speler) {
                    counts[ev.speler] = (counts[ev.speler] || 0) + 1;
                }
            });
            yellowCardCounts = counts;
            loadTimeline(snap);
        }
    );
}

// ── Time calculation ──────────────────────────────────────────────────────────

function getRegularHalfDuration() {
    return currentMatch?.team === 'veteranen' ? 35 : 45;
}

function calculateElapsedSeconds() {
    if (!currentMatch?.startedAt) return 0;
    const phase  = currentMatch.phase || 1;
    const frozen = currentMatch.status === 'rust' && currentMatch.pausedAt;
    const now    = frozen ? currentMatch.pausedAt.toMillis() : Date.now();

    let startMs;
    if (phase === 1) {
        startMs = currentMatch.startedAt.toMillis();
    } else if (phase === 2) {
        startMs = currentMatch.resumeStartedAt?.toMillis();
    } else if (phase === 3) {
        startMs = currentMatch.etStartedAt?.toMillis();
    } else {
        startMs = currentMatch.etResumeStartedAt?.toMillis();
    }
    if (!startMs) return 0;
    return Math.max(0, Math.floor((now - startMs) / 1000));
}

function calculateTimeDisplay() {
    const elapsed  = calculateElapsedSeconds();
    const mins     = Math.floor(elapsed / 60);
    const secs     = elapsed % 60;
    const pad      = s => String(s).padStart(2, '0');
    const halfDur  = getRegularHalfDuration();
    const fullDur  = halfDur * 2;
    const phase    = currentMatch?.phase || 1;
    const status   = currentMatch?.status;

    if (phase === 1) {
        if (mins < halfDur) return `${mins}:${pad(secs)}`;
        return `${halfDur}+${mins - halfDur}:${pad(secs)}`;
    }
    if (phase === 2) {
        // Frozen during rust before 2nd half starts
        if (status === 'rust' && !currentMatch?.resumeStartedAt) return `${halfDur}:00`;
        const disp = halfDur + mins;
        if (disp <= fullDur) return `${disp}:${pad(secs)}`;
        return `${fullDur}+${disp - fullDur}:${pad(secs)}`;
    }
    if (phase === 3) {
        // Frozen during ET rust before ET 1st half starts
        if (status === 'rust' && !currentMatch?.etStartedAt) return `${fullDur}:00`;
        const disp = fullDur + mins;
        const etFull = fullDur + ET_HALF_DURATION;
        if (disp <= etFull) return `${disp}:${pad(secs)}`;
        return `${etFull}+${disp - etFull}:${pad(secs)}`;
    }
    // phase 4
    if (status === 'rust' && !currentMatch?.etResumeStartedAt) return `${fullDur + ET_HALF_DURATION}:00`;
    const disp   = fullDur + ET_HALF_DURATION + mins;
    const etFull = fullDur + ET_HALF_DURATION * 2;
    if (disp <= etFull) return `${disp}:${pad(secs)}`;
    return `${etFull}+${disp - etFull}:${pad(secs)}`;
}

function getCurrentMinuteForEvent() {
    const elapsed = calculateElapsedSeconds();
    const mins    = Math.floor(elapsed / 60);
    const halfDur = getRegularHalfDuration();
    const fullDur = halfDur * 2;
    const phase   = currentMatch?.phase || 1;

    if (phase === 1) return mins;
    if (phase === 2) {
        if (currentMatch?.status === 'rust' && !currentMatch?.resumeStartedAt) return halfDur;
        return halfDur + mins;
    }
    if (phase === 3) return fullDur + mins;
    return fullDur + ET_HALF_DURATION + mins;
}

// ── Display update ────────────────────────────────────────────────────────────

function updateMatchDisplay() {
    if (!currentMatch) return;

    document.getElementById('homeTeamName').textContent  = currentMatch.thuisploeg;
    document.getElementById('awayTeamName').textContent  = currentMatch.uitploeg;
    document.getElementById('homeScore').textContent     = currentMatch.scoreThuis ?? 0;
    document.getElementById('awayScore').textContent     = currentMatch.scoreUit   ?? 0;
    document.getElementById('currentMinute').textContent = calculateTimeDisplay();

    const statusEl = document.getElementById('matchStatus');
    if (statusEl) {
        if (currentMatch.status === 'rust') {
            statusEl.textContent       = 'Rust';
            statusEl.style.background  = '#FFC107';
        } else if (currentMatch.extraTimeStarted) {
            statusEl.textContent       = 'Verlengingen';
            statusEl.style.background  = '#9C27B0';
        } else {
            statusEl.textContent       = 'Live';
            statusEl.style.background  = '#DC3545';
        }
    }

    const descEl = document.getElementById('matchDescription');
    if (descEl) {
        if (currentMatch.beschrijving?.trim()) {
            descEl.textContent    = currentMatch.beschrijving;
            descEl.style.display  = 'block';
        } else {
            descEl.style.display  = 'none';
        }
    }

    if (hasAccess) {
        const hct = document.getElementById('homeTeamControlTitle');
        const act = document.getElementById('awayTeamControlTitle');
        if (hct) hct.textContent = currentMatch.thuisploeg;
        if (act) act.textContent = currentMatch.uitploeg;
    }
}

function startDisplayInterval() {
    if (displayInterval) clearInterval(displayInterval);
    displayInterval = setInterval(() => {
        if (currentMatch?.status === 'live') updateMatchDisplay();
    }, 1000);
}

// ── Control button states ─────────────────────────────────────────────────────

function updateControlButtonStates() {
    if (!hasAccess || !currentMatch) return;

    const phase             = currentMatch.phase || 1;
    const status            = currentMatch.status;
    const extraTimeStarted  = currentMatch.extraTimeStarted  || false;
    const etHalfTimeReached = currentMatch.etHalfTimeReached || false;

    const pauseBtn     = document.getElementById('pauseBtn');
    const resumeBtn    = document.getElementById('resumeBtn');
    const extraTimeBtn = document.getElementById('extraTimeBtn');

    // RUST button: visible during live phase 1 or phase 3 only
    if (pauseBtn) {
        const showPause = status === 'live' && (phase === 1 || phase === 3);
        pauseBtn.style.display = showPause ? 'inline-block' : 'none';
    }

    // HERVAT / START button: visible when status === 'rust'
    if (resumeBtn) {
        resumeBtn.style.display = status === 'rust' ? 'inline-block' : 'none';
        if (status === 'rust') {
            if (!extraTimeStarted) {
                resumeBtn.textContent = 'START 2E HELFT';
            } else if (!etHalfTimeReached) {
                resumeBtn.textContent = 'START VERLENGINGEN';
            } else {
                resumeBtn.textContent = 'START 2E VERLENGING';
            }
        }
    }

    // VERLENGINGEN button: only when live in phase 2, score equal, not veteranen, ET not yet started
    if (extraTimeBtn) {
        const scoreEqual = (currentMatch.scoreThuis ?? 0) === (currentMatch.scoreUit ?? 0);
        const showET = status === 'live'
            && phase === 2
            && !extraTimeStarted
            && scoreEqual
            && currentMatch.team !== 'veteranen';
        extraTimeBtn.style.display = showET ? 'inline-block' : 'none';
    }
}

// ── Setup control buttons ─────────────────────────────────────────────────────

function setupControlButtons() {
    document.querySelectorAll('.control-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', handleControlClick);
    });

    const pauseBtn       = document.getElementById('pauseBtn');
    const resumeBtn      = document.getElementById('resumeBtn');
    const extraTimeBtn   = document.getElementById('extraTimeBtn');
    const endMatchBtn    = document.getElementById('endMatchBtn');
    const scoreCorrectBtn = document.getElementById('scoreCorrectBtn');

    if (pauseBtn)        pauseBtn.addEventListener('click', handlePause);
    if (resumeBtn)       resumeBtn.addEventListener('click', handleResume);
    if (extraTimeBtn)    extraTimeBtn.addEventListener('click', handleExtraTime);
    if (endMatchBtn)     endMatchBtn.addEventListener('click', handleEndMatch);
    if (scoreCorrectBtn) scoreCorrectBtn.addEventListener('click', openScoreModal);

    updateControlButtonStates();
}

// ── Pause handler ─────────────────────────────────────────────────────────────

async function handlePause() {
    try {
        const minute   = getCurrentMinuteForEvent();
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);

        const upd = { status: 'rust', pausedAt: serverTimestamp() };
        if (phase === 1) {
            // End of 1st regular half — advance phase counter to 2 (rust before 2nd half)
            upd.halfTimeReached = true;
            upd.phase = 2;
        } else if (phase === 3) {
            // End of 1st ET half
            upd.etHalfTimeReached = true;
            upd.phase = 4;
        }

        await updateDoc(matchRef, upd);
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut:  minute,
            half:    phase,
            type:    'rust',
            ploeg:   'center',
            speler:  '',
            timestamp: serverTimestamp()
        });
        console.log('Paused at minute', minute, 'phase', phase);
    } catch (e) {
        console.error('Error pausing:', e);
        alert('Fout bij pauze: ' + e.message);
    }
}

// ── Resume handler ────────────────────────────────────────────────────────────

async function handleResume() {
    try {
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);

        const upd = { status: 'live', pausedAt: null };

        if (phase === 2 && !currentMatch.resumeStartedAt) {
            upd.resumeStartedAt = serverTimestamp();
        } else if (phase === 3 && !currentMatch.etStartedAt) {
            upd.etStartedAt = serverTimestamp();
        } else if (phase === 4 && !currentMatch.etResumeStartedAt) {
            upd.etResumeStartedAt = serverTimestamp();
        }

        await updateDoc(matchRef, upd);
        // No event written — timeline stays clean (no "hervat" block)
        console.log('Resumed, phase:', phase);
    } catch (e) {
        console.error('Error resuming:', e);
        alert('Fout bij hervatten: ' + e.message);
    }
}

// ── Extra time handler ────────────────────────────────────────────────────────

async function handleExtraTime() {
    const halfDur = getRegularHalfDuration();
    const fullDur = halfDur * 2;
    if (!confirm(`Verlengingen starten? De timer springt naar ${fullDur}' en er volgen 2 × 15 minuten.`)) return;

    try {
        const minute   = getCurrentMinuteForEvent();
        const matchRef = doc(db, 'matches', currentMatchId);

        // Put in rust so the designated person sees "START VERLENGINGEN"
        await updateDoc(matchRef, {
            status:           'rust',
            pausedAt:         serverTimestamp(),
            extraTimeStarted: true,
            phase:            3
        });

        // Mark end of regular time in the timeline
        await addDoc(collection(db, 'events'), {
            matchId:  currentMatchId,
            minuut:   minute,
            half:     2,
            type:     'einde-regulier',
            ploeg:    'center',
            speler:   '',
            timestamp: serverTimestamp()
        });

        console.log('Extra time initiated at minute', minute);
    } catch (e) {
        console.error('Error starting extra time:', e);
        alert('Fout bij verlengingen: ' + e.message);
    }
}

// ── End match handler ─────────────────────────────────────────────────────────

async function handleEndMatch() {
    if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) return;
    try {
        const minute   = getCurrentMinuteForEvent();
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);

        await updateDoc(matchRef, { status: 'finished' });
        await addDoc(collection(db, 'events'), {
            matchId:  currentMatchId,
            minuut:   minute,
            half:     phase,
            type:     'einde',
            ploeg:    'center',
            speler:   '',
            timestamp: serverTimestamp()
        });

        alert('Wedstrijd beëindigd!');
        window.location.href = 'index.html';
    } catch (e) {
        console.error('Error ending match:', e);
        alert('Fout bij beëindigen: ' + e.message);
    }
}

// ── Player picker modal ───────────────────────────────────────────────────────

let pendingAction = null;

function populateSelect(selectEl, players, emptyLabel = '— Selecteer speler —') {
    selectEl.innerHTML = `<option value="">${emptyLabel}</option>`;
    players.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        selectEl.appendChild(opt);
    });
}

function getModalValue(selectId, manualId) {
    const sel = document.getElementById(selectId);
    const man = document.getElementById(manualId);
    if (sel && sel.value) return sel.value;
    if (man && man.value.trim()) return man.value.trim();
    return '';
}

function handleControlClick(e) {
    const btn    = e.currentTarget;
    const team   = btn.dataset.team;
    const action = btn.dataset.action;

    pendingAction = { team, action };

    const modal           = document.getElementById('playerModal');
    const modalTitle      = document.getElementById('modalTitle');
    const singleSection   = document.getElementById('singlePlayerSection');
    const assistSection   = document.getElementById('assistSection');
    const subSection      = document.getElementById('substitutionSection');
    const pickerLabel     = document.getElementById('playerPickerLabel');

    singleSection.style.display = 'none';
    assistSection.style.display = 'none';
    subSection.style.display    = 'none';

    const actionNames = {
        goal: 'Goal', penalty: 'Penalty', 'own-goal': 'Eigen Doelpunt',
        yellow: 'Gele Kaart', red: 'Rode Kaart', substitution: 'Wissel'
    };
    modalTitle.textContent = actionNames[action] || action;

    const isAway   = team === 'away';
    const players  = isAway ? [] : homePlayers; // away → always manual

    if (action === 'substitution') {
        subSection.style.display = 'block';
        const outSel = document.getElementById('playerOutSelect');
        const inSel  = document.getElementById('playerInSelect');
        populateSelect(outSel, players, '— Speler uit —');
        populateSelect(inSel,  players, '— Speler in —');
        // Hide dropdowns for away (empty anyway, but cleaner)
        outSel.style.display = isAway ? 'none' : '';
        inSel.style.display  = isAway ? 'none' : '';
        document.getElementById('playerOutManualInput').value = '';
        document.getElementById('playerInManualInput').value  = '';
    } else {
        singleSection.style.display = 'block';
        pickerLabel.textContent = action === 'own-goal' ? 'Speler (eigen doelpunt)' : 'Speler';
        const playerSel = document.getElementById('playerSelect');
        populateSelect(playerSel, players);
        playerSel.style.display = isAway ? 'none' : '';
        document.getElementById('playerManualInput').value = '';

        if (action === 'goal' || action === 'penalty') {
            assistSection.style.display = 'block';
            const assistSel = document.getElementById('assistSelect');
            populateSelect(assistSel, players, '— Geen assist —');
            assistSel.style.display = isAway ? 'none' : '';
            document.getElementById('assistManualInput').value = '';
        }
    }

    modal.classList.add('active');
}

// ── Modal confirm / cancel ────────────────────────────────────────────────────

const modalConfirm = document.getElementById('modalConfirm');
const modalCancel  = document.getElementById('modalCancel');

if (modalConfirm) {
    modalConfirm.addEventListener('click', async () => {
        if (!pendingAction) return;
        const modal = document.getElementById('playerModal');
        const { team, action } = pendingAction;

        let playerName = '', assistName = '', playerOut = '', playerIn = '';

        if (action === 'substitution') {
            playerOut = getModalValue('playerOutSelect', 'playerOutManualInput');
            playerIn  = getModalValue('playerInSelect',  'playerInManualInput');
        } else {
            playerName = getModalValue('playerSelect', 'playerManualInput');
            if (action === 'goal' || action === 'penalty') {
                assistName = getModalValue('assistSelect', 'assistManualInput');
            }
        }

        modal.classList.remove('active');
        await executeAction(team, action, playerName, playerOut, playerIn, assistName);
        pendingAction = null;
    });
}
if (modalCancel) {
    modalCancel.addEventListener('click', () => {
        document.getElementById('playerModal').classList.remove('active');
        pendingAction = null;
    });
}

// ── Execute action ────────────────────────────────────────────────────────────

async function executeAction(team, action, playerName = '', playerOut = '', playerIn = '', assistName = '') {
    try {
        const minute   = getCurrentMinuteForEvent();
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);

        let resolvedAction = action;
        if (action === 'yellow' && playerName && (yellowCardCounts[playerName] || 0) >= 1) {
            resolvedAction = 'yellow2red';
        }

        const eventData = {
            matchId: currentMatchId,
            minuut:  minute,
            half:    phase,
            type:    resolvedAction,
            ploeg:   team,
            speler:  playerName,
            timestamp: serverTimestamp()
        };

        if ((resolvedAction === 'goal' || resolvedAction === 'penalty') && assistName) {
            eventData.assist = assistName;
        }

        if (resolvedAction === 'goal' || resolvedAction === 'penalty') {
            const field    = team === 'home' ? 'scoreThuis' : 'scoreUit';
            const newScore = ((team === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) || 0) + 1;
            await updateDoc(matchRef, { [field]: newScore });
        } else if (resolvedAction === 'own-goal') {
            const oppTeam  = team === 'home' ? 'away' : 'home';
            const field    = oppTeam === 'home' ? 'scoreThuis' : 'scoreUit';
            const cur      = (oppTeam === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) || 0;
            await updateDoc(matchRef, { [field]: cur + 1 });
        }

        if (resolvedAction === 'substitution') {
            eventData.spelerUit = playerOut;
            eventData.spelerIn  = playerIn;
        }

        await addDoc(collection(db, 'events'), eventData);
        console.log('Action:', resolvedAction, 'min:', minute, 'phase:', phase);
    } catch (e) {
        console.error('Error executing action:', e);
        alert('Fout bij uitvoeren actie: ' + e.message);
    }
}

// ── Score correction modal ────────────────────────────────────────────────────

function openScoreModal() {
    document.getElementById('homeTeamLabel').textContent = currentMatch.thuisploeg;
    document.getElementById('awayTeamLabel').textContent = currentMatch.uitploeg;
    document.getElementById('homeScoreInput').value      = currentMatch.scoreThuis ?? 0;
    document.getElementById('awayScoreInput').value      = currentMatch.scoreUit   ?? 0;
    document.getElementById('scoreModal').classList.add('active');
}

const scoreModalConfirm = document.getElementById('scoreModalConfirm');
const scoreModalCancel  = document.getElementById('scoreModalCancel');

if (scoreModalConfirm) {
    scoreModalConfirm.addEventListener('click', async () => {
        const h = parseInt(document.getElementById('homeScoreInput').value) || 0;
        const a = parseInt(document.getElementById('awayScoreInput').value) || 0;
        try {
            await updateDoc(doc(db, 'matches', currentMatchId), { scoreThuis: h, scoreUit: a });
            document.getElementById('scoreModal').classList.remove('active');
        } catch (e) {
            console.error('Error correcting score:', e);
            alert('Fout bij aanpassen score: ' + e.message);
        }
    });
}
if (scoreModalCancel) {
    scoreModalCancel.addEventListener('click', () => {
        document.getElementById('scoreModal').classList.remove('active');
    });
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function loadTimeline(snapshot) {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    if (snapshot.empty) {
        timeline.innerHTML = '<div class="timeline-empty">Nog geen events...</div>';
        return;
    }

    const events = [];
    snapshot.forEach(d => events.push({ id: d.id, ...d.data() }));
    timeline.innerHTML = '';
    renderTimeline(events, timeline);
}

/**
 * Shared renderer — also used by team.js for post-match timeline.
 * Groups events by phase (half), inserts structural separators.
 * Display order (top = most recent):
 *   einde → ET half 4 events → ET rust → ET half 3 events
 *   → einde-regulier → regular half 2 events → rust (HT) → regular half 1 events → aftrap
 */
export function renderTimeline(events, container) {
    const STRUCTURAL = new Set(['aftrap', 'rust', 'einde-regulier', 'einde']);
    const structural = events.filter(e => STRUCTURAL.has(e.type));
    const regular    = events.filter(e => !STRUCTURAL.has(e.type));

    const byHalf = { 1: [], 2: [], 3: [], 4: [] };
    regular.forEach(e => {
        const h = e.half || 1;
        if (byHalf[h]) byHalf[h].push(e);
    });

    const sortDesc = (a, b) => {
        const d = (b.minuut || 0) - (a.minuut || 0);
        if (d !== 0) return d;
        if (a.timestamp && b.timestamp) return b.timestamp.toMillis() - a.timestamp.toMillis();
        return 0;
    };
    [1, 2, 3, 4].forEach(h => byHalf[h].sort(sortDesc));

    const rustEvents    = structural.filter(e => e.type === 'rust');
    const rustHT        = rustEvents.find(e => e.half === 1 || e.half === 2) || rustEvents[0] || null;
    const rustET        = rustEvents.find(e => e.half === 3 || e.half === 4);
    const aftrap        = structural.find(e => e.type === 'aftrap');
    const eindeReg      = structural.find(e => e.type === 'einde-regulier');
    const einde         = structural.find(e => e.type === 'einde');

    const ordered = [];
    if (einde) ordered.push(einde);

    byHalf[4].forEach(e => ordered.push(e));
    if (rustET) ordered.push(rustET);
    byHalf[3].forEach(e => ordered.push(e));
    if (eindeReg) ordered.push(eindeReg);
    byHalf[2].forEach(e => ordered.push(e));
    if (rustHT) ordered.push(rustHT);
    byHalf[1].forEach(e => ordered.push(e));
    if (aftrap) ordered.push(aftrap);

    ordered.forEach(e => container.appendChild(createEventElement(e)));
}

// Returns an <img> tag for a given event type.
// All PNG files are expected in /assets/.
function eventIcon(type, half) {
    const img = (file, alt) =>
        `<img src="assets/${file}" alt="${alt}" class="timeline-icon-img">`;

    switch (type) {
        case 'aftrap':        return img('goal.png',      'Aftrap');
        case 'goal':          return img('goal.png',      'Goal');
        case 'penalty':       return img('penalty.png',   'Penalty');
        case 'own-goal':      return img('own-goal.png',  'Eigen doelpunt');
        case 'yellow':        return img('yellow.png',    'Gele kaart');
        case 'yellow2red':    return img('yellow2red.png','2e Gele kaart / Rood');
        case 'red':           return img('red.png',       'Rode kaart');
        case 'substitution':  return img('sub.png',       'Wissel');
        case 'rust':
            return (half >= 3)
                ? img('rust.png', 'Rust verlengingen')
                : img('rust.png', 'Rust');
        case 'einde-regulier': return img('extra-time.png', 'Verlengingen');
        case 'einde':          return img('einde.png',       'Einde');
        default:               return `<span class="timeline-icon-fallback">•</span>`;
    }
}

export function createEventElement(event) {
    const div = document.createElement('div');
    div.className = `timeline-event ${event.type}`;

    let teamClass = 'center';
    if (event.ploeg === 'home') teamClass = 'home';
    else if (event.ploeg === 'away') teamClass = 'away';
    div.classList.add(teamClass);

    let text = '';

    switch (event.type) {
        case 'aftrap':
            text = 'Aftrap'; break;
        case 'goal':
            text = `GOAL${event.speler ? ' - ' + event.speler : ''}`;
            if (event.assist) text += ` <span class="event-assist">(assist: ${event.assist})</span>`;
            break;
        case 'penalty':
            text = `PENALTY${event.speler ? ' - ' + event.speler : ''}`;
            if (event.assist) text += ` <span class="event-assist">(assist: ${event.assist})</span>`;
            break;
        case 'own-goal':
            text = `Eigen doelpunt${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'yellow':
            text = `Gele kaart${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'yellow2red':
            text = `2e Gele kaart (Rood)${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'red':
            text = `Rode kaart${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'substitution':
            text = `Wissel${event.spelerUit && event.spelerIn ? ': ' + event.spelerUit + ' → ' + event.spelerIn : ''}`; break;
        case 'rust':
            text = (event.half >= 3) ? 'Rust verlengingen' : 'Rust'; break;
        case 'einde-regulier':
            text = 'Einde reguliere tijd — Verlengingen'; break;
        case 'einde':
            text = 'Einde wedstrijd'; break;
        default:
            text = event.type;
    }

    div.innerHTML = `
        <span class="event-time">${event.minuut}'</span>
        <span class="event-icon">${eventIcon(event.type, event.half)}</span>
        <span class="event-text">${text}</span>
    `;
    return div;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
    if (matchListener)   matchListener();
    if (eventsListener)  eventsListener();
    if (displayInterval) clearInterval(displayInterval);
});

console.log('Live.js initialization complete');
