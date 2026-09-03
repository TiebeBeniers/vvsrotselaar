const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const bancontactApiKey = defineSecret('BANCONTACT_API_KEY');

// ═══════════════════════════════════════════════
// GEDEELDE PUSH-VERSTUURFUNCTIE
// Verstuurt een pushmelding naar een reeks user-documenten
// (elk met .data().fcmTokens en .ref) en kuist ongeldige/
// verlopen tokens meteen op. Gebruikt door zowel de
// admin-meldingen als de leden-meldingen hieronder.
// ═══════════════════════════════════════════════

async function sendPushToUserDocs(db, userDocs, title, body, clickUrl) {
    const tokens = [];
    userDocs.forEach(docSnap => {
        const data = docSnap.data();
        if (Array.isArray(data.fcmTokens)) tokens.push(...data.fcmTokens);
    });
    if (tokens.length === 0) {
        console.log('Geen tokens gevonden, geen pushmelding verstuurd.');
        return;
    }

    // LET OP: bewust enkel "data" gebruiken, geen "notification"-veld.
    // Een "notification"-veld laat de Firebase SDK in de service worker
    // ZELF automatisch al een melding tonen, nog vóór onBackgroundMessage()
    // uitgevoerd wordt — dat gaf dubbele meldingen (auto-weergave + onze
    // eigen showNotification() erbovenop). Met enkel "data" is onze eigen
    // code in firebase-messaging-sw.js de enige plek die iets toont.
    const message = {
        data: {
            title,
            body,
            click_action: clickUrl,
        },
        tokens,
    };

    const response = await getMessaging().sendEachForMulticast(message);
    console.log(`Push verstuurd: ${response.successCount}/${tokens.length} geslaagd.`);

    // Ongeldige/verlopen tokens netjes opkuisen zodat de lijst niet blijft aangroeien
    const invalidTokens = [];
    response.responses.forEach((r, i) => {
        const code = r.error?.code;
        if (code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered') {
            invalidTokens.push(tokens[i]);
        }
    });
    if (invalidTokens.length > 0) {
        const batch = db.batch();
        userDocs.forEach(docSnap => {
            const arr = docSnap.data().fcmTokens || [];
            const filtered = arr.filter(t => !invalidTokens.includes(t));
            if (filtered.length !== arr.length) {
                batch.update(docSnap.ref, { fcmTokens: filtered });
            }
        });
        await batch.commit();
        console.log(`${invalidTokens.length} verlopen token(s) opgekuist.`);
    }
}

// ═══════════════════════════════════════════════
// PUSHMELDINGEN NAAR ADMINS
// Triggert automatisch bij nieuwe contactberichten
// en nieuwe accountaanvragen.
// ═══════════════════════════════════════════════

async function notifyAdmins(title, body, clickUrl) {
    const db = getFirestore();
    const usersSnap = await db.collection('users')
        .where('permissions', 'array-contains', 'admin')
        .get();

    await sendPushToUserDocs(db, usersSnap.docs, title, body, clickUrl);
}

exports.onNewContactBericht = onDocumentCreated(
    { document: 'contactberichten/{id}', region: 'europe-west1' },
    async (event) => {
        const d = event.data.data();
        await notifyAdmins(
            '📩 Nieuw contactbericht',
            `${d.email}: ${(d.bericht || '').slice(0, 100)}`,
            'https://vvsrotselaar.be/admin.html'
        );
    }
);

exports.onNewAccountRequest = onDocumentCreated(
    { document: 'account_requests/{id}', region: 'europe-west1' },
    async (event) => {
        const d = event.data.data();
        await notifyAdmins(
            '👤 Nieuwe accountaanvraag',
            `${d.naam || d.name || 'Iemand'} vraagt een account aan`,
            'https://vvsrotselaar.be/admin.html'
        );
    }
);

// ═══════════════════════════════════════════════
// HERINNERING AANWEZIGHEID (ZONDAG/ZATERDAG/VETERANEN)
// Draait elke dag om 09:00 (Brussel). Voor elk team wordt de
// eerstvolgende wedstrijd opgezocht; valt die over exact 3 dagen,
// dan krijgen teamleden die nog niets hebben aangeduid in
// matches/{id}/availability EN pushSettings.reminder === true
// een herinneringsmelding. Werkt automatisch voor alle teams en
// past zich vanzelf aan als een wedstrijd verzet wordt, in plaats
// van vaste dagen (woensdag/donderdag) te hardcoden.
// ═══════════════════════════════════════════════

const REMINDER_DAYS_BEFORE = 3;
const TEAMS = ['zaterdag', 'zondag', 'veteranen'];

