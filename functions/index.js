const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const bancontactApiKey = defineSecret('BANCONTACT_API_KEY');

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

    const tokens = [];
    usersSnap.forEach(doc => {
        const data = doc.data();
        if (Array.isArray(data.fcmTokens)) tokens.push(...data.fcmTokens);
    });
    if (tokens.length === 0) {
        console.log('Geen admin-tokens gevonden, geen pushmelding verstuurd.');
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
        usersSnap.forEach(docSnap => {
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