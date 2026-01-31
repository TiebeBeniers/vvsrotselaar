// ===============================================
// LIVE MATCH PAGE - COMPLETE VERSION
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Live.js loaded');

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
// GLOBAL VARIABLES
// ===============================================

let currentUser = null;
let currentUserData = null;
let currentMatch = null;
let currentMatchId = null;
let isDesignatedPerson = false;
let matchListener = null;
let eventsListener = null;
let displayUpdateInterval = null;

// ===============================================
// MODAL MANAGEMENT
// ===============================================

const playerModal = document.getElementById('playerModal');
const modalTitle = document.getElementById('modalTitle');
const playerInput = document.getElementById('playerInput');
const substitutionInputs = document.getElementById('substitutionInputs');
const playerOutInput = document.getElementById('playerOutInput');
const playerInInput = document.getElementById('playerInInput');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

let currentAction = null;
let currentTeam = null;

function openModal(action, team, title) {
    currentAction = action;
    currentTeam = team;
    modalTitle.textContent = title;
    
    playerInput.value = '';
    playerOutInput.value = '';
    playerInInput.value = '';
    
    if (action === 'substitution') {
        playerInput.style.display = 'none';
        substitutionInputs.style.display = 'block';
    } else {
        playerInput.style.display = 'block';
        substitutionInputs.style.display = 'none';
    }
    
    playerModal.classList.add('active');
}

function closeModal() {
    playerModal.classList.remove('active');
    currentAction = null;
    currentTeam = null;
}

if (modalCancel) {
    modalCancel.addEventListener('click', closeModal);
}

if (modalConfirm) {
    modalConfirm.addEventListener('click', async () => {
        let playerName = '';
        let playerOut = '';
        
        if (currentAction === 'substitution') {
            playerOut = playerOutInput.value.trim();
            playerName = playerInInput.value.trim();
        } else {
            playerName = playerInput.value.trim();
        }
        
        await addEvent(currentAction, currentTeam, playerName, playerOut);
        closeModal();
    });
}

// ===============================================
// SCORE CORRECTION MODAL
// ===============================================

const scoreModal = document.getElementById('scoreModal');
const scoreCorrectBtn = document.getElementById('scoreCorrectBtn');
const scoreModalCancel = document.getElementById('scoreModalCancel');
const scoreModalConfirm = document.getElementById('scoreModalConfirm');

function openScoreModal() {
    if (!currentMatch) return;
    
    const homeScoreInput = document.getElementById('homeScoreInput');
    const awayScoreInput = document.getElementById('awayScoreInput');
    const homeTeamLabel = document.getElementById('homeTeamLabel');
    const awayTeamLabel = document.getElementById('awayTeamLabel');
    
    if (homeScoreInput) homeScoreInput.value = currentMatch.scoreThuis || 0;
    if (awayScoreInput) awayScoreInput.value = currentMatch.scoreUit || 0;
    if (homeTeamLabel) homeTeamLabel.textContent = currentMatch.thuisploeg;
    if (awayTeamLabel) awayTeamLabel.textContent = currentMatch.uitploeg;
    
    scoreModal.classList.add('active');
}

if (scoreCorrectBtn) {
    scoreCorrectBtn.addEventListener('click', openScoreModal);
}

if (scoreModalCancel) {
    scoreModalCancel.addEventListener('click', () => {
        scoreModal.classList.remove('active');
    });
}

if (scoreModalConfirm) {
    scoreModalConfirm.addEventListener('click', async () => {
        const homeScore = parseInt(document.getElementById('homeScoreInput').value) || 0;
        const awayScore = parseInt(document.getElementById('awayScoreInput').value) || 0;
        
        console.log('Correcting score to:', homeScore, '-', awayScore);
        
        try {
            const matchRef = doc(db, 'matches', currentMatchId);
            await updateDoc(matchRef, {
                scoreThuis: homeScore,
                scoreUit: awayScore
            });
            
            const elapsed = calculateElapsedTime(
                currentMatch.startedAt,
                currentMatch.status,
                currentMatch.pausedAt,
                currentMatch.pausedDuration
            );
            
            await addDoc(collection(db, 'events'), {
                matchId: currentMatchId,
                minuut: elapsed.minutes,
                type: 'score-correctie',
                ploeg: 'center',
                spelerIn: `${homeScore} - ${awayScore}`,
                timestamp: serverTimestamp()
            });
            
            console.log('Score corrected successfully');
            scoreModal.classList.remove('active');
        } catch (error) {
            console.error('Error correcting score:', error);
        }
    });
}

// ===============================================
// AUTH STATE
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
        console.log('User not logged in');
        if (loginLink) {
            loginLink.textContent = 'LOGIN';
        }
    }
    
    initializeLiveMatch();
});

// ===============================================
// MATCH INITIALIZATION
// ===============================================

async function initializeLiveMatch() {
    console.log('Initializing live match...');
    
    const liveMatchQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    if (matchListener) {
        matchListener();
    }

    matchListener = onSnapshot(liveMatchQuery, (snapshot) => {
        if (snapshot.empty) {
            console.log('No live match found, redirecting to home');
            window.location.href = 'index.html';
            return;
        }

        const matchDoc = snapshot.docs[0];
        currentMatchId = matchDoc.id;
        currentMatch = matchDoc.data();

        console.log('Live match loaded:', currentMatch.thuisploeg, 'vs', currentMatch.uitploeg, 'Status:', currentMatch.status);

        updateMatchDisplay();
        checkIfDesignatedPerson();
        listenToEvents();
        startDisplayUpdate();
    });
}

// ===============================================
// TIMER CALCULATION
// ===============================================

function calculateElapsedTime(startedAt, status, pausedAt, pausedDuration) {
    if (!startedAt) {
        console.warn('No startedAt timestamp');
        return { minutes: 0, seconds: 0, totalSeconds: 0 };
    }
    
    try {
        const now = new Date();
        const start = startedAt.toDate();
        let elapsedMs = now - start;
        
        // Subtract total paused duration
        if (pausedDuration) {
            elapsedMs -= (pausedDuration * 1000);
        }
        
        // If currently paused, don't count current pause time
        if (status === 'rust' && pausedAt) {
            const currentPauseDuration = now - pausedAt.toDate();
            elapsedMs -= currentPauseDuration;
        }
        
        const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
        
        return {
            minutes: Math.floor(totalSeconds / 60),
            seconds: totalSeconds % 60,
            totalSeconds
        };
    } catch (error) {
        console.error('Error calculating elapsed time:', error);
        return { minutes: 0, seconds: 0, totalSeconds: 0 };
    }
}

// ===============================================
// DISPLAY UPDATE
// ===============================================

function updateMatchDisplay() {
    if (!currentMatch) return;
    
    const homeTeamName = document.getElementById('homeTeamName');
    const awayTeamName = document.getElementById('awayTeamName');
    const homeScore = document.getElementById('homeScore');
    const awayScore = document.getElementById('awayScore');
    const currentMinute = document.getElementById('currentMinute');
    const matchStatus = document.getElementById('matchStatus');
    
    if (homeTeamName) homeTeamName.textContent = currentMatch.thuisploeg;
    if (awayTeamName) awayTeamName.textContent = currentMatch.uitploeg;
    if (homeScore) homeScore.textContent = currentMatch.scoreThuis || 0;
    if (awayScore) awayScore.textContent = currentMatch.scoreUit || 0;
    
    // Calculate and display time in MM:SS format
    if (currentMatch.startedAt) {
        const elapsed = calculateElapsedTime(
            currentMatch.startedAt,
            currentMatch.status,
            currentMatch.pausedAt,
            currentMatch.pausedDuration
        );
        
        const mins = String(elapsed.minutes).padStart(2, '0');
        const secs = String(elapsed.seconds).padStart(2, '0');
        
        if (currentMinute) {
            currentMinute.textContent = `${mins}:${secs}`;
        }
    } else {
        if (currentMinute) currentMinute.textContent = '00:00';
    }
    
    const statusText = currentMatch.status === 'rust' ? 'Rust' : 'Live';
    if (matchStatus) matchStatus.textContent = statusText;
    
    // Show description if exists
    if (currentMatch.beschrijving) {
        const descEl = document.getElementById('matchDescription');
        if (descEl) {
            descEl.textContent = currentMatch.beschrijving;
            descEl.style.display = 'block';
        }
    }
}

function startDisplayUpdate() {
    stopDisplayUpdate();
    
    displayUpdateInterval = setInterval(() => {
        if (currentMatch && currentMatch.status === 'live') {
            updateMatchDisplay();
        }
    }, 1000); // Update every second
}

function stopDisplayUpdate() {
    if (displayUpdateInterval) {
        clearInterval(displayUpdateInterval);
        displayUpdateInterval = null;
    }
}

// ===============================================
// ACCESS CONTROL
// ===============================================

function checkIfDesignatedPerson() {
    const controlPanel = document.getElementById('controlPanel');
    
    if (!controlPanel) {
        console.error('controlPanel element not found');
        return;
    }
    
    if (!currentUser) {
        isDesignatedPerson = false;
        controlPanel.style.display = 'none';
        console.log('No user logged in, hiding controls');
        return;
    }
    
    // Check if user is bestuurslid OR in aangeduidePersonen
    const isBestuurslid = currentUserData && currentUserData.categorie === 'bestuurslid';
    const isInList = currentMatch.aangeduidePersonen && 
                     currentMatch.aangeduidePersonen.includes(currentUser.uid);
    
    if (isBestuurslid || isInList) {
        isDesignatedPerson = true;
        controlPanel.style.display = 'block';
        
        console.log('User has control access:', isBestuurslid ? 'bestuurslid' : 'designated person');
        
        const homeTeamControlTitle = document.getElementById('homeTeamControlTitle');
        const awayTeamControlTitle = document.getElementById('awayTeamControlTitle');
        
        if (homeTeamControlTitle) homeTeamControlTitle.textContent = currentMatch.thuisploeg;
        if (awayTeamControlTitle) awayTeamControlTitle.textContent = currentMatch.uitploeg;
        
        setupControlButtons();
    } else {
        isDesignatedPerson = false;
        controlPanel.style.display = 'none';
        console.log('User does not have control access');
    }
}

// ===============================================
// CONTROL BUTTONS
// ===============================================

function setupControlButtons() {
    console.log('Setting up control buttons...');
    
    const controlButtons = document.querySelectorAll('.control-btn:not(.score-correction)');
    
    controlButtons.forEach(btn => {
        // Remove old listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', () => {
            const team = newBtn.getAttribute('data-team');
            const action = newBtn.getAttribute('data-action');
            handleControlAction(action, team);
        });
    });
    
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');
    const endMatchBtn = document.getElementById('endMatchBtn');
    
    if (pauseBtn) {
        pauseBtn.onclick = pauseMatch;
    }
    if (resumeBtn) {
        resumeBtn.onclick = resumeMatch;
    }
    if (endMatchBtn) {
        endMatchBtn.onclick = endMatch;
    }
    
    // Update button visibility based on status
    if (currentMatch.status === 'rust') {
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'block';
        if (endMatchBtn) endMatchBtn.style.display = 'block';
    } else {
        if (pauseBtn) pauseBtn.style.display = 'block';
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (endMatchBtn) endMatchBtn.style.display = 'block';
    }
}

function handleControlAction(action, team) {
    console.log('Control action:', action, 'for team:', team);
    
    const teamName = team === 'home' ? currentMatch.thuisploeg : currentMatch.uitploeg;
    
    const titles = {
        'goal': `Goal voor ${teamName}`,
        'penalty': `Penalty voor ${teamName}`,
        'own-goal': `Eigen doelpunt tegen ${teamName}`,
        'yellow': `Gele kaart voor ${teamName}`,
        'red': `Rode kaart voor ${teamName}`,
        'substitution': `Wissel bij ${teamName}`
    };
    
    openModal(action, team, titles[action] || 'Event invoeren');
}

// ===============================================
// ADD EVENT
// ===============================================

async function addEvent(action, team, playerName, playerOut) {
    console.log('Adding event:', action, 'Team:', team, 'Player:', playerName);
    
    try {
        const elapsed = calculateElapsedTime(
            currentMatch.startedAt,
            currentMatch.status,
            currentMatch.pausedAt,
            currentMatch.pausedDuration
        );
        
        const eventData = {
            matchId: currentMatchId,
            minuut: elapsed.minutes,
            type: action === 'yellow' ? 'geel' : action === 'red' ? 'rood' : action === 'substitution' ? 'wissel' : action,
            ploeg: team,
            spelerIn: playerName || '',
            timestamp: serverTimestamp()
        };
        
        if (action === 'substitution') {
            eventData.spelerUit = playerOut || '';
        }
        
        await addDoc(collection(db, 'events'), eventData);
        console.log('Event added to database');
        
        // Update score if goal/penalty/own-goal
        if (['goal', 'penalty', 'own-goal'].includes(action)) {
            const matchRef = doc(db, 'matches', currentMatchId);
            const newScoreThuis = currentMatch.scoreThuis || 0;
            const newScoreUit = currentMatch.scoreUit || 0;
            
            if (action === 'own-goal') {
                // Own goal increases opponent's score
                if (team === 'home') {
                    await updateDoc(matchRef, { scoreUit: newScoreUit + 1 });
                } else {
                    await updateDoc(matchRef, { scoreThuis: newScoreThuis + 1 });
                }
            } else {
                // Regular goal/penalty
                if (team === 'home') {
                    await updateDoc(matchRef, { scoreThuis: newScoreThuis + 1 });
                } else {
                    await updateDoc(matchRef, { scoreUit: newScoreUit + 1 });
                }
            }
            
            console.log('Score updated');
        }
        
    } catch (error) {
        console.error('Error adding event:', error);
    }
}

// ===============================================
// MATCH CONTROL
// ===============================================

async function pauseMatch() {
    console.log('Pausing match...');
    
    try {
        const matchRef = doc(db, 'matches', currentMatchId);
        
        await updateDoc(matchRef, {
            status: 'rust',
            pausedAt: serverTimestamp()
        });
        
        const elapsed = calculateElapsedTime(
            currentMatch.startedAt,
            'live', // Use 'live' to get accurate time before pause
            null,
            currentMatch.pausedDuration
        );
        
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: elapsed.minutes,
            type: 'rust',
            ploeg: 'center',
            spelerIn: '',
            timestamp: serverTimestamp()
        });
        
        console.log('Match paused at minute:', elapsed.minutes);
    } catch (error) {
        console.error('Error pausing match:', error);
    }
}

async function resumeMatch() {
    console.log('Resuming match...');
    
    try {
        const matchRef = doc(db, 'matches', currentMatchId);
        
        // Calculate total paused duration
        let totalPausedDuration = currentMatch.pausedDuration || 0;
        if (currentMatch.pausedAt) {
            const now = new Date();
            const pauseStart = currentMatch.pausedAt.toDate();
            const thisPauseDuration = (now - pauseStart) / 1000; // in seconds
            totalPausedDuration += thisPauseDuration;
        }
        
        await updateDoc(matchRef, {
            status: 'live',
            pausedAt: null,
            pausedDuration: totalPausedDuration
        });
        
        console.log('Match resumed, total paused duration:', totalPausedDuration, 'seconds');
    } catch (error) {
        console.error('Error resuming match:', error);
    }
}

async function endMatch() {
    if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) {
        return;
    }
    
    console.log('Ending match...');
    
    try {
        const matchRef = doc(db, 'matches', currentMatchId);
        await updateDoc(matchRef, {
            status: 'finished'
        });
        
        const elapsed = calculateElapsedTime(
            currentMatch.startedAt,
            currentMatch.status,
            currentMatch.pausedAt,
            currentMatch.pausedDuration
        );
        
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: elapsed.minutes,
            type: 'einde',
            ploeg: 'center',
            spelerIn: '',
            timestamp: serverTimestamp()
        });
        
        console.log('Match ended');
        alert('Wedstrijd beëindigd!');
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Error ending match:', error);
    }
}

// ===============================================
// EVENTS TIMELINE
// ===============================================

function listenToEvents() {
    if (eventsListener) {
        eventsListener();
    }

    console.log('Setting up events listener for matchId:', currentMatchId);

    const eventsQuery = query(
        collection(db, 'events'),
        where('matchId', '==', currentMatchId),
        orderBy('minuut', 'desc')
    );

    eventsListener = onSnapshot(eventsQuery, (snapshot) => {
        console.log('Events snapshot received:', snapshot.size, 'events');
        renderTimeline(snapshot.docs);
    }, (error) => {
        console.error('Events listener error:', error);
        
        if (error.code === 'failed-precondition') {
            console.log('Index not found, using simple query');
            const simpleQuery = query(
                collection(db, 'events'),
                where('matchId', '==', currentMatchId)
            );
            eventsListener = onSnapshot(simpleQuery, (snapshot) => {
                console.log('Events (simple query):', snapshot.size);
                const sortedDocs = snapshot.docs.sort((a, b) => {
                    return (b.data().minuut || 0) - (a.data().minuut || 0);
                });
                renderTimeline(sortedDocs);
            });
        }
    });
}

function renderTimeline(eventDocs) {
    const timeline = document.getElementById('timeline');
    
    if (!timeline) {
        console.error('timeline element not found');
        return;
    }
    
    console.log('Rendering timeline with', eventDocs.length, 'events');
    
    if (eventDocs.length === 0) {
        timeline.innerHTML = '<div class="timeline-empty">De wedstrijd is gestart. Events verschijnen hier...</div>';
        return;
    }
    
    timeline.innerHTML = '';
    
    eventDocs.forEach(docSnap => {
        const event = docSnap.data();
        const eventElement = createEventElement(event);
        timeline.appendChild(eventElement);
    });
}

function createEventElement(event) {
    const div = document.createElement('div');
    
    // Center events (aftrap, rust, einde, score-correctie)
    if (event.ploeg === 'center') {
        div.className = `timeline-event center ${event.type}`;
        
        const details = document.createElement('div');
        details.className = 'event-details center';
        
        const type = document.createElement('div');
        type.className = 'event-type';
        type.textContent = getEventTypeText(event.type);
        
        details.appendChild(type);
        
        if (event.type === 'score-correctie' && event.spelerIn) {
            const score = document.createElement('div');
            score.className = 'event-player';
            score.textContent = event.spelerIn;
            details.appendChild(score);
        }
        
        div.appendChild(details);
        return div;
    }
    
    // Team events
    div.className = `timeline-event ${event.ploeg} ${event.type}`;
    
    const minute = document.createElement('div');
    minute.className = 'event-minute';
    minute.textContent = `${event.minuut}'`;
    
    const details = document.createElement('div');
    details.className = 'event-details';
    
    const type = document.createElement('div');
    type.className = 'event-type';
    type.textContent = getEventTypeText(event.type);
    
    details.appendChild(type);
    
    if (event.type === 'wissel') {
        if (event.spelerUit || event.spelerIn) {
            const player = document.createElement('div');
            player.className = 'event-player';
            
            const parts = [];
            if (event.spelerUit) parts.push(`🔻 ${event.spelerUit}`);
            if (event.spelerIn) parts.push(`🔺 ${event.spelerIn}`);
            player.textContent = parts.join(' ');
            details.appendChild(player);
        }
    } else {
        if (event.spelerIn) {
            const player = document.createElement('div');
            player.className = 'event-player';
            player.textContent = event.spelerIn;
            details.appendChild(player);
        }
    }
    
    if (event.ploeg === 'home') {
        div.appendChild(minute);
        div.appendChild(details);
    } else {
        div.appendChild(details);
        div.appendChild(minute);
    }
    
    return div;
}

function getEventTypeText(type) {
    const types = {
        'goal': '⚽ Goal',
        'penalty': '⚽ Penalty',
        'own-goal': '⚽ Eigen Doelpunt',
        'geel': '🟨 Gele Kaart',
        'rood': '🟥 Rode Kaart',
        'wissel': '🔄 Wissel',
        'aftrap': '⚽ Aftrap',
        'rust': '⏸️ Rust',
        'einde': '🏁 Wedstrijd Geëindigd',
        'score-correctie': '✏️ Score Correctie'
    };
    return types[type] || type;
}

// ===============================================
// CLEANUP
// ===============================================

window.addEventListener('beforeunload', () => {
    console.log('Page unloading, cleaning up...');
    if (matchListener) matchListener();
    if (eventsListener) eventsListener();
    stopDisplayUpdate();
});

console.log('Live.js initialization complete');
