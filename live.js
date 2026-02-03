// ===============================================
// LIVE MATCH PAGE - IMPROVED TIMER VERSION
// V.V.S Rotselaar
// Fixed: Proper half-time with resumeStartedAt timestamp
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, addDoc, serverTimestamp, deleteDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Live.js loaded (IMPROVED TIMER VERSION)');

// ===============================================
// GLOBAL STATE
// ===============================================

let currentUser = null;
let currentUserData = null;
let currentMatch = null;
let currentMatchId = null;
let matchListener = null;
let eventsListener = null;
let displayInterval = null;
let hasAccess = false;

// ===============================================
// HAMBURGER MENU
// ===============================================

const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');

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

// ===============================================
// AUTH & ACCESS CONTROL
// ===============================================

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    
    if (user) {
        currentUser = user;
        console.log('User logged in:', user.uid);
        
        try {
            const userQuery = query(collection(db, 'users'), where('uid', '==', user.uid));
            const userSnapshot = await getDocs(userQuery);
            
            if (!userSnapshot.empty) {
                currentUserData = userSnapshot.docs[0].data();
                console.log('User data loaded:', currentUserData.naam, 'Categorie:', currentUserData.categorie);
                
                if (loginLink) {
                    loginLink.textContent = 'PROFIEL';
                }
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    } else {
        currentUser = null;
        currentUserData = null;
        console.log('User not logged in (can still view)');
        
        if (loginLink) {
            loginLink.textContent = 'LOGIN';
        }
    }
    
    // Load live match (for everyone)
    loadLiveMatch();
});

// ===============================================
// LOAD LIVE MATCH
// ===============================================

async function loadLiveMatch() {
    console.log('Loading live match...');
    
    const liveMatchQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );
    
    try {
        const snapshot = await getDocs(liveMatchQuery);
        
        if (snapshot.empty) {
            console.log('No live match found, redirecting...');
            window.location.href = 'index.html';
            return;
        }
        
        currentMatchId = snapshot.docs[0].id;
        currentMatch = snapshot.docs[0].data();
        
        console.log('Live match loaded:', currentMatch.thuisploeg, 'vs', currentMatch.uitploeg);
        console.log('Match team:', currentMatch.team);
        console.log('Match data:', currentMatch);
        
        // Check if user has access to controls
        checkAccess();
        
        // Set up real-time listeners
        setupMatchListener();
        setupEventsListener();
        
        // Initial display
        updateMatchDisplay();
        
        // Start display interval
        startDisplayInterval();
        
    } catch (error) {
        console.error('Error loading live match:', error);
        alert('Fout bij laden wedstrijd: ' + error.message);
    }
}

function checkAccess() {
    if (!currentUser || !currentUserData || !currentMatch) {
        hasAccess = false;
        document.getElementById('controlPanel').style.display = 'none';
        console.log('No access to controls (not logged in or no user data)');
        return;
    }
    
    const isBestuurslid = currentUserData.categorie === 'bestuurslid';
    const isDesignated = currentMatch.aangeduidePersonen && 
                        currentMatch.aangeduidePersonen.includes(currentUser.uid);
    
    hasAccess = isBestuurslid || isDesignated;
    
    if (hasAccess) {
        console.log('User has access to controls');
        document.getElementById('controlPanel').style.display = 'block';
        setupControlButtons();
    } else {
        console.log('User does NOT have access to controls');
        document.getElementById('controlPanel').style.display = 'none';
    }
}

// ===============================================
// REAL-TIME LISTENERS
// ===============================================

function setupMatchListener() {
    if (matchListener) {
        matchListener();
    }
    
    const matchRef = doc(db, 'matches', currentMatchId);
    
    matchListener = onSnapshot(matchRef, (snapshot) => {
        if (snapshot.exists()) {
            currentMatch = snapshot.data();
            console.log('Match updated:', currentMatch.status);
            updateMatchDisplay();
            updateControlButtonStates();
        }
    });
}

function setupEventsListener() {
    if (eventsListener) {
        eventsListener();
    }
    
    const eventsQuery = query(
        collection(db, 'events'),
        where('matchId', '==', currentMatchId)
    );
    
    eventsListener = onSnapshot(eventsQuery, (snapshot) => {
        console.log('Events updated, count:', snapshot.size);
        loadTimeline();
    });
}

// ===============================================
// DISPLAY FUNCTIONS
// ===============================================

function updateMatchDisplay() {
    if (!currentMatch) return;
    
    // Team names
    document.getElementById('homeTeamName').textContent = currentMatch.thuisploeg;
    document.getElementById('awayTeamName').textContent = currentMatch.uitploeg;
    
    // Scores
    document.getElementById('homeScore').textContent = currentMatch.scoreThuis || 0;
    document.getElementById('awayScore').textContent = currentMatch.scoreUit || 0;
    
    // Timer with proper formatting
    const timeDisplay = calculateTimeDisplay();
    document.getElementById('currentMinute').textContent = timeDisplay;
    
    // Status
    const statusEl = document.getElementById('matchStatus');
    if (currentMatch.status === 'rust') {
        statusEl.textContent = 'Rust';
        statusEl.style.background = '#FFC107';
    } else if (currentMatch.status === 'live') {
        statusEl.textContent = 'Live';
        statusEl.style.background = '#DC3545';
    }
    
    // Description
    const descEl = document.getElementById('matchDescription');
    if (currentMatch.beschrijving && currentMatch.beschrijving.trim()) {
        descEl.textContent = currentMatch.beschrijving;
        descEl.style.display = 'block';
    } else {
        descEl.style.display = 'none';
    }
    
    // Control panel team names
    if (hasAccess) {
        document.getElementById('homeTeamControlTitle').textContent = currentMatch.thuisploeg;
        document.getElementById('awayTeamControlTitle').textContent = currentMatch.uitploeg;
    }
}

function getHalfTime() {
    // Veteranen: 35 minutes, Zaterdag/Zondag: 45 minutes
    if (currentMatch.team === 'veteranen') {
        return 35;
    } else {
        return 45;
    }
}

function calculateElapsedTime() {
    if (!currentMatch || !currentMatch.startedAt) return 0;
    
    const halfTimeReached = currentMatch.halfTimeReached || false;
    
    if (!halfTimeReached) {
        // First half - count from match start
        const startTime = currentMatch.startedAt.toMillis();
        const currentTime = currentMatch.status === 'rust' && currentMatch.pausedAt 
            ? currentMatch.pausedAt.toMillis() 
            : Date.now();
        
        const elapsed = Math.floor((currentTime - startTime) / 1000);
        return Math.max(0, elapsed);
    } else {
        // Second half - count from resume start
        if (currentMatch.resumeStartedAt) {
            const resumeStart = currentMatch.resumeStartedAt.toMillis();
            const currentTime = Date.now();
            
            const elapsed = Math.floor((currentTime - resumeStart) / 1000);
            return Math.max(0, elapsed);
        } else {
            // Still in rust, show halfTime
            const halfTime = getHalfTime();
            return halfTime * 60;
        }
    }
}

function calculateTimeDisplay() {
    const elapsedSeconds = calculateElapsedTime();
    const totalMinutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    
    const halfTime = getHalfTime();
    const halfTimeReached = currentMatch.halfTimeReached || false;
    
    if (!halfTimeReached) {
        // First half
        if (totalMinutes < halfTime) {
            // Regular first half: 0' → 34'
            return `${totalMinutes}:${String(seconds).padStart(2, '0')}`;
        } else {
            // Extra time first half: 35+1, 35+2, etc.
            const extraTime = totalMinutes - halfTime;
            return `${halfTime}+${extraTime}:${String(seconds).padStart(2, '0')}`;
        }
    } else {
        // Second half
        if (currentMatch.status === 'rust' && !currentMatch.resumeStartedAt) {
            // Still in rust, show halfTime
            return `${halfTime}:${String(seconds).padStart(2, '0')}`;
        } else {
            // After resume: 35' → 70' (veteranen) or 45' → 90' (zaterdag/zondag)
            const secondHalfMinute = halfTime + totalMinutes;
            
            if (secondHalfMinute <= halfTime * 2) {
                // Regular second half
                return `${secondHalfMinute}:${String(seconds).padStart(2, '0')}`;
            } else {
                // Extra time second half: 70+1, 90+1, etc.
                const extraTime = secondHalfMinute - (halfTime * 2);
                return `${halfTime * 2}+${extraTime}:${String(seconds).padStart(2, '0')}`;
            }
        }
    }
}

function getCurrentMinuteForEvent() {
    const elapsedSeconds = calculateElapsedTime();
    const totalMinutes = Math.floor(elapsedSeconds / 60);
    const halfTime = getHalfTime();
    const halfTimeReached = currentMatch.halfTimeReached || false;
    
    if (!halfTimeReached) {
        // First half
        return totalMinutes;
    } else {
        // Second half
        if (currentMatch.status === 'rust' && !currentMatch.resumeStartedAt) {
            // Still in rust
            return halfTime;
        } else {
            // After resume: starts at halfTime (35 or 45)
            return halfTime + totalMinutes;
        }
    }
}

function startDisplayInterval() {
    if (displayInterval) {
        clearInterval(displayInterval);
    }
    
    displayInterval = setInterval(() => {
        if (currentMatch && currentMatch.status === 'live') {
            updateMatchDisplay();
        }
    }, 1000);
}

// ===============================================
// CONTROL BUTTONS
// ===============================================

function setupControlButtons() {
    const controlBtns = document.querySelectorAll('.control-btn[data-action]');
    controlBtns.forEach(btn => {
        btn.addEventListener('click', handleControlClick);
    });
    
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');
    const endMatchBtn = document.getElementById('endMatchBtn');
    const scoreCorrectBtn = document.getElementById('scoreCorrectBtn');
    
    if (pauseBtn) {
        pauseBtn.addEventListener('click', handlePause);
    }
    
    if (resumeBtn) {
        resumeBtn.addEventListener('click', handleResume);
    }
    
    if (endMatchBtn) {
        endMatchBtn.addEventListener('click', handleEndMatch);
    }
    
    if (scoreCorrectBtn) {
        scoreCorrectBtn.addEventListener('click', openScoreModal);
    }
    
    updateControlButtonStates();
}

function updateControlButtonStates() {
    if (!hasAccess || !currentMatch) return;
    
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');
    
    const halfTimeReached = currentMatch.halfTimeReached || false;
    
    if (currentMatch.status === 'rust') {
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'inline-block';
    } else {
        if (pauseBtn) pauseBtn.style.display = halfTimeReached ? 'none' : 'inline-block';
        if (resumeBtn) resumeBtn.style.display = 'none';
    }
}

let pendingAction = null;

function handleControlClick(e) {
    const btn = e.currentTarget;
    const team = btn.dataset.team;
    const action = btn.dataset.action;
    
    pendingAction = { team, action };
    
    const modal = document.getElementById('playerModal');
    const modalTitle = document.getElementById('modalTitle');
    const playerInput = document.getElementById('playerInput');
    const substitutionInputs = document.getElementById('substitutionInputs');
    
    if (action === 'substitution') {
        modalTitle.textContent = 'Wissel Invoeren';
        playerInput.style.display = 'none';
        substitutionInputs.style.display = 'block';
        document.getElementById('playerOutInput').value = '';
        document.getElementById('playerInInput').value = '';
    } else {
        const actionNames = {
            'goal': 'Goal',
            'penalty': 'Penalty',
            'own-goal': 'Eigen Doelpunt',
            'yellow': 'Gele Kaart',
            'red': 'Rode Kaart'
        };
        modalTitle.textContent = `${actionNames[action] || action} - Speler Invoeren`;
        playerInput.style.display = 'block';
        substitutionInputs.style.display = 'none';
        playerInput.value = '';
    }
    
    modal.classList.add('active');
}

async function handlePause() {
    try {
        const currentMinuteForEvent = getCurrentMinuteForEvent();
        const matchRef = doc(db, 'matches', currentMatchId);
        
        await updateDoc(matchRef, {
            status: 'rust',
            pausedAt: serverTimestamp(),
            halfTimeReached: true
        });
        
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: currentMinuteForEvent,
            half: 1,  // Rust is always end of first half
            type: 'rust',
            ploeg: 'center',
            speler: '',
            timestamp: serverTimestamp()
        });
        
        console.log('Match paused (half-time) at minute:', currentMinuteForEvent);
    } catch (error) {
        console.error('Error pausing match:', error);
        alert('Fout bij pauze: ' + error.message);
    }
}

async function handleResume() {
    try {
        const halfTime = getHalfTime();
        const matchRef = doc(db, 'matches', currentMatchId);
        
        // Set new start time for second half
        await updateDoc(matchRef, {
            status: 'live',
            pausedAt: null,
            resumeStartedAt: serverTimestamp()  // NEW: timestamp for second half start
        });
        
        // Resume event at halfTime minute (35' or 45')
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: halfTime,
            half: 2,  // Hervat is start of second half
            type: 'hervat',
            ploeg: 'center',
            speler: '',
            timestamp: serverTimestamp()
        });
        
        console.log('Match resumed at minute:', halfTime);
    } catch (error) {
        console.error('Error resuming match:', error);
        alert('Fout bij hervatten: ' + error.message);
    }
}

async function handleEndMatch() {
    if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) {
        return;
    }
    
    try {
        const currentMinuteForEvent = getCurrentMinuteForEvent();
        const matchRef = doc(db, 'matches', currentMatchId);
        const halfTimeReached = currentMatch.halfTimeReached || false;
        
        await updateDoc(matchRef, {
            status: 'finished'
        });
        
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: currentMinuteForEvent,
            half: halfTimeReached ? 2 : 1,
            type: 'einde',
            ploeg: 'center',
            speler: '',
            timestamp: serverTimestamp()
        });
        
        console.log('Match ended');
        alert('Wedstrijd beëindigd!');
        window.location.href = 'index.html';
        
    } catch (error) {
        console.error('Error ending match:', error);
        alert('Fout bij beëindigen wedstrijd: ' + error.message);
    }
}

// ===============================================
// PLAYER INPUT MODAL
// ===============================================

const modalConfirm = document.getElementById('modalConfirm');
const modalCancel = document.getElementById('modalCancel');

if (modalConfirm) {
    modalConfirm.addEventListener('click', async () => {
        if (!pendingAction) return;
        
        const modal = document.getElementById('playerModal');
        const { team, action } = pendingAction;
        
        let playerName = '';
        let playerOut = '';
        let playerIn = '';
        
        if (action === 'substitution') {
            playerOut = document.getElementById('playerOutInput').value.trim();
            playerIn = document.getElementById('playerInInput').value.trim();
        } else {
            playerName = document.getElementById('playerInput').value.trim();
        }
        
        modal.classList.remove('active');
        
        await executeAction(team, action, playerName, playerOut, playerIn);
        pendingAction = null;
    });
}

if (modalCancel) {
    modalCancel.addEventListener('click', () => {
        document.getElementById('playerModal').classList.remove('active');
        pendingAction = null;
    });
}

async function executeAction(team, action, playerName = '', playerOut = '', playerIn = '') {
    try {
        const currentMinuteForEvent = getCurrentMinuteForEvent();
        const matchRef = doc(db, 'matches', currentMatchId);
        
        // Determine which half we're in
        const halfTimeReached = currentMatch.halfTimeReached || false;
        const half = halfTimeReached ? 2 : 1;
        
        const eventData = {
            matchId: currentMatchId,
            minuut: currentMinuteForEvent,
            half: half,  // NEW: Track which half (1 or 2)
            type: action,
            ploeg: team,
            speler: playerName,
            timestamp: serverTimestamp()
        };
        
        // Handle score updates
        if (action === 'goal' || action === 'penalty') {
            const newScore = (team === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) + 1;
            const scoreField = team === 'home' ? 'scoreThuis' : 'scoreUit';
            await updateDoc(matchRef, { [scoreField]: newScore });
        } else if (action === 'own-goal') {
            const oppositeTeam = team === 'home' ? 'away' : 'home';
            const newScore = (oppositeTeam === 'home' ? currentMatch.scoreThuis : currentMatch.scoreUit) + 1;
            const scoreField = oppositeTeam === 'home' ? 'scoreThuis' : 'scoreUit';
            await updateDoc(matchRef, { [scoreField]: newScore });
        }
        
        // Handle substitution
        if (action === 'substitution') {
            eventData.spelerUit = playerOut;
            eventData.spelerIn = playerIn;
        }
        
        await addDoc(collection(db, 'events'), eventData);
        console.log('Action executed:', action, 'at minute:', currentMinuteForEvent, 'half:', half);
        
    } catch (error) {
        console.error('Error executing action:', error);
        alert('Fout bij uitvoeren actie: ' + error.message);
    }
}

// ===============================================
// SCORE CORRECTION MODAL
// ===============================================

function openScoreModal() {
    const modal = document.getElementById('scoreModal');
    const homeScoreInput = document.getElementById('homeScoreInput');
    const awayScoreInput = document.getElementById('awayScoreInput');
    const homeLabel = document.getElementById('homeTeamLabel');
    const awayLabel = document.getElementById('awayTeamLabel');
    
    homeLabel.textContent = currentMatch.thuisploeg;
    awayLabel.textContent = currentMatch.uitploeg;
    
    homeScoreInput.value = currentMatch.scoreThuis || 0;
    awayScoreInput.value = currentMatch.scoreUit || 0;
    
    modal.classList.add('active');
}

const scoreModalConfirm = document.getElementById('scoreModalConfirm');
const scoreModalCancel = document.getElementById('scoreModalCancel');

if (scoreModalConfirm) {
    scoreModalConfirm.addEventListener('click', async () => {
        const homeScore = parseInt(document.getElementById('homeScoreInput').value) || 0;
        const awayScore = parseInt(document.getElementById('awayScoreInput').value) || 0;
        
        try {
            const matchRef = doc(db, 'matches', currentMatchId);
            await updateDoc(matchRef, {
                scoreThuis: homeScore,
                scoreUit: awayScore
            });
            
            console.log('Score corrected:', homeScore, '-', awayScore);
            document.getElementById('scoreModal').classList.remove('active');
            
        } catch (error) {
            console.error('Error correcting score:', error);
            alert('Fout bij aanpassen score: ' + error.message);
        }
    });
}

if (scoreModalCancel) {
    scoreModalCancel.addEventListener('click', () => {
        document.getElementById('scoreModal').classList.remove('active');
    });
}

// ===============================================
// TIMELINE
// ===============================================

async function loadTimeline() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;
    
    try {
        const eventsQuery = query(
            collection(db, 'events'),
            where('matchId', '==', currentMatchId)
        );
        
        const eventsSnapshot = await getDocs(eventsQuery);
        
        if (eventsSnapshot.empty) {
            timeline.innerHTML = '<div class="timeline-empty">Nog geen events...</div>';
            return;
        }
        
        const events = [];
        eventsSnapshot.forEach(docSnap => {
            events.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        // Separate by half
        const firstHalfEvents = [];
        const secondHalfEvents = [];
        let rustEvent = null;
        let hervatEvent = null;
        
        events.forEach(event => {
            if (event.type === 'rust') {
                rustEvent = event;
            } else if (event.type === 'hervat') {
                hervatEvent = event;
            } else {
                // Use half field if available, otherwise fallback to old logic
                const eventHalf = event.half || 1;
                
                if (eventHalf === 2) {
                    secondHalfEvents.push(event);
                } else {
                    firstHalfEvents.push(event);
                }
            }
        });
        
        // Sort first half descending
        firstHalfEvents.sort((a, b) => {
            const minuteDiff = (b.minuut || 0) - (a.minuut || 0);
            if (minuteDiff !== 0) return minuteDiff;
            if (a.timestamp && b.timestamp) {
                return b.timestamp.toMillis() - a.timestamp.toMillis();
            }
            return 0;
        });
        
        // Sort second half descending
        secondHalfEvents.sort((a, b) => {
            const minuteDiff = (b.minuut || 0) - (a.minuut || 0);
            if (minuteDiff !== 0) return minuteDiff;
            if (a.timestamp && b.timestamp) {
                return b.timestamp.toMillis() - a.timestamp.toMillis();
            }
            return 0;
        });
        
        // Combine in correct order: second half → hervat → rust → first half
        const sortedEvents = [];
        sortedEvents.push(...secondHalfEvents);
        if (hervatEvent) sortedEvents.push(hervatEvent);
        if (rustEvent) sortedEvents.push(rustEvent);
        sortedEvents.push(...firstHalfEvents);
        
        timeline.innerHTML = '';
        sortedEvents.forEach(event => {
            const eventEl = createEventElement(event);
            timeline.appendChild(eventEl);
        });
        
    } catch (error) {
        console.error('Error loading timeline:', error);
    }
}

function createEventElement(event) {
    const div = document.createElement('div');
    div.className = `timeline-event ${event.type}`;
    
    let icon = '';
    let text = '';
    let teamClass = '';
    
    if (event.ploeg === 'home') {
        teamClass = 'home';
    } else if (event.ploeg === 'away') {
        teamClass = 'away';
    } else {
        teamClass = 'center';
    }
    
    div.classList.add(teamClass);
    
    switch (event.type) {
        case 'aftrap':
            icon = '⚽';
            text = 'Aftrap';
            break;
        case 'goal':
            icon = '⚽';
            text = `GOAL${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'penalty':
            icon = '⚽';
            text = `PENALTY${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'own-goal':
            icon = '⚽';
            text = `Eigen doelpunt${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'yellow':
            icon = '🟨';
            text = `Gele kaart${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'red':
            icon = '🟥';
            text = `Rode kaart${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'substitution':
            icon = '🔄';
            text = `Wissel${event.spelerUit && event.spelerIn ? ': ' + event.spelerUit + ' → ' + event.spelerIn : ''}`;
            break;
        case 'rust':
            icon = '⏸';
            text = 'Rust';
            break;
        case 'hervat':
            icon = '▶️';
            text = 'Hervat';
            break;
        case 'einde':
            icon = '🏁';
            text = 'Einde wedstrijd';
            break;
        default:
            icon = '•';
            text = event.type;
    }
    
    div.innerHTML = `
        <span class="event-time">${event.minuut}'</span>
        <span class="event-icon">${icon}</span>
        <span class="event-text">${text}</span>
    `;
    
    return div;
}

// ===============================================
// CLEANUP
// ===============================================

window.addEventListener('beforeunload', () => {
    console.log('Page unloading, cleaning up...');
    if (matchListener) matchListener();
    if (eventsListener) eventsListener();
    if (displayInterval) clearInterval(displayInterval);
});

console.log('Live.js initialization complete');
