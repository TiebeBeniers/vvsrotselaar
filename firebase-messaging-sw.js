// ===============================================
// FIREBASE MESSAGING SERVICE WORKER
// V.V.S Rotselaar
// LET OP: dit bestand moet in de ROOT van de site staan
// (naast index.html), niet in de scripts/-map.
// ===============================================

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Zelfde configuratie als scripts/firebase-config.js
// (een service worker kan geen ES-modules importeren, dus dit moet hardcoded staan)
firebase.initializeApp({
    apiKey: "AIzaSyDS9uRPtr5W4r_A2i3HOM-xk47RTisCgwg",
    authDomain: "vvs-rotselaar-db.firebaseapp.com",
    projectId: "vvs-rotselaar-db",
    storageBucket: "vvs-rotselaar-db.firebasestorage.app",
    messagingSenderId: "776733736506",
    appId: "1:776733736506:web:864e8c0f9cf68a04e9bf03"
});

const messaging = firebase.messaging();

// Wordt getriggerd wanneer een pushmelding binnenkomt terwijl er geen tabblad open staat.
// LET OP: de server stuurt bewust enkel "data" (geen "notification"-veld) — anders
// toont de Firebase SDK hier automatisch al zelf een melding, wat samen met onze
// eigen showNotification() hieronder tot een dubbele melding leidde.
messaging.onBackgroundMessage(async (payload) => {
    console.log('[firebase-messaging-sw.js] Achtergrondmelding ontvangen:', payload);
    const title      = payload.data?.title || 'V.V.S Rotselaar';
    const body       = payload.data?.body  || '';
    const url        = payload.data?.click_action || '/admin.html';
    const tag        = payload.data?.tag || null;
    const groupTitle = payload.data?.groupTitle || title;

    if (tag) {
        // Live wedstrijdmelding: alle events van dezelfde wedstrijd delen dezelfde
        // "tag" (live-{matchId}). Bestaande melding met die tag ophalen en de nieuwe
        // regel aan de body toevoegen, i.p.v. telkens een aparte melding te tonen —
        // zo blijft het één melding die groeit, en die je in het notificatiecenter
        // kan uitklappen om alle events van de wedstrijd te zien.
        const existing = await self.registration.getNotifications({ tag });
        const previousLines = existing[0]?.data?.lines || [];
        const lines = [...previousLines, body].slice(-20); // laatste 20 events tonen

        await self.registration.showNotification(groupTitle, {
            body: lines.join('\n'),
            icon: '/assets/logo.png',
            badge: '/assets/icons/badge-monochrome.png',
            tag,
            renotify: true,
            data: { url, lines }
        });
        return;
    }

    // Geen tag → gewone, aparte melding (admin-meldingen, herinneringen, ...)
    self.registration.showNotification(title, {
        body,
        icon: '/assets/logo.png',
        badge: '/assets/icons/badge-monochrome.png',
        data: { url }
    });
});

// Klik op de melding → open (of focus) de admin-pagina
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/admin.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(url) && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});