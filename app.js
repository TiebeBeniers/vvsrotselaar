// ===============================================
// HOMEPAGE FUNCTIONALITY - WITH LIVE OVERLAY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('App.js loaded (with live overlay)');

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
    
    // Check for live matches (for everyone)
    checkForLiveMatches();
});

// ===============================================
// LIVE MATCH OVERLAY
// ===============================================

let liveMatchListener = null;
let liveOverlayUpdateInterval = null;
let currentLiveMatch = null;

function checkForLiveMatches() {
    console.log('Checking for live matches...');
    
    const liveOverlay = document.getElementById('liveMatchOverlay');
    const startMatchContainer = document.getElementById('startMatchContainer');
    
    if (!liveOverlay) {
        console.error('Live overlay element not found');
        return;
    }

    // Query for live matches
    const liveMatchesQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    // Clean up previous listener
    if (liveMatchListener) {
        liveMatchListener();
    }

    // Real-time listener for live matches
    liveMatchListener = onSnapshot(liveMatchesQuery, (snapshot) => {
        if (!snapshot.empty) {
            // Live match found!
            const matchData = snapshot.docs[0].data();
            const matchId = snapshot.docs[0].id;
            currentLiveMatch = { id: matchId, ...matchData };
            
            console.log('Live match found:', matchData.thuisploeg, 'vs', matchData.uitploeg, 'Status:', matchData.status);
            
            // Show overlay
            liveOverlay.style.display = 'flex';
            
            // Hide start match button if visible
            if (startMatchContainer) {
                startMatchContainer.style.display = 'none';
            }
            
            // Update overlay content
            updateLiveOverlay(currentLiveMatch);
            startLiveOverlayUpdate();
            
        } else {
            // No live match
            console.log('No live match found');
            liveOverlay.style.display = 'none';
            stopLiveOverlayUpdate();
            currentLiveMatch = null;
            
            // Check if user can start a match (only if logged in)
            if (currentUser && currentUserData) {
                checkForStartMatch();
            }
        }
    });
}

function updateLiveOverlay(match) {
    const liveBadge = document.getElementById('liveBadge');
    const overlayHomeTeam = document.getElementById('overlayHomeTeam');
    const overlayAwayTeam = document.getElementById('overlayAwayTeam');
    const overlayHomeScore = document.getElementById('overlayHomeScore');
    const overlayAwayScore = document.getElementById('overlayAwayScore');
    const overlayTime = document.getElementById('overlayTime');
    
    if (!liveBadge || !overlayHomeTeam || !overlayAwayTeam) return;
    
    // Update badge
    if (match.status === 'rust') {
        liveBadge.textContent = 'RUST';
        liveBadge.className = 'live-badge rust';
    } else {
        liveBadge.textContent = 'LIVE';
        liveBadge.className = 'live-badge live';
    }
    
    // Update teams
    overlayHomeTeam.textContent = match.thuisploeg;
    overlayAwayTeam.textContent = match.uitploeg;
    
    // Update scores
    overlayHomeScore.textContent = match.scoreThuis || 0;
    overlayAwayScore.textContent = match.scoreUit || 0;
    
    // Update time
    const timeDisplay = calculateDisplayTime(match);
    overlayTime.textContent = timeDisplay;
}

function calculateDisplayTime(match) {
    if (!match.startedAt) return "0'";
    
    try {
        const halfTimeReached = match.halfTimeReached || false;
        const halfTime = match.team === 'veteranen' ? 35 : 45;
        
        let elapsedSeconds;
        
        if (!halfTimeReached) {
            // First half - count from match start
            const startTime = match.startedAt.toMillis();
            const currentTime = match.status === 'rust' && match.pausedAt 
                ? match.pausedAt.toMillis() 
                : Date.now();
            
            elapsedSeconds = Math.floor((currentTime - startTime) / 1000);
        } else {
            // Second half - count from resume start
            if (match.resumeStartedAt) {
                const resumeStart = match.resumeStartedAt.toMillis();
                const currentTime = Date.now();
                
                elapsedSeconds = Math.floor((currentTime - resumeStart) / 1000);
            } else {
                // Still in rust
                elapsedSeconds = halfTime * 60;
            }
        }
        
        const totalMinutes = Math.floor(elapsedSeconds / 60);
        
        if (!halfTimeReached) {
            // First half
            if (totalMinutes < halfTime) {
                return `${totalMinutes}'`;
            } else {
                const extraTime = totalMinutes - halfTime;
                return `${halfTime}+${extraTime}'`;
            }
        } else {
            // Second half
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

function startLiveOverlayUpdate() {
    stopLiveOverlayUpdate();
    
    // Update every second
    liveOverlayUpdateInterval = setInterval(() => {
        if (currentLiveMatch) {
            updateLiveOverlay(currentLiveMatch);
        }
    }, 1000);
}

function stopLiveOverlayUpdate() {
    if (liveOverlayUpdateInterval) {
        clearInterval(liveOverlayUpdateInterval);
        liveOverlayUpdateInterval = null;
    }
}

// ===============================================
// START MATCH (for designated persons)
// ===============================================

async function checkForStartMatch() {
    const startMatchContainer = document.getElementById('startMatchContainer');
    
    if (!startMatchContainer) return;
    
    if (!currentUser || !currentUserData) {
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
            
            // Check if user has access
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
            startMatchContainer.style.display = 'flex';
            
            const startMatchBtn = document.getElementById('startMatchBtn');
            if (startMatchBtn) {
                startMatchBtn.onclick = () => startMatch(matchToStart);
            }
        } else {
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
            pausedDuration: 0,
            halfTimeReached: false  // Track if half-time button was used
        });

        // Add kickoff event
        await addDoc(collection(db, 'events'), {
            matchId: matchData.id,
            minuut: 0,
            half: 1,  // Kickoff is always in first half
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
// CLEANUP
// ===============================================

window.addEventListener('beforeunload', () => {
    console.log('Page unloading, cleaning up...');
    if (liveMatchListener) {
        liveMatchListener();
    }
    stopCarousel();
    stopLiveOverlayUpdate();
});

console.log('App.js initialization complete');
