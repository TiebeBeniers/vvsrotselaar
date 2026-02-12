// ===============================================
// TEAM PAGE FUNCTIONALITY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, orderBy, limit, onSnapshot, doc, setDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Team.js loaded');

// Get team type from URL (e.g., veteranen.html -> veteranen)
function getTeamTypeFromURL() {
    const path = window.location.pathname;
    const filename = path.substring(path.lastIndexOf('/') + 1);
    const teamType = filename.replace('.html', '');
    
    // Validate team type
    const validTeams = ['veteranen', 'zaterdag', 'zondag'];
    if (validTeams.includes(teamType)) {
        return teamType;
    }
    
    // Fallback: check if set in window
    if (window.TEAM_TYPE) {
        return window.TEAM_TYPE;
    }
    
    console.error('Could not determine team type from URL:', filename);
    return null;
}

const TEAM_TYPE = getTeamTypeFromURL();
console.log('Team type:', TEAM_TYPE);

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
// AUTH STATE
// ===============================================

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    
    if (user) {
        currentUser = user;
        if (loginLink) loginLink.textContent = 'PROFIEL';
    } else {
        currentUser = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
    }
});

// ===============================================
// LOAD NEXT MATCH OR LIVE MATCH
// ===============================================

let liveMatchListener = null;
let liveUpdateInterval = null;

async function loadNextMatch() {
    console.log('Loading next match for', TEAM_TYPE);
    const container = document.getElementById('nextMatchContainer');
    
    if (!container) return;
    
    // First check for live match
    const liveQuery = query(
        collection(db, 'matches'),
        where('team', '==', TEAM_TYPE),
        where('status', 'in', ['live', 'rust'])
    );
    
    try {
        // Setup real-time listener for live matches
        if (liveMatchListener) {
            liveMatchListener();
        }
        
        liveMatchListener = onSnapshot(liveQuery, (snapshot) => {
            if (!snapshot.empty) {
                // Live match found
                const matchData = snapshot.docs[0].data();
                const matchId = snapshot.docs[0].id;
                displayLiveMatch({ id: matchId, ...matchData }, container);
                startLiveUpdate({ id: matchId, ...matchData });
            } else {
                // No live match, show next planned match
                stopLiveUpdate();
                loadPlannedMatch(container);
            }
        });
        
    } catch (error) {
        console.error('Error loading match:', error);
        container.innerHTML = '<p class="error">Fout bij laden van wedstrijd.</p>';
    }
}

async function loadPlannedMatch(container) {
    console.log('Loading planned match for team:', TEAM_TYPE);
    
    try {
        // First, try without date filter to see if there are ANY planned matches
        const plannedQuery = query(
            collection(db, 'matches'),
            where('team', '==', TEAM_TYPE),
            where('status', '==', 'planned')
        );
        
        console.log('Querying matches with team:', TEAM_TYPE, 'status: planned');
        const snapshot = await getDocs(plannedQuery);
        console.log('Found', snapshot.size, 'planned matches');
        
        if (snapshot.empty) {
            console.log('No planned matches found for', TEAM_TYPE);
            container.innerHTML = '<p class="no-matches">Geen geplande wedstrijden gevonden.</p>';
            return;
        }
        
        // Get all matches and sort by date
        const matches = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log('Found match:', data.thuisploeg, 'vs', data.uitploeg, 'on', data.datum);
            matches.push({ id: doc.id, ...data });
        });
        
        // Sort matches by date and time
        matches.sort((a, b) => {
            const dateA = new Date(`${a.datum}T${a.uur || '00:00'}`);
            const dateB = new Date(`${b.datum}T${b.uur || '00:00'}`);
            return dateA - dateB;
        });
        
        // Filter to only future matches
        const now = new Date();
        const futureMatches = matches.filter(match => {
            const matchDate = new Date(`${match.datum}T${match.uur || '00:00'}`);
            return matchDate >= now;
        });
        
        if (futureMatches.length === 0) {
            // Show most recent match even if in the past
            console.log('No future matches, showing most recent');
            const nextMatch = matches[matches.length - 1];
            displayPlannedMatch(nextMatch, container);
        } else {
            console.log('Showing next future match');
            const nextMatch = futureMatches[0];
            displayPlannedMatch(nextMatch, container);
        }
        
    } catch (error) {
        console.error('Error loading planned match:', error);
        console.error('Error details:', error.message);
        container.innerHTML = `<p class="error">Fout bij laden van wedstrijd: ${error.message}</p>`;
    }
}

function displayPlannedMatch(match, container) {
    console.log('Displaying planned match:', match);
    
    try {
        const matchDate = new Date(`${match.datum}T${match.uur || '00:00'}`);
        const formattedDate = matchDate.toLocaleDateString('nl-BE', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const formattedTime = match.uur || 'Tijd niet beschikbaar';
        
        // Availability section HTML - alleen voor ingelogde users
        const availabilityHTML = currentUser ? `
                <!-- Availability Section -->
                <div class="availability-section" id="availabilitySection">
                    <div class="availability-header">
                        <div class="availability-title">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            Beschikbaarheid
                        </div>
                        <div class="availability-summary" id="availabilitySummary">
                            <div class="availability-count available">
                                <span>✓</span>
                                <span id="availableCount">0</span>
                            </div>
                            <div class="availability-count unavailable">
                                <span>✗</span>
                                <span id="unavailableCount">0</span>
                            </div>
                        </div>
                    </div>
                    <div id="availabilityContent">
                        <div class="loading">Laden...</div>
                    </div>
                </div>
        ` : '';
        
        container.innerHTML = `
            <div class="next-match-card planned">
                <div class="match-date">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <span>${formattedDate} om ${formattedTime}</span>
                </div>
                <div class="match-teams-preview">
                    <div class="team-name">${match.thuisploeg || 'Thuisploeg'}</div>
                    <div class="vs">VS</div>
                    <div class="team-name">${match.uitploeg || 'Uitploeg'}</div>
                </div>
                <div class="match-location">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span>${match.locatie || 'Locatie niet beschikbaar'}</span>
                </div>
                ${match.beschrijving ? `<div class="match-description">${match.beschrijving}</div>` : ''}
                ${availabilityHTML}
            </div>
        `;
        
        console.log('Planned match displayed successfully');
        
        // Load availability data (alleen als user ingelogd is)
        if (currentUser) {
            loadAvailability(match.id);
        }
        
    } catch (error) {
        console.error('Error displaying planned match:', error);
        container.innerHTML = `<p class="error">Fout bij weergeven van wedstrijd: ${error.message}</p>`;
    }
}

function displayLiveMatch(match, container) {
    container.innerHTML = `
        <div class="next-match-card live">
            <div class="live-badge-small">
                ${match.status === 'rust' ? 'RUST' : 'LIVE'}
            </div>
            <div class="live-match-display">
                <div class="live-team">
                    <div class="team-name">${match.thuisploeg}</div>
                    <div class="live-score" id="liveHomeScore">${match.scoreThuis || 0}</div>
                </div>
                <div class="live-center">
                    <div class="live-time" id="liveTime">0'</div>
                    <div class="live-separator">-</div>
                </div>
                <div class="live-team">
                    <div class="team-name">${match.uitploeg}</div>
                    <div class="live-score" id="liveAwayScore">${match.scoreUit || 0}</div>
                </div>
            </div>
            <button class="watch-live-btn" onclick="window.location.href='live.html'">
                VOLG LIVE →
            </button>
        </div>
    `;
    
    updateLiveDisplay(match);
}

function updateLiveDisplay(match) {
    const timeEl = document.getElementById('liveTime');
    const homeScoreEl = document.getElementById('liveHomeScore');
    const awayScoreEl = document.getElementById('liveAwayScore');
    
    if (!timeEl) return;
    
    // Update scores
    if (homeScoreEl) homeScoreEl.textContent = match.scoreThuis || 0;
    if (awayScoreEl) awayScoreEl.textContent = match.scoreUit || 0;
    
    // Update time
    timeEl.textContent = calculateDisplayTime(match);
}

function calculateDisplayTime(match) {
    if (!match.startedAt) return "0'";
    
    try {
        const halfTimeReached = match.halfTimeReached || false;
        const halfTime = match.team === 'veteranen' ? 35 : 45;
        
        let elapsedSeconds;
        
        if (!halfTimeReached) {
            const startTime = match.startedAt.toMillis();
            const currentTime = match.status === 'rust' && match.pausedAt 
                ? match.pausedAt.toMillis() 
                : Date.now();
            
            elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
        } else {
            if (match.resumeStartedAt) {
                const resumeStart = match.resumeStartedAt.toMillis();
                elapsedSeconds = Math.floor((Date.now() - resumeStart) / 1000);
            } else {
                elapsedSeconds = halfTime * 60;
            }
        }
        
        const totalMinutes = Math.floor(elapsedSeconds / 60);
        
        if (!halfTimeReached) {
            if (totalMinutes < halfTime) {
                return `${totalMinutes}'`;
            } else {
                const extraTime = totalMinutes - halfTime;
                return `${halfTime}+${extraTime}'`;
            }
        } else {
            if (match.status === 'rust' && !match.resumeStartedAt) {
                return `${halfTime}'`;
            } else {
                const secondHalfMinute = halfTime + totalMinutes;
                
                if (secondHalfMinute <= halfTime * 2) {
                    return `${secondHalfMinute}'`;
                } else {
                    const extraTime = secondHalfMinute - (halfTime * 2);
                    return `${halfTime * 2}+${extraTime}'`;
                }
            }
        }
    } catch (error) {
        console.error('Error calculating time:', error);
        return "0'";
    }
}

let currentLiveMatch = null;

function startLiveUpdate(match) {
    currentLiveMatch = match;
    stopLiveUpdate();
    
    liveUpdateInterval = setInterval(() => {
        if (currentLiveMatch) {
            updateLiveDisplay(currentLiveMatch);
        }
    }, 1000);
}

function stopLiveUpdate() {
    if (liveUpdateInterval) {
        clearInterval(liveUpdateInterval);
        liveUpdateInterval = null;
    }
    currentLiveMatch = null;
}

// ===============================================
// LOAD RANKING
// ===============================================

async function loadRanking() {
    console.log('Loading ranking for', TEAM_TYPE);
    const tbody = document.getElementById('rankingBody');
    
    if (!tbody) {
        console.error('Ranking body element not found');
        return;
    }
    
    try {
        console.log('Fetching ranking.json...');
        const response = await fetch('ranking.json');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const rankingData = await response.json();
        console.log('Ranking data loaded successfully');
        console.log('Available teams in ranking:', Object.keys(rankingData));
        
        const teamRanking = rankingData[TEAM_TYPE];
        
        if (!teamRanking) {
            console.error('No ranking data for team:', TEAM_TYPE);
            tbody.innerHTML = `<tr><td colspan="10" class="error">Geen ranking beschikbaar voor ${TEAM_TYPE}.</td></tr>`;
            return;
        }
        
        if (teamRanking.length === 0) {
            console.log('Ranking array is empty for', TEAM_TYPE);
            tbody.innerHTML = '<tr><td colspan="10">Geen ranking beschikbaar.</td></tr>';
            return;
        }
        
        console.log('Found', teamRanking.length, 'teams in ranking');
        tbody.innerHTML = '';
        
        teamRanking.forEach((team, index) => {
            const row = document.createElement('tr');
            const isVVS = team.team.includes('V.V.S ROTSELAAR');
            
            if (isVVS) {
                row.classList.add('vvs-row');
                console.log('Found VVS row at position', team.pos);
            } else {
                row.classList.add(index % 2 === 0 ? 'even-row' : 'odd-row');
            }
            
            // Clean up team name (remove duplicates)
            const teamName = team.team.replace(/(.+)\1+/, '$1');
            
            // Calculate played games
            const played = team.won + team.draw + team.lost;
            
            row.innerHTML = `
                <td class="pos-col">${team.pos}</td>
                <td class="team-col">${teamName}</td>
                <td class="pnt-col"><strong>${team.pnt}</strong></td>
                <td class="stat-col">${played}</td>
                <td class="stat-col">${team.won}</td>
                <td class="stat-col">${team.draw}</td>
                <td class="stat-col">${team.lost}</td>
                <td class="goals-col">${team.goals_for}</td>
                <td class="goals-col">${team.goals_against}</td>
                <td class="saldo-col ${team.saldo >= 0 ? 'positive' : 'negative'}">${team.saldo >= 0 ? '+' : ''}${team.saldo}</td>
            `;
            
            tbody.appendChild(row);
        });
        
        console.log('Ranking table populated successfully');
        
    } catch (error) {
        console.error('Error loading ranking:', error);
        console.error('Error details:', error.message);
        tbody.innerHTML = `<tr><td colspan="10" class="error">Fout bij laden van ranking: ${error.message}</td></tr>`;
    }
}

// ===============================================
// LOAD RECENT MATCHES
// ===============================================

async function loadRecentMatches() {
    console.log('Loading recent matches for', TEAM_TYPE);
    const container = document.getElementById('recentMatchesList');
    
    if (!container) {
        console.error('Recent matches container not found');
        return;
    }
    
    try {
        const recentQuery = query(
            collection(db, 'matches'),
            where('team', '==', TEAM_TYPE),
            where('status', '==', 'finished')
        );
        
        console.log('Querying finished matches for', TEAM_TYPE);
        const snapshot = await getDocs(recentQuery);
        console.log('Found', snapshot.size, 'finished matches');
        
        if (snapshot.empty) {
            console.log('No finished matches found');
            container.innerHTML = '<p class="no-matches">Nog geen afgelopen wedstrijden.</p>';
            return;
        }
        
        // Get all finished matches and sort by date
        const matches = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log('Finished match:', data.thuisploeg, 'vs', data.uitploeg, data.scoreThuis, '-', data.scoreUit);
            matches.push({ id: doc.id, ...data });
        });
        
        // Sort by date descending (most recent first)
        matches.sort((a, b) => {
            const dateA = new Date(`${a.datum}T${a.uur || '00:00'}`);
            const dateB = new Date(`${b.datum}T${b.uur || '00:00'}`);
            return dateB - dateA;
        });
        
        // Take only last 3
        const recentMatches = matches.slice(0, 3);
        console.log('Showing', recentMatches.length, 'recent matches');
        
        container.innerHTML = '';
        
        recentMatches.forEach(match => {
            const card = createRecentMatchCard(match);
            container.appendChild(card);
        });
        
    } catch (error) {
        console.error('Error loading recent matches:', error);
        console.error('Error details:', error.message);
        container.innerHTML = `<p class="error">Fout bij laden van wedstrijden: ${error.message}</p>`;
    }
}

function createRecentMatchCard(match) {
    const card = document.createElement('div');
    card.className = 'recent-match-card';
    
    const matchDate = new Date(`${match.datum}T${match.uur}`);
    const formattedDate = matchDate.toLocaleDateString('nl-BE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
    
    card.innerHTML = `
        <div class="recent-match-date">${formattedDate} - ${match.uur}</div>
        <div class="recent-match-teams">
            <div class="recent-team">${match.thuisploeg}</div>
            <div class="recent-score">${match.scoreThuis} - ${match.scoreUit}</div>
            <div class="recent-team">${match.uitploeg}</div>
        </div>
        ${match.beschrijving ? `<div class="recent-match-desc">${match.beschrijving}</div>` : ''}
    `;
    
    card.addEventListener('click', () => {
        showMatchTimeline(match);
    });
    
    return card;
}

// ===============================================
// MATCH TIMELINE MODAL
// ===============================================

async function showMatchTimeline(match) {
    const modal = document.getElementById('timelineModal');
    const modalTitle = document.getElementById('timelineModalTitle');
    const modalHomeTeam = document.getElementById('modalHomeTeam');
    const modalAwayTeam = document.getElementById('modalAwayTeam');
    const modalHomeScore = document.getElementById('modalHomeScore');
    const modalAwayScore = document.getElementById('modalAwayScore');
    const modalMatchDate = document.getElementById('modalMatchDate');
    const modalMatchLocation = document.getElementById('modalMatchLocation');
    const modalTimeline = document.getElementById('modalTimeline');
    
    if (!modal) return;
    
    // Update modal header
    modalTitle.textContent = 'Wedstrijd Samenvatting';
    modalHomeTeam.textContent = match.thuisploeg;
    modalAwayTeam.textContent = match.uitploeg;
    modalHomeScore.textContent = match.scoreThuis || 0;
    modalAwayScore.textContent = match.scoreUit || 0;
    
    const matchDate = new Date(`${match.datum}T${match.uur}`);
    modalMatchDate.textContent = matchDate.toLocaleDateString('nl-BE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    modalMatchLocation.textContent = match.locatie;
    
    // Show modal
    modal.classList.add('active');
    
    // Load timeline
    modalTimeline.innerHTML = '<div class="loading">Laden...</div>';
    
    try {
        // Query WITHOUT orderBy to avoid needing composite index
        const eventsQuery = query(
            collection(db, 'events'),
            where('matchId', '==', match.id)
        );
        
        const eventsSnapshot = await getDocs(eventsQuery);
        
        if (eventsSnapshot.empty) {
            modalTimeline.innerHTML = '<p class="no-events">Geen tijdslijn beschikbaar, deze match werd niet Live gevolgd.</p>';
            return;
        }
        
        const events = [];
        eventsSnapshot.forEach(doc => {
            events.push({ id: doc.id, ...doc.data() });
        });
        
        // Sort events manually (same logic as live.js)
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
                // Use half field if available
                const eventHalf = event.half || 1;
                
                if (eventHalf === 2) {
                    secondHalfEvents.push(event);
                } else {
                    firstHalfEvents.push(event);
                }
            }
        });
        
        // Sort first half descending (most recent first)
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
        
        // Combine: second half → hervat → rust → first half
        const sortedEvents = [];
        sortedEvents.push(...secondHalfEvents);
        if (hervatEvent) sortedEvents.push(hervatEvent);
        if (rustEvent) sortedEvents.push(rustEvent);
        sortedEvents.push(...firstHalfEvents);
        
        displayTimeline(sortedEvents, modalTimeline, match);
        
    } catch (error) {
        console.error('Error loading match timeline:', error);
        modalTimeline.innerHTML = '<p class="error">Fout bij laden van timeline. Probeer het opnieuw.</p>';
    }
}

function displayTimeline(events, container, match) {
    container.innerHTML = '';
    
    events.forEach(event => {
        const item = createTimelineItem(event, match);
        container.appendChild(item);
    });
}

function createTimelineItem(event, match) {
    const item = document.createElement('div');
    item.className = `timeline-item ${event.ploeg || 'center'}`;
    
    const iconMap = {
        'aftrap': '⚽',
        'goal': '⚽',
        'penalty': '⚽',
        'own-goal': '⚽',
        'yellow': '🟨',
        'red': '🟥',
        'substitution': '🔄',
        'rust': '⏸',
        'hervat': '▶️',
        'einde': '🏁'
    };
    
    const icon = iconMap[event.type] || '•';
    
    let description = '';
    switch (event.type) {
        case 'aftrap':
            description = 'Aftrap';
            break;
        case 'goal':
            description = `GOAL${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'penalty':
            description = `PENALTY${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'own-goal':
            description = `Eigen doelpunt${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'yellow':
            description = `Gele kaart${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'red':
            description = `Rode kaart${event.speler ? ' - ' + event.speler : ''}`;
            break;
        case 'substitution':
            description = `Wissel${event.spelerUit && event.spelerIn ? ': ' + event.spelerUit + ' → ' + event.spelerIn : ''}`;
            break;
        case 'rust':
            description = 'Rust';
            break;
        case 'hervat':
            description = 'Hervat 2e helft';
            break;
        case 'einde':
            description = 'Einde wedstrijd';
            break;
        default:
            description = event.type;
    }
    
    // Structuur zoals live.js: minuut, icoon, en description los van elkaar
    item.innerHTML = `
        <span class="timeline-minute">${event.minuut || 0}'</span>
        <span class="timeline-icon">${icon}</span>
        <div class="timeline-content">
            <span class="timeline-description">${description}</span>
        </div>
    `;
    
    return item;
}

// Close modal
const modalClose = document.getElementById('modalClose');
if (modalClose) {
    modalClose.addEventListener('click', () => {
        const modal = document.getElementById('timelineModal');
        if (modal) modal.classList.remove('active');
    });
}

// Close modal on outside click
const timelineModal = document.getElementById('timelineModal');
if (timelineModal) {
    timelineModal.addEventListener('click', (e) => {
        if (e.target === timelineModal) {
            timelineModal.classList.remove('active');
        }
    });
}

// ===============================================
// LOAD STATISTICS
// ===============================================

function loadStatistics() {
    console.log('Loading statistics for', TEAM_TYPE);
    
    // Placeholder data - in de toekomst kan dit uit Firestore komen
    const statisticsData = {
        zondag: {
            topScorers: [
                { name: 'Roel Wouters', goals: 10 },
                { name: 'Dries Moermans', goals: 6 },
                { name: 'Ruben Staal', goals: 4 }
            ],
            topAssists: [
                { name: 'Dries Moermans', assists: 9 },
                { name: 'Jesse Janssens', assists: 5 },
                { name: 'Nand Wallays', assists: 4 }
            ]
        }
    };
    
    const teamStats = statisticsData[TEAM_TYPE];
    
    if (!teamStats) {
        console.log('No statistics available for', TEAM_TYPE);
        return;
    }
    
    // Update top scorers
    const topScorersContainer = document.getElementById('topScorers');
    if (topScorersContainer && teamStats.topScorers) {
        topScorersContainer.innerHTML = '';
        teamStats.topScorers.forEach((scorer, index) => {
            const item = document.createElement('div');
            item.className = 'stat-item';
            item.innerHTML = `
                <span class="stat-rank">${index + 1}</span>
                <span class="stat-player">${scorer.name}</span>
                <span class="stat-value">${scorer.goals}</span>
            `;
            topScorersContainer.appendChild(item);
        });
    }
    
    // Update top assists
    const topAssistsContainer = document.getElementById('topAssists');
    if (topAssistsContainer && teamStats.topAssists) {
        topAssistsContainer.innerHTML = '';
        teamStats.topAssists.forEach((assister, index) => {
            const item = document.createElement('div');
            item.className = 'stat-item';
            item.innerHTML = `
                <span class="stat-rank">${index + 1}</span>
                <span class="stat-player">${assister.name}</span>
                <span class="stat-value">${assister.assists}</span>
            `;
            topAssistsContainer.appendChild(item);
        });
    }
}

// ===============================================
// INITIALIZE PAGE
// ===============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing team page...');
    loadNextMatch();
    loadRanking();
    loadRecentMatches();
    loadStatistics();
});

// ===============================================
// AVAILABILITY SYSTEM
// ===============================================

let availabilityListener = null;

async function loadAvailability(matchId) {
    console.log('Loading availability for match:', matchId);
    const contentDiv = document.getElementById('availabilityContent');
    
    if (!contentDiv) return;
    
    // Als gebruiker NIET ingelogd is: toon helemaal niks
    if (!currentUser) {
        contentDiv.innerHTML = ''; // Volledig leeg
        return;
    }
    
    // Gebruiker is ingelogd - check of het zijn eigen ploeg is
    try {
        // Haal gebruikersdata op
        const userQuery = query(collection(db, 'users'), where('uid', '==', currentUser.uid));
        const userSnapshot = await getDocs(userQuery);
        
        if (userSnapshot.empty) {
            console.log('User data not found');
            contentDiv.innerHTML = '';
            return;
        }
        
        const userData = userSnapshot.docs[0].data();
        const userCategorie = userData.categorie; // veteranen/zaterdag/zondag/bestuurslid
        
        console.log('User categorie:', userCategorie, 'Team type:', TEAM_TYPE);
        
        // Check of gebruiker bij deze ploeg hoort
        const isOwnTeam = userCategorie === TEAM_TYPE;
        const isBestuurslid = userCategorie === 'bestuurslid';
        
        if (isOwnTeam) {
            // Eigen ploeg: toon knoppen EN lijst
            contentDiv.innerHTML = `
                <div class="availability-actions">
                    <button class="availability-btn available" id="availableBtn">
                        <span>✓</span>
                        <span>Ik kan komen</span>
                    </button>
                    <button class="availability-btn unavailable" id="unavailableBtn">
                        <span>✗</span>
                        <span>Ik kan niet komen</span>
                    </button>
                </div>
                <div class="availability-list" id="availabilityList">
                    <div class="loading">Laden...</div>
                </div>
            `;
            
            // Setup button handlers
            const availableBtn = document.getElementById('availableBtn');
            const unavailableBtn = document.getElementById('unavailableBtn');
            
            availableBtn.addEventListener('click', () => setAvailability(matchId, true, userData.naam));
            unavailableBtn.addEventListener('click', () => setAvailability(matchId, false, userData.naam));
            
            // Setup real-time listener met lijst
            setupAvailabilityListener(matchId, true);
            
        } else if (isBestuurslid) {
            // Bestuurslid: alleen lijst zien, geen knoppen
            contentDiv.innerHTML = `
                <div class="availability-info">
                    <p style="color: var(--text-gray); font-size: 0.9rem; margin-bottom: 1rem; font-style: italic;">
                        Als bestuurslid kun je de beschikbaarheid bekijken
                    </p>
                </div>
                <div class="availability-list" id="availabilityList">
                    <div class="loading">Laden...</div>
                </div>
            `;
            
            // Setup real-time listener met lijst
            setupAvailabilityListener(matchId, true);
            
        } else {
            // Andere ploeg: alleen telling zien, geen lijst
            contentDiv.innerHTML = `
                <div class="availability-summary-only"></div>
            `;
            
            // Setup real-time listener zonder lijst (alleen telling)
            setupAvailabilityListener(matchId, false);
        }
        
    } catch (error) {
        console.error('Error loading availability:', error);
        contentDiv.innerHTML = '';
    }
}

function setupAvailabilityListener(matchId, showList = true) {
    // Clean up previous listener
    if (availabilityListener) {
        availabilityListener();
    }
    
    const availabilityRef = collection(db, 'matches', matchId, 'availability');
    
    availabilityListener = onSnapshot(availabilityRef, (snapshot) => {
        console.log('Availability updated, count:', snapshot.size);
        
        const availabilityList = document.getElementById('availabilityList');
        const availableCountEl = document.getElementById('availableCount');
        const unavailableCountEl = document.getElementById('unavailableCount');
        const availableBtn = document.getElementById('availableBtn');
        const unavailableBtn = document.getElementById('unavailableBtn');
        
        // Count and organize data
        let availableCount = 0;
        let unavailableCount = 0;
        const availabilities = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            availabilities.push({
                userId: doc.id,
                ...data
            });
            
            if (data.available) {
                availableCount++;
            } else {
                unavailableCount++;
            }
        });
        
        // Update counts in header (altijd zichtbaar)
        if (availableCountEl) availableCountEl.textContent = availableCount;
        if (unavailableCountEl) unavailableCountEl.textContent = unavailableCount;
        
        // Update button states if user is logged in
        if (currentUser && availableBtn && unavailableBtn) {
            availableBtn.classList.remove('selected');
            unavailableBtn.classList.remove('selected');
            
            const userAvailability = availabilities.find(a => a.userId === currentUser.uid);
            if (userAvailability) {
                if (userAvailability.available) {
                    availableBtn.classList.add('selected');
                } else {
                    unavailableBtn.classList.add('selected');
                }
            }
        }
        
        // Display list ONLY if showList is true (eigen ploeg of bestuurslid)
        if (showList && availabilityList) {
            if (availabilities.length === 0) {
                availabilityList.innerHTML = `
                    <div class="availability-list-empty">
                        Nog niemand heeft beschikbaarheid aangegeven
                    </div>
                `;
            } else {
                // Sort: available first, then alphabetically
                availabilities.sort((a, b) => {
                    if (a.available !== b.available) {
                        return b.available - a.available; // true (1) before false (0)
                    }
                    return a.displayName.localeCompare(b.displayName);
                });
                
                availabilityList.innerHTML = availabilities.map(av => `
                    <div class="availability-player">
                        <span class="player-name">${av.displayName}</span>
                        <span class="availability-status ${av.available ? 'available' : 'unavailable'}">
                            <span>${av.available ? '✓' : '✗'}</span>
                            <span>${av.available ? 'Aanwezig' : 'Afwezig'}</span>
                        </span>
                    </div>
                `).join('');
            }
        }
    }, (error) => {
        console.error('Error loading availability:', error);
        if (availabilityList && showList) {
            availabilityList.innerHTML = `<p class="error">Fout bij laden van beschikbaarheid</p>`;
        }
    });
}

async function setAvailability(matchId, available, userName) {
    if (!currentUser) {
        alert('Je moet ingelogd zijn om je beschikbaarheid aan te geven');
        return;
    }
    
    const availableBtn = document.getElementById('availableBtn');
    const unavailableBtn = document.getElementById('unavailableBtn');
    
    // Disable buttons during update
    if (availableBtn) availableBtn.disabled = true;
    if (unavailableBtn) unavailableBtn.disabled = true;
    
    try {
        const availabilityRef = doc(db, 'matches', matchId, 'availability', currentUser.uid);
        
        await setDoc(availabilityRef, {
            available: available,
            displayName: userName || currentUser.displayName || currentUser.email,
            timestamp: new Date().toISOString()
        });
        
        console.log('Availability set:', available);
        
    } catch (error) {
        console.error('Error setting availability:', error);
        alert('Fout bij opslaan van beschikbaarheid. Probeer opnieuw.');
    } finally {
        // Re-enable buttons
        if (availableBtn) availableBtn.disabled = false;
        if (unavailableBtn) unavailableBtn.disabled = false;
    }
}

// Cleanup availability listener on page unload
window.addEventListener('beforeunload', () => {
    if (availabilityListener) {
        availabilityListener();
    }
});

// ===============================================
// END AVAILABILITY SYSTEM
// ===============================================

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (liveMatchListener) {
        liveMatchListener();
    }
    stopLiveUpdate();
});

console.log('Team.js initialization complete');
