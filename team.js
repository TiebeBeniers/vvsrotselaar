// ===============================================
// TEAM PAGE FUNCTIONALITY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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
            </div>
        `;
        
        console.log('Planned match displayed successfully');
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
    modalHomeScore.textContent = match.scoreThuis;
    modalAwayScore.textContent = match.scoreUit;
    
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
        const eventsQuery = query(
            collection(db, 'events'),
            where('matchId', '==', match.id),
            orderBy('timestamp', 'asc')
        );
        
        const eventsSnapshot = await getDocs(eventsQuery);
        
        if (eventsSnapshot.empty) {
            modalTimeline.innerHTML = '<p class="no-events">Geen events beschikbaar voor deze wedstrijd.</p>';
            return;
        }
        
        const events = [];
        eventsSnapshot.forEach(doc => {
            events.push({ id: doc.id, ...doc.data() });
        });
        
        displayTimeline(events, modalTimeline, match);
        
    } catch (error) {
        console.error('Error loading match timeline:', error);
        modalTimeline.innerHTML = '<p class="error">Fout bij laden van timeline.</p>';
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
    item.className = `timeline-item ${event.ploeg}`;
    
    const iconMap = {
        'aftrap': '⚽',
        'goal': '⚽',
        'penalty': '⚽',
        'eigen-doelpunt': '⚽',
        'gele-kaart': '🟨',
        'rode-kaart': '🟥',
        'wissel': '🔄',
        'rust': '⏸',
        'hervatting': '▶️',
        'einde': '🏁'
    };
    
    const icon = iconMap[event.type] || '•';
    
    let description = '';
    switch (event.type) {
        case 'aftrap':
            description = 'Aftrap';
            break;
        case 'goal':
            description = `GOAL! ${event.spelerIn || 'Onbekende speler'}`;
            break;
        case 'penalty':
            description = `PENALTY! ${event.spelerIn || 'Onbekende speler'}`;
            break;
        case 'eigen-doelpunt':
            description = `Eigen doelpunt ${event.spelerIn || ''}`;
            break;
        case 'gele-kaart':
            description = `Gele kaart voor ${event.spelerIn || 'onbekende speler'}`;
            break;
        case 'rode-kaart':
            description = `Rode kaart voor ${event.spelerIn || 'onbekende speler'}`;
            break;
        case 'wissel':
            description = `Wissel: ${event.spelerUit || '?'} → ${event.spelerIn || '?'}`;
            break;
        case 'rust':
            description = 'Rust';
            break;
        case 'hervatting':
            description = 'Hervatting 2e helft';
            break;
        case 'einde':
            description = 'Einde wedstrijd';
            break;
        default:
            description = event.type;
    }
    
    item.innerHTML = `
        <div class="timeline-icon">${icon}</div>
        <div class="timeline-content">
            <div class="timeline-minute">${event.minuut}'</div>
            <div class="timeline-description">${description}</div>
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (liveMatchListener) {
        liveMatchListener();
    }
    stopLiveUpdate();
});

console.log('Team.js initialization complete');