function startOfBrusselsDay(date) {
    // Vergelijkt enkel kalenderdagen (Brusselse tijdzone), niet exacte uren
    const brusselsStr = date.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }); // YYYY-MM-DD
    return brusselsStr;
}

function daysBetween(dateStrA, dateStrB) {
    const a = new Date(dateStrA + 'T00:00:00Z');
    const b = new Date(dateStrB + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
}

exports.sendAvailabilityReminders = onSchedule(
    { schedule: '0 9 * * *', timeZone: 'Europe/Brussels', region: 'europe-west1' },
    async () => {
        const db = getFirestore();
        const todayStr = startOfBrusselsDay(new Date());

        for (const team of TEAMS) {
            try {
                // Eerstvolgende (nog niet gespeelde) wedstrijd van dit team, op datum gesorteerd
                const matchesSnap = await db.collection('matches')
                    .where('team', '==', team)
                    .where('datum', '>=', todayStr)
                    .orderBy('datum', 'asc')
                    .limit(1)
                    .get();

                if (matchesSnap.empty) continue;

                const matchDoc = matchesSnap.docs[0];
                const match    = matchDoc.data();
                const diff     = daysBetween(todayStr, match.datum);

                if (diff !== REMINDER_DAYS_BEFORE) continue;

                // Alle teamleden ophalen
                const membersSnap = await db.collection('users')
                    .where('team', 'array-contains', team)
                    .get();

                if (membersSnap.empty) continue;

                // Wie heeft al aan-/afwezigheid doorgegeven?
                const availabilitySnap = await db.collection('matches')
                    .doc(matchDoc.id)
                    .collection('availability')
                    .get();
                const respondedUids = new Set(availabilitySnap.docs.map(d => d.id));

                const toRemind = membersSnap.docs.filter(docSnap => {
                    if (respondedUids.has(docSnap.id)) return false;
                    return docSnap.data()?.pushSettings?.reminder === true;
                });

                if (toRemind.length === 0) {
                    console.log(`[reminder] ${team}: iedereen heeft al gereageerd of niemand heeft herinneringen aan.`);
                    continue;
                }

                const home = match.thuisploeg || 'Thuis';
                const away = match.uitploeg || 'Uit';

                await sendPushToUserDocs(
                    db,
                    toRemind,
                    '🔔 Geef je aanwezigheid door',
                    `${home} - ${away}: je hebt nog niet aangeduid of je aanwezig bent.`,
                    `https://vvsrotselaar.be/${team}.html`
                );

                console.log(`[reminder] ${team}: ${toRemind.length} herinnering(en) verstuurd.`);
            } catch (err) {
                console.error(`[reminder] Fout bij team ${team}:`, err);
            }
        }
    }
);

// ═══════════════════════════════════════════════
// LIVE WEDSTRIJDMELDINGEN
// Triggert telkens er tijdens een live wedstrijd een event
// (doelpunt, owngoal, penalty, kaart) wordt toegevoegd door
// live.js. Stuurt naar iedereen die dit team heeft toegevoegd aan
// pushSettings.liveTeams — los van teamlidmaatschap: je kan dit
// aanzetten voor eender welke ploeg, ook een ploeg waar je zelf
// niet in speelt.
// ═══════════════════════════════════════════════

const LIVE_NOTIFY_TYPES = new Set(['goal', 'own-goal', 'penalty', 'yellow', 'yellow2red', 'red']);

function formatLiveEventText(event, match) {
    const home = match.thuisploeg || 'Thuis';
    const away = match.uitploeg || 'Uit';
    const speler = event.speler ? event.speler : '';

    switch (event.type) {
        case 'goal':
            return { title: '⚽ Doelpunt!', body: `${speler ? speler + ' scoort! ' : ''}${home} ${match.scoreThuis ?? ''} - ${match.scoreUit ?? ''} ${away}` };
        case 'penalty':
            return { title: '⚽ Penalty gescoord!', body: `${speler ? speler + ' scoort een penalty! ' : ''}${home} ${match.scoreThuis ?? ''} - ${match.scoreUit ?? ''} ${away}` };
        case 'own-goal':
            return { title: '⚽ Owngoal', body: `${home} ${match.scoreThuis ?? ''} - ${match.scoreUit ?? ''} ${away}` };
        case 'yellow':
            return { title: '🟨 Gele kaart', body: speler ? `${speler} krijgt geel.` : 'Een speler krijgt geel.' };
        case 'yellow2red':
            return { title: '🟨🟥 Tweede geel = rood', body: speler ? `${speler} moet van het veld.` : 'Een speler krijgt zijn tweede gele kaart.' };
        case 'red':
            return { title: '🟥 Rode kaart', body: speler ? `${speler} krijgt rood.` : 'Een speler krijgt rood.' };
        default:
            return null;
    }
}

exports.onLiveMatchEvent = onDocumentCreated(
    { document: 'matches/{matchId}/events/{eventId}', region: 'europe-west1' },
    async (event) => {
        const eventData = event.data.data();
        if (!LIVE_NOTIFY_TYPES.has(eventData.type)) return;

        const db = getFirestore();
        const matchId  = event.params.matchId;
        const matchSnap = await db.collection('matches').doc(matchId).get();
        if (!matchSnap.exists) return;
        const match = matchSnap.data();
        if (!match.team) return;

        const texts = formatLiveEventText(eventData, match);
        if (!texts) return;

        // Rechtstreeks filteren op wie deze ploeg als live-melding aanzette
        // (array-contains op de geneste pushSettings.liveTeams-lijst) —
        // geen teamlidmaatschap nodig, dit staat volledig los daarvan.
        const subscribersSnap = await db.collection('users')
            .where('pushSettings.liveTeams', 'array-contains', match.team)
            .get();
        if (subscribersSnap.empty) return;

        await sendPushToUserDocs(
            db,
            subscribersSnap.docs,
            texts.title,
            texts.body,
            `https://vvsrotselaar.be/${match.team}.html`
        );
    }
);

// ═══════════════════════════════════════════════
// 1) BETALING AANMAKEN
// ═══════════════════════════════════════════════
exports.createBancontactPayment = onRequest(
    {
        cors: true,
        secrets: [bancontactApiKey],
        region: 'europe-west1'
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const { amount } = req.body;

        if (!amount || typeof amount !== 'number' || amount < 1 || !Number.isInteger(amount)) {
            return res.status(400).json({ error: 'Ongeldig bedrag.' });
        }

        // Callback URL = de tweede Cloud Function hieronder
        // ⚠️ LET OP: dit is nog de OUDE us-central1 URL (herkenbaar aan "-uc.a.run.app").
        // Na de deploy naar europe-west1 krijgt deze functie een NIEUWE URL (die eindigt
        // op "-ew.a.run.app" i.p.v. "-uc.a.run.app"). Vervang de regel hieronder met die
        // nieuwe URL — zie stap 3 in de deploy-instructies.
        const callbackUrl = 'https://europe-west1-vvs-rotselaar-db.cloudfunctions.net/bancontactCallback';

        try {
            const response = await fetch('https://merchant.api.bancontact.net/v3/payments', {
                method: 'POST',
                headers: {
                    'Authorization': bancontactApiKey.value(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount,
                    currency: 'EUR',
                    description: 'VVS Rockwerchter',
                    callbackUrl
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('Bancontact API fout:', data);
                return res.status(response.status).json({ error: data.message || 'Bancontact API fout' });
            }

            const qrUrl = data._links?.qrcode?.href;
            if (!qrUrl) {
                return res.status(500).json({ error: 'Geen QR-code URL ontvangen' });
            }

            // Sla de betaling op in Firestore met status PENDING
            const db = getFirestore();
            await db.collection('rw_payments').doc(data.paymentId).set({
                paymentId:   data.paymentId,
                amount,
                status:      'PENDING',
                aangemaakt:  new Date()
            });

            return res.status(200).json({
                paymentId: data.paymentId,
                qrUrl
            });

        } catch (e) {
            console.error('Onverwachte fout:', e);
            return res.status(500).json({ error: 'Interne serverfout' });
        }
    }
);

// ═══════════════════════════════════════════════
// 2) CALLBACK VAN BANCONTACT
// Bancontact roept deze URL aan als de betaling
// voltooid, mislukt of geannuleerd is.
// ═══════════════════════════════════════════════
exports.bancontactCallback = onRequest(
    {
        cors: false,
        region: 'europe-west1'
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).send('Method not allowed');
        }

        try {
            const { paymentId, status } = req.body;

            if (!paymentId || !status) {
                return res.status(400).send('Ontbrekende velden');
            }

            console.log(`Callback ontvangen: ${paymentId} → ${status}`);

            // Update de status in Firestore
            // rockwerchter.js luistert realtime naar dit document
            const db = getFirestore();
            await db.collection('rw_payments').doc(paymentId).update({
                status,
                bijgewerkt: new Date()
            });

            return res.status(200).send('OK');

        } catch (e) {
            console.error('Callback fout:', e);
            return res.status(500).send('Interne fout');
        }
    }
);

exports.calendarFeed = require('./calendarFeed').calendarFeed;