// ===============================================
// PUSH NOTIFICATIONS (Firebase Cloud Messaging)
// V.V.S Rotselaar — enkel gebruikt in het admin-paneel
// ===============================================

import { db, app } from './firebase-config.js';
import { getMessaging, getToken, deleteToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase Console → Project instellingen → Cloud Messaging → tabblad "Web configuration"
// → "Web Push certificates" → genereer een key pair (of kopieer de bestaande).
const VAPID_KEY = 'BFKrgBtZOxR2vaDslxAfveQiGh9NmMDjEdnfKpHMqQEBzH-Okn_fOTs0RcxByTC409hn0KEOXHSKpsVJx4aF3vo';

/**
 * Vraagt toestemming voor pushmeldingen, registreert de service worker,
 * en slaat het FCM-token op bij de ingelogde admin in Firestore.
 * @param {string} uid - uid van de ingelogde admin (users/{uid})
 * @returns {Promise<boolean>} true als succesvol ingeschakeld
 */
/**
 * Vangt pushberichten op die binnenkomen terwijl deze tab open én actief is
 * (Firebase levert die NIET aan de service worker, maar rechtstreeks aan de pagina).
 * Toont een gewone systeemmelding, identiek aan de achtergrond-versie.
 * Roep dit één keer aan bij het laden van de pagina, als er al toestemming is.
 */
let _foregroundListenerActive = false;
export function listenForegroundMessages() {
    if (_foregroundListenerActive) return; // niet dubbel registreren
    _foregroundListenerActive = true;

    const messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
        console.log('[push] Voorgrond-bericht ontvangen:', payload);
        const title = payload.data?.title || 'V.V.S Rotselaar';
        const body  = payload.data?.body  || '';
        const url   = payload.data?.click_action || '/admin.html';

        if (Notification.permission === 'granted') {
            const notif = new Notification(title, {
                body,
                icon: '/assets/logo.png',
                badge: '/assets/icons/badge-monochrome.png'
            });
            notif.onclick = () => {
                window.focus();
                if (location.pathname !== url) window.location.href = url;
                notif.close();
            };
        }
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
            if (scriptUrl.includes('firebase-messaging-sw.js') && !reg.scope.includes('/firebase-push-scope/')) {
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
            scope: '/firebase-push-scope/'
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
        const registration = registrations.find(r => r.scope.includes('/firebase-push-scope/'));
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