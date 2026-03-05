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
//
// NEW: Lineup & minute-tracking fields on match doc:
//   lineup          { uid: { name, status } }
//                   status: 'starter' | 'bench' | 'out'
//   lineupConfirmed bool   – set to true after lineup step
//
// Player minute tracking stored per-match in:
//   matches/{matchId}/playerMinutes/{uid}
//     { uid, name, minuteOn, minuteOff (null if still on) }
//
// On match end, for every VVS player with uid we update their
// users doc with cumulative stats (goals, assists, geelKaarten,
// roodKaarten, matchen, minuten).
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, query, where, onSnapshot, getDocs,
    doc, getDoc, updateDoc, addDoc, setDoc, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Live.js loaded (with lineup + stat tracking)');

// ── Global state ──────────────────────────────────────────────────────────────

let currentUser     = null;
let currentUserData = null;
let currentMatch    = null;
let currentMatchId  = null;
let matchListener   = null;
let eventsListener  = null;
let displayInterval = null;
let hasAccess       = false;

// All players who marked available for this match
// { uid, name, isExternal }
let availablePlayers = [];

// Current active lineup:
//   activePlayers  — on the pitch right now (selectable for goals etc.)
//   benchPlayers   — on bench (selectable for cards + sub-in)
//   outPlayers     — subbed off (not selectable for goals; selectable for cards)
let activePlayers = [];
let benchPlayers  = [];
let outPlayers    = [];

// Which side VVS plays: 'home' | 'away'
let vvsSide = 'home';

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

        if (hasAccess) {
            await loadAvailablePlayers();
        }
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
        availablePlayers = [];
        snap.forEach(d => {
            const data = d.data();
            if (data.available) {
                availablePlayers.push({
                    uid:        d.id,
                    name:       data.displayName || d.id,
                    isExternal: !!data.isExternalPlayer
                });
            }
        });
        availablePlayers.sort((a, b) => a.name.localeCompare(b.name));

        // Determine VVS side
        const thuisploeg = (currentMatch?.thuisploeg || '').toLowerCase();
        vvsSide = thuisploeg.includes('rotselaar') ? 'home' : 'away';

        // If lineup already confirmed, rebuild active/bench/out from match.lineup
        if (currentMatch.lineupConfirmed && currentMatch.lineup) {
            rebuildLineupFromMatch();
        }

        console.log('Available players:', availablePlayers.length, '| VVS side:', vvsSide);
    } catch (e) { console.error('Error loading players:', e); }
}

// Rebuild the three player arrays from the saved lineup on the match doc
function rebuildLineupFromMatch() {
    activePlayers = [];
    benchPlayers  = [];
    outPlayers    = [];
    const lineup = currentMatch.lineup || {};
    for (const [uid, info] of Object.entries(lineup)) {
        const p = { uid, name: info.name };
        if (info.status === 'starter') activePlayers.push(p);
        else if (info.status === 'bench') benchPlayers.push(p);
        else if (info.status === 'out') outPlayers.push(p);
    }
    activePlayers.sort((a, b) => a.name.localeCompare(b.name));
    benchPlayers.sort((a, b) => a.name.localeCompare(b.name));
}
// ── Real-time listeners ───────────────────────────────────────────────────────

function setupMatchListener() {
    if (matchListener) matchListener();
    matchListener = onSnapshot(doc(db, 'matches', currentMatchId), snap => {
        if (snap.exists()) {
            currentMatch = snap.data();
            // Sync lineup arrays whenever match updates
            if (currentMatch.lineupConfirmed && currentMatch.lineup) {
                rebuildLineupFromMatch();
            }
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
    if (phase === 1)      startMs = currentMatch.startedAt.toMillis();
    else if (phase === 2) startMs = currentMatch.resumeStartedAt?.toMillis();
    else if (phase === 3) startMs = currentMatch.etStartedAt?.toMillis();
    else                  startMs = currentMatch.etResumeStartedAt?.toMillis();

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
        if (status === 'rust' && !currentMatch?.resumeStartedAt) return `${halfDur}:00`;
        const disp = halfDur + mins;
        if (disp < fullDur) return `${disp}:${pad(secs)}`;
        return `${fullDur}+${disp - fullDur}:${pad(secs)}`;
    }
    if (phase === 3) {
        if (status === 'rust' && !currentMatch?.etStartedAt) return `${fullDur}:00`;
        const disp = fullDur + mins;
        const etFull = fullDur + ET_HALF_DURATION;
        if (disp < etFull) return `${disp}:${pad(secs)}`;
        return `${etFull}+${disp - etFull}:${pad(secs)}`;
    }
    if (status === 'rust' && !currentMatch?.etResumeStartedAt) return `${fullDur + ET_HALF_DURATION}:00`;
    const disp   = fullDur + ET_HALF_DURATION + mins;
    const etFull = fullDur + ET_HALF_DURATION * 2;
    if (disp < etFull) return `${disp}:${pad(secs)}`;
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
            statusEl.textContent      = 'Rust';
            statusEl.style.background = '#FFC107';
        } else if (currentMatch.extraTimeStarted) {
            statusEl.textContent      = 'Verlengingen';
            statusEl.style.background = '#9C27B0';
        } else {
            statusEl.textContent      = 'Live';
            statusEl.style.background = '#DC3545';
        }
    }

    const descEl = document.getElementById('matchDescription');
    if (descEl) {
        if (currentMatch.beschrijving?.trim()) {
            descEl.textContent   = currentMatch.beschrijving;
            descEl.style.display = 'block';
        } else {
            descEl.style.display = 'none';
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

    if (pauseBtn) {
        const showPause = status === 'live' && (phase === 1 || phase === 3);
        pauseBtn.style.display = showPause ? 'inline-block' : 'none';
    }
    if (resumeBtn) {
        resumeBtn.style.display = status === 'rust' ? 'inline-block' : 'none';
        if (status === 'rust') {
            if (!extraTimeStarted)           resumeBtn.textContent = 'START 2E HELFT';
            else if (!etHalfTimeReached)     resumeBtn.textContent = 'START VERLENGINGEN';
            else                             resumeBtn.textContent = 'START 2E VERLENGING';
        }
    }
    if (extraTimeBtn) {
        const scoreEqual = (currentMatch.scoreThuis ?? 0) === (currentMatch.scoreUit ?? 0);
        const showET = status === 'live' && phase === 2 && !extraTimeStarted
            && scoreEqual && currentMatch.team !== 'veteranen';
        extraTimeBtn.style.display = showET ? 'inline-block' : 'none';
    }
}

// ── Setup control buttons ─────────────────────────────────────────────────────

function setupControlButtons() {
    document.querySelectorAll('.control-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', handleControlClick);
    });

    const pauseBtn        = document.getElementById('pauseBtn');
    const resumeBtn       = document.getElementById('resumeBtn');
    const extraTimeBtn    = document.getElementById('extraTimeBtn');
    const endMatchBtn     = document.getElementById('endMatchBtn');
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
        const now      = Timestamp.fromDate(new Date());
        const upd      = { status: 'rust', pausedAt: now };
        if (phase === 1) { upd.halfTimeReached = true; upd.phase = 2; }
        else if (phase === 3) { upd.etHalfTimeReached = true; upd.phase = 4; }

        await updateDoc(matchRef, upd);
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId, minuut: minute, half: phase,
            type: 'rust', ploeg: 'center', speler: '', timestamp: serverTimestamp()
        });
    } catch (e) { console.error('Error pausing:', e); alert('Fout bij pauze: ' + e.message); }
}

// ── Resume handler ────────────────────────────────────────────────────────────

async function handleResume() {
    try {
        const phase    = currentMatch.phase || 1;
        const matchRef = doc(db, 'matches', currentMatchId);
        const now      = Timestamp.fromDate(new Date());
        const upd      = { status: 'live', pausedAt: null };

        if (phase === 2 && !currentMatch.resumeStartedAt)    upd.resumeStartedAt   = now;
        else if (phase === 3 && !currentMatch.etStartedAt)   upd.etStartedAt       = now;
        else if (phase === 4 && !currentMatch.etResumeStartedAt) upd.etResumeStartedAt = now;

        await updateDoc(matchRef, upd);
    } catch (e) { console.error('Error resuming:', e); alert('Fout bij hervatten: ' + e.message); }
}

// ── Extra time handler ────────────────────────────────────────────────────────

async function handleExtraTime() {
    const halfDur = getRegularHalfDuration();
    const fullDur = halfDur * 2;
    if (!confirm(`Verlengingen starten? De timer springt naar ${fullDur}' en er volgen 2 × 15 minuten.`)) return;
    try {
        const minute = getCurrentMinuteForEvent();
        await updateDoc(doc(db, 'matches', currentMatchId), {
            status: 'rust', pausedAt: Timestamp.fromDate(new Date()),
            extraTimeStarted: true, phase: 3
        });
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId, minuut: minute, half: 2,
            type: 'einde-regulier', ploeg: 'center', speler: '', timestamp: serverTimestamp()
        });
    } catch (e) { console.error('Error starting extra time:', e); alert('Fout bij verlengingen: ' + e.message); }
}

// ── End match handler — with stat finalization ────────────────────────────────

async function handleEndMatch() {
    if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) return;
    try {
        const minute = getCurrentMinuteForEvent();
        const phase  = currentMatch.phase || 1;

        await updateDoc(doc(db, 'matches', currentMatchId), { status: 'finished' });
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId, minuut: minute, half: phase,
            type: 'einde', ploeg: 'center', speler: '', timestamp: serverTimestamp()
        });

        // Finalize player stats
        await finalizePlayerStats(minute);

        // Invalideer de localStorage-cache voor alle spelers in de lineup
        // zodat hun profiel direct de nieuwe stats toont na de wedstrijd.
        try {
            const lineup = currentMatch.lineup || {};
            const team   = currentMatch.team   || '';
            for (const uid of Object.keys(lineup)) {
                localStorage.removeItem(`vvs_profile_${uid}`);
                localStorage.removeItem(`vvs_history_${uid}`);
            }
            // Teampagina's: recente wedstrijden en stats zijn nu verouderd
            localStorage.removeItem(`vvs_recent_matches_${team}`);
            localStorage.removeItem(`vvs_team_stats_${team}`);
            localStorage.removeItem(`vvs_next_match_${team}`);
        } catch (_) {}

        alert('Wedstrijd beëindigd!');
        window.location.href = 'index.html';
    } catch (e) { console.error('Error ending match:', e); alert('Fout bij beëindigen: ' + e.message); }
}

// ── Finalize stats on match end ───────────────────────────────────────────────
// For every VVS player with a real uid (non-external), increment their cumulative
// stats in the users collection.

async function finalizePlayerStats(finalMinute) {
    try {
        // 1. Get all playerMinutes records
        const pmSnap = await getDocs(
            collection(db, 'matches', currentMatchId, 'playerMinutes')
        );

        // 2. Fetch all events for this match
        const eventsSnap = await getDocs(
            query(collection(db, 'events'), where('matchId', '==', currentMatchId))
        );
        const events = [];
        eventsSnap.forEach(d => events.push(d.data()));

        // Build a map: playerName → uid (for event lookup by name)
        // Using the lineup stored on the match doc
        const nameToUid = {};
        const lineup = currentMatch.lineup || {};
        for (const [uid, info] of Object.entries(lineup)) {
            nameToUid[info.name] = uid;
        }

        // 3. For each player with a minute record, compute played minutes
        const playerUpdates = {}; // uid → { minuten, matchen, goals, assists, geelKaarten, roodKaarten }

        pmSnap.forEach(d => {
            const pm = d.data();
            const uid = pm.uid;
            if (!uid || uid.startsWith('manual_')) return; // skip external/manual players

            const minuteOn  = pm.minuteOn  ?? 0;
            const minuteOff = pm.minuteOff ?? finalMinute;
            const played    = Math.max(0, minuteOff - minuteOn);

            playerUpdates[uid] = {
                minuten:      played,
                matchen:      1,
                goals:        0,
                assists:      0,
                geelKaarten:  0,
                roodKaarten:  0
            };
        });

        // 4. Count events per player by name → uid mapping
        events.forEach(ev => {
            if (!ev.speler) return;
            const uid = nameToUid[ev.speler];
            if (!uid || !playerUpdates[uid]) return;

            switch (ev.type) {
                case 'goal':
                case 'penalty':
                    playerUpdates[uid].goals++;
                    break;
                case 'own-goal':
                    // own goal doesn't count positively
                    break;
            }
            // Assists
            if ((ev.type === 'goal' || ev.type === 'penalty') && ev.assist) {
                const assistUid = nameToUid[ev.assist];
                if (assistUid && playerUpdates[assistUid]) {
                    playerUpdates[assistUid].assists++;
                }
            }
            // Cards
            if (ev.type === 'yellow') playerUpdates[uid].geelKaarten++;
            if (ev.type === 'yellow2red') { playerUpdates[uid].geelKaarten++; playerUpdates[uid].roodKaarten++; }
            if (ev.type === 'red') playerUpdates[uid].roodKaarten++;
        });

        // 5. Apply increments to each user doc
        const userUpdatePromises = [];
        for (const [uid, delta] of Object.entries(playerUpdates)) {
            userUpdatePromises.push(incrementUserStats(uid, delta));
        }
        await Promise.all(userUpdatePromises);
        console.log('Player stats finalized for', Object.keys(playerUpdates).length, 'players');

    } catch (e) {
        console.error('Error finalizing player stats:', e);
        // Non-fatal — match is still ended
    }
}

async function incrementUserStats(uid, delta) {
    try {
        // Find the user doc (uid is stored as a field, not doc ID)
        const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', uid)));
        if (snap.empty) return;

        const userDocId  = snap.docs[0].id;
        const userData   = snap.docs[0].data();
        const userDocRef = doc(db, 'users', userDocId);

        await updateDoc(userDocRef, {
            goals:       (userData.goals       || 0) + delta.goals,
            assists:     (userData.assists     || 0) + delta.assists,
            geelKaarten: (userData.geelKaarten || 0) + delta.geelKaarten,
            roodKaarten: (userData.roodKaarten || 0) + delta.roodKaarten,
            matchen:     (userData.matchen     || 0) + delta.matchen,
            minuten:     (userData.minuten     || 0) + delta.minuten,
        });
    } catch (e) {
        console.error(`Error updating stats for uid ${uid}:`, e);
    }
}

// ── Player picker modal ───────────────────────────────────────────────────────

let pendingAction = null;

// Returns the correct player list depending on the action type
function getPlayersForAction(action, isVvs) {
    if (!isVvs) return []; // opponent: always manual

    switch (action) {
        case 'goal':
        case 'penalty':
        case 'own-goal':
            // Only players currently on the pitch
            return [...activePlayers];
        case 'yellow':
        case 'red':
            // Active + bench + subbed off can all receive cards
            return [...activePlayers, ...benchPlayers, ...outPlayers];
        case 'substitution':
            // Uit: actieve spelers op het veld
            // In: bankspelers + eerder gewisselde spelers (kunnen terugkomen)
            return { out: [...activePlayers], in: [...benchPlayers, ...outPlayers] };
        default:
            return [...activePlayers];
    }
}

function populateSelect(selectEl, players, emptyLabel = '— Selecteer speler —') {
    selectEl.innerHTML = `<option value="">${emptyLabel}</option>`;
    players.forEach(p => {
        const opt = document.createElement('option');
        opt.value       = p.name;
        opt.textContent = p.name;
        selectEl.appendChild(opt);
    });
}

function getModalValue(selectId, manualId, isOpponent = false) {
    const sel = document.getElementById(selectId);
    const man = document.getElementById(manualId);
    if (sel && sel.value) return sel.value;
    if (man && man.value.trim()) {
        const val = man.value.trim();
        if (isOpponent && /^\d+$/.test(val)) return `Nummer ${val}`;
        return val;
    }
    return '';
}

function handleControlClick(e) {
    const btn    = e.currentTarget;
    const team   = btn.dataset.team;
    const action = btn.dataset.action;

    pendingAction = { team, action };

    const modal         = document.getElementById('playerModal');
    const modalTitle    = document.getElementById('modalTitle');
    const singleSection = document.getElementById('singlePlayerSection');
    const assistSection = document.getElementById('assistSection');
    const subSection    = document.getElementById('substitutionSection');
    const pickerLabel   = document.getElementById('playerPickerLabel');

    singleSection.style.display = 'none';
    assistSection.style.display = 'none';
    subSection.style.display    = 'none';

    const actionNames = {
        goal: 'Goal', penalty: 'Penalty', 'own-goal': 'Eigen Doelpunt',
        yellow: 'Gele Kaart', red: 'Rode Kaart', substitution: 'Wissel'
    };
    modalTitle.textContent = actionNames[action] || action;

    const isVvs = team === vvsSide;

    const injuryRow       = document.getElementById('injuryRow');
    const injuryCheck     = document.getElementById('injuryCheck');
    const penaltyMissedRow = document.getElementById('penaltyMissedRow');
    if (injuryRow)       injuryRow.style.display    = 'none';
    if (injuryCheck)     injuryCheck.checked         = false;
    if (penaltyMissedRow) penaltyMissedRow.style.display = 'none';

    if (action === 'substitution') {
        subSection.style.display = 'block';
        const outSel = document.getElementById('playerOutSelect');
        const inSel  = document.getElementById('playerInSelect');

        if (isVvs) {
            const subPlayers = getPlayersForAction('substitution', true);
            populateSelect(outSel, subPlayers.out, '— Speler uit —');
            populateSelect(inSel,  subPlayers.in,  '— Speler in —');
            outSel.style.display = '';
            inSel.style.display  = '';
        } else {
            populateSelect(outSel, [], '— Speler uit —');
            populateSelect(inSel,  [], '— Speler in —');
            outSel.style.display = 'none';
            inSel.style.display  = 'none';
        }

        document.getElementById('playerOutManualInput').placeholder = isVvs ? 'Of typ naam handmatig...' : 'Rugnummer (bijv. 10)';
        document.getElementById('playerInManualInput').placeholder  = isVvs ? 'Of typ naam handmatig...' : 'Rugnummer (bijv. 10)';
        document.getElementById('playerOutManualInput').value = '';
        document.getElementById('playerInManualInput').value  = '';
        if (injuryRow) injuryRow.style.display = 'flex';

    } else {
        singleSection.style.display = 'block';
        pickerLabel.textContent = action === 'own-goal' ? 'Speler (eigen doelpunt)' : 'Speler';

        const players   = isVvs ? getPlayersForAction(action, true) : [];
        const playerSel = document.getElementById('playerSelect');
        populateSelect(playerSel, players);
        playerSel.style.display = isVvs ? '' : 'none';
        document.getElementById('playerManualInput').placeholder = isVvs ? 'Of typ naam handmatig...' : 'Rugnummer (bijv. 10)';
        document.getElementById('playerManualInput').value = '';

        if (action === 'goal' || action === 'penalty') {
            assistSection.style.display = 'block';
            const assistSel = document.getElementById('assistSelect');
            // Assists: active players only (they must be on the pitch)
            const assistPlayers = isVvs ? [...activePlayers] : [];
            populateSelect(assistSel, assistPlayers, '— Geen assist —');
            assistSel.style.display = isVvs ? '' : 'none';
            document.getElementById('assistManualInput').placeholder = isVvs ? 'Of typ naam handmatig...' : 'Rugnummer (bijv. 10)';
            document.getElementById('assistManualInput').value = '';
        }
        if (action === 'penalty' && penaltyMissedRow) {
            penaltyMissedRow.style.display = 'flex';
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
        const isOpponent = team !== vvsSide;

        let playerName = '', assistName = '', playerOut = '', playerIn = '';
        let injured = false;

        if (action === 'substitution') {
            playerOut = getModalValue('playerOutSelect', 'playerOutManualInput', isOpponent);
            playerIn  = getModalValue('playerInSelect',  'playerInManualInput',  isOpponent);
            const injuryCheck = document.getElementById('injuryCheck');
            injured = injuryCheck ? injuryCheck.checked : false;
        } else {
            playerName = getModalValue('playerSelect', 'playerManualInput', isOpponent);
            if (action === 'goal' || action === 'penalty') {
                assistName = getModalValue('assistSelect', 'assistManualInput', isOpponent);
            }
        }

        modal.classList.remove('active');
        await executeAction(team, action, playerName, playerOut, playerIn, assistName, { injured });
        pendingAction = null;
    });
}
if (modalCancel) {
    modalCancel.addEventListener('click', () => {
        document.getElementById('playerModal').classList.remove('active');
        pendingAction = null;
    });
}

const penaltyMissedBtn = document.getElementById('penaltyMissedBtn');
if (penaltyMissedBtn) {
    penaltyMissedBtn.addEventListener('click', async () => {
        if (!pendingAction) return;
        const modal      = document.getElementById('playerModal');
        const { team }   = pendingAction;
        const isOpponent = team !== vvsSide;
        const playerName = getModalValue('playerSelect', 'playerManualInput', isOpponent);
        modal.classList.remove('active');
        await executeAction(team, 'penalty-missed', playerName, '', '', '', {});
        pendingAction = null;
    });
}

// ── Execute action ────────────────────────────────────────────────────────────

async function executeAction(team, action, playerName = '', playerOut = '', playerIn = '', assistName = '', options = {}) {
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

        // Score updates
        if (resolvedAction === 'goal' || resolvedAction === 'penalty') {
            const field    = team === 'home' ? 'scoreThuis' : 'scoreUit';
            const newScore = ((team === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) || 0) + 1;
            await updateDoc(matchRef, { [field]: newScore });
        } else if (resolvedAction === 'own-goal') {
            const oppTeam = team === 'home' ? 'away' : 'home';
            const field   = oppTeam === 'home' ? 'scoreThuis' : 'scoreUit';
            const cur     = (oppTeam === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) || 0;
            await updateDoc(matchRef, { [field]: cur + 1 });
        }

        // Substitution: update lineup + playerMinutes
        if (resolvedAction === 'substitution' && team === vvsSide) {
            eventData.spelerUit = playerOut;
            eventData.spelerIn  = playerIn;
            if (options.injured) eventData.injured = true;

            await handleSubstitutionLineup(playerOut, playerIn, minute);
        } else if (resolvedAction === 'substitution') {
            eventData.spelerUit = playerOut;
            eventData.spelerIn  = playerIn;
            if (options.injured) eventData.injured = true;
        }

        await addDoc(collection(db, 'events'), eventData);
        console.log('Action:', resolvedAction, 'min:', minute, 'phase:', phase);

    } catch (e) {
        console.error('Error executing action:', e);
        alert('Fout bij uitvoeren actie: ' + e.message);
    }
}

// ── Handle substitution lineup update ────────────────────────────────────────

async function handleSubstitutionLineup(playerOutName, playerInName, minute) {
    const lineup = { ...(currentMatch.lineup || {}) };

    // Find uids by name
    let uidOut = null, uidIn = null;
    for (const [uid, info] of Object.entries(lineup)) {
        if (info.name === playerOutName) uidOut = uid;
        if (info.name === playerInName)  uidIn  = uid;
    }

    const updates = {};

    // Update lineup statuses
    if (uidOut) {
        lineup[uidOut] = { ...lineup[uidOut], status: 'out' };
        updates[`lineup.${uidOut}.status`] = 'out';
    }
    if (uidIn) {
        lineup[uidIn] = { ...lineup[uidIn], status: 'starter' };
        updates[`lineup.${uidIn}.status`] = 'starter';
    }

    if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, 'matches', currentMatchId), updates);
    }

    // Update playerMinutes: record minuteOff for player going out
    if (uidOut && !uidOut.startsWith('manual_')) {
        await setDoc(
            doc(db, 'matches', currentMatchId, 'playerMinutes', uidOut),
            { uid: uidOut, name: playerOutName, minuteOff: minute },
            { merge: true }
        );
    }

    // Record minuteOn for player coming in
    if (uidIn && !uidIn.startsWith('manual_')) {
        await setDoc(
            doc(db, 'matches', currentMatchId, 'playerMinutes', uidIn),
            { uid: uidIn, name: playerInName, minuteOn: minute, minuteOff: null },
            { merge: true }
        );
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
        } catch (e) { console.error('Score correction error:', e); alert('Fout: ' + e.message); }
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

export function renderTimeline(events, container) {
    const STRUCTURAL = new Set(['aftrap', 'rust', 'einde-regulier', 'einde']);
    const structural = events.filter(e => STRUCTURAL.has(e.type));
    const regular    = events.filter(e => !STRUCTURAL.has(e.type));

    const byHalf = { 1: [], 2: [], 3: [], 4: [] };
    regular.forEach(e => { const h = e.half || 1; if (byHalf[h]) byHalf[h].push(e); });

    const sortDesc = (a, b) => {
        const d = (b.minuut || 0) - (a.minuut || 0);
        if (d !== 0) return d;
        if (a.timestamp && b.timestamp) return b.timestamp.toMillis() - a.timestamp.toMillis();
        return 0;
    };
    [1, 2, 3, 4].forEach(h => byHalf[h].sort(sortDesc));

    const rustEvents = structural.filter(e => e.type === 'rust');
    const rustHT     = rustEvents.find(e => e.half === 1 || e.half === 2) || rustEvents[0] || null;
    const rustET     = rustEvents.find(e => e.half === 3 || e.half === 4);
    const aftrap     = structural.find(e => e.type === 'aftrap');
    const eindeReg   = structural.find(e => e.type === 'einde-regulier');
    const einde      = structural.find(e => e.type === 'einde');

    const ordered = [];
    if (einde)    ordered.push(einde);
    byHalf[4].forEach(e => ordered.push(e));
    if (rustET)   ordered.push(rustET);
    byHalf[3].forEach(e => ordered.push(e));
    if (eindeReg) ordered.push(eindeReg);
    byHalf[2].forEach(e => ordered.push(e));
    if (rustHT)   ordered.push(rustHT);
    byHalf[1].forEach(e => ordered.push(e));
    if (aftrap)   ordered.push(aftrap);

    ordered.forEach(e => container.appendChild(createEventElement(e)));
}

function eventIcon(type, half) {
    const img = (file, alt) => `<img src="assets/${file}" alt="${alt}" class="timeline-icon-img">`;
    switch (type) {
        case 'aftrap':         return img('goal.png',           'Aftrap');
        case 'goal':           return img('goal.png',           'Goal');
        case 'penalty':        return img('penalty.png',        'Penalty');
        case 'penalty-missed': return img('penalty_missed.png', 'Penalty gemist');
        case 'own-goal':       return img('own-goal.png',       'Eigen doelpunt');
        case 'yellow':         return img('yellow.png',         'Gele kaart');
        case 'yellow2red':     return img('yellow2red.png',     '2e Gele kaart / Rood');
        case 'red':            return img('red.png',            'Rode kaart');
        case 'substitution':   return img('sub.png',            'Wissel');
        case 'rust':           return half >= 3 ? img('rust.png', 'Rust verlengingen') : img('rust.png', 'Rust');
        case 'einde-regulier': return img('extra-time.png', 'Verlengingen');
        case 'einde':          return img('einde.png', 'Einde');
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
        case 'aftrap':        text = 'Aftrap'; break;
        case 'goal':
            text = `GOAL${event.speler ? ' - ' + event.speler : ''}`;
            if (event.assist) text += ` <span class="event-assist">(assist: ${event.assist})</span>`;
            break;
        case 'penalty':
            text = `PENALTY${event.speler ? ' - ' + event.speler : ''}`;
            if (event.assist) text += ` <span class="event-assist">(assist: ${event.assist})</span>`;
            break;
        case 'penalty-missed': text = `Penalty gemist${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'own-goal':       text = `Eigen doelpunt${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'yellow':         text = `Gele kaart${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'yellow2red':     text = `2e Gele kaart (Rood)${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'red':            text = `Rode kaart${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'substitution': {
            const injuryIcon = event.injured
                ? ` <img src="assets/blessure.png" alt="Geblesseerd" class="timeline-icon-img timeline-icon-inline" title="Geblesseerd">`
                : '';
            text = (event.spelerUit && event.spelerIn)
                ? `Wissel: ${event.spelerUit}${injuryIcon} → ${event.spelerIn}`
                : `Wissel${injuryIcon}`;
            break;
        }
        case 'rust':           text = event.half >= 3 ? 'Rust verlengingen' : 'Rust'; break;
        case 'einde-regulier': text = 'Einde reguliere tijd — Verlengingen'; break;
        case 'einde':          text = 'Einde wedstrijd'; break;
        default:               text = event.type;
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
