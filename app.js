// ===============================================
// HOMEPAGE FUNCTIONALITY - WITH LIVE OVERLAY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, addDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('App.js loaded (with live overlay)');

// ── Config ────────────────────────────────────────────────────────────────────
// How many minutes after the scheduled kick-off does a planned match stay visible
// as "bezig" even without live tracking.
const MATCH_VISIBLE_WINDOW_MINUTES = 150;

// Within how many minutes of kick-off does the designated person get
// "real" start time (serverTimestamp). After this threshold the scheduled
// time is used as startedAt so the timer reflects the actual match time.
const START_LATE_THRESHOLD_MINUTES = 10;

// ── Hamburger ─────────────────────────────────────────────────────────────────

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

// ── Carousel ──────────────────────────────────────────────────────────────────

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

function nextSlide() { currentSlide++; showSlide(currentSlide); }
function startCarousel() { carouselInterval = setInterval(nextSlide, 12000); }
function stopCarousel() { if (carouselInterval) clearInterval(carouselInterval); }

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

    const carouselContainer = document.querySelector('.carousel-container');
    if (carouselContainer) {
        let touchStartX = 0, touchEndX = 0, touchStartY = 0, touchEndY = 0;

        carouselContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        carouselContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            handleSwipe();
        }, { passive: true });

        function handleSwipe() {
            const dx = touchEndX - touchStartX;
            const dy = Math.abs(touchEndY - touchStartY);
            if (dy >= 100) return;
            if (dx > 50) {
                currentSlide--;
                if (currentSlide < 0) currentSlide = slides.length - 1;
                showSlide(currentSlide); stopCarousel(); startCarousel();
            } else if (dx < -50) {
                currentSlide++;
                if (currentSlide >= slides.length) currentSlide = 0;
                showSlide(currentSlide); stopCarousel(); startCarousel();
            }
        }
    }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let currentUser = null;
let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    const loginLink = document.getElementById('loginLink');

    if (user) {
        currentUser = user;
        try {
            const userDoc = await getDocs(query(collection(db, 'users'), where('uid', '==', user.uid)));
            if (!userDoc.empty) {
                currentUserData = userDoc.docs[0].data();
                if (loginLink) loginLink.textContent = 'PROFIEL';
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    } else {
        currentUser = null;
        currentUserData = null;
        if (loginLink) loginLink.textContent = 'LOGIN';
    }

    checkForLiveMatches();
});

// ── Live / Bezig overlay ──────────────────────────────────────────────────────

let liveMatchListener   = null;
let plannedMatchPoller  = null;   // interval that re-checks planned matches every 30s
let liveOverlayUpdateInterval = null;
let currentLiveMatch = null;

// The planned match currently shown as "bezig" (no live tracking)
let currentBezigMatch = null;

function checkForLiveMatches() {
    const liveOverlay = document.getElementById('liveMatchOverlay');
    if (!liveOverlay) { console.error('Live overlay element not found'); return; }

    if (liveMatchListener) liveMatchListener();

    const liveMatchesQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    liveMatchListener = onSnapshot(liveMatchesQuery, (snapshot) => {
        if (!snapshot.empty) {
            // ── Echte live wedstrijd ──────────────────────────────────────
            const matchData = snapshot.docs[0].data();
            const matchId   = snapshot.docs[0].id;
            currentLiveMatch  = { id: matchId, ...matchData };
            currentBezigMatch = null;

            stopPlannedMatchPoller();
            liveOverlay.style.display = 'flex';

            const startMatchContainer = document.getElementById('startMatchContainer');
            if (startMatchContainer) startMatchContainer.style.display = 'none';

            showLiveOverlay(currentLiveMatch);
            startLiveOverlayUpdate();

        } else {
            // ── Geen live wedstrijd ───────────────────────────────────────
            currentLiveMatch = null;
            stopLiveOverlayUpdate();

            // Check for a planned match that should be shown as "bezig"
            checkBezigMatch();

            // Poll every 30 s so the overlay appears/disappears at the right moment
            startPlannedMatchPoller();

            // Start-button for designated person
            if (currentUser && currentUserData) checkForStartMatch();
        }
    });
}

// ── "Bezig" check (planned match within its window) ──────────────────────────

async function checkBezigMatch() {
    const liveOverlay = document.getElementById('liveMatchOverlay');
    if (!liveOverlay) return;

    const now = new Date();

    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'planned')
        ));

        let bezigMatch = null;

        snap.forEach(docSnap => {
            const d = docSnap.data();
            const matchTime = new Date(`${d.datum}T${d.uur}`);
            const windowEnd = new Date(matchTime.getTime() + MATCH_VISIBLE_WINDOW_MINUTES * 60 * 1000);

            if (now >= matchTime && now <= windowEnd) {
                bezigMatch = { id: docSnap.id, ...d };
            }
        });

        if (bezigMatch) {
            currentBezigMatch = bezigMatch;
            liveOverlay.style.display = 'flex';
            showBezigOverlay(bezigMatch);
        } else {
            currentBezigMatch = null;
            liveOverlay.style.display = 'none';
        }

    } catch (err) {
        console.error('Error checking bezig match:', err);
    }
}

function startPlannedMatchPoller() {
    stopPlannedMatchPoller();
    plannedMatchPoller = setInterval(() => {
        // Only re-check when there's no real live match
        if (!currentLiveMatch) checkBezigMatch();
    }, 30_000);
}

function stopPlannedMatchPoller() {
    if (plannedMatchPoller) { clearInterval(plannedMatchPoller); plannedMatchPoller = null; }
}

// ── Overlay renderers ─────────────────────────────────────────────────────────

/**
 * Show the overlay for a genuinely live/rust match — full details.
 */
function showLiveOverlay(match) {
    const liveBadge      = document.getElementById('liveBadge');
    const overlayHomeTeam = document.getElementById('overlayHomeTeam');
    const overlayAwayTeam = document.getElementById('overlayAwayTeam');
    const overlayHomeScore = document.getElementById('overlayHomeScore');
    const overlayAwayScore = document.getElementById('overlayAwayScore');
    const overlayTime    = document.getElementById('overlayTime');
    const overlayScoreSep = document.getElementById('overlayScoreSeparator'); // optional

    if (!liveBadge || !overlayHomeTeam) return;

    const watchBtn = document.getElementById('overlayWatchBtn');

    // Badge
    if (match.status === 'rust') {
        liveBadge.textContent = 'RUST';
        liveBadge.className   = 'live-badge rust';
    } else if (match.extraTimeStarted) {
        liveBadge.textContent = 'VERL.';
        liveBadge.className   = 'live-badge live';
    } else {
        liveBadge.textContent = 'LIVE';
        liveBadge.className   = 'live-badge live';
    }

    overlayHomeTeam.textContent = match.thuisploeg;
    overlayAwayTeam.textContent = match.uitploeg;

    // Score — always show real numbers for live matches
    if (overlayHomeScore) overlayHomeScore.textContent = match.scoreThuis ?? 0;
    if (overlayAwayScore) overlayAwayScore.textContent = match.scoreUit   ?? 0;
    if (overlayScoreSep)  overlayScoreSep.textContent  = '-';

    if (overlayTime) overlayTime.textContent = calculateDisplayTime(match);

    // Knop tonen — dit is een echte live wedstrijd
    if (watchBtn) watchBtn.style.display = '';
}

/**
 * Show the overlay for a planned match that has started but isn't tracked live.
 * No score, no timer — just the teams and a neutral badge.
 */
function showBezigOverlay(match) {
    const liveBadge       = document.getElementById('liveBadge');
    const overlayHomeTeam = document.getElementById('overlayHomeTeam');
    const overlayAwayTeam = document.getElementById('overlayAwayTeam');
    const overlayHomeScore = document.getElementById('overlayHomeScore');
    const overlayAwayScore = document.getElementById('overlayAwayScore');
    const overlayTime     = document.getElementById('overlayTime');
    const overlayScoreSep = document.getElementById('overlayScoreSeparator');

    if (!liveBadge || !overlayHomeTeam) return;

    liveBadge.textContent = 'BEZIG';
    liveBadge.className   = 'live-badge bezig';

    overlayHomeTeam.textContent = match.thuisploeg;
    overlayAwayTeam.textContent = match.uitploeg;

    // Score unknown — show dashes
    if (overlayHomeScore) overlayHomeScore.textContent = '–';
    if (overlayAwayScore) overlayAwayScore.textContent = '–';
    if (overlayScoreSep)  overlayScoreSep.textContent  = '-';

    // No timer for bezig matches
    if (overlayTime) overlayTime.textContent = '';

    // Knop verbergen — geen live data beschikbaar
    const watchBtn = document.getElementById('overlayWatchBtn');
    if (watchBtn) watchBtn.style.display = 'none';
}

// ── Live timer (phase-aware, mirrors live.js logic) ───────────────────────────

function calculateDisplayTime(match) {
    if (!match.startedAt) return "0'";

    try {
        const phase    = match.phase || 1;
        const halfTime = match.team === 'veteranen' ? 35 : 45;
        const fullTime = halfTime * 2;
        const ET_HALF  = 15;

        const frozen = match.status === 'rust' && match.pausedAt;
        const now    = frozen ? match.pausedAt.toMillis() : Date.now();

        let startMs;
        if (phase === 1) {
            startMs = match.startedAt.toMillis();
        } else if (phase === 2) {
            startMs = match.resumeStartedAt?.toMillis();
        } else if (phase === 3) {
            startMs = match.etStartedAt?.toMillis();
        } else {
            startMs = match.etResumeStartedAt?.toMillis();
        }
        if (!startMs) return "0'";

        const elapsedSeconds = Math.max(0, Math.floor((now - startMs) / 1000));
        const mins = Math.floor(elapsedSeconds / 60);

        if (phase === 1) {
            return mins < halfTime ? `${mins}'` : `${halfTime}+${mins - halfTime}'`;
        }
        if (phase === 2) {
            if (match.status === 'rust' && !match.resumeStartedAt) return `${halfTime}'`;
            const d = halfTime + mins;
            return d <= fullTime ? `${d}'` : `${fullTime}+${d - fullTime}'`;
        }
        if (phase === 3) {
            if (match.status === 'rust' && !match.etStartedAt) return `${fullTime}'`;
            const d = fullTime + mins;
            const etEnd = fullTime + ET_HALF;
            return d <= etEnd ? `${d}'` : `${etEnd}+${d - etEnd}'`;
        }
        // phase 4
        if (match.status === 'rust' && !match.etResumeStartedAt) return `${fullTime + ET_HALF}'`;
        const d    = fullTime + ET_HALF + mins;
        const end  = fullTime + ET_HALF * 2;
        return d <= end ? `${d}'` : `${end}+${d - end}'`;

    } catch (err) {
        console.error('Error calculating display time:', err);
        return "0'";
    }
}

function startLiveOverlayUpdate() {
    stopLiveOverlayUpdate();
    liveOverlayUpdateInterval = setInterval(() => {
        if (currentLiveMatch) showLiveOverlay(currentLiveMatch);
    }, 1000);
}

function stopLiveOverlayUpdate() {
    if (liveOverlayUpdateInterval) {
        clearInterval(liveOverlayUpdateInterval);
        liveOverlayUpdateInterval = null;
    }
}

// ── Start match (for designated persons) ─────────────────────────────────────

async function checkForStartMatch() {
    const startMatchContainer = document.getElementById('startMatchContainer');
    if (!startMatchContainer) return;

    if (!currentUser || !currentUserData) {
        startMatchContainer.style.display = 'none';
        return;
    }

    const now = new Date();

    try {
        const upcomingSnapshot = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'planned')
        ));

        let showStartButton = false;
        let matchToStart    = null;

        upcomingSnapshot.forEach((docSnap) => {
            const matchData    = docSnap.data();
            const matchDateTime = new Date(`${matchData.datum}T${matchData.uur}`);

            // Window: 30 min before → 30 min after scheduled kick-off
            const thirtyBefore = new Date(matchDateTime.getTime() - 30 * 60 * 1000);
            const thirtyAfter  = new Date(matchDateTime.getTime() + 30 * 60 * 1000);

            const isBestuurslid = currentUserData.categorie === 'bestuurslid';
            const isDesignated  = matchData.aangeduidePersonen?.includes(currentUser.uid);

            if ((isBestuurslid || isDesignated) && now >= thirtyBefore && now <= thirtyAfter) {
                showStartButton = true;
                matchToStart    = { id: docSnap.id, ...matchData };
            }
        });

        if (showStartButton && matchToStart) {
            startMatchContainer.style.display = 'flex';
            const startMatchBtn = document.getElementById('startMatchBtn');
            if (startMatchBtn) {
                // Rebind to avoid duplicate handlers
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
        const matchRef      = doc(db, 'matches', matchData.id);
        const scheduledTime = new Date(`${matchData.datum}T${matchData.uur}`);
        const now           = new Date();
        const lateMinutes   = (now.getTime() - scheduledTime.getTime()) / 60_000;

        // If the person starts > START_LATE_THRESHOLD_MINUTES after kick-off,
        // use the SCHEDULED time as startedAt so the timer is correct.
        // Otherwise use the real click time (serverTimestamp).
        let startedAt;
        if (lateMinutes > START_LATE_THRESHOLD_MINUTES) {
            // Back-date to scheduled kick-off
            startedAt = Timestamp.fromDate(scheduledTime);
            console.log(`Late start (${Math.round(lateMinutes)} min) — using scheduled time as startedAt`);
        } else {
            // On-time: use server timestamp (set below via updateDoc)
            startedAt = null; // signal to use serverTimestamp
            console.log(`On-time start — using serverTimestamp`);
        }

        const updatePayload = {
            status:          'live',
            scoreThuis:      0,
            scoreUit:        0,
            phase:           1,
            halfTimeReached: false,
            extraTimeStarted: false,
            etHalfTimeReached: false,
            pausedAt:        null,
            resumeStartedAt: null,
            etStartedAt:     null,
            etResumeStartedAt: null,
        };

        if (startedAt) {
            // Late start: use back-dated Timestamp
            updatePayload.startedAt = startedAt;
        } else {
            // On-time: let Firestore set the server time
            updatePayload.startedAt = serverTimestamp();
        }

        await updateDoc(matchRef, updatePayload);

        // Kickoff event — minute 0 even for late starts (the timer already accounts for offset)
        await addDoc(collection(db, 'events'), {
            matchId:   matchData.id,
            minuut:    0,
            half:      1,
            type:      'aftrap',
            ploeg:     'center',
            speler:    '',
            timestamp: serverTimestamp()
        });

        console.log('Match started, redirecting to live page...');
        window.location.href = 'live.html';

    } catch (error) {
        console.error('Error starting match:', error);
        alert('Fout bij starten wedstrijd: ' + error.message);
    }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
    if (liveMatchListener) liveMatchListener();
    stopPlannedMatchPoller();
    stopCarousel();
    stopLiveOverlayUpdate();
});

console.log('App.js initialization complete');
