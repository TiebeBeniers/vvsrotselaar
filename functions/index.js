const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();

const bancontactApiKey = defineSecret('BANCONTACT_API_KEY');

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