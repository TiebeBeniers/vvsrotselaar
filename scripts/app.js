// ===============================================
// HOMEPAGE FUNCTIONALITY - WITH LIVE OVERLAY
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, onSnapshot, getDocs, getDoc, doc, updateDoc, addDoc, setDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { isSupporter } from './vvs-user-helpers.js';
import { checkAndShowWrapped } from './vvs-wrapped.js';
import { applyLogoFromCache }  from './vvs-logo.js';
import { canManageMatch } from './match-management.js';

// ── Logo: laad snel vanuit cache, async Firestore-check via vvs-logo.js ───────
if (!applyLogoFromCache()) {
    // Eerste keer op deze sessie: vvs-logo.js doet de Firestore-check via zijn
    // eigen IIFE — niets extra nodig hier.
}

console.log('App.js loaded (with live overlay)');

// ── Config ────────────────────────────────────────────────────────────────────
// How many minutes after the scheduled kick-off does a planned match stay visible
// as "bezig" even without live tracking.
const MATCH_VISIBLE_WINDOW_MINUTES = 150;

// Within how many minutes of kick-off does the designated person get
// "real" start time (serverTimestamp). After this threshold the scheduled
// time is used as startedAt so the timer reflects the actual match time.
const START_LATE_THRESHOLD_MINUTES = 10;

// ── Carousel ──────────────────────────────────────────────────────────────────

let currentSlide = 0;
const slides = document.querySelectorAll('.carousel-slide');
const dots = document.querySelectorAll('.dot');
let carouselInterval;
let slideRequestId = 0;
const slideLoads = new WeakMap();

function showSlide(index) {
    if (slides.length === 0) return;
    const targetIndex = (index + slides.length) % slides.length;
    const slide = slides[targetIndex];
    const requestId = ++slideRequestId;

    let load = slideLoads.get(slide);
    if (!load) {
        load = slide.style.backgroundImage
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    slide.style.backgroundImage = `url("${image.src}")`;
                    resolve();
                };
                image.onerror = () => reject(new Error(`Carrouselfoto laden mislukt: ${image.src}`));
                image.src = slide.dataset.background;
            });
        slideLoads.set(slide, load);
    }

    load.then(() => {
        if (requestId !== slideRequestId) return;
        currentSlide = targetIndex;
        slides.forEach(item => item.classList.remove('active'));
        dots.forEach(dot => dot.classList.remove('active'));
        slide.classList.add('active');
        if (dots[targetIndex]) dots[targetIndex].classList.add('active');
    }).catch(error => {
        slideLoads.delete(slide);
        if (requestId === slideRequestId) console.error(error);
    });
}

function nextSlide() { showSlide(currentSlide + 1); }
function startCarousel() { carouselInterval = setInterval(nextSlide, 12000); }
function stopCarousel() { if (carouselInterval) clearInterval(carouselInterval); }

