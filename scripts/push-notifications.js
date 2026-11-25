// ===============================================
// PUSH NOTIFICATIONS (Firebase Cloud Messaging)
// V.V.S Rotselaar — gebruikt in het admin-paneel
// (nieuwe contactberichten/accountaanvragen) én door leden
// (live wedstrijdmeldingen)
// ===============================================

import { db, app } from './firebase-config.js';
import { getMessaging, getToken, deleteToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase Console → Project instellingen → Cloud Messaging → tabblad "Web configuration"
// → "Web Push certificates" → genereer een key pair (of kopieer de bestaande).
const VAPID_KEY = 'BFKrgBtZOxR2vaDslxAfveQiGh9NmMDjEdnfKpHMqQEBzH-Okn_fOTs0RcxByTC409hn0KEOXHSKpsVJx4aF3vo';

// Scope waarop de FCM-service worker geregistreerd staat (zie enablePushNotifications
// hieronder) — apart van scope '/' zodat er geen conflict ontstaat met pwa.js.
const PUSH_SCOPE = '/firebase-push-scope/';
const DEVICE_DISABLED_KEY = 'vvs_push_device_disabled';
const ADMIN_ENABLED_KEY = 'vvs_push_enabled';

async function getPushWorkerRegistration() {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
        const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        if (scriptUrl.includes('firebase-messaging-sw.js') && !reg.scope.endsWith(PUSH_SCOPE)) {
            console.log('[push] Oude service worker-registratie opgeruimd:', reg.scope);
            await reg.unregister();
        }
    }

    let registration = registrations.find(reg => reg.scope.endsWith(PUSH_SCOPE));
    if (!registration) {
        registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
            scope: PUSH_SCOPE
        });
    }

    if (registration.active) return registration;

    const worker = registration.installing || registration.waiting;
    if (!worker) throw new Error('De push-service-worker kon niet worden geactiveerd.');

    await new Promise((resolve, reject) => {
        const onStateChange = () => {
            if (registration.active) {
                worker.removeEventListener('statechange', onStateChange);
                resolve();
            } else if (worker.state === 'redundant') {
                worker.removeEventListener('statechange', onStateChange);
                reject(new Error('De push-service-worker kon niet worden geactiveerd.'));
            }
        };
        worker.addEventListener('statechange', onStateChange);
        onStateChange();
    });

    return registration;
}

function isDevicePushDisabled() {
    try { return localStorage.getItem(DEVICE_DISABLED_KEY) === '1'; }
    catch (_) { return false; }
}

/**
 * Vangt pushberichten op die binnenkomen terwijl deze tab open én actief is
 * (Firebase levert die NIET aan de service worker, maar rechtstreeks aan de pagina).
 * Toont dezelfde melding via de service worker (self.registration.showNotification),
 * identiek aan de achtergrond-versie in firebase-messaging-sw.js — zo groeperen
 * live wedstrijdmeldingen (zelfde "tag") ook hier tot één uitklapbare melding
 * i.p.v. een aparte melding per event, en loopt de klik-afhandeling altijd via
 * dezelfde "notificationclick"-listener in de service worker.
 * Roep dit één keer aan bij het laden van de pagina, als er al toestemming is.
 */
let _foregroundListenerActive = false;
export function listenForegroundMessages() {
    if (_foregroundListenerActive) return; // niet dubbel registreren
    _foregroundListenerActive = true;

    const messaging = getMessaging(app);
    onMessage(messaging, async (payload) => {
        console.log('[push] Voorgrond-bericht ontvangen:', payload);
        if (Notification.permission !== 'granted') return;

        const registration = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
        if (!registration) return; // geen SW geregistreerd, kan geen melding tonen

        const title      = payload.data?.title || 'V.V.S Rotselaar';
        const body        = payload.data?.body  || '';
        const url         = payload.data?.click_action || '/admin.html';
        const tag         = payload.data?.tag || null;
        const groupTitle  = payload.data?.groupTitle || title;

        if (tag) {
            // Live wedstrijdmelding: bestaande melding met deze tag ophalen en
            // de nieuwe regel toevoegen, zodat het één (groeiende) melding blijft.
            const existing = await registration.getNotifications({ tag });
            const previousLines = existing[0]?.data?.lines || [];
            const lines = [...previousLines, body].slice(-20); // laatste 20 events

            await registration.showNotification(groupTitle, {
                body: lines.join('\n'),
                icon: '/assets/logo.png',
                badge: '/assets/icons/badge-monochrome.png',
                tag,
                renotify: true,
                data: { url, lines }
            });
            return;
        }

        await registration.showNotification(title, {
            body,
            icon: '/assets/logo.png',
            badge: '/assets/icons/badge-monochrome.png',
            data: { url }
        });
    });
}

/**
 * Vraagt toestemming voor pushmeldingen, registreert de service worker,
 * en slaat het FCM-token op bij de ingelogde gebruiker in Firestore.
 * @param {string} uid - uid van de ingelogde gebruiker (users/{uid})
 * @returns {Promise<boolean>} true als succesvol ingeschakeld
 */
export async function enablePushNotifications(uid) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('Pushmeldingen worden niet ondersteund in deze browser.');
        return false;
    }
    if (VAPID_KEY.startsWith('VUL_IN')) {
        alert('VAPID-key is nog niet ingesteld in push-notifications.js.');
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Pushmeldingen geweigerd door gebruiker.');
            return false;
        }

        const registration = await getPushWorkerRegistration();
        const messaging = getMessaging(app);
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        if (!token) {
            console.error('Geen FCM-token ontvangen.');
            return false;
        }

        await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) });
        try { localStorage.removeItem(DEVICE_DISABLED_KEY); } catch (_) {}
        listenForegroundMessages();
        console.log('Pushmeldingen ingeschakeld, token opgeslagen.');
        return true;

    } catch (err) {
        console.error('Push setup mislukt:', err);
        alert('Kon pushmeldingen niet inschakelen: ' + err.message);
        return false;
    }
}

/**
 * Vernieuwt een eerder toegestane pushregistratie zonder opnieuw toestemming
 * te vragen. Wordt alleen aangeroepen als minstens één meldingscategorie actief is.
 */
export async function refreshPushTokenIfEnabled(uid, userData) {
    const permissions = Array.isArray(userData.permissions) ? userData.permissions : [];
    const settings = userData.pushSettings || {};
    const memberOptIn = Array.isArray(settings.liveTeams) && settings.liveTeams.length > 0;
    let adminOptIn = false;
    try {
        adminOptIn = permissions.includes('admin') && localStorage.getItem(ADMIN_ENABLED_KEY) === '1';
    } catch (_) {}

    if ((!memberOptIn && !adminOptIn) || isDevicePushDisabled() ||
        getPushPermissionStatus() !== 'granted' ||
        !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return false;
    }

    try {
        const registration = await getPushWorkerRegistration();
        const token = await getToken(getMessaging(app), {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });
        if (!token) throw new Error('Geen FCM-token ontvangen.');

        await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) });
        listenForegroundMessages();
        return true;
    } catch (err) {
        console.error('Pushregistratie kon niet automatisch worden vernieuwd:', err);
        return false;
    }
}

/**
 * Geeft de huidige status terug zonder iets te wijzigen —
 * handig om de knoptekst correct te tonen bij het laden van de pagina.
 */
export function getPushPermissionStatus() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
}

/**
 * Schakelt pushmeldingen uit voor dit toestel/browser, via de site zelf
 * (geen browserinstellingen nodig). Verwijdert het token uit Firestore
 * én trekt de lokale FCM-subscriptie in.
 * @param {string} uid
 * @param {boolean} rememberDeviceOptOut voorkomt automatische herinschrijving
 * @returns {Promise<boolean>}
 */
export async function disablePushNotifications(uid, rememberDeviceOptOut = true) {
    try {
        // Zoek alleen de eigen push-registratie; getToken zonder deze registratie
        // kan anders onbedoeld een tweede worker op de root-scope aanmaken.
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations.find(r => r.scope.endsWith(PUSH_SCOPE));
        const messaging = getMessaging(app);

        // Huidig token ophalen zodat we exact dát token uit Firestore kunnen verwijderen
        let token = null;
        if (registration) {
            token = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: registration
            });
        }

        if (token) {
            await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayRemove(token) });
        }

        // Trekt de lokale FCM-registratie in zodat dit toestel geen tokens meer genereert
        await deleteToken(messaging);
        if (rememberDeviceOptOut) {
            try { localStorage.setItem(DEVICE_DISABLED_KEY, '1'); } catch (_) {}
        }
        return true;

    } catch (err) {
        console.error('Push uitschakelen mislukt:', err);
        return false;
    }
}

// ===============================================
// MELDINGSCATEGORIE VOOR LEDEN
// Bovenop de aan/uit-schakelaar hierboven (die de browser-
// toestemming + het FCM-token regelt) kan iedereen kiezen:
//  - 'liveTeams' (live wedstrijdmeldingen) — een LIJST van ploegnamen,
//    los van lidmaatschap: iedereen mag live meldingen van eender
//    welke ploeg aanzetten, ook een ploeg waar die zelf niet in zit.
// Opgeslagen als users/{uid}.pushSettings = { liveTeams }.
// ===============================================

/**
 * Haalt de huidige meldingsvoorkeuren van een gebruiker op.
 * @param {string} uid
 * @returns {Promise<{liveTeams: string[]}>}
 */
export async function getPushCategories(uid) {
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        const settings = snap.data()?.pushSettings || {};
        return {
            liveTeams: Array.isArray(settings.liveTeams) ? settings.liveTeams : []
        };
    } catch (err) {
        console.error('Kon pushSettings niet ophalen:', err);
        return { liveTeams: [] };
    }
}

/**
 * Ruimt het FCM-token op zodra alle meldingscategorieën uitstaan,
 * behalve wanneer deze browser ook expliciet voor adminmeldingen is ingeschakeld.
 */
async function cleanupDeviceIfAllOff(uid) {
    const current = await getPushCategories(uid);
    let adminOptIn = false;
    try { adminOptIn = localStorage.getItem(ADMIN_ENABLED_KEY) === '1'; } catch (_) {}
    if (current.liveTeams.length === 0 && !adminOptIn) {
        await disablePushNotifications(uid, false);
    }
}

/**
 * Schakelt live wedstrijdmeldingen voor één specifieke ploeg in of uit.
 * Werkt onafhankelijk van lidmaatschap — een gebruiker kan dit voor
 * eender welke ploeg aanzetten.
 * @param {string} uid
 * @param {'zaterdag'|'zondag'|'veteranen'} team
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true als succesvol doorgevoerd
 */
export async function setLiveTeamPreference(uid, team, enabled) {
    if (enabled) {
        const ok = await enablePushNotifications(uid);
        if (!ok) return false;
    }
    try {
        await updateDoc(doc(db, 'users', uid), {
            'pushSettings.liveTeams': enabled ? arrayUnion(team) : arrayRemove(team)
        });
    } catch (err) {
        console.error('Kon live-instelling niet bijwerken:', err);
        return false;
    }
    if (!enabled) await cleanupDeviceIfAllOff(uid);
    return true;
}