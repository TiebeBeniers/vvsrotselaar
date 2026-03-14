// ===============================================
// HOMEPAGE FUNCTIONALITY - WITH LIVE OVERLAY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, doc, updateDoc, addDoc, setDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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
            return d < fullTime ? `${d}'` : `${fullTime}+${d - fullTime}'`;
        }
        if (phase === 3) {
            if (match.status === 'rust' && !match.etStartedAt) return `${fullTime}'`;
            const d = fullTime + mins;
            const etEnd = fullTime + ET_HALF;
            return d < etEnd ? `${d}'` : `${etEnd}+${d - etEnd}'`;
        }
        // phase 4
        if (match.status === 'rust' && !match.etResumeStartedAt) return `${fullTime + ET_HALF}'`;
        const d    = fullTime + ET_HALF + mins;
        const end  = fullTime + ET_HALF * 2;
        return d < end ? `${d}'` : `${end}+${d - end}'`;

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
    const container = document.getElementById('startMatchContainer');
    if (!container) return;

    if (!currentUser || !currentUserData) {
        container.style.display = 'none';
        return;
    }

    const isBestuurslid = currentUserData.categorie === 'bestuurslid';
    const now = new Date();
    // Start of today at 00:00 local time
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    try {
        const snap = await getDocs(query(
            collection(db, 'matches'),
            where('status', '==', 'planned')
        ));

        let todayMatch = null;

        snap.forEach(docSnap => {
            const d           = docSnap.data();
            const matchDateTime = new Date(`${d.datum}T${d.uur}`);
            const isDesignated  = d.aangeduidePersonen?.includes(currentUser.uid);

            // Match must be today (from 00:00) and user must be allowed
            if ((isBestuurslid || isDesignated) && matchDateTime >= todayStart) {
                // Pick the soonest match today
                if (!todayMatch || matchDateTime < new Date(`${todayMatch.datum}T${todayMatch.uur}`)) {
                    todayMatch = { id: docSnap.id, ...d };
                }
            }
        });

        if (!todayMatch) {
            container.style.display = 'none';
            return;
        }

        const matchDateTime = new Date(`${todayMatch.datum}T${todayMatch.uur}`);
        const thirtyBefore  = new Date(matchDateTime.getTime() - 30 * 60 * 1000);
        const thirtyAfter   = new Date(matchDateTime.getTime() + 30 * 60 * 1000);
        const inStartWindow = now >= thirtyBefore && now <= thirtyAfter;
        const lineupSaved   = !!todayMatch.lineupDraftConfirmed;

        container.style.display = 'flex';

        // ── Build the right button set ────────────────────────────────────
        if (!lineupSaved) {
            // State 1: lineup not yet confirmed — show only "Line-up selecteren"
            container.innerHTML = `
                <button class="start-match-btn" id="lineupSelectBtn">
                    Line-up selecteren
                </button>`;
            document.getElementById('lineupSelectBtn').onclick = () => openLineupForDraft(todayMatch);

        } else if (inStartWindow) {
            // State 3: lineup confirmed + within 30-min window — show start + wijzig
            container.innerHTML = `
                <div class="start-match-btn-group">
                    <button class="start-match-btn" id="startMatchBtn">
                        ▶ Start wedstrijd
                    </button>
                    <button class="wijzig-lineup-btn" id="wijzigLineupBtn">
                        <img src="assets/edit.png" class="icon" alt=""> Wijzig lineup
                    </button>
                </div>`;
            document.getElementById('startMatchBtn').onclick   = () => confirmStartMatch(todayMatch);
            document.getElementById('wijzigLineupBtn').onclick = () => openLineupForDraft(todayMatch, true);

        } else {
            // State 2: lineup confirmed but not yet in start window — show only wijzig
            container.innerHTML = `
                <div class="start-match-btn-group">
                    <div class="lineup-saved-badge">✓ Opstelling opgeslagen</div>
                    <button class="wijzig-lineup-btn" id="wijzigLineupBtn">
                        <img src="assets/edit.png" class="icon" alt=""> Wijzig lineup
                    </button>
                </div>`;
            document.getElementById('wijzigLineupBtn').onclick = () => openLineupForDraft(todayMatch, true);
        }

    } catch (err) {
        console.error('Error checking for start match:', err);
    }
}

// ── Confirmation before actually starting ────────────────────────────────────

function confirmStartMatch(matchData) {
    let confirmModal = document.getElementById('startMatchConfirmModal');
    if (!confirmModal) {
        confirmModal = document.createElement('div');
        confirmModal.id        = 'startMatchConfirmModal';
        confirmModal.className = 'modal';
        confirmModal.innerHTML = `
            <div class="modal-content">
                <h3>Wedstrijd starten?</h3>
                <p style="margin-bottom:1.5rem;color:var(--text-gray);">
                    De wedstrijd wordt live gezet en je wordt doorgestuurd naar de live pagina.
                    Dit kan niet ongedaan worden gemaakt.
                </p>
                <div class="modal-actions">
                    <button class="modal-btn cancel" id="startConfirmCancel">Annuleren</button>
                    <button class="modal-btn confirm" id="startConfirmOk">▶ Ja, start!</button>
                </div>
            </div>`;
        document.body.appendChild(confirmModal);
        document.getElementById('startConfirmCancel').addEventListener('click', () => {
            confirmModal.classList.remove('active');
        });
        confirmModal.addEventListener('click', e => {
            if (e.target === confirmModal) confirmModal.classList.remove('active');
        });
    }

    // Wire confirm button fresh each time
    const okBtn = document.getElementById('startConfirmOk');
    okBtn.onclick = async () => {
        okBtn.disabled    = true;
        okBtn.textContent = 'Bezig...';
        confirmModal.classList.remove('active');
        await finalizeMatchStart(matchData);
    };

    confirmModal.classList.add('active');
}

// ── Lineup modal ──────────────────────────────────────────────────────────────

let lineupMatchData        = null;
let lineupAvailablePlayers = [];

/**
 * Open the lineup modal in "draft" mode.
 * @param {Object}  matchData  - the match object
 * @param {boolean} isEdit     - true when editing an already-saved draft
 */
async function openLineupForDraft(matchData, isEdit = false) {
    lineupMatchData = matchData;

    try {
        const snap = await getDocs(collection(db, 'matches', matchData.id, 'availability'));
        lineupAvailablePlayers = [];
        snap.forEach(d => {
            if (d.data().available) {
                lineupAvailablePlayers.push({ uid: d.id, name: d.data().displayName || d.id });
            }
        });
        lineupAvailablePlayers.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        alert('Fout bij laden spelers: ' + e.message);
        return;
    }

    // Pre-load saved starters when editing
    const savedStarters = new Set();
    if (isEdit && matchData.lineupDraft) {
        Object.entries(matchData.lineupDraft).forEach(([uid, info]) => {
            if (info.status === 'starter') savedStarters.add(uid);
        });
    }

    openLineupModal(savedStarters);
}

function openLineupModal(initialStarters = new Set()) {
    let modal = document.getElementById('lineupModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id        = 'lineupModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content lineup-modal-content">
                <h3>Opstelling Aanduiden</h3>
                <p class="lineup-subtitle">Selecteer de basisspelers. De overige aanwezige spelers worden bankzitters.</p>
                <div class="lineup-columns">
                    <div class="lineup-col">
                        <h4>Aanwezig (<span id="lineupAvailCount">0</span>)</h4>
                        <div id="lineupAvailList" class="lineup-list"></div>
                    </div>
                    <div class="lineup-col">
                        <h4>Basis (<span id="lineupStartCount">0</span>/11)</h4>
                        <div id="lineupStartList" class="lineup-list starter-list"></div>
                    </div>
                </div>
                <div class="lineup-hint" id="lineupHint">Selecteer 7 tot 11 basisspelers.</div>
                <div class="lineup-actions">
                    <button class="modal-btn cancel" id="lineupCancelBtn">Annuleren</button>
                    <button class="modal-btn confirm" id="lineupConfirmBtn" disabled>Bevestigen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('lineupCancelBtn').addEventListener('click', () => {
            modal.classList.remove('active');
        });
    }

    renderLineupModal(modal, initialStarters);
    modal.classList.add('active');
}

function renderLineupModal(modal, initialStarters = new Set()) {
    const availList  = modal.querySelector('#lineupAvailList');
    const startList  = modal.querySelector('#lineupStartList');
    const confirmBtn = modal.querySelector('#lineupConfirmBtn');
    const availCount = modal.querySelector('#lineupAvailCount');
    const startCount = modal.querySelector('#lineupStartCount');
    const hintEl     = modal.querySelector('#lineupHint');

    const MIN = 7, MAX = 11;
    const starters = new Set(initialStarters);

    function refresh() {
        availList.innerHTML = '';
        startList.innerHTML = '';
        const count = starters.size;
        availCount.textContent = lineupAvailablePlayers.length - count;
        startCount.textContent = count;

        const valid = count >= MIN && count <= MAX;
        confirmBtn.disabled = !valid;

        if (hintEl) {
            if (count < MIN)       hintEl.textContent = `Selecteer nog ${MIN - count} speler(s) minimum.`;
            else if (count > MAX)  hintEl.textContent = `Maximum ${MAX} basisspelers.`;
            else                   hintEl.textContent = `✓ Klaar (${count} spelers geselecteerd).`;
            hintEl.style.color = valid ? 'var(--success, #28a745)' : 'var(--text-gray, #666)';
        }

        lineupAvailablePlayers.forEach(p => {
            const isStarter = starters.has(p.uid);
            const atMax     = count >= MAX;
            const btn = document.createElement('button');
            btn.className   = `lineup-player-btn${isStarter ? ' selected' : ''}`;
            btn.textContent = p.name;
            if (!isStarter && atMax) btn.disabled = true;
            btn.addEventListener('click', () => {
                if (isStarter) starters.delete(p.uid);
                else if (starters.size < MAX) starters.add(p.uid);
                refresh();
            });
            if (isStarter) startList.appendChild(btn);
            else availList.appendChild(btn);
        });
    }

    refresh();

    confirmBtn.textContent = 'Bevestigen';
    confirmBtn.onclick = async () => {
        if (starters.size < MIN || starters.size > MAX) return;
        confirmBtn.disabled    = true;
        confirmBtn.textContent = 'Opslaan...';

        try {
            // Build draft lineup object
            const lineupDraft = {};
            lineupAvailablePlayers.forEach(p => {
                lineupDraft[p.uid] = {
                    name:   p.name,
                    status: starters.has(p.uid) ? 'starter' : 'bench'
                };
            });

            await updateDoc(doc(db, 'matches', lineupMatchData.id), {
                lineupDraft,
                lineupDraftConfirmed: true
            });

            // Update local object so wijzig-lineup opens the new draft
            lineupMatchData.lineupDraft          = lineupDraft;
            lineupMatchData.lineupDraftConfirmed = true;

            modal.classList.remove('active');
            // Refresh the start-match button area
            await checkForStartMatch();

        } catch (e) {
            alert('Fout bij opslaan opstelling: ' + e.message);
            confirmBtn.disabled    = false;
            confirmBtn.textContent = 'Bevestigen';
        }
    };
}

async function finalizeMatchStart(matchData) {
    try {
        const matchRef = doc(db, 'matches', matchData.id);

        // Use the saved draft lineup
        const lineup = matchData.lineupDraft || {};
        if (Object.keys(lineup).length === 0) {
            alert('Geen opgeslagen opstelling gevonden. Sla eerst een lineup op.');
            return;
        }

        const starterUids = new Set(
            Object.entries(lineup)
                .filter(([, info]) => info.status === 'starter')
                .map(([uid]) => uid)
        );

        const scheduledTime = new Date(`${matchData.datum}T${matchData.uur}`);
        const now           = new Date();
        const lateMinutes   = (now.getTime() - scheduledTime.getTime()) / 60_000;
        const startedAt     = lateMinutes > START_LATE_THRESHOLD_MINUTES
            ? Timestamp.fromDate(scheduledTime)
            : Timestamp.fromDate(now);

        await updateDoc(matchRef, {
            status:            'live',
            startedAt,
            scoreThuis:        0,
            scoreUit:          0,
            phase:             1,
            halfTimeReached:   false,
            extraTimeStarted:  false,
            etHalfTimeReached: false,
            pausedAt:          null,
            resumeStartedAt:   null,
            etStartedAt:       null,
            etResumeStartedAt: null,
            lineupConfirmed:   true,
            lineup,
        });

        // Write playerMinutes for starters
        const minutePromises = [];
        for (const [uid, info] of Object.entries(lineup)) {
            if (info.status === 'starter') {
                minutePromises.push(
                    setDoc(doc(db, 'matches', matchData.id, 'playerMinutes', uid), {
                        uid, name: info.name, minuteOn: 0, minuteOff: null
                    })
                );
            }
        }
        await Promise.all(minutePromises);

        await addDoc(collection(db, 'events'), {
            matchId:   matchData.id,
            minuut:    0,
            half:      1,
            type:      'aftrap',
            ploeg:     'center',
            speler:    '',
            timestamp: serverTimestamp()
        });

        window.location.href = 'live.html';

    } catch (e) {
        console.error('Error finalizing match start:', e);
        alert('Fout bij starten wedstrijd: ' + e.message);
        // Re-enable start button if something went wrong
        await checkForStartMatch();
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
