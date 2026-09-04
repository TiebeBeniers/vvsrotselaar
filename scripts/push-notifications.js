// ===============================================
// PUSH NOTIFICATIONS (Firebase Cloud Messaging)
// V.V.S Rotselaar — gebruikt in het admin-paneel
// (nieuwe contactberichten/accountaanvragen) én door leden
// (herinnering aanwezigheid + live wedstrijdmeldingen)
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

/**
 * Vraagt toestemming voor pushmeldingen, registreert de service worker,
 * en slaat het FCM-token op bij de ingelogde admin in Firestore.
 * @param {string} uid - uid van de ingelogde admin (users/{uid})
 * @returns {Promise<boolean>} true als succesvol ingeschakeld
 */
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
        // Eventuele oude/verouderde registraties van dit script opruimen — bv. een
        // restant op scope '/' van vóór de scope-fix. Zonder opkuis kunnen 2 actieve
        // registraties dezelfde binnenkomende push allebei tonen (dubbele melding).
        const existing = await navigator.serviceWorker.getRegistrations();
        for (const reg of existing) {
            const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
            if (scriptUrl.includes('firebase-messaging-sw.js') && !reg.scope.includes(PUSH_SCOPE)) {
                console.log('[push] Oude service worker-registratie opgeruimd:', reg.scope);
                await reg.unregister();
            }
        }

        // Eigen, aparte scope gebruiken zodat er geen conflict ontstaat met de
        // bestaande PWA-service worker (pwa.js), die ook op scope '/' draait.
        // Zonder deze aparte scope kan een push bij de verkeerde worker terechtkomen,
        // die geen melding toont — Chrome toont dan zelf een generieke fallbacktekst
        // ("De site is geüpdatet op de achtergrond") in plaats van ons eigen bericht.
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
            scope: PUSH_SCOPE
        });
        await navigator.serviceWorker.ready;

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Pushmeldingen geweigerd door gebruiker.');
            return false;
        }

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
        console.log('Pushmeldingen ingeschakeld, token opgeslagen.');
        return true;

    } catch (err) {
        console.error('Push setup mislukt:', err);
        alert('Kon pushmeldingen niet inschakelen: ' + err.message);
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
 * @returns {Promise<boolean>}
 */
export async function disablePushNotifications(uid) {
    try {
        // Zoek de registratie op basis van scope (niet op scriptbestand — getRegistration()
        // verwacht een pagina-URL die binnen de scope valt, geen bestandsnaam).
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations.find(r => r.scope.includes(PUSH_SCOPE));
        const messaging = getMessaging(app);

        // Huidig token ophalen zodat we exact dát token uit Firestore kunnen verwijderen
        let token = null;
        try {
            token = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: registration
            });
        } catch (_) { /* kan mislukken, geen probleem — dan slaan we die stap gewoon over */ }

        if (token) {
            await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayRemove(token) });
        }

        // Trekt de lokale FCM-registratie in zodat dit toestel geen tokens meer genereert
        await deleteToken(messaging);
        return true;

    } catch (err) {
        console.error('Push uitschakelen mislukt:', err);
        return false;
    }
}

// ===============================================
// MELDINGSCATEGORIEËN VOOR LEDEN
// Bovenop de aan/uit-schakelaar hierboven (die de browser-
// toestemming + het FCM-token regelt) kan iedereen apart kiezen:
//  - 'reminder' (herinnering aanwezig/afwezig) — enkel zinvol voor
//    de eigen ploeg(en), wordt enkel getoond aan leden van die ploeg.
//  - 'liveTeams' (live wedstrijdmeldingen) — een LIJST van ploegnamen,
//    los van lidmaatschap: iedereen mag live meldingen van eender
//    welke ploeg aanzetten, ook een ploeg waar die zelf niet in zit.
// Opgeslagen als users/{uid}.pushSettings = { reminder, liveTeams }.
// ===============================================

/**
 * Haalt de huidige meldingsvoorkeuren van een gebruiker op.
 * @param {string} uid
 * @returns {Promise<{reminder: boolean, liveTeams: string[]}>}
 */
export async function getPushCategories(uid) {
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        const settings = snap.data()?.pushSettings || {};
        return {
            reminder: !!settings.reminder,
            liveTeams: Array.isArray(settings.liveTeams) ? settings.liveTeams : []
        };
    } catch (err) {
        console.error('Kon pushSettings niet ophalen:', err);
        return { reminder: false, liveTeams: [] };
    }
}

/**
 * Ruimt het FCM-token op zodra ALLE meldingscategorieën uitstaan
 * (geen herinnering én geen enkele live-ploeg meer), zodat de
 * gebruiker pas opnieuw om browsertoestemming gevraagd wordt als
 * die iets terug aanzet.
 */
async function cleanupDeviceIfAllOff(uid) {
    const current = await getPushCategories(uid);
    if (!current.reminder && current.liveTeams.length === 0) {
        await disablePushNotifications(uid);
    }
}

/**
 * Schakelt de herinnering aanwezig/afwezig in of uit.
 * @param {string} uid
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true als succesvol doorgevoerd
 */
export async function setReminderPreference(uid, enabled) {
    if (enabled) {
        const ok = await enablePushNotifications(uid);
        if (!ok) return false;
    }
    try {
        await updateDoc(doc(db, 'users', uid), { 'pushSettings.reminder': enabled });
    } catch (err) {
        console.error('Kon reminder-instelling niet bijwerken:', err);
        return false;
    }
    if (!enabled) await cleanupDeviceIfAllOff(uid);
    return true;
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