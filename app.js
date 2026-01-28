// ===============================================
// HOMEPAGE FUNCTIONALITY
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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

    // Close menu when clicking a link
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
    slides.forEach(slide => slide.classList.remove('active'));
    dots.forEach(dot => dot.classList.remove('active'));
    
    if (index >= slides.length) currentSlide = 0;
    if (index < 0) currentSlide = slides.length - 1;
    
    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');
}

function nextSlide() {
    currentSlide++;
    showSlide(currentSlide);
}

function startCarousel() {
    carouselInterval = setInterval(nextSlide, 12000); // 12 seconds
}

function stopCarousel() {
    clearInterval(carouselInterval);
}

// Manual dot navigation
dots.forEach((dot, index) => {
    dot.addEventListener('click', () => {
        currentSlide = index;
        showSlide(currentSlide);
        stopCarousel();
        startCarousel();
    });
});

// Start carousel
startCarousel();

// ===============================================
// AUTH STATE MANAGEMENT
// ===============================================

let currentUser = null;
let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');
    
    if (user) {
        currentUser = user;
        
        // Get user data from Firestore
        const userDoc = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
        if (!userDoc.empty) {
            currentUserData = userDoc.docs[0].data();
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
    
    // Check for upcoming matches
    checkUpcomingMatches();
});

// ===============================================
// MATCH MANAGEMENT
// ===============================================

let liveMatchListener = null;

async function checkUpcomingMatches() {
    const heroSection = document.getElementById('heroSection');
    const carouselContainer = document.getElementById('carouselContainer');
    const startMatchContainer = document.getElementById('startMatchContainer');
    const liveMatchCard = document.getElementById('liveMatchCard');
    const startMatchBtn = document.getElementById('startMatchBtn');
    const viewLiveBtn = document.getElementById('viewLiveBtn');

    // Query for live matches
    const liveMatchesQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    // Listen to live matches
    if (liveMatchListener) {
        liveMatchListener(); // Unsubscribe previous listener
    }

    liveMatchListener = onSnapshot(liveMatchesQuery, (snapshot) => {
        if (!snapshot.empty) {
            // There's a live match
            const matchData = snapshot.docs[0].data();
            const matchId = snapshot.docs[0].id;
            
            // Hide carousel
            carouselContainer.style.display = 'none';
            startMatchContainer.style.display = 'none';
            
            // Show live match card
            liveMatchCard.style.display = 'flex';
            
            // Update match info
            document.getElementById('liveHomeTeam').textContent = matchData.thuisploeg;
            document.getElementById('liveAwayTeam').textContent = matchData.uitploeg;
            document.getElementById('liveHomeScore').textContent = matchData.scoreThuis || 0;
            document.getElementById('liveAwayScore').textContent = matchData.scoreUit || 0;
            document.getElementById('liveMinute').textContent = `${matchData.currentMinute || 0}'`;
            
            viewLiveBtn.onclick = () => {
                window.location.href = 'live.html';
            };
            
            return;
        }
        
        // No live match, check for upcoming matches
        checkForStartMatch();
    });
}

async function checkForStartMatch() {
    if (!currentUser || !currentUserData) {
        // Show carousel for non-logged-in users
        document.getElementById('carouselContainer').style.display = 'block';
        document.getElementById('startMatchContainer').style.display = 'none';
        document.getElementById('liveMatchCard').style.display = 'none';
        return;
    }

    const now = new Date();
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60000);

    // Query matches that start within 30 minutes and are planned
    const upcomingMatchesQuery = query(
        collection(db, 'matches'),
        where('status', '==', 'planned'),
        where('aangeduidePersoon', '==', currentUser.uid)
    );

    const upcomingSnapshot = await getDocs(upcomingMatchesQuery);
    
    let showStartButton = false;
    let matchToStart = null;

    upcomingSnapshot.forEach((doc) => {
        const matchData = doc.data();
        const matchDateTime = new Date(`${matchData.datum}T${matchData.uur}`);
        
        // Check if match is within 30 minutes
        if (matchDateTime <= thirtyMinutesFromNow && matchDateTime > now) {
            showStartButton = true;
            matchToStart = { id: doc.id, ...matchData };
        }
    });

    const carouselContainer = document.getElementById('carouselContainer');
    const startMatchContainer = document.getElementById('startMatchContainer');
    const startMatchBtn = document.getElementById('startMatchBtn');

    if (showStartButton && matchToStart) {
        // Show start button
        carouselContainer.style.display = 'none';
        startMatchContainer.style.display = 'flex';
        
        startMatchBtn.onclick = () => startMatch(matchToStart);
    } else {
        // Show carousel
        carouselContainer.style.display = 'block';
        startMatchContainer.style.display = 'none';
    }
}

async function startMatch(matchData) {
    try {
        const matchRef = doc(db, 'matches', matchData.id);
        
        await updateDoc(matchRef, {
            status: 'live',
            startTimestamp: serverTimestamp(),
            currentMinute: 0,
            scoreThuis: 0,
            scoreUit: 0
        });

        // Start timer in background
        startMatchTimer(matchData.id);

        // Redirect to live page
        window.location.href = 'live.html';
    } catch (error) {
        console.error('Error starting match:', error);
        alert('Er is een fout opgetreden bij het starten van de wedstrijd.');
    }
}

function startMatchTimer(matchId) {
    // Timer runs on client side but syncs with server
    // In production, consider using Cloud Functions for server-side timer
    const timerInterval = setInterval(async () => {
        try {
            const matchRef = doc(db, 'matches', matchId);
            const matchDoc = await getDocs(query(collection(db, 'matches'), where('__name__', '==', matchId)));
            
            if (!matchDoc.empty) {
                const matchData = matchDoc.docs[0].data();
                
                if (matchData.status === 'finished') {
                    clearInterval(timerInterval);
                    return;
                }
                
                if (matchData.status === 'live') {
                    const newMinute = (matchData.currentMinute || 0) + 1;
                    await updateDoc(matchRef, {
                        currentMinute: newMinute
                    });
                }
            }
        } catch (error) {
            console.error('Timer error:', error);
        }
    }, 60000); // Every minute
}

// ===============================================
// TEAM BUTTONS
// ===============================================

const teamButtons = document.querySelectorAll('.team-button');
teamButtons.forEach(button => {
    button.addEventListener('click', () => {
        // Future: Navigate to team page
        alert('Team pagina komt binnenkort!');
    });
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (liveMatchListener) {
        liveMatchListener();
    }
    stopCarousel();
});
