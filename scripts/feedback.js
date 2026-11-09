import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const DISMISSED_KEY = 'vvs_feedback_dismissed';
const COOLDOWN_KEY = 'vvs_feedback_last_sent';
const COOLDOWN_MS = 5 * 60 * 1000;

const widget = document.getElementById('feedbackWidget');
const toggle = document.getElementById('feedbackToggle');
const panel = document.getElementById('feedbackPanel');
const panelHandle = document.getElementById('feedbackPanelHandle');
const form = document.getElementById('feedbackForm');
const pageInput = document.getElementById('feedbackPage');
const feedbackInput = document.getElementById('feedbackMessage');
const suggestionInput = document.getElementById('feedbackSuggestion');
const accountOption = document.getElementById('feedbackAccount');
const accountCheckbox = document.getElementById('feedbackUseAccount');
const accountNameLabel = document.getElementById('feedbackAccountName');
const anonymousNote = document.getElementById('feedbackAnonymous');
const submitButton = document.getElementById('feedbackSubmit');
const statusMessage = document.getElementById('feedbackStatus');

if (widget && toggle && panel && form) {
    let currentUser = null;
    let accountName = '';
    let cooldownInterval = null;

    function setPanelOpen(open) {
        widget.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        panel.setAttribute('aria-hidden', String(!open));
        panel.inert = !open;
        if (open) pageInput.focus();
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `feedback-status is-${type}`;
        statusMessage.hidden = false;
    }

    function updateCooldown() {
        const lastSent = Number(localStorage.getItem(COOLDOWN_KEY) || 0);
        const remaining = Number.isFinite(lastSent)
            ? Math.max(0, COOLDOWN_MS - (Date.now() - lastSent))
            : 0;
        if (remaining === 0) {
            clearInterval(cooldownInterval);
            cooldownInterval = null;
            submitButton.disabled = false;
            submitButton.textContent = 'Feedback versturen';
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = `Opnieuw feedback geven over ${Math.ceil(remaining / 1000)}s`;
        if (!cooldownInterval) cooldownInterval = setInterval(updateCooldown, 1000);
    }

    function dismissWidget() {
        localStorage.setItem(DISMISSED_KEY, 'true');
        widget.hidden = true;
    }

    if (localStorage.getItem(DISMISSED_KEY) === 'true') {
        widget.hidden = true;
    }

    toggle.addEventListener('click', () => setPanelOpen(true));
    document.getElementById('feedbackCollapse').addEventListener('click', () => {
        setPanelOpen(false);
        toggle.focus();
    });
    document.getElementById('feedbackDismiss').addEventListener('click', dismissWidget);
    document.getElementById('feedbackDismissCollapsed').addEventListener('click', dismissWidget);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && widget.classList.contains('is-open')) {
            setPanelOpen(false);
            toggle.focus();
        }
    });

    function addSwipeHandler(element, onSwipeUp, onSwipeDown) {
        let startY = null;
        element.addEventListener('pointerdown', (event) => {
            startY = event.clientY;
        });
        element.addEventListener('pointerup', (event) => {
            if (startY === null) return;
            const distance = event.clientY - startY;
            startY = null;
            if (distance < -45) onSwipeUp();
            if (distance > 60) onSwipeDown();
        });
        element.addEventListener('pointercancel', () => { startY = null; });
    }

    addSwipeHandler(toggle, () => setPanelOpen(true), () => {});
    addSwipeHandler(panelHandle, () => {}, () => {
        setPanelOpen(false);
        toggle.focus();
    });

    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        accountName = user?.displayName || 'Gebruiker';
        accountCheckbox.checked = false;

        if (user) {
            try {
                const profile = await getDoc(doc(db, 'users', user.uid));
                const profileName = profile.exists() ? profile.data().name : '';
                if (typeof profileName === 'string' && profileName.trim()) {
                    accountName = profileName.trim().slice(0, 100);
                }
            } catch (error) {
                console.error('Accountnaam laden voor feedback is mislukt:', error);
            }
        }

        if (currentUser?.uid !== user?.uid) return;
        accountOption.hidden = !user;
        anonymousNote.hidden = Boolean(user);
        accountNameLabel.textContent = user ? `(${accountName})` : '';
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        updateCooldown();
        if (submitButton.disabled) return;

        const feedback = feedbackInput.value.trim();
        const suggesties = suggestionInput.value.trim();
        if (!feedback && !suggesties) {
            showStatus('Vul je feedback of een suggestie in om te versturen.', 'error');
            feedbackInput.focus();
            return;
        }

        const useAccount = accountCheckbox.checked && Boolean(currentUser);
        submitButton.disabled = true;
        submitButton.textContent = 'Versturen...';

        try {
            const onderwerpen = [...form.querySelectorAll('input[name="onderwerp"]:checked')]
                .map((input) => input.value)
                .join(', ');

            await addDoc(collection(db, 'feedback'), {
                pagina: pageInput.value.trim(),
                onderwerpen,
                feedback,
                suggesties,
                userId: useAccount ? currentUser.uid : null,
                naam: useAccount ? accountName.slice(0, 100) : 'Anoniem',
                createdAt: serverTimestamp(),
            });

            localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
            form.reset();
            pageInput.value = 'Homepagina';
            showStatus('Bedankt! Je feedback is verstuurd.', 'success');
            updateCooldown();
        } catch (error) {
            console.error('Feedback versturen is mislukt:', error);
            const message = error.code === 'permission-denied'
                ? 'Je feedback kon niet worden opgeslagen. Controleer je verbinding of probeer het later opnieuw.'
                : 'Feedback versturen is niet gelukt. Probeer het later opnieuw.';
            showStatus(message, 'error');
            submitButton.disabled = false;
            submitButton.textContent = 'Feedback versturen';
        }
    });

    updateCooldown();
}