if (dots.length > 0) {
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            showSlide(index);
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
                showSlide(currentSlide - 1); stopCarousel(); startCarousel();
            } else if (dx < -50) {
                showSlide(currentSlide + 1); stopCarousel(); startCarousel();
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
            const _uSnap = await getDoc(doc(db, 'users', user.uid));
            const _rData = _uSnap.exists() ? _uSnap.data() : null;
            if (_rData) {
                currentUserData = _rData;
                if (loginLink) loginLink.textContent = 'PROFIEL';
                // VVS Wrapped: toon als admin het heeft ingeschakeld
                checkAndShowWrapped(user, currentUserData);
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
let currentLiveMatches = [];
let singleLiveOverlayMarkup = null;

// The planned match currently shown as "bezig" (no live tracking)
let currentBezigMatch = null;

function checkForLiveMatches() {
    const liveOverlay = document.getElementById('liveMatchOverlay');
    if (!liveOverlay) { console.error('Live overlay element not found'); return; }
    if (singleLiveOverlayMarkup === null) singleLiveOverlayMarkup = liveOverlay.innerHTML;

    if (liveMatchListener) liveMatchListener();
    const liveMatchesQuery = query(
        collection(db, 'matches'),
        where('status', 'in', ['live', 'rust'])
    );

    liveMatchListener = onSnapshot(liveMatchesQuery, (snapshot) => {
        currentLiveMatches = snapshot.docs
            .map(matchDoc => ({ id: matchDoc.id, ...matchDoc.data() }))
        currentLiveMatch = currentLiveMatches[0] || null;

        if (currentLiveMatch) {
            currentBezigMatch = null;
            stopPlannedMatchPoller();
            liveOverlay.style.display = 'flex';
            renderLiveOverlayMatches();
            startLiveOverlayUpdate();
        } else {
            // ── Geen live wedstrijd ───────────────────────────────────────
            stopLiveOverlayUpdate();
            checkBezigMatch();
            startPlannedMatchPoller();
        }
        if (currentUser && currentUserData) checkForStartMatch();
    }, error => {
        console.error('Live wedstrijden laden mislukt:', error);
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

        const bezigMatches = [];

        snap.forEach(docSnap => {
            const d = docSnap.data();
            const matchTime = new Date(`${d.datum}T${d.uur}`);
            const windowEnd = new Date(matchTime.getTime() + MATCH_VISIBLE_WINDOW_MINUTES * 60 * 1000);

            if (now >= matchTime && now <= windowEnd) {
                bezigMatches.push({ id: docSnap.id, ...d });
            }
        });

        if (bezigMatches.length > 1) {
            currentBezigMatch = null;
            liveOverlay.style.display = 'flex';
            renderMultiLiveOverlay(bezigMatches, true);
        } else if (bezigMatches.length === 1) {
            const bezigMatch = bezigMatches[0];
            currentBezigMatch = bezigMatch;
            liveOverlay.style.display = 'flex';
            restoreSingleLiveOverlay();
            showBezigOverlay(bezigMatch);
        } else {
            currentBezigMatch = null;
            liveOverlay.style.display = 'none';
            restoreSingleLiveOverlay();
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
    restoreSingleLiveOverlay();

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
    if (watchBtn) watchBtn.onclick = () => {
        window.location.href = `live.html?match=${encodeURIComponent(match.id)}`;
    };
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
    restoreSingleLiveOverlay();

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

function restoreSingleLiveOverlay() {
    const overlay = document.getElementById('liveMatchOverlay');
    if (overlay?.classList.contains('multi')) {
        overlay.innerHTML = singleLiveOverlayMarkup;
        overlay.classList.remove('multi');
        document.getElementById('heroSection')?.classList.remove('multi-live-active');
    }
}

function renderLiveOverlayMatches() {
    if (currentLiveMatches.length > 1) {
        renderMultiLiveOverlay(currentLiveMatches);
    } else if (currentLiveMatch) {
        showLiveOverlay(currentLiveMatch);
    }
}

function renderMultiLiveOverlay(matches, bezig = false) {
    const overlay = document.getElementById('liveMatchOverlay');
    if (!overlay) return;
    overlay.classList.add('multi');
    document.getElementById('heroSection')?.classList.add('multi-live-active');
    overlay.replaceChildren();

    const header = document.createElement('div');
    header.className = 'multi-live-heading';
    header.textContent = bezig ? 'Wedstrijden bezig' : 'Wedstrijden live';
    const grid = document.createElement('div');
    grid.className = 'multi-live-grid';

    matches.forEach(match => {
        const card = document.createElement('a');
        card.className = 'multi-live-card';
        card.dataset.matchId = match.id;
        card.href = LOCAL_MULTI_LIVE_PREVIEW
            ? '#local-preview'
            : `live.html?match=${encodeURIComponent(match.id)}`;
        if (LOCAL_MULTI_LIVE_PREVIEW) card.addEventListener('click', event => event.preventDefault());
        const badge = document.createElement('span');
        badge.className = `multi-live-badge${match.status === 'rust' ? ' rust' : ''}`;
        badge.textContent = bezig ? 'BEZIG' : (match.status === 'rust' ? 'RUST' : match.extraTimeStarted ? 'VERL.' : 'LIVE');
        const teamLabel = document.createElement('span');
        teamLabel.className = 'multi-live-team';
        teamLabel.textContent = (match.team || 'VVS Rotselaar').toUpperCase();
        const teams = document.createElement('span');
        teams.className = 'multi-live-teams';
        teams.textContent = `${match.thuisploeg || 'Thuis'} – ${match.uitploeg || 'Uit'}`;
        const scoreTime = document.createElement('span');
        scoreTime.className = 'multi-live-scoretime';
        scoreTime.innerHTML = `<span class="multi-live-score"></span><span class="multi-live-time"></span>`;
        scoreTime.querySelector('.multi-live-score').textContent = bezig
            ? '— : —'
            : `${match.scoreThuis ?? 0} : ${match.scoreUit ?? 0}`;
        scoreTime.querySelector('.multi-live-time').textContent = bezig ? '' : calculateDisplayTime(match);
        const follow = document.createElement('span');
        follow.className = 'multi-live-follow';
        follow.textContent = 'VOLG WEDSTRIJD →';
        card.append(badge, teamLabel, teams, scoreTime, follow);
        grid.appendChild(card);
    });

    overlay.append(header, grid);
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
        if (currentLiveMatches.length > 1) {
            currentLiveMatches.forEach(match => {
                const card = [...document.querySelectorAll('.multi-live-card')]
                    .find(item => item.dataset.matchId === match.id);
                const time = card?.querySelector('.multi-live-time');
                if (time) time.textContent = calculateDisplayTime(match);
            });
        } else if (currentLiveMatch) showLiveOverlay(currentLiveMatch);
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
    const section = document.getElementById('matchManagementSection');
    if (!container || !section) return;

    if (!currentUser || !currentUserData) {
        container.style.display = 'none';
        section.hidden = true;
        return;
    }
    if (isSupporter(currentUserData)) {
        container.style.display = 'none';
        section.hidden = true;
        return;
    }

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    try {
    const snap = await getDocs(query(collection(db, 'matches'), where('status', '==', 'planned')));
    let matches = snap.docs.map(matchDoc => ({ id: matchDoc.id, ...matchDoc.data() }));

    const graceCutoff = new Date(now.getTime() - START_LATE_THRESHOLD_MINUTES * 60 * 1000);
    matches = matches.filter(match => {
        if (!canManageMatch(currentUser, currentUserData, match)) return false;
        const kickoff = new Date(`${match.datum}T${match.uur || '00:00'}`);
        return kickoff <= in24Hours && kickoff >= graceCutoff;
        }).sort((a, b) =>
            new Date(`${a.datum}T${a.uur || '00:00'}`) - new Date(`${b.datum}T${b.uur || '00:00'}`)
        );

        if (!matches.length) {
            container.style.display = 'none';
            section.hidden = true;
            return;
        }

        if (matches.length === 1 && currentLiveMatches.length === 0) {
            section.hidden = true;
            const match = matches[0];
            const kickoff = new Date(`${match.datum}T${match.uur || '00:00'}`);
            const inStartWindow = now >= new Date(kickoff.getTime() - 30 * 60 * 1000);
            container.style.display = 'flex';

            if (!match.lineupDraftConfirmed) {
                container.innerHTML = '<button class="start-match-btn" id="lineupSelectBtn">Line-up selecteren</button>';
                document.getElementById('lineupSelectBtn').onclick = () => openLineupForDraft(match);
            } else if (inStartWindow) {
                container.innerHTML = `
                    <div class="start-match-btn-group">
                        <button class="start-match-btn" id="startMatchBtn">▶ Start wedstrijd</button>
                        <button class="wijzig-lineup-btn" id="wijzigLineupBtn">
                            <img src="assets/edit.png" class="icon" alt=""> Wijzig lineup
                        </button>
                    </div>`;
                document.getElementById('startMatchBtn').onclick = () => confirmStartMatch(match);
                document.getElementById('wijzigLineupBtn').onclick = () => openLineupForDraft(match, true);
            } else {
                container.innerHTML = `
                    <div class="start-match-btn-group">
                        <div class="lineup-saved-badge">✓ Opstelling opgeslagen</div>
                        <button class="wijzig-lineup-btn" id="wijzigLineupBtn">
                            <img src="assets/edit.png" class="icon" alt=""> Wijzig lineup
                        </button>
                    </div>`;
                document.getElementById('wijzigLineupBtn').onclick = () => openLineupForDraft(match, true);
            }
            return;
        }

        container.style.display = 'none';
        section.hidden = false;
        section.innerHTML = `
            <div class="match-management-heading">
                <span>WEDSTRIJDEN BEHEREN</span>
                <p>Selecteer de juiste ploeg voor je opstelling of aftrap.</p>
            </div>
            <div class="match-management-grid"></div>`;
        const grid = section.querySelector('.match-management-grid');
        matches.forEach(match => {
            const card = document.createElement('article');
            card.className = 'match-management-card';
            const title = document.createElement('h3');
            title.textContent = `${match.thuisploeg} – ${match.uitploeg}`;
            const meta = document.createElement('p');
            meta.textContent = `${match.team || 'Wedstrijd'} · ${new Date(`${match.datum}T${match.uur || '00:00'}`).toLocaleString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
            card.append(title, meta);
            const actions = document.createElement('div');
            actions.className = 'match-management-actions';
            if (!match.lineupDraftConfirmed) {
                const lineupButton = document.createElement('button');
                lineupButton.className = 'start-match-btn';
                lineupButton.textContent = 'Line-up selecteren';
                lineupButton.onclick = () => openLineupForDraft(match);
                actions.appendChild(lineupButton);
            } else {
                const editButton = document.createElement('button');
                editButton.className = 'wijzig-lineup-btn';
                editButton.textContent = 'Wijzig lineup';
                editButton.onclick = () => openLineupForDraft(match, true);
                actions.appendChild(editButton);
                if (now >= new Date(new Date(`${match.datum}T${match.uur || '00:00'}`).getTime() - 30 * 60 * 1000)) {
                    const startButton = document.createElement('button');
                    startButton.className = 'start-match-btn';
                    startButton.textContent = '▶ Start wedstrijd';
                    startButton.onclick = () => confirmStartMatch(match);
                    actions.appendChild(startButton);
                }
            }
            card.appendChild(actions);
            grid.appendChild(card);
        });
    } catch (err) {
        console.error('Error checking for start match:', err);
        container.style.display = 'none';
        section.hidden = true;
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
let lineupRequestSequence  = 0;

/**
 * Open the lineup modal in "draft" mode.
 * @param {Object}  matchData  - the match object
 * @param {boolean} isEdit     - true when editing an already-saved draft
 */
async function openLineupForDraft(matchData, isEdit = false) {
    const requestId = ++lineupRequestSequence;

    try {
        const snap = await getDocs(collection(db, 'matches', matchData.id, 'availability'));
        const availablePlayers = [];
        snap.forEach(d => {
            if (d.data().available) {
                availablePlayers.push({ uid: d.id, name: d.data().displayName || d.id });
            }
        });
        availablePlayers.sort((a, b) => a.name.localeCompare(b.name));
        if (requestId !== lineupRequestSequence) return;
        lineupMatchData = matchData;
        lineupAvailablePlayers = availablePlayers;
    } catch (e) {
        if (requestId === lineupRequestSequence) showToast('Fout bij laden spelers: ' + e.message, 'error');
        return;
    }

    // Pre-load saved starters + subs when editing
    const savedStarters = new Set();
    const savedSubs     = new Set();
    if (isEdit && matchData.lineupDraft) {
        Object.entries(matchData.lineupDraft).forEach(([uid, info]) => {
            if (info.status === 'starter') savedStarters.add(uid);
            else if (info.status === 'bench') savedSubs.add(uid);
        });
    }

    openLineupModal(savedStarters, savedSubs);
}

function openLineupModal(initialStarters = new Set(), initialSubs = new Set()) {
    let modal = document.getElementById('lineupModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id        = 'lineupModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content lineup-modal-content">
                <h3>Opstelling Aanduiden</h3>
                <p class="lineup-subtitle">
                    Verdeel de aanwezige spelers over <strong>Basis</strong> (exact 11) en
                    <strong>Wisselspelers</strong> (max 5). Spelers die niet geselecteerd worden
                    komen niet in aanmerking tijdens de wedstrijd en krijgen geen statistieken.
                </p>

                <div class="lineup-columns lineup-columns-3">

                    <!-- Kolom 1: niet geselecteerd -->
                    <div class="lineup-col">
                        <div class="lineup-col-header lineup-col-header--avail">
                            <span class="lineup-col-icon">👥</span>
                            <h4>Aanwezig</h4>
                            <span class="lineup-col-badge" id="lineupAvailCount">0</span>
                        </div>
                        <div id="lineupAvailList" class="lineup-list"></div>
                        <p class="lineup-col-sub">Klik om te plaatsen</p>
                    </div>

                    <!-- Kolom 2: basisspelers -->
                    <div class="lineup-col">
                        <div class="lineup-col-header lineup-col-header--start">
                            <span class="lineup-col-icon">⚽</span>
                            <h4>Basis</h4>
                            <span class="lineup-col-badge" id="lineupStartCount">0</span>
                            <span class="lineup-col-max">/11</span>
                        </div>
                        <div id="lineupStartList" class="lineup-list starter-list"></div>
                        <p class="lineup-col-sub">Exact 11 spelers</p>
                    </div>

                    <!-- Kolom 3: wisselspelers -->
                    <div class="lineup-col">
                        <div class="lineup-col-header lineup-col-header--sub">
                            <span class="lineup-col-icon">🔄</span>
                            <h4>Wisselspelers</h4>
                            <span class="lineup-col-badge" id="lineupSubCount">0</span>
                            <span class="lineup-col-max">/5</span>
                        </div>
                        <div id="lineupSubList" class="lineup-list sub-list"></div>
                        <p class="lineup-col-sub">Max 5 wisselspelers</p>
                    </div>
                </div>

                <div class="lineup-hint" id="lineupHint">Selecteer 11 basisspelers.</div>
                <div class="lineup-actions">
                    <button class="modal-btn cancel" id="lineupCancelBtn">Annuleren</button>
                    <button class="modal-btn confirm" id="lineupConfirmBtn" disabled>Bevestigen</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('lineupCancelBtn').addEventListener('click', () => {
            modal.classList.remove('active');
        });
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }

    renderLineupModal(modal, initialStarters, initialSubs);
    modal.classList.add('active');
}

// Cycle: avail → starter → sub → avail
function getNextStatus(uid, starters, subs) {
    if (starters.has(uid)) return 'sub';
    if (subs.has(uid)) return 'avail';
    return 'starter';
}

function renderLineupModal(modal, initialStarters = new Set(), initialSubs = new Set()) {
    const availList  = modal.querySelector('#lineupAvailList');
    const startList  = modal.querySelector('#lineupStartList');
    const subList    = modal.querySelector('#lineupSubList');
    const confirmBtn = modal.querySelector('#lineupConfirmBtn');
    const availCount = modal.querySelector('#lineupAvailCount');
    const startCount = modal.querySelector('#lineupStartCount');
    const subCount   = modal.querySelector('#lineupSubCount');
    const hintEl     = modal.querySelector('#lineupHint');

    const MAX_START = 11;
    const MIN_START = 7;
    const MAX_SUBS  = 5;

    const starters = new Set(initialStarters);
    const subs     = new Set(initialSubs);

    function refresh() {
        availList.innerHTML = '';
        startList.innerHTML = '';
        subList.innerHTML   = '';

        const sc = starters.size;
        const bc = subs.size;
        const ac = lineupAvailablePlayers.length - sc - bc;

        if (availCount) availCount.textContent = ac;
        if (startCount) startCount.textContent = sc;
        if (subCount)   subCount.textContent   = bc;

        const startFull = sc >= MAX_START;
        const subFull   = bc >= MAX_SUBS;
        const valid     = sc === MAX_START;

        if (confirmBtn) confirmBtn.disabled = !valid;

        if (hintEl) {
            if (sc < MIN_START)
                hintEl.textContent = `Voeg nog ${MIN_START - sc} basisspeler(s) toe (minimum).`;
            else if (sc < MAX_START)
                hintEl.textContent = `Voeg nog ${MAX_START - sc} basisspeler(s) toe.`;
            else if (bc === 0)
                hintEl.textContent = `✓ Basis volledig. Voeg optioneel wisselspelers toe.`;
            else
                hintEl.textContent = `✓ Klaar — ${sc} basis, ${bc} wissel${bc !== 1 ? 's' : ''}.`;
            hintEl.style.color = valid ? 'var(--success, #28a745)' : 'var(--text-gray, #666)';
        }

        lineupAvailablePlayers.forEach(p => {
            const isStarter = starters.has(p.uid);
            const isSub     = subs.has(p.uid);
            const isAvail   = !isStarter && !isSub;

            const btn = document.createElement('button');
            btn.textContent = p.name;

            if (isStarter) {
                btn.className = 'lineup-player-btn lineup-player-btn--starter';
                btn.title     = 'Klik: verplaats naar wisselbank';
                startList.appendChild(btn);
            } else if (isSub) {
                btn.className = 'lineup-player-btn lineup-player-btn--sub';
                btn.title     = 'Klik: terugplaatsen naar beschikbaar';
                subList.appendChild(btn);
            } else {
                btn.className = 'lineup-player-btn';
                btn.title     = startFull
                    ? (subFull ? 'Basis en bank zijn vol' : 'Klik: voeg toe als wisselspeler')
                    : 'Klik: voeg toe aan basis';
                if (startFull && subFull) btn.disabled = true;
                availList.appendChild(btn);
            }

            btn.addEventListener('click', () => {
                if (isStarter) {
                    // starter → sub (als sub niet vol) anders → avail
                    starters.delete(p.uid);
                    if (subs.size < MAX_SUBS) subs.add(p.uid);
                } else if (isSub) {
                    // sub → avail
                    subs.delete(p.uid);
                } else {
                    // avail: eerst proberen basis te vullen, daarna bank
                    if (!startFull) {
                        starters.add(p.uid);
                    } else if (!subFull) {
                        subs.add(p.uid);
                    }
                }
                refresh();
            });
        });
    }

    refresh();

    confirmBtn.textContent = 'Bevestigen';
    confirmBtn.onclick = async () => {
        if (starters.size !== MAX_START) return;
        confirmBtn.disabled    = true;
        confirmBtn.textContent = 'Opslaan...';

        try {
            const lineupDraft = {};
            lineupAvailablePlayers.forEach(p => {
                let status = 'niet_geselecteerd';
                if (starters.has(p.uid)) status = 'starter';
                else if (subs.has(p.uid)) status = 'bench';
                lineupDraft[p.uid] = { name: p.name, status };
            });

            await updateDoc(doc(db, 'matches', lineupMatchData.id), {
                lineupDraft,
                lineupDraftConfirmed: true
            });

            lineupMatchData.lineupDraft          = lineupDraft;
            lineupMatchData.lineupDraftConfirmed = true;

            modal.classList.remove('active');
            await checkForStartMatch();

        } catch (e) {
            showToast('Fout bij opslaan opstelling: ' + e.message, 'error');
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
            showToast('Geen opgeslagen opstelling gevonden', 'error');
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

        // NIEUW: events in matches/{id}/events subcollection
        await addDoc(collection(db, 'matches', matchData.id, 'events'), {
            minuut:    0,
            half:      1,
            type:      'aftrap',
            ploeg:     'center',
            speler:    '',
            timestamp: serverTimestamp()
        });

        window.location.href = `live.html?match=${encodeURIComponent(matchData.id)}`;

    } catch (e) {
        console.error('Error finalizing match start:', e);
        showToast('Fout bij starten wedstrijd: ' + e.message, 'error');
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

// ── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `position:fixed;bottom:1.75rem;right:1.75rem;background:var(--text-dark);color:var(--white);padding:0.75rem 1.3rem;border-radius:9px;font-size:0.88rem;font-weight:600;z-index:9999;transform:translateY(80px);opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;max-width:320px;`;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--text-dark)';
    t.style.transform  = 'translateY(0)';
    t.style.opacity    = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.transform = 'translateY(80px)'; t.style.opacity = '0'; }, 3500);
}