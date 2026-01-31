// ===============================================
// HOMEPAGE FUNCTIONALITY - COMPLETE VERSION
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('App.js loaded');

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
// CAROUSEL
// ===============================================

let currentSlide = 0;
const slides = document.querySelectorAll('.carousel-slide');
const dots = document.querySelectorAll('.dot');
let carouselInterval;

function showSlide(index) {
    if (slides.length === 0) return;
    
    slides.forEach(slide => slide.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));
    
    if (index >= slides.length) currentSlide = 0;
    if (index < 0) currentSlide = slides.length - 1;
    
    slides[currentSlide].classList.add('active');
    if (dots[currentSlide]) dots[currentSlide].classList.add('active');
}

function nextSlide() {
    currentSlide++;
    showSlide(currentSlide);
}

function startCarousel() {
    carouselInterval = setInterval(nextSlide, 12000);
}

function stopCarousel() {
    if (carouselInterval) {
        clearInterval(carouselInterval);
    }
}

if (dots.length > 0) {
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            currentSlide = index;
            showSlide(currentSlide);
            stopCarousel();
            startCarousel();
        });
    });
}

if (slides.length > 0) {
    startCarousel();
}

// ===============================================
// AUTH STATE MANAGEMENT
// ===============================================

let currentUser = null;
let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    
    if (user) {
        currentUser = user;
        console.log('User logged in:', user.uid);
        
        try {
            const userDoc = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!userDoc.empty) {
                currentUserData = userDoc.docs[0].data();
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
    
    checkUpcomingMatches();
});

// ===============================================
// MATCH MANAGEMENT
// ===============================================

let liveMatchListener = null;
let liveMatchDisplayInterval = null;

async function checkUpcomingMatches() {
    const heroSection = document.getElementById('heroSection');
    const carouselContainer = document.getElementById('carouselContainer');
    const startMatchContainer = document.getElementById('startMatchContainer');
    const liveMatchCard = document.getElementById('liveMatchCard');
    
    if (!carouselContainer || !liveMatchCard) {
        console.error('Required elements not found');
        return;
    }
    
    console.log('Checking for upcoming matches...');

    // Query for live matches
    const liveMatchesQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    // Clean up previous listener
    if (liveMatchListener) {
        liveMatchListener();
    }

    liveMatchListener = onSnapshot(liveMatchesQuery, (snapshot) => {
        if (!snapshot.empty) {
            // There's a live match
            const matchData = snapshot.docs[0].data();
            const matchId = snapshot.docs[0].id;
            
            console.log('Live match found:', matchData.thuisploeg, 'vs', matchData.uitploeg);
            
            // Show carousel with overlay
            carouselContainer.style.display = 'block';
            carouselContainer.classList.add('with-overlay');
            
            if (startMatchContainer) startMatchContainer.style.display = 'none';
            liveMatchCard.style.display = 'flex';
            
            // Update and start display
            updateLiveMatchCard(matchData);
            startLiveMatchDisplay(matchData);
            
            return;
        }
        
        // No live match
        console.log('No live match, checking for start match');
        carouselContainer.classList.remove('with-overlay');
        liveMatchCard.style.display = 'none';
        stopLiveMatchDisplay();
        
        checkForStartMatch();
    });
}

function updateLiveMatchCard(matchData) {
    const liveMatchCard = document.getElementById('liveMatchCard');
    if (!liveMatchCard) return;
    
    const timeDisplay = calculateDisplayTime(matchData);
    
    const beschrijvingHtml = matchData.beschrijving 
        ? `<div class="match-description-display">${matchData.beschrijving}</div>`
        : '';
    
    liveMatchCard.innerHTML = `
        <div class="match-info">
            <div class="team home-team">
                <h2>${matchData.thuisploeg}</h2>
            </div>
            <div class="match-score">
                <div class="score-display">
                    <span>${matchData.scoreThuis || 0}</span>
                    <span class="separator">-</span>
                    <span>${matchData.scoreUit || 0}</span>
                </div>
                <div class="match-minute" id="liveMatchTime">${timeDisplay}</div>
            </div>
            <div class="team away-team">
                <h2>${matchData.uitploeg}</h2>
            </div>
        </div>
        ${beschrijvingHtml}
        <button class="view-live-btn" onclick="window.location.href='live.html'">VOLG LIVE</button>
    `;
}

function calculateDisplayTime(match) {
    if (!match.startedAt) return "0'";
    
    try {
        const now = new Date();
        const start = match.startedAt.toDate();
        let elapsedMs = now - start;
        
        // Subtract paused duration
        if (match.pausedDuration) {
            elapsedMs -= (match.pausedDuration * 1000);
        }
        
        // If currently paused, don't count current pause time
        if (match.status === 'rust' && match.pausedAt) {
            const currentPauseDuration = now - match.pausedAt.toDate();
            elapsedMs -= currentPauseDuration;
        }
        
        const minutes = Math.floor(elapsedMs / 60000);
        return `${Math.max(0, minutes)}'`;
    } catch (error) {
        console.error('Error calculating time:', error);
        return "0'";
    }
}

function startLiveMatchDisplay(matchData) {
    stopLiveMatchDisplay();
    
    // Update every second
    liveMatchDisplayInterval = setInterval(() => {
        const timeDisplay = calculateDisplayTime(matchData);
        const timeElement = document.getElementById('liveMatchTime');
        if (timeElement) {
            timeElement.textContent = timeDisplay;
        }
    }, 1000);
}

function stopLiveMatchDisplay() {
    if (liveMatchDisplayInterval) {
        clearInterval(liveMatchDisplayInterval);
        liveMatchDisplayInterval = null;
    }
}

async function checkForStartMatch() {
    const startMatchContainer = document.getElementById('startMatchContainer');
    const carouselContainer = document.getElementById('carouselContainer');
    
    if (!startMatchContainer || !carouselContainer) return;
    
    if (!currentUser || !currentUserData) {
        carouselContainer.style.display = 'block';
        startMatchContainer.style.display = 'none';
        return;
    }

    console.log('Checking if user can start a match...');
    
    const now = new Date();
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60000);

    const upcomingMatchesQuery = query(
        collection(db, 'matches'),
        where('status', '==', 'planned')
    );

    try {
        const upcomingSnapshot = await getDocs(upcomingMatchesQuery);
        
        let showStartButton = false;
        let matchToStart = null;

        upcomingSnapshot.forEach((docSnap) => {
            const matchData = docSnap.data();
            const matchDateTime = new Date(`${matchData.datum}T${matchData.uur}`);
            
            // Check if user has access (bestuurslid OR in aangeduidePersonen)
            const isBestuurslid = currentUserData.categorie === 'bestuurslid';
            const isDesignated = matchData.aangeduidePersonen && 
                                matchData.aangeduidePersonen.includes(currentUser.uid);
            
            const hasAccess = isBestuurslid || isDesignated;
            
            if (hasAccess && matchDateTime <= thirtyMinutesFromNow && matchDateTime >= now) {
                console.log('User can start match:', matchData.thuisploeg, 'vs', matchData.uitploeg);
                showStartButton = true;
                matchToStart = { id: docSnap.id, ...matchData };
            }
        });

        if (showStartButton && matchToStart) {
            carouselContainer.style.display = 'none';
            startMatchContainer.style.display = 'flex';
            
            const startMatchBtn = document.getElementById('startMatchBtn');
            if (startMatchBtn) {
                startMatchBtn.onclick = () => startMatch(matchToStart);
            }
        } else {
            carouselContainer.style.display = 'block';
            startMatchContainer.style.display = 'none';
        }
    } catch (error) {
        console.error('Error checking for start match:', error);
    }
}

async function startMatch(matchData) {
    console.log('Starting match:', matchData.thuisploeg, 'vs', matchData.uitploeg);
    
    try {
        const matchRef = doc(db, 'matches', matchData.id);
        
        await updateDoc(matchRef, {
            status: 'live',
            startedAt: serverTimestamp(),
            scoreThuis: 0,
            scoreUit: 0,
            pausedDuration: 0
        });

        // Add kickoff event
        await addDoc(collection(db, 'events'), {
            matchId: matchData.id,
            minuut: 0,
            type: 'aftrap',
            ploeg: 'center',
            spelerIn: '',
            timestamp: serverTimestamp()
        });

        console.log('Match started successfully, redirecting to live page...');
        window.location.href = 'live.html';
    } catch (error) {
        console.error('Error starting match:', error);
        alert('Fout bij starten wedstrijd: ' + error.message);
    }
}

// ===============================================
// TEAM BUTTONS
// ===============================================

const teamButtons = document.querySelectorAll('.team-button');
if (teamButtons.length > 0) {
    teamButtons.forEach(button => {
        button.addEventListener('click', () => {
            console.log('Team button clicked - feature coming soon');
        });
    });
}

// ===============================================
// CLEANUP
// ===============================================

window.addEventListener('beforeunload', () => {
    console.log('Page unloading, cleaning up...');
    if (liveMatchListener) {
        liveMatchListener();
    }
    stopCarousel();
    stopLiveMatchDisplay();
});

console.log('App.js initialization complete');
