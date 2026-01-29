// ===============================================
// LIVE MATCH PAGE
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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
let timerInterval = null;

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
    
    // Reset inputs
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

modalCancel.addEventListener('click', closeModal);

modalConfirm.addEventListener('click', async () => {
    let playerName = '';
    let playerOut = '';
    
    if (currentAction === 'substitution') {
        playerOut = playerOutInput.value.trim();
        playerName = playerInInput.value.trim();
        
        // For substitution, at least one name should be provided
        if (!playerOut && !playerName) {
            alert('Vul tenminste één speler in voor een wissel.');
            return;
        }
    } else {
        playerName = playerInput.value.trim();
        // Empty is allowed - will show only event type
    }
    
    await addEvent(currentAction, currentTeam, playerName, playerOut);
    closeModal();
});

// ===============================================
// AUTH STATE
// ===============================================

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    
    if (user) {
        currentUser = user;
        
        // Get user data
        const userQuery = query(collection(db, 'users'), where('uid', '==', user.uid));
        const userSnapshot = await getDocs(userQuery);
        
        if (!userSnapshot.empty) {
            currentUserData = userSnapshot.docs[0].data();
            if (loginLink) {
                loginLink.textContent = 'PROFIEL';
            }
        }
    } else {
        currentUser = null;
        currentUserData = null;
        if (loginLink) {
            loginLink.textContent = 'LOGIN';
        }
    }
    
    // Initialize live match
    initializeLiveMatch();
});

// ===============================================
// MATCH INITIALIZATION
// ===============================================

async function initializeLiveMatch() {
    // Query for live or paused matches
    const liveMatchQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    // Listen to match updates
    if (matchListener) {
        matchListener();
    }

    matchListener = onSnapshot(liveMatchQuery, (snapshot) => {
        if (snapshot.empty) {
            // No live match, redirect to home
            window.location.href = 'index.html';
            return;
        }

        const matchDoc = snapshot.docs[0];
        currentMatchId = matchDoc.id;
        currentMatch = matchDoc.data();

        updateMatchDisplay();
        checkIfDesignatedPerson();
        listenToEvents();
        
        // Start timer if live
        if (currentMatch.status === 'live') {
            startTimer();
        } else {
            stopTimer();
        }
    });
}

function updateMatchDisplay() {
    document.getElementById('homeTeamName').textContent = currentMatch.thuisploeg;
    document.getElementById('awayTeamName').textContent = currentMatch.uitploeg;
    document.getElementById('homeScore').textContent = currentMatch.scoreThuis || 0;
    document.getElementById('awayScore').textContent = currentMatch.scoreUit || 0;
    document.getElementById('currentMinute').textContent = `${currentMatch.currentMinute || 0}'`;
    
    const statusText = currentMatch.status === 'rust' ? 'Rust' : 'Live';
    document.getElementById('matchStatus').textContent = statusText;
}

function checkIfDesignatedPerson() {
    const controlPanel = document.getElementById('controlPanel');
    
    if (currentUser && currentMatch.aangeduidePersoon === currentUser.uid) {
        isDesignatedPerson = true;
        controlPanel.style.display = 'block';
        
        // Update control panel team names
        document.getElementById('homeTeamControlTitle').textContent = currentMatch.thuisploeg;
        document.getElementById('awayTeamControlTitle').textContent = currentMatch.uitploeg;
        
        setupControlButtons();
    } else {
        isDesignatedPerson = false;
        controlPanel.style.display = 'none';
    }
}

// ===============================================
// CONTROL BUTTONS
// ===============================================

function setupControlButtons() {
    const controlButtons = document.querySelectorAll('.control-btn:not(.score-correction)');
    
    controlButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const team = btn.getAttribute('data-team');
            const action = btn.getAttribute('data-action');
            
            handleControlAction(action, team);
        });
    });
    
    // Pause, Resume and End buttons
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');
    const endMatchBtn = document.getElementById('endMatchBtn');
    const scoreCorrectBtn = document.getElementById('scoreCorrectBtn');
    
    pauseBtn.addEventListener('click', pauseMatch);
    resumeBtn.addEventListener('click', resumeMatch);
    endMatchBtn.addEventListener('click', endMatch);
    scoreCorrectBtn.addEventListener('click', openScoreModal);
    
    // Update button visibility based on status
    if (currentMatch.status === 'rust') {
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = 'block';
        endMatchBtn.style.display = 'block';
    } else {
        pauseBtn.style.display = 'block';
        resumeBtn.style.display = 'none';
        endMatchBtn.style.display = 'block';
    }
}

// ===============================================
// SCORE CORRECTION
// ===============================================

const scoreModal = document.getElementById('scoreModal');
const homeScoreInput = document.getElementById('homeScoreInput');
const awayScoreInput = document.getElementById('awayScoreInput');
const scoreModalCancel = document.getElementById('scoreModalCancel');
const scoreModalConfirm = document.getElementById('scoreModalConfirm');

function openScoreModal() {
    // Set current scores
    homeScoreInput.value = currentMatch.scoreThuis || 0;
    awayScoreInput.value = currentMatch.scoreUit || 0;
    
    // Set team labels
    document.getElementById('homeTeamLabel').textContent = currentMatch.thuisploeg;
    document.getElementById('awayTeamLabel').textContent = currentMatch.uitploeg;
    
    scoreModal.classList.add('active');
}

function closeScoreModal() {
    scoreModal.classList.remove('active');
}

scoreModalCancel.addEventListener('click', closeScoreModal);

scoreModalConfirm.addEventListener('click', async () => {
    const newHomeScore = parseInt(homeScoreInput.value) || 0;
    const newAwayScore = parseInt(awayScoreInput.value) || 0;
    
    try {
        const matchRef = doc(db, 'matches', currentMatchId);
        await updateDoc(matchRef, {
            scoreThuis: newHomeScore,
            scoreUit: newAwayScore
        });
        
        // Add score correction event
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: currentMatch.currentMinute || 0,
            type: 'score-correctie',
            ploeg: 'center',
            spelerIn: `${newHomeScore} - ${newAwayScore}`,
            timestamp: serverTimestamp()
        });
        
        closeScoreModal();
    } catch (error) {
        console.error('Error correcting score:', error);
        alert('Fout bij aanpassen score.');
    }
});

function handleControlAction(action, team) {
    const teamName = team === 'home' ? currentMatch.thuisploeg : currentMatch.uitploeg;
    
    switch(action) {
        case 'goal':
            openModal('goal', team, `Goal - ${teamName}`);
            break;
        case 'penalty':
            openModal('penalty', team, `Penalty - ${teamName}`);
            break;
        case 'own-goal':
            openModal('own-goal', team, `Eigen Doelpunt - ${teamName}`);
            break;
        case 'yellow':
            openModal('geel', team, `Gele Kaart - ${teamName}`);
            break;
        case 'red':
            openModal('rood', team, `Rode Kaart - ${teamName}`);
            break;
        case 'substitution':
            openModal('substitution', team, `Wissel - ${teamName}`);
            break;
    }
}

async function addEvent(type, team, playerIn, playerOut = null) {
    try {
        const eventData = {
            matchId: currentMatchId,
            minuut: currentMatch.currentMinute || 0,
            type: type,
            ploeg: team,
            spelerIn: playerIn,
            timestamp: serverTimestamp()
        };
        
        if (playerOut) {
            eventData.spelerUit = playerOut;
        }
        
        // Add event to database
        await addDoc(collection(db, 'events'), eventData);
        
        // Update score if goal or penalty
        if (type === 'goal' || type === 'penalty') {
            const matchRef = doc(db, 'matches', currentMatchId);
            const scoreField = team === 'home' ? 'scoreThuis' : 'scoreUit';
            const currentScore = currentMatch[scoreField] || 0;
            
            await updateDoc(matchRef, {
                [scoreField]: currentScore + 1
            });
        }
        
        // Handle own goal
        if (type === 'own-goal') {
            const matchRef = doc(db, 'matches', currentMatchId);
            const scoreField = team === 'home' ? 'scoreUit' : 'scoreThuis'; // Opposite team scores
            const currentScore = currentMatch[scoreField] || 0;
            
            await updateDoc(matchRef, {
                [scoreField]: currentScore + 1
            });
        }
        
    } catch (error) {
        console.error('Error adding event:', error);
        alert('Er is een fout opgetreden bij het toevoegen van het event.');
    }
}

async function pauseMatch() {
    try {
        const matchRef = doc(db, 'matches', currentMatchId);
        await updateDoc(matchRef, {
            status: 'rust'
        });
        
        // Add halftime event
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: currentMatch.currentMinute || 0,
            type: 'rust',
            ploeg: 'center',
            spelerIn: '',
            timestamp: serverTimestamp()
        });
        
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('resumeBtn').style.display = 'block';
        document.getElementById('endMatchBtn').style.display = 'block';
    } catch (error) {
        console.error('Error pausing match:', error);
    }
}

async function resumeMatch() {
    try {
        const matchRef = doc(db, 'matches', currentMatchId);
        
        // Determine resume minute based on team type
        const resumeMinute = currentMatch.teamType === 'veteranen' ? 35 : 45;
        
        await updateDoc(matchRef, {
            status: 'live',
            currentMinute: resumeMinute
        });
        
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('resumeBtn').style.display = 'none';
        document.getElementById('endMatchBtn').style.display = 'block';
    } catch (error) {
        console.error('Error resuming match:', error);
    }
}

async function endMatch() {
    if (!confirm('Weet je zeker dat je de wedstrijd wilt beëindigen?')) {
        return;
    }
    
    try {
        const matchRef = doc(db, 'matches', currentMatchId);
        await updateDoc(matchRef, {
            status: 'finished'
        });
        
        // Add end match event
        await addDoc(collection(db, 'events'), {
            matchId: currentMatchId,
            minuut: currentMatch.currentMinute || 0,
            type: 'einde',
            ploeg: 'center',
            spelerIn: '',
            timestamp: serverTimestamp()
        });
        
        alert('Wedstrijd beëindigd!');
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Error ending match:', error);
    }
}

// ===============================================
// TIMER
// ===============================================

function startTimer() {
    stopTimer(); // Clear any existing timer
    
    timerInterval = setInterval(async () => {
        if (currentMatch.status === 'live') {
            try {
                const matchRef = doc(db, 'matches', currentMatchId);
                const newMinute = (currentMatch.currentMinute || 0) + 1;
                
                await updateDoc(matchRef, {
                    currentMinute: newMinute
                });
            } catch (error) {
                console.error('Timer error:', error);
            }
        }
    }, 60000); // Every minute
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
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
        // Fallback: query without orderBy if index not created
        if (error.code === 'failed-precondition') {
            console.log('Index not found, using simple query');
            const simpleQuery = query(
                collection(db, 'events'),
                where('matchId', '==', currentMatchId)
            );
            eventsListener = onSnapshot(simpleQuery, (snapshot) => {
                console.log('Events (simple query):', snapshot.size);
                // Sort manually
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
    
    console.log('Rendering timeline with', eventDocs.length, 'events');
    
    if (eventDocs.length === 0) {
        timeline.innerHTML = '<div class="timeline-empty">De wedstrijd is gestart. Events verschijnen hier...</div>';
        return;
    }
    
    timeline.innerHTML = '';
    
    eventDocs.forEach(doc => {
        const event = doc.data();
        console.log('Creating event element:', event);
        const eventElement = createEventElement(event);
        timeline.appendChild(eventElement);
    });
}

function createEventElement(event) {
    const div = document.createElement('div');
    
    // Check if it's a center event (aftrap, rust, einde, score-correctie)
    if (event.ploeg === 'center') {
        div.className = `timeline-event center ${event.type}`;
        
        const details = document.createElement('div');
        details.className = 'event-details center';
        
        const type = document.createElement('div');
        type.className = 'event-type';
        type.textContent = getEventTypeText(event.type);
        
        details.appendChild(type);
        
        // Add score for score-correctie
        if (event.type === 'score-correctie' && event.spelerIn) {
            const score = document.createElement('div');
            score.className = 'event-player';
            score.textContent = event.spelerIn;
            details.appendChild(score);
        }
        
        div.appendChild(details);
        return div;
    }
    
    // Regular team events
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
    
    // Only add player info if names are provided
    if (event.type === 'wissel') {
        if (event.spelerUit || event.spelerIn) {
            const player = document.createElement('div');
            player.className = 'event-player';
            
            const parts = [];
            if (event.spelerUit) {
                parts.push(`🔻 ${event.spelerUit}`);
            }
            if (event.spelerIn) {
                parts.push(`🔺 ${event.spelerIn}`);
            }
            player.textContent = parts.join(' ');
            details.appendChild(player);
        }
    } else {
        // For other events, only show player if name is provided
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
    if (matchListener) matchListener();
    if (eventsListener) eventsListener();
    stopTimer();
});
