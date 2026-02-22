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
            loadAvailability(match.id, match);
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

// Sla alle geladen wedstrijden op voor "meer laden"
let allRecentMatches = [];
const INITIAL_SHOW = 3;
const LOAD_MORE_STEP = 3;
let currentlyShowing = INITIAL_SHOW;

// Bereken win/loss/draw voor VVS Rotselaar
function getMatchResult(match) {
    const vvsNames = ['v.v.s rotselaar', 'vvs rotselaar', 'v.v.s. rotselaar'];
    const homeIsVVS = vvsNames.includes((match.thuisploeg || '').toLowerCase());
    const awayIsVVS = vvsNames.includes((match.uitploeg || '').toLowerCase());

    const home = match.scoreThuis ?? 0;
    const away = match.scoreUit  ?? 0;

    if (!homeIsVVS && !awayIsVVS) return 'unknown';
    if (home === away) return 'draw';

    const vvsScore  = homeIsVVS ? home : away;
    const oppScore  = homeIsVVS ? away : home;
    return vvsScore > oppScore ? 'win' : 'loss';
}

function renderFormBar(matches) {
    // matches zijn gesorteerd van meest recent → oud
    // Neem de laatste 5 (of minder), keer de volgorde om → oudste links
    const last5 = matches.slice(0, 5).reverse();

    const circles = [];
    for (let i = 0; i < 5; i++) {
        if (i < last5.length) {
            const result = getMatchResult(last5[i]);
            if      (result === 'win')  circles.push('<span class="form-circle win"  title="Gewonnen"></span>');
            else if (result === 'loss') circles.push('<span class="form-circle loss" title="Verloren"></span>');
            else if (result === 'draw') circles.push('<span class="form-circle draw" title="Gelijkspel"></span>');
            else                        circles.push('<span class="form-circle empty" title="Onbekend"></span>');
        } else {
            circles.push('<span class="form-circle empty" title="Geen wedstrijd"></span>');
        }
    }
    return circles.join('');
}

async function loadRecentMatches() {
    console.log('Loading recent matches for', TEAM_TYPE);
    const container = document.getElementById('recentMatchesList');
    if (!container) return;

    try {
        const recentQuery = query(
            collection(db, 'matches'),
            where('team', '==', TEAM_TYPE),
            where('status', '==', 'finished')
        );

        const snapshot = await getDocs(recentQuery);
        console.log('Found', snapshot.size, 'finished matches');

        if (snapshot.empty) {
            container.innerHTML = '<p class="no-matches">Nog geen afgelopen wedstrijden.</p>';
            return;
        }

        // Verzamel en sorteer
        allRecentMatches = [];
        snapshot.forEach(doc => {
            allRecentMatches.push({ id: doc.id, ...doc.data() });
        });
        allRecentMatches.sort((a, b) => {
            const dateA = new Date(`${a.datum}T${a.uur || '00:00'}`);
            const dateB = new Date(`${b.datum}T${b.uur || '00:00'}`);
            return dateB - dateA; // meest recent eerst
        });

        currentlyShowing = INITIAL_SHOW;
        renderRecentMatches(container);

        // Vorm cirkels naast de h2 plaatsen
        const section = container.closest('section');
        if (section && allRecentMatches.length > 0) {
            // Zoek bestaande header wrapper of maak aan
            let header = section.querySelector('.recent-matches-header');
            if (!header) {
                const h2 = section.querySelector('h2');
                if (h2) {
                    header = document.createElement('div');
                    header.className = 'recent-matches-header';
                    h2.parentNode.insertBefore(header, h2);
                    header.appendChild(h2);
                }
            }
            if (header) {
                // Verwijder oude form-bar als die er al is
                const old = header.querySelector('.form-bar');
                if (old) old.remove();

                const formBar = document.createElement('div');
                formBar.className = 'form-bar';
                formBar.innerHTML = `<div class="form-circles">${renderFormBar(allRecentMatches)}</div>`;
                header.appendChild(formBar);
            }
        }

    } catch (error) {
        console.error('Error loading recent matches:', error);
        container.innerHTML = `<p class="error">Fout bij laden: ${error.message}</p>`;
    }
}

function renderRecentMatches(container) {
    container.innerHTML = '';

    // Wedstrijdkaartjes
    const toShow = allRecentMatches.slice(0, currentlyShowing);
    toShow.forEach(match => {
        container.appendChild(createRecentMatchCard(match));
    });

    // "Meer laden" knop
    if (currentlyShowing < allRecentMatches.length) {
        const moreBtn = document.createElement('button');
        moreBtn.className = 'load-more-btn';
        moreBtn.textContent = `Meer laden (${allRecentMatches.length - currentlyShowing} resterend)`;
        moreBtn.addEventListener('click', () => {
            currentlyShowing += LOAD_MORE_STEP;
            renderRecentMatches(container);
            moreBtn.scrollIntoView({ behavior: 'smooth', block: 'end' });
        });
        container.appendChild(moreBtn);
    }
}

function createRecentMatchCard(match) {
    const card = document.createElement('div');
    card.className = 'recent-match-card';

    const matchDate = new Date(`${match.datum}T${match.uur || '00:00'}`);
    const formattedDate = matchDate.toLocaleDateString('nl-BE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    // Voeg result klasse toe aan de kaart voor kleurcodering
    const result = getMatchResult(match);
    if (result === 'win')  card.classList.add('result-win');
    if (result === 'loss') card.classList.add('result-loss');
    if (result === 'draw') card.classList.add('result-draw');

    card.innerHTML = `
        <div class="recent-match-date">${formattedDate} - ${match.uur}</div>
        <div class="recent-match-teams">
            <div class="recent-team">${match.thuisploeg}</div>
            <div class="recent-score">${match.scoreThuis} - ${match.scoreUit}</div>
            <div class="recent-team">${match.uitploeg}</div>
        </div>
        ${match.beschrijving ? `<div class="recent-match-desc">${match.beschrijving}</div>` : ''}
    `;

    card.addEventListener('click', () => showMatchTimeline(match));
    return card;
}

// ===============================================
// MATCH TIMELINE MODAL
// ===============================================

async function showMatchTimeline(match) {
    const modal           = document.getElementById('timelineModal');
    const modalTitle      = document.getElementById('timelineModalTitle');
    const modalHomeTeam   = document.getElementById('modalHomeTeam');
    const modalAwayTeam   = document.getElementById('modalAwayTeam');
    const modalHomeScore  = document.getElementById('modalHomeScore');
    const modalAwayScore  = document.getElementById('modalAwayScore');
    const modalMatchDate  = document.getElementById('modalMatchDate');
    const modalMatchLocation = document.getElementById('modalMatchLocation');
    const modalTimeline   = document.getElementById('modalTimeline');

    if (!modal) return;

    modalTitle.textContent      = 'Wedstrijd Samenvatting';
    modalHomeTeam.textContent   = match.thuisploeg;
    modalAwayTeam.textContent   = match.uitploeg;
    modalHomeScore.textContent  = match.scoreThuis || 0;
    modalAwayScore.textContent  = match.scoreUit   || 0;

    const matchDate = new Date(`${match.datum}T${match.uur}`);
    modalMatchDate.textContent = matchDate.toLocaleDateString('nl-BE', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    modalMatchLocation.textContent = match.locatie;

    modal.classList.add('active');
    modalTimeline.innerHTML = '<div class="loading">Laden...</div>';

    try {
        const eventsSnapshot = await getDocs(query(
            collection(db, 'events'),
            where('matchId', '==', match.id)
        ));

        if (eventsSnapshot.empty) {
            modalTimeline.innerHTML = '<p class="no-events">Geen tijdslijn beschikbaar.</p>';
            return;
        }

        const events = [];
        eventsSnapshot.forEach(d => events.push({ id: d.id, ...d.data() }));

        modalTimeline.innerHTML = '';
        renderTimelineTeam(events, modalTimeline);

    } catch (error) {
        console.error('Error loading match timeline:', error);
        modalTimeline.innerHTML = '<p class="error">Fout bij laden van timeline.</p>';
    }
}

/**
 * Renders a post-match timeline — logic mirrored from live.js.
 * Structural events (aftrap, rust, einde-regulier, einde) used as dividers.
 * Hervat events are intentionally ignored (not shown).
 * Order (top = most recent):
 *   einde → ET half 4 → ET rust → ET half 3 → einde-regulier
 *   → 2nd half → HT rust → 1st half → aftrap
 */
function renderTimelineTeam(events, container) {
    const STRUCTURAL = new Set(['aftrap', 'rust', 'einde-regulier', 'einde', 'hervat']);
    // Filter out 'hervat' entirely from display
    const structural = events.filter(e => STRUCTURAL.has(e.type) && e.type !== 'hervat');
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

    const rustEvents = structural.filter(e => e.type === 'rust');
    const rustHT     = rustEvents.find(e => (e.half || 1) <= 2) || rustEvents[0] || null;
    const rustET     = rustEvents.find(e => (e.half || 1) >= 3) || null;
    const aftrap     = structural.find(e => e.type === 'aftrap');
    const eindeReg   = structural.find(e => e.type === 'einde-regulier');
    const einde      = structural.find(e => e.type === 'einde');

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

    ordered.forEach(e => container.appendChild(createTimelineItem(e)));
}

// Returns an <img> tag for a given event type — mirrors live.js eventIcon().
function eventIcon(type, half) {
    const img = (file, alt) =>
        `<img src="assets/${file}" alt="${alt}" class="timeline-icon-img">`;
    switch (type) {
        case 'aftrap':         return img('goal.png',       'Aftrap');
        case 'goal':           return img('goal.png',       'Goal');
        case 'penalty':        return img('penalty.png',    'Penalty');
        case 'own-goal':       return img('own-goal.png',   'Eigen doelpunt');
        case 'yellow':         return img('yellow.png',     'Gele kaart');
        case 'yellow2red':     return img('yellow2red.png', '2e Gele kaart / Rood');
        case 'red':            return img('red.png',        'Rode kaart');
        case 'substitution':   return img('sub.png',        'Wissel');
        case 'rust':
            return (half >= 3)
                ? img('rust.png', 'Rust verlengingen')
                : img('rust.png', 'Rust');
        case 'einde-regulier': return img('extra-time.png', 'Verlengingen');
        case 'einde':          return img('einde.png',      'Einde');
        default:               return `<span class="timeline-icon-fallback">•</span>`;
    }
}

function createTimelineItem(event) {
    const item = document.createElement('div');
    item.className = `timeline-item ${event.ploeg || 'center'}`;

    let description = '';

    switch (event.type) {
        case 'aftrap':
            description = 'Aftrap'; break;
        case 'goal':
            description = `GOAL${event.speler ? ' - ' + event.speler : ''}`;
            if (event.assist) description += ` <span class="event-assist">(assist: ${event.assist})</span>`;
            break;
        case 'penalty':
            description = `PENALTY${event.speler ? ' - ' + event.speler : ''}`;
            if (event.assist) description += ` <span class="event-assist">(assist: ${event.assist})</span>`;
            break;
        case 'own-goal':
            description = `Eigen doelpunt${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'yellow':
            description = `Gele kaart${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'yellow2red':
            description = `2e Gele kaart (Rood)${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'red':
            description = `Rode kaart${event.speler ? ' - ' + event.speler : ''}`; break;
        case 'substitution':
            description = `Wissel${event.spelerUit && event.spelerIn ? ': ' + event.spelerUit + ' → ' + event.spelerIn : ''}`; break;
        case 'rust':
            description = (event.half >= 3) ? 'Rust verlengingen' : 'Rust'; break;
        case 'einde-regulier':
            description = 'Einde reguliere tijd — Verlengingen'; break;
        case 'einde':
            description = 'Einde wedstrijd'; break;
        default:
            description = event.type;
    }

    item.innerHTML = `
        <span class="timeline-minute">${event.minuut || 0}'</span>
        <span class="timeline-icon">${eventIcon(event.type, event.half)}</span>
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
                { name: 'Roel Wouters', goals: 11 },
                { name: 'Dries Moermans', goals: 6 },
                { name: 'Ruben Staal', goals: 6 }
            ],
            topAssists: [
                { name: 'Dries Moermans', assists: 10 },
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

async function loadAvailability(matchId, matchData = {}) {
    console.log('Loading availability for match:', matchId);
    const contentDiv = document.getElementById('availabilityContent');
    
    if (!contentDiv) return;
    
    // Als gebruiker NIET ingelogd is: toon helemaal niks
    if (!currentUser) {
        contentDiv.innerHTML = '';
        return;
    }
    
    try {
        const userQuery = query(collection(db, 'users'), where('uid', '==', currentUser.uid));
        const userSnapshot = await getDocs(userQuery);
        
        if (userSnapshot.empty) {
            contentDiv.innerHTML = '';
            return;
        }
        
        const userData = userSnapshot.docs[0].data();
        const userCategorie = userData.categorie;
        
        console.log('User categorie:', userCategorie, 'Team type:', TEAM_TYPE);
        
        const isOwnTeam = userCategorie === TEAM_TYPE;
        const isBestuurslid = userCategorie === 'bestuurslid';
        const isDesignated = matchData.aangeduidePersonen &&
            matchData.aangeduidePersonen.includes(currentUser.uid);
        const canManageList = isBestuurslid || isDesignated;
        
        if (isOwnTeam) {
            // Eigen ploeg: toon knoppen EN lijst
            // Als ook aangeduid persoon: toon ook extra speler knop
            const extraPlayerBtn = canManageList ? `
                <button class="availability-btn extra-player" id="addExtraPlayerBtn" style="margin-top:0.5rem; background: var(--primary-green, #2d6a2d); color: #fff; font-size: 0.85rem;">
                    <span>+</span>
                    <span>Speler van andere ploeg toevoegen</span>
                </button>
            ` : '';

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
                    ${extraPlayerBtn}
                </div>
                <div class="availability-list" id="availabilityList">
                    <div class="loading">Laden...</div>
                </div>
            `;
            
            document.getElementById('availableBtn').addEventListener('click', () => setAvailability(matchId, true, userData.naam));
            document.getElementById('unavailableBtn').addEventListener('click', () => setAvailability(matchId, false, userData.naam));
            if (canManageList) {
                document.getElementById('addExtraPlayerBtn').addEventListener('click', () => showAddExtraPlayerModal(matchId));
            }
            
            setupAvailabilityListener(matchId, true, canManageList);
            
        } else if (canManageList) {
            // Aangeduid persoon of bestuurslid van andere ploeg: lijst zien + extra speler toevoegen
            contentDiv.innerHTML = `
                <div class="availability-info">
                    <p style="color: var(--text-gray); font-size: 0.9rem; margin-bottom: 0.75rem; font-style: italic;">
                        Je kunt de beschikbaarheid bekijken en spelers van andere ploegen toevoegen.
                    </p>
                    <button class="availability-btn extra-player" id="addExtraPlayerBtn" style="background: var(--primary-green, #2d6a2d); color: #fff; font-size: 0.85rem; margin-bottom: 0.5rem;">
                        <span>+</span>
                        <span>Speler van andere ploeg toevoegen</span>
                    </button>
                </div>
                <div class="availability-list" id="availabilityList">
                    <div class="loading">Laden...</div>
                </div>
            `;
            
            document.getElementById('addExtraPlayerBtn').addEventListener('click', () => showAddExtraPlayerModal(matchId));
            setupAvailabilityListener(matchId, true, true);
            
        } else {
            // Andere ploeg: alleen telling zien, geen lijst
            contentDiv.innerHTML = `<div class="availability-summary-only"></div>`;
            setupAvailabilityListener(matchId, false, false);
        }
        
    } catch (error) {
        console.error('Error loading availability:', error);
        contentDiv.innerHTML = '';
    }
}

// -----------------------------------------------
// EXTRA PLAYER MODAL (from other teams)
// -----------------------------------------------

// Cache of all users (loaded once per page session)
let allUsersCache = null;

async function getAllUsers() {
    if (allUsersCache) return allUsersCache;
    const snapshot = await getDocs(collection(db, 'users'));
    allUsersCache = [];
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Exclude users from the current team page — they already have availability buttons
        if (data.categorie !== TEAM_TYPE) {
            allUsersCache.push({
                uid: data.uid || docSnap.id,
                naam: data.naam || data.displayName || '',
                categorie: data.categorie || ''
            });
        }
    });
    allUsersCache.sort((a, b) => a.naam.localeCompare(b.naam));
    return allUsersCache;
}

function showAddExtraPlayerModal(matchId) {
    const existing = document.getElementById('extraPlayerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'extraPlayerModal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Speler van andere ploeg toevoegen</h3>
            <div class="modal-body">
                <p style="font-size:0.9rem; color: var(--text-gray); margin-bottom:0.75rem;">
                    Zoek een bestaand VVS-lid van een andere ploeg en voeg hem toe aan de
                    beschikbaarheidslijst voor deze wedstrijd.
                </p>
                <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:0.4rem;">Zoek speler</label>
                <input
                    type="text"
                    id="extraPlayerSearch"
                    placeholder="Typ naam…"
                    autocomplete="off"
                    style="width:100%; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box;"
                >
                <div
                    id="extraPlayerResults"
                    style="margin-top:0.4rem; max-height:200px; overflow-y:auto; border:1px solid #e0e0e0; border-radius:8px; display:none;"
                ></div>
                <div id="extraPlayerSelected" style="display:none; margin-top:0.75rem; padding:0.5rem 0.75rem; background:#f0f7f0; border:1px solid #b2d8b2; border-radius:8px; font-size:0.9rem;"></div>
            </div>
            <div class="modal-actions">
                <button class="modal-btn cancel" id="extraPlayerCancel">Annuleren</button>
                <button class="modal-btn confirm" id="extraPlayerConfirm" disabled style="opacity:0.5;">Toevoegen</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    let selectedUser = null;

    const searchInput    = modal.querySelector('#extraPlayerSearch');
    const resultsBox     = modal.querySelector('#extraPlayerResults');
    const selectedBox    = modal.querySelector('#extraPlayerSelected');
    const confirmBtn     = modal.querySelector('#extraPlayerConfirm');
    const cancelBtn      = modal.querySelector('#extraPlayerCancel');

    const teamLabels = {
        veteranen: 'Veteranen',
        zaterdag:  'Zaterdag',
        zondag:    'Zondag',
        bestuurslid: 'Bestuurslid'
    };

    function selectUser(user) {
        selectedUser = user;
        searchInput.value = user.naam;
        resultsBox.style.display = 'none';
        selectedBox.style.display = 'block';
        selectedBox.textContent = `✓  ${user.naam}  (${teamLabels[user.categorie] || user.categorie})`;
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
    }

    function clearSelection() {
        selectedUser = null;
        selectedBox.style.display = 'none';
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
    }

    searchInput.addEventListener('input', async () => {
        const q = searchInput.value.trim().toLowerCase();
        clearSelection();

        if (q.length < 1) {
            resultsBox.style.display = 'none';
            return;
        }

        const users = await getAllUsers();
        const matches = users.filter(u => u.naam.toLowerCase().includes(q));

        if (matches.length === 0) {
            resultsBox.innerHTML = `
                <div style="padding:0.6rem 0.75rem; color:#888; font-size:0.9rem;">Geen spelers gevonden</div>
                <div
                    class="extra-player-result extra-player-manual-opt"
                    style="padding:0.55rem 0.75rem; cursor:pointer; font-size:0.88rem; color:#555; border-top:1px solid #eee; font-style:italic;"
                >
                    ✏️ Handmatig toevoegen…
                </div>
            `;
            resultsBox.style.display = 'block';
            resultsBox.querySelector('.extra-player-manual-opt')?.addEventListener('click', () => {
                showManualFallback(modal, matchId, q);
            });
            return;
        }

        resultsBox.innerHTML = matches.map((u, i) => `
            <div
                class="extra-player-result"
                data-idx="${i}"
                style="padding:0.55rem 0.75rem; cursor:pointer; font-size:0.92rem; border-bottom:1px solid #f0f0f0; display:flex; justify-content:space-between; align-items:center;"
            >
                <span>${u.naam}</span>
                <span style="font-size:0.78rem; color:#888;">${teamLabels[u.categorie] || u.categorie}</span>
            </div>
        `).join('');
        // Add "manual" option at bottom
        resultsBox.innerHTML += `
            <div
                class="extra-player-result extra-player-manual-opt"
                style="padding:0.55rem 0.75rem; cursor:pointer; font-size:0.88rem; color:#555; border-top:2px solid #eee; font-style:italic;"
            >
                ✏️ Niet gevonden? Handmatig toevoegen…
            </div>
        `;
        resultsBox.style.display = 'block';

        resultsBox.querySelectorAll('.extra-player-result:not(.extra-player-manual-opt)').forEach((row, i) => {
            row.addEventListener('mouseenter', () => row.style.background = '#f5f5f5');
            row.addEventListener('mouseleave', () => row.style.background = '');
            row.addEventListener('click', () => selectUser(matches[i]));
        });
        resultsBox.querySelector('.extra-player-manual-opt')?.addEventListener('click', () => {
            showManualFallback(modal, matchId, searchInput.value.trim());
        });
    });

    cancelBtn.addEventListener('click', () => modal.remove());

    confirmBtn.addEventListener('click', async () => {
        if (!selectedUser) return;

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Bezig…';

        try {
            // Use the player's uid as the document key so duplicates are prevented
            const availabilityRef = doc(db, 'matches', matchId, 'availability', selectedUser.uid);
            await setDoc(availabilityRef, {
                available: true,
                displayName: selectedUser.naam,
                isExternalPlayer: true,
                fromTeam: selectedUser.categorie,  // which team they normally play for
                addedBy: currentUser.uid,
                timestamp: new Date().toISOString()
            });
            console.log('Extra player added:', selectedUser.naam, '(', selectedUser.categorie, ')');
            modal.remove();
        } catch (error) {
            console.error('Error adding extra player:', error);
            alert('Fout bij toevoegen speler: ' + error.message);
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Toevoegen';
        }
    });

    // Focus search on open
    setTimeout(() => searchInput.focus(), 50);
}

/**
 * Shows a simple manual-entry fallback inside the same modal overlay.
 * Called when the user clicks "Handmatig toevoegen" in the search results.
 */
function showManualFallback(modal, matchId, prefillName = '') {
    const body = modal.querySelector('.modal-body');
    body.innerHTML = `
        <p style="font-size:0.9rem; color:var(--text-gray); margin-bottom:0.75rem;">
            Vul de naam en ploeg in van de speler die niet in het systeem staat.
        </p>
        <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:0.3rem;">Naam</label>
        <input
            type="text"
            id="manualFallbackName"
            value="${prefillName}"
            placeholder="Voornaam Achternaam"
            style="width:100%; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box; margin-bottom:0.75rem;"
        >
        <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:0.3rem;">Ploeg</label>
        <select id="manualFallbackTeam" style="width:100%; padding:0.5rem 0.75rem; border:1px solid #ccc; border-radius:8px; font-size:1rem; box-sizing:border-box;">
            <option value="veteranen">Veteranen</option>
            <option value="zaterdag">Zaterdag</option>
            <option value="zondag">Zondag</option>
            <option value="overig">Overig / Extern</option>
        </select>
    `;

    const confirmBtn = modal.querySelector('#extraPlayerConfirm');
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    confirmBtn.textContent = 'Toevoegen';

    // Override confirm handler for manual mode
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);

    newConfirm.addEventListener('click', async () => {
        const name = document.getElementById('manualFallbackName')?.value.trim();
        const team = document.getElementById('manualFallbackTeam')?.value;
        if (!name) { alert('Voer een naam in.'); return; }

        newConfirm.disabled = true;
        newConfirm.textContent = 'Bezig…';
        try {
            const safeKey = 'manual_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
            await setDoc(doc(db, 'matches', matchId, 'availability', safeKey), {
                available:        true,
                displayName:      name,
                isExternalPlayer: true,
                fromTeam:         team,
                addedBy:          currentUser.uid,
                timestamp:        new Date().toISOString()
            });
            modal.remove();
        } catch (err) {
            console.error('Error adding manual player:', err);
            alert('Fout bij toevoegen: ' + err.message);
            newConfirm.disabled = false;
            newConfirm.textContent = 'Toevoegen';
        }
    });
}

function setupAvailabilityListener(matchId, showList = true, canManage = false) {
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
        
        let availableCount = 0;
        let unavailableCount = 0;
        const availabilities = [];
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            availabilities.push({ userId: docSnap.id, ...data });
            if (data.available) availableCount++;
            else unavailableCount++;
        });
        
        if (availableCountEl) availableCountEl.textContent = availableCount;
        if (unavailableCountEl) unavailableCountEl.textContent = unavailableCount;
        
        if (currentUser && availableBtn && unavailableBtn) {
            availableBtn.classList.remove('selected');
            unavailableBtn.classList.remove('selected');
            const userAvailability = availabilities.find(a => a.userId === currentUser.uid);
            if (userAvailability) {
                if (userAvailability.available) availableBtn.classList.add('selected');
                else unavailableBtn.classList.add('selected');
            }
        }
        
        if (showList && availabilityList) {
            if (availabilities.length === 0) {
                availabilityList.innerHTML = `
                    <div class="availability-list-empty">
                        Nog niemand heeft beschikbaarheid aangegeven
                    </div>
                `;
            } else {
                availabilities.sort((a, b) => {
                    if (a.available !== b.available) return b.available - a.available;
                    return (a.displayName || '').localeCompare(b.displayName || '');
                });
                
                availabilityList.innerHTML = availabilities.map(av => {
                    const isExternal = av.isExternalPlayer === true;
                    const teamLabels = { veteranen: 'Veteranen', zaterdag: 'Zaterdag', zondag: 'Zondag', bestuurslid: 'Bestuurslid' };
                    const sideLabel = isExternal
                        ? ` <span style="font-size:0.75rem; color:#888; font-style:italic;">(${teamLabels[av.fromTeam] || av.fromTeam || 'extern'})</span>`
                        : '';
                    const removeBtn = (canManage && isExternal)
                        ? `<button class="remove-extra-player-btn" data-uid="${av.userId}" data-matchid="${matchId}" style="margin-left:auto; background:none; border:none; cursor:pointer; color:#4A4A4A; font-size:1rem;" title="Verwijder">✕</button>`
                        : '';
                    return `
                        <div class="availability-player" style="display:flex; align-items:center; gap:0.5rem;">
                            <span class="player-name">${av.displayName}${sideLabel}</span>
                            <span class="availability-status ${av.available ? 'available' : 'unavailable'}" style="margin-left:${removeBtn ? '0' : 'auto'};">
                                <span>${av.available ? '✓' : '✗'}</span>
                                <span>${av.available ? 'Aanwezig' : 'Afwezig'}</span>
                            </span>
                            ${removeBtn}
                        </div>
                    `;
                }).join('');

                // Wire up remove buttons
                availabilityList.querySelectorAll('.remove-extra-player-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const uid = btn.dataset.uid;
                        const mid = btn.dataset.matchid;
                        if (!confirm('Speler verwijderen uit de lijst?')) return;
                        try {
                            await deleteDoc(doc(db, 'matches', mid, 'availability', uid));
                        } catch (err) {
                            console.error('Error removing extra player:', err);
                            alert('Fout bij verwijderen: ' + err.message);
                        }
                    });
                });
            }
        }
    }, (error) => {
        console.error('Error loading availability:', error);
        const availabilityList = document.getElementById('availabilityList');
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
