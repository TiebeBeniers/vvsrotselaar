// ===============================================
// NOTIFICATIONS.JS
// V.V.S Rotselaar – Meldingen
//
// Admin-meldingen (Firestore: notificaties/{id}) en MOTM-stemherinneringen.
//
// Banners stapelen in een gedeelde #notifStack container.
// Versie-mechanisme: dismiss-key = vvs_custom_{id}_v{versie}
//   → ophogen versie in admin reset automatisch alle dismissals.
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, getDoc, doc }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { enablePushNotifications, refreshPushTokenIfEnabled } from './push-notifications.js';
import { isSupporter } from './vvs-user-helpers.js';

const CHECK_INTERVAL = 2 * 60 * 60 * 1000;  // Om de 2 uur opnieuw checken
const LAST_CHECK_KEY = 'vvs_notif_last_check';

// Bijhouden welke UID het laatst gecheckt werd → bij login altijd direct checken
let _lastCheckedUid = null;

// ── Gedeelde stack container ──────────────────────────────────────────────────
function getStack() {
    let stack = document.getElementById('notifStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'notifStack';
        document.body.appendChild(stack);
    }
    return stack;
}

// ── Dismiss helpers — admin meldingen ─────────────────────────────────────────
function customDismissKey(id, versie, uid = null) {
    return `vvs_custom_${id}_v${versie}${uid ? `_${uid}` : ''}`;
}
function isCustomDismissed(id, versie, uid = null) {
    try { return localStorage.getItem(customDismissKey(id, versie, uid)) === '1'; }
    catch (_) { return false; }
}
function customDismiss(id, versie, uid = null) {
    try { localStorage.setItem(customDismissKey(id, versie, uid), '1'); } catch (_) {}
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
function shouldCheck(uid) {
    // Altijd checken als de ingelogde user veranderd is (login/logout)
    if (uid !== _lastCheckedUid) return true;
    try { return Date.now() - parseInt(localStorage.getItem(LAST_CHECK_KEY + '_' + (uid || 'anon')) || '0') > CHECK_INTERVAL; }
    catch (_) { return true; }
}
function markChecked(uid) {
    _lastCheckedUid = uid;
    try { localStorage.setItem(LAST_CHECK_KEY + '_' + (uid || 'anon'), String(Date.now())); } catch (_) {}
}

// ── Banner factory ────────────────────────────────────────────────────────────
function makeBanner(id, html, onDismiss, autoHideMs = 15000) {
    const stack  = getStack();
    const banner = document.createElement('div');
    banner.className = 'notif-banner';
    banner.id = id;
    banner.innerHTML = html;
    stack.appendChild(banner);

    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('visible')));

    const closeBtn = banner.querySelector('.notif-banner-close');
    // collapse() verwijdert de banner én klapt hem in zodat er geen gat achterblijft
    function collapse() {
        banner.classList.remove('visible');
        banner.classList.add('collapsing');
        onDismiss?.();
        setTimeout(() => banner.remove(), 380);
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', collapse);
    }

    if (autoHideMs > 0) {
        setTimeout(() => {
            if (banner.isConnected) collapse();
        }, autoHideMs);
    }

    return banner;
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN-MELDING BANNERS
// ══════════════════════════════════════════════════════════════════════════════

const TYPE_META = {
    info:    { icon: 'ℹ️',  color: '#0047AB' },
    warning: { icon: '⚠️',  color: '#FFC107' },
    success: { icon: '✅',  color: '#28A745' },
};

function showCustomBanner(m, user = null) {
    const bannerId = `notifCustom_${m.id}`;
    document.getElementById(bannerId)?.remove();

    const meta = TYPE_META[m.type] || TYPE_META.info;

    // Gebruik de opgeslagen kleur (valt terug op meta-kleur van het type)
    const accentKleur = m.kleur || meta.color;
    // Duur: 0 = oneindig → 0ms in makeBanner; anders seconden → ms
    const autoHideMs  = m.pushOptIn ? 0 : (m.duur && m.duur > 0) ? m.duur * 1000 : 0;

    const html = `
        <div class="notif-banner-header notif-custom" style="--notif-accent:${accentKleur};border-top-color:${accentKleur}">
            <div class="notif-banner-title-row">
                <span class="notif-banner-icon">${meta.icon}</span>
                <span class="notif-banner-title">${escHtml(m.titel)}</span>
                <button class="notif-banner-close" title="${m.pushOptIn ? 'Negeren' : 'Sluiten'}" aria-label="${m.pushOptIn ? 'Negeren' : 'Sluiten'}">✕</button>
            </div>
            <p class="notif-banner-text notif-text-center">${escHtml(m.tekst)}</p>
            ${m.pushOptIn ? `
                <div class="notif-push-actions">
                    <button type="button" class="notif-match-btn notif-push-enable">Meldingen aanzetten</button>
                    <button type="button" class="notif-push-dismiss">Negeren</button>
                </div>` : ''}
        </div>`;

    const uid = m.pushOptIn ? user?.uid : null;
    const banner = makeBanner(bannerId, html, () => customDismiss(m.id, m.versie ?? 1, uid), autoHideMs);

    if (m.pushOptIn) {
        banner.classList.add('notif-push-opt-in');
        banner.querySelector('.notif-push-dismiss')?.addEventListener('click', () => {
            banner.querySelector('.notif-banner-close')?.click();
        });
        const enableButton = banner.querySelector('.notif-push-enable');
        enableButton?.addEventListener('click', async () => {
            if (!user || !enableButton) return;
            enableButton.disabled = true;
            enableButton.textContent = 'Toestemming aanvragen…';
            const enabled = await enablePushNotifications(user.uid);
            if (enabled) {
                banner.querySelector('.notif-banner-close')?.click();
            } else if (enableButton.isConnected) {
                enableButton.disabled = false;
                enableButton.textContent = 'Meldingen aanzetten';
            }
        });
    }
}

function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════════════════════
// HOOFDLOGICA
// ══════════════════════════════════════════════════════════════════════════════

function motmReminderKey(uid, matchId) {
    return `vvs_motm_reminder_${uid}_${matchId}`;
}

function showMotmReminder(user, match) {
    const key = motmReminderKey(user.uid, match.id);
    try {
        if (localStorage.getItem(key) === '1') return;
        localStorage.setItem(key, '1');
    } catch (_) {}

    const teamPages = { zaterdag: 'zaterdag.html', zondag: 'zondag.html', veteranen: 'veteranen.html' };
    const teamPage = teamPages[match.team];
    if (!teamPage) return;

    const home = escHtml(match.thuisploeg || 'Thuis');
    const away = escHtml(match.uitploeg || 'Uit');
    const href = `${teamPage}?motm=${encodeURIComponent(match.id)}#motmSection`;
    const html = `
        <div class="notif-banner-header notif-custom" style="--notif-accent:#f0b429;border-top-color:#f0b429">
            <div class="notif-banner-title-row">
                <span class="notif-banner-icon">🏆</span>
                <span class="notif-banner-title">Stem op Man van de Match</span>
                <button class="notif-banner-close" title="Sluiten" aria-label="Sluiten">✕</button>
            </div>
            <p class="notif-banner-text notif-text-center">De wedstrijd ${home} – ${away} is afgelopen. Breng je stem uit!</p>
            <a class="notif-match-btn" href="${href}">Ga naar de stemming →</a>
        </div>`;
    makeBanner(`notifMotm_${match.id}`, html, null, 0);
}

async function checkMotmReminders(user, userData) {
    const permissions = Array.isArray(userData.permissions) ? userData.permissions : [];
    const isGlobalDelegate = permissions.includes('afgevaardigde:*');
    const teams = new Set([
        ...(Array.isArray(userData.team) ? userData.team : []),
        ...(isGlobalDelegate ? ['zaterdag', 'zondag', 'veteranen'] : permissions
            .filter(permission => typeof permission === 'string' && permission.startsWith('afgevaardigde:'))
            .map(permission => permission.slice('afgevaardigde:'.length)))
    ].filter(team => ['zaterdag', 'zondag', 'veteranen'].includes(team)));
    if (teams.size === 0) return;

    const now = new Date();
    try {
        for (const team of teams) {
            const snap = await getDocs(query(
                collection(db, 'matches'),
                where('team', '==', team),
                where('status', '==', 'finished')
            ));

            for (const matchDoc of snap.docs) {
                const match = { id: matchDoc.id, ...matchDoc.data() };
                if (match.motmResults || !Array.isArray(match.motmCandidateUids)) continue;

                const matchDate = new Date(`${match.datum}T${match.uur || '00:00'}`);
                const dayEnd = new Date(matchDate);
                dayEnd.setHours(23, 59, 59, 999);
                if (!Number.isFinite(matchDate.getTime()) || now < matchDate || now > dayEnd) continue;

                const isDelegate = isGlobalDelegate ||
                    permissions.includes(`afgevaardigde:${team}`);
                const isEligible = isSupporter(userData)
                    ? (userData.team || []).includes(team)
                    : isDelegate || (userData.team || []).includes(team) &&
                        (match.motmEligibleUids || []).includes(user.uid);
                if (!isEligible) continue;

                const voteSnap = await getDoc(doc(db, 'matches', match.id, 'motm', user.uid));
                if (!voteSnap.exists()) showMotmReminder(user, match);
            }
        }
    } catch (err) {
        console.warn('MOTM-herinnering kon niet worden gecontroleerd:', err);
    }
}

async function checkCustomNotifications(user, ploegen, hasFcmToken, profileLoaded, supporterAccount = false) {
    // ploegen is een array van strings, bv. ['zaterdag', 'zondag']
    const today = new Date().toISOString().slice(0, 10);

    try {
        const snap = await getDocs(
            query(collection(db, 'notificaties'), where('actief', '==', true))
        );

        snap.forEach(d => {
            const m = { id: d.id, ...d.data() };

            // Datumperiode check
            if (m.vanDatum  && today < m.vanDatum)  return;
            if (m.totDatum  && today > m.totDatum)  return;

            // Doelgroep check
            const dg = m.doelgroep || 'iedereen';
            if (supporterAccount && (dg !== 'iedereen' || m.pushOptIn)) return;
            if (dg === 'ingelogd' && !user) return;
            if (m.pushOptIn && (!user || !profileLoaded || hasFcmToken)) return;
            // Ploeg-specifieke check: de speler moet in die ploeg zitten
            if (dg === 'zaterdag'  && !ploegen.includes('zaterdag'))  return;
            if (dg === 'zondag'    && !ploegen.includes('zondag'))    return;
            if (dg === 'veteranen' && !ploegen.includes('veteranen')) return;
            // 'iedereen' → altijd tonen

            // Al gedismissed voor deze versie?
            if (isCustomDismissed(m.id, m.versie ?? 1, m.pushOptIn ? user.uid : null)) return;

            showCustomBanner(m, user);
        });
    } catch (err) {
        console.warn('Custom meldingen check mislukt:', err);
    }
}

async function runChecks(user) {
    const uid = user?.uid || null;
    if (!shouldCheck(uid)) return;
    markChecked(uid);

    // Haal gebruikersprofiel op (enkel nodig als ingelogd)
    let ploegen = [];
    let hasFcmToken = false;
    let profileLoaded = !user;
    let supporterAccount = false;
    let userData = null;
    if (user) {
        try {
            const snap = await getDoc(doc(db, 'users', user.uid));
            if (snap.exists()) {
                const data = snap.data();
                userData = data;
                profileLoaded = true;
                supporterAccount = isSupporter(data);
                hasFcmToken = Array.isArray(data.fcmTokens)
                    && data.fcmTokens.some(token => typeof token === 'string' && token.trim());
                // Ondersteun zowel het nieuwe ploegen-array als het oude categorie-veld
                if (Array.isArray(data.ploegen) && data.ploegen.length > 0) {
                    ploegen = data.ploegen;
                } else if (data.categorie) {
                    ploegen = [data.categorie];
                }
            } else {
                console.warn('Gebruikersprofiel niet gevonden voor pushmeldingen:', user.uid);
            }
        } catch (err) {
            console.error('Gebruikersprofiel kon niet worden geladen:', err);
        }
    }

    // Beide checks parallel uitvoeren
    const tasks = [checkCustomNotifications(user, ploegen, hasFcmToken, profileLoaded, supporterAccount)];
    if (user && userData) {
        tasks.push(checkMotmReminders(user, userData));
        tasks.push(refreshPushTokenIfEnabled(user.uid, userData));
    }

    await Promise.allSettled(tasks);
}

// ── Auth listener ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    document.querySelectorAll('.notif-push-opt-in').forEach(banner => banner.remove());
    if (user) {
        setTimeout(() => runChecks(user), 2000);
    } else {
        // Niet ingelogd: wel custom meldingen checken voor doelgroep "iedereen"
        setTimeout(() => runChecks(null), 2000);
    }
});
