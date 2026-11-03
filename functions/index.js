const { onRequest } = require('firebase-functions/v2/https');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const bancontactApiKey = defineSecret('BANCONTACT_API_KEY');

const PUBLIC_TEAMS = ['veteranen', 'zaterdag', 'zondag'];
const MAX_BATCH_WRITES = 400;

async function calculateRockWerchterOrder(itemCounts) {
    if (!itemCounts || typeof itemCounts !== 'object' || Array.isArray(itemCounts)) {
        throw new HttpsError('invalid-argument', 'Ongeldige bestelling.');
    }

    const requested = Object.entries(itemCounts);
    if (requested.length === 0 || requested.length > 50) {
        throw new HttpsError('invalid-argument', 'Kies minstens één product.');
    }

    const db = getFirestore();
    const catalogSnap = await db.collection('rw_items').get();
    const catalog = new Map();
    catalogSnap.docs.forEach(itemDoc => {
        const item = itemDoc.data();
        if (item.actief !== false && typeof item.naam === 'string' && item.naam) {
            if (catalog.has(item.naam)) {
                throw new HttpsError('failed-precondition', `Dubbel product in drankkaart: ${item.naam}.`);
            }
            catalog.set(item.naam, item);
        }
    });

    const cart = Object.create(null);
    const items = Object.create(null);
    let amountCents = 0;
    let itemCount = 0;
    for (const [name, count] of requested) {
        const item = catalog.get(name);
        if (!item || name.length > 100 || !Number.isInteger(count) || count < 1 || count > 100) {
            throw new HttpsError('invalid-argument', 'Bestelling bevat een onbekend product of ongeldig aantal.');
        }
        if (!Number.isFinite(item.prijs)) {
            throw new HttpsError('failed-precondition', `Ongeldige prijs ingesteld voor ${name}.`);
        }

        const priceCents = Math.round(item.prijs * 100);
        if (priceCents < -100000 || priceCents > 1000000) {
            throw new HttpsError('failed-precondition', `Ongeldige prijs ingesteld voor ${name}.`);
        }
        const subtotalCents = priceCents * count;
        cart[name] = count;
        items[name] = {
            count,
            prijs: priceCents / 100,
            subtotaal: subtotalCents / 100,
        };
        amountCents += subtotalCents;
        itemCount += count;
    }

    for (const [name, count] of requested) {
        const item = catalog.get(name);
        const requiredItems = Array.isArray(item.vereistItems)
            ? item.vereistItems
            : (item.vereistItem ? [item.vereistItem] : []);
        if (count > 0 && requiredItems.some(required => !cart[required])) {
            throw new HttpsError('failed-precondition', `${name} vereist een ander product in de bestelling.`);
        }
    }

    if (amountCents <= 0 || amountCents > 1000000 || itemCount > 500) {
        throw new HttpsError('invalid-argument', 'Het totaalbedrag of aantal producten is ongeldig.');
    }

    const sortedCart = Object.fromEntries(Object.entries(cart).sort(([a], [b]) => a.localeCompare(b)));
    return {
        cart: sortedCart,
        items: Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b))),
        aantalItems: itemCount,
        amountCents,
        totaal: amountCents / 100,
    };
}

function publicPlayerProfile(userData) {
    const permissions = Array.isArray(userData.permissions) ? userData.permissions : [];
    const teams = Array.isArray(userData.team)
        ? userData.team.filter(team => PUBLIC_TEAMS.includes(team))
        : [];

    if (!userData.name || teams.length === 0 ||
        permissions.some(permission => ['supporter', 'tijdelijk', 'extern'].includes(permission))) {
        return null;
    }

    const stats = userData.stats || {};
    const asCount = (...values) => {
        const value = values.find(Number.isFinite);
        return value !== undefined && value >= 0 ? value : 0;
    };

    return {
        name: String(userData.name).slice(0, 100),
        team: teams,
        stats: {
            goals: asCount(stats.goals, userData.goals, userData.Goals),
            assists: asCount(stats.assists, userData.assists, userData.Assists),
            matches: asCount(stats.matches, stats.matchen, userData.matches, userData.matchen),
            minutes: asCount(stats.minutes, stats.minuten, userData.minutes, userData.minuten),
            yellowCard: asCount(stats.yellowCard, stats.geelKaarten, userData.yellowCard, userData.geelKaarten),
            redCard: asCount(stats.redCard, stats.roodKaarten, userData.redCard, userData.roodKaarten),
            motmPoints: asCount(stats.motmPoints, userData.motmPoints),
        },
    };
}

exports.syncPublicPlayerProfile = onDocumentWritten(
    { document: 'users/{uid}', region: 'europe-west1' },
    async event => {
        const db = getFirestore();
        const publicRef = db.collection('public_profiles').doc(event.params.uid);
        const after = event.data?.after;
        if (!after?.exists) {
            await publicRef.delete();
            return;
        }

        const profile = publicPlayerProfile(after.data());
        if (!profile) {
            await publicRef.delete();
            return;
        }
        await publicRef.set(profile);
    }
);

exports.updateEventRegistrationCount = onDocumentWritten(
    { document: 'evenementen/{eventId}/inschrijvingen/{uid}', region: 'europe-west1' },
    async event => {
        const db = getFirestore();
        const eventRef = db.collection('evenementen').doc(event.params.eventId);
        const eventSnap = await eventRef.get();
        if (!eventSnap.exists) return;

        const countSnap = await event.data.after.ref.parent.count().get();
        await eventRef.set({ inschrijvingenCount: countSnap.data().count }, { merge: true });
    }
);

exports.rebuildPublicPlayerProfiles = onCall(
    { region: 'europe-west1', timeoutSeconds: 300 },
    async request => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Log in als beheerder.');

        const db = getFirestore();
        const caller = await db.collection('users').doc(request.auth.uid).get();
        const permissions = caller.exists && Array.isArray(caller.data().permissions)
            ? caller.data().permissions : [];
        if (!permissions.includes('admin') || permissions.includes('supporter')) {
            throw new HttpsError('permission-denied', 'Alleen beheerders mogen publieke profielen synchroniseren.');
        }

        const [usersSnap, publicSnap, eventsSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection('public_profiles').get(),
            db.collection('evenementen').get(),
        ]);
        const desired = new Map();
        usersSnap.docs.forEach(userDoc => {
            const profile = publicPlayerProfile(userDoc.data());
            if (profile) desired.set(userDoc.id, profile);
        });

        const writes = [];
        const existingProfiles = new Map(publicSnap.docs.map(doc => [doc.id, doc.data()]));
        desired.forEach((profile, uid) => {
            if (JSON.stringify(existingProfiles.get(uid)) !== JSON.stringify(profile)) {
                writes.push({ type: 'set', ref: db.collection('public_profiles').doc(uid), profile });
            }
        });
        publicSnap.docs.forEach(profileDoc => {
            if (!desired.has(profileDoc.id)) writes.push({ type: 'delete', ref: profileDoc.ref });
        });

        for (let i = 0; i < writes.length; i += MAX_BATCH_WRITES) {
            const batch = db.batch();
            writes.slice(i, i + MAX_BATCH_WRITES).forEach(write => {
                if (write.type === 'set') batch.set(write.ref, write.profile);
                else batch.delete(write.ref);
            });
            await batch.commit();
        }

        await Promise.all(eventsSnap.docs.map(async eventDoc => {
            const countSnap = await eventDoc.ref.collection('inschrijvingen').count().get();
            if (eventDoc.data().inschrijvingenCount !== countSnap.data().count) {
                await eventDoc.ref.update({ inschrijvingenCount: countSnap.data().count });
            }
        }));

        return { synchronized: desired.size, removed: writes.filter(write => write.type === 'delete').length };
    }
);

exports.updateShiftSignup = onCall(
    { region: 'europe-west1' },
    async request => {
        const uid = request.auth?.uid;
        const { werklijstId, shiftId, responsible = false, signedUp } = request.data || {};
        if (!uid) throw new HttpsError('unauthenticated', 'Log in om je aan te melden.');
        if (typeof werklijstId !== 'string' || !werklijstId ||
            typeof shiftId !== 'string' || !shiftId ||
            typeof responsible !== 'boolean' || typeof signedUp !== 'boolean') {
            throw new HttpsError(
                'invalid-argument',
                'Vernieuw de pagina en probeer opnieuw.'
            );
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(uid);
        const listRef = db.collection('werklijsten').doc(werklijstId);
        const shiftRef = listRef.collection('shifts').doc(shiftId);

        await db.runTransaction(async transaction => {
            const [userSnap, listSnap, shiftSnap] = await Promise.all([
                transaction.get(userRef),
                transaction.get(listRef),
                transaction.get(shiftRef),
            ]);
            if (!userSnap.exists) throw new HttpsError('permission-denied', 'Gebruikersprofiel niet gevonden.');

            const userData = userSnap.data();
            const permissions = Array.isArray(userData.permissions) ? userData.permissions : [];
            if (permissions.includes('supporter') ||
                (permissions.includes('extern') && !permissions.includes('werken'))) {
                throw new HttpsError('permission-denied', 'Je hebt geen toegang tot deze werklijst.');
            }
            if (!listSnap.exists) {
                throw new HttpsError('failed-precondition', 'Deze werklijst is niet actief.');
            }
            if (listSnap.data().locked === true) {
                throw new HttpsError('failed-precondition', 'Deze werklijst is vergrendeld.');
            }
            if (!shiftSnap.exists) throw new HttpsError('not-found', 'Deze shift bestaat niet meer.');

            const shift = shiftSnap.data();
            const persons = Array.isArray(shift.persons) ? shift.persons : [];
            const currentIndex = persons.findIndex(person => person.uid === uid);
            if (!listSnap.data().active && signedUp) {
                throw new HttpsError('failed-precondition', 'Deze werklijst is niet actief.');
            }
            if (!signedUp) {
                if (currentIndex < 0) return;
                transaction.update(shiftRef, {
                    persons: persons.filter(person => person.uid !== uid),
                });
                return;
            }
            if (currentIndex >= 0) return;

            if (responsible && (shift.section === 'special' ||
                (shift.requireResponsible === false) ||
                persons.some(person => person.responsible === true))) {
                throw new HttpsError('failed-precondition', 'Deze shift kan niet als verantwoordelijke worden gekozen.');
            }
            const max = shift.max;
            if (shift.hardLimit === true && Number.isFinite(max) && max >= 0 && persons.length >= max) {
                throw new HttpsError('resource-exhausted', 'Deze shift is vol.');
            }
            if (persons.length >= 500) {
                throw new HttpsError('resource-exhausted', 'Deze shift heeft het maximumaantal deelnemers bereikt.');
            }

            const name = typeof userData.name === 'string' && userData.name.trim()
                ? userData.name.trim().slice(0, 100)
                : typeof userData.email === 'string' ? userData.email.slice(0, 100) : 'Vrijwilliger';
            transaction.update(shiftRef, {
                persons: [...persons, { uid, name, naam: name, responsible }],
            });
        });

        return { success: true };
    }
);

exports.updateTrainingSignup = onCall(
    { region: 'europe-west1' },
    async request => {
        const uid = request.auth?.uid;
        const trainingId = request.data?.trainingId;
        if (!uid) throw new HttpsError('unauthenticated', 'Log in om je aan te melden.');
        if (typeof trainingId !== 'string' || !trainingId) {
            throw new HttpsError('invalid-argument', 'Ongeldige training.');
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(uid);
        const trainingRef = db.collection('trainingen').doc(trainingId);
        let signedUp = false;
        await db.runTransaction(async transaction => {
            const [userSnap, trainingSnap] = await Promise.all([
                transaction.get(userRef),
                transaction.get(trainingRef),
            ]);
            if (!userSnap.exists) throw new HttpsError('permission-denied', 'Gebruikersprofiel niet gevonden.');
            const permissions = Array.isArray(userSnap.data().permissions) ? userSnap.data().permissions : [];
            if (permissions.includes('supporter')) {
                throw new HttpsError('permission-denied', 'Supporteraccounts kunnen zich niet aanmelden voor trainingen.');
            }
            if (!trainingSnap.exists || trainingSnap.data().type === 'other') {
                throw new HttpsError('not-found', 'Deze training bestaat niet meer.');
            }

            const training = trainingSnap.data();
            const attendees = Array.isArray(training.aanwezigen) ? training.aanwezigen : [];
            const currentIndex = attendees.findIndex(person => person?.uid === uid);
            if (currentIndex >= 0) {
                attendees.splice(currentIndex, 1);
                signedUp = false;
            } else {
                if (attendees.length >= 500) {
                    throw new HttpsError('resource-exhausted', 'Deze training heeft het maximumaantal deelnemers bereikt.');
                }
                const user = userSnap.data();
                const name = typeof user.name === 'string' && user.name.trim()
                    ? user.name.trim().slice(0, 100)
                    : typeof user.email === 'string' ? user.email.slice(0, 100) : 'Lid';
                attendees.push({ uid, name, naam: name });
                signedUp = true;
            }
            transaction.update(trainingRef, { aanwezigen: attendees });
        });

        return { signedUp };
    }
);

exports.revealMotmResults = onCall(
    { region: 'europe-west1' },
    async request => {
        const uid = request.auth?.uid;
        const matchId = request.data?.matchId;
        if (!uid) throw new HttpsError('unauthenticated', 'Log in om de uitslag bekend te maken.');
        if (typeof matchId !== 'string' || !matchId) {
            throw new HttpsError('invalid-argument', 'Ongeldige wedstrijd.');
        }

        const db = getFirestore();
        const matchRef = db.collection('matches').doc(matchId);
        const [callerSnap, matchSnap] = await Promise.all([
            db.collection('users').doc(uid).get(),
            matchRef.get(),
        ]);
        if (!callerSnap.exists || !matchSnap.exists) {
            throw new HttpsError('not-found', 'Gebruiker of wedstrijd niet gevonden.');
        }

        const caller = callerSnap.data();
        const permissions = Array.isArray(caller.permissions) ? caller.permissions : [];
        const match = matchSnap.data();
        const canReveal = !permissions.includes('supporter') && (
            permissions.includes('admin') ||
            permissions.includes('score_invullen') ||
            (match.aangeduidePersonen || []).includes(uid) ||
            permissions.includes(`afgevaardigde:${match.team}`) ||
            permissions.includes('afgevaardigde:*')
        );
        if (!canReveal) throw new HttpsError('permission-denied', 'Je mag deze uitslag niet bekendmaken.');
        if (match.status !== 'finished') {
            throw new HttpsError('failed-precondition', 'De wedstrijd is nog niet afgelopen.');
        }
        if (match.motmResults) {
            throw new HttpsError('already-exists', 'De uitslag is al bekendgemaakt.');
        }

        const candidateUids = Array.isArray(match.motmCandidateUids)
            ? [...new Set(match.motmCandidateUids.filter(candidate => typeof candidate === 'string' && !candidate.startsWith('manual_')))]
            : [];
        if (candidateUids.length === 0) {
            throw new HttpsError('failed-precondition', 'Er zijn geen geldige kandidaten voor deze wedstrijd.');
        }

        const votesSnap = await matchRef.collection('motm').get();
        const voterSnaps = await Promise.all(votesSnap.docs.map(voteDoc =>
            db.collection('users').doc(voteDoc.id).get()
        ));
        const tally = new Map();
        votesSnap.docs.forEach((voteDoc, index) => {
            const voterSnap = voterSnaps[index];
            const voter = voterSnap.exists ? voterSnap.data() : null;
            const voterPermissions = Array.isArray(voter?.permissions) ? voter.permissions : [];
            const isSupporter = voterPermissions.includes('supporter');
            const isEligible = isSupporter
                ? Array.isArray(voter.team) && voter.team.includes(match.team)
                : (match.motmEligibleUids || []).includes(voteDoc.id) ||
                    voterPermissions.includes(`afgevaardigde:${match.team}`) ||
                    voterPermissions.includes('afgevaardigde:*');
            const picks = voteDoc.data().votes;
            if (!isEligible || !Array.isArray(picks) || picks.length < 1 || picks.length > 3) return;

            const seenUids = new Set();
            const seenRanks = new Set();
            picks.forEach(pick => {
                if (!pick || typeof pick.uid !== 'string' || pick.uid === voteDoc.id ||
                    !candidateUids.includes(pick.uid) || ![1, 2, 3].includes(pick.rank) ||
                    seenUids.has(pick.uid) || seenRanks.has(pick.rank)) return;

                seenUids.add(pick.uid);
                seenRanks.add(pick.rank);
                const points = 4 - pick.rank;
                tally.set(pick.uid, (tally.get(pick.uid) || 0) + points);
            });
        });

        const ranked = [...tally.entries()]
            .map(([candidateUid, points]) => ({ uid: candidateUid, points }))
            .sort((a, b) => b.points - a.points || a.uid.localeCompare(b.uid))
            .slice(0, 3);
        if (ranked.length === 0) {
            throw new HttpsError('failed-precondition', 'Er zijn nog geen geldige stemmen uitgebracht.');
        }

        const profileSnaps = await Promise.all(ranked.map(result =>
            db.collection('public_profiles').doc(result.uid).get()
        ));
        const top3 = ranked.map((result, index) => ({
            ...result,
            name: profileSnaps[index].exists ? profileSnaps[index].data().name : 'Onbekende speler',
        }));
        const revealedAt = new Date().toISOString();
        const resultUserRefs = top3.map(result => db.collection('users').doc(result.uid));

        await db.runTransaction(async transaction => {
            const freshMatch = await transaction.get(matchRef);
            if (!freshMatch.exists || freshMatch.data().motmResults) {
                throw new HttpsError('already-exists', 'De uitslag is ondertussen al bekendgemaakt.');
            }
            const userSnaps = await Promise.all(resultUserRefs.map(ref => transaction.get(ref)));
            transaction.update(matchRef, { motmResults: top3, motmRevealedAt: revealedAt });
            userSnaps.forEach((userSnap, index) => {
                if (!userSnap.exists) return;
                const points = [3, 2, 1][index];
                transaction.update(resultUserRefs[index], {
                    'stats.motmPoints': FieldValue.increment(points),
                    'stats.motmHistory': FieldValue.arrayUnion({
                        matchId,
                        datum: match.datum,
                        positie: index + 1,
                        punten: points,
                        team: match.team,
                    }),
                });
            });
        });

        return { top3, revealedAt };
    }
);

exports.createRockWerchterOrder = onCall(
    { region: 'europe-west1' },
    async request => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Log in om een bestelling te plaatsen.');

        const db = getFirestore();
        const userSnap = await db.collection('users').doc(uid).get();
        if (!userSnap.exists) throw new HttpsError('permission-denied', 'Gebruikersprofiel niet gevonden.');
        const user = userSnap.data();
        const permissions = Array.isArray(user.permissions) ? user.permissions : [];
        if (permissions.includes('supporter')) {
            throw new HttpsError('permission-denied', 'Supporteraccounts kunnen geen bestellingen plaatsen.');
        }
        if ((permissions.includes('tijdelijk') || permissions.includes('extern')) &&
            !permissions.includes('rockwerchter') && !permissions.includes('werken')) {
            throw new HttpsError('permission-denied', 'Je hebt geen toegang tot bestellingen.');
        }

        const data = request.data || {};
        const method = data.betaalmethode;
        const extra = data.extra || {};
        if (!['kaart', 'bancontact', 'cash'].includes(method) ||
            typeof extra !== 'object' || Array.isArray(extra)) {
            throw new HttpsError('invalid-argument', 'Ongeldige betaalgegevens.');
        }
        const allowedExtraKeys = ['status', 'terminal', 'bancontactPaymentId', 'ontvangen', 'wisselgeld'];
        if (Object.keys(extra).some(key => !allowedExtraKeys.includes(key))) {
            throw new HttpsError('invalid-argument', 'Onverwachte betaalgegevens.');
        }

        const order = await calculateRockWerchterOrder(data.items);
        const status = extra.status || 'geslaagd';
        if (!['geslaagd', 'manueel bevestigd'].includes(status)) {
            throw new HttpsError('invalid-argument', 'Ongeldige betaalstatus.');
        }
        if (extra.terminal !== undefined &&
            (typeof extra.terminal !== 'string' || extra.terminal.length > 50)) {
            throw new HttpsError('invalid-argument', 'Ongeldige terminal.');
        }
        if (extra.bancontactPaymentId !== undefined &&
            (typeof extra.bancontactPaymentId !== 'string' || !extra.bancontactPaymentId ||
                extra.bancontactPaymentId.length > 200)) {
            throw new HttpsError('invalid-argument', 'Ongeldige Bancontactreferentie.');
        }

        if (method === 'cash') {
            if (!Number.isFinite(extra.ontvangen) || extra.ontvangen < order.totaal ||
                !Number.isFinite(extra.wisselgeld) || extra.wisselgeld < 0 ||
                Math.round((extra.ontvangen - order.totaal) * 100) !== Math.round(extra.wisselgeld * 100)) {
                throw new HttpsError('invalid-argument', 'Het ontvangen bedrag of wisselgeld klopt niet.');
            }
        } else if (extra.ontvangen !== undefined || extra.wisselgeld !== undefined) {
            throw new HttpsError('invalid-argument', 'Contante betaalgegevens horen alleen bij cashbetalingen.');
        }
        if (method !== 'bancontact' && status !== 'geslaagd') {
            throw new HttpsError('invalid-argument', 'Ongeldige betaalstatus voor deze betaalmethode.');
        }

        const paymentId = extra.bancontactPaymentId;
        if (method === 'bancontact' && status === 'geslaagd' && typeof paymentId !== 'string') {
            throw new HttpsError('failed-precondition', 'De Bancontactbetaling is niet bevestigd.');
        }
        if (method !== 'bancontact' && paymentId !== undefined) {
            throw new HttpsError('invalid-argument', 'Onverwachte Bancontactreferentie.');
        }
        if (method === 'bancontact' && status === 'manueel bevestigd' &&
            !permissions.some(permission => ['admin', 'rockwerchter', 'werken'].includes(permission))) {
            throw new HttpsError('permission-denied', 'Alleen bevoegde medewerkers mogen een betaling manueel bevestigen.');
        }

        const orderRef = db.collection('rockwerchter_bestellingen').doc();
        const paymentRef = paymentId ? db.collection('rw_payments').doc(paymentId) : null;
        const privatePaymentRef = paymentId ? db.collection('rw_payment_private').doc(paymentId) : null;
        await db.runTransaction(async transaction => {
            let paymentSnap = null;
            let privatePaymentSnap = null;
            if (paymentRef) {
                [paymentSnap, privatePaymentSnap] = await Promise.all([
                    transaction.get(paymentRef),
                    transaction.get(privatePaymentRef),
                ]);
            }
            if (paymentSnap) {
                if (!paymentSnap.exists || !privatePaymentSnap.exists) {
                    throw new HttpsError('failed-precondition', 'De Bancontactbetaling bestaat niet.');
                }
                const payment = paymentSnap.data();
                const privatePayment = privatePaymentSnap.data();
                const sameCart = privatePayment.cart &&
                    JSON.stringify(Object.fromEntries(Object.entries(privatePayment.cart).sort(([a], [b]) => a.localeCompare(b)))) ===
                    JSON.stringify(order.cart);
                if (payment.status !== 'SUCCEEDED' || payment.amount !== order.amountCents ||
                    !sameCart || privatePayment.uid !== uid || payment.orderId) {
                    throw new HttpsError('failed-precondition', 'De Bancontactbetaling ontbreekt, is ongeldig of werd al gebruikt.');
                }
            }

            const orderData = {
                userId: uid,
                userName: typeof user.name === 'string' ? user.name.slice(0, 100) : 'Lid',
                items: order.items,
                aantalItems: order.aantalItems,
                totaal: order.totaal,
                betaalmethode: method,
                datum: FieldValue.serverTimestamp(),
                status,
            };
            if (typeof extra.terminal === 'string' && extra.terminal.length <= 50) {
                orderData.terminal = extra.terminal;
            }
            if (paymentId) orderData.bancontactPaymentId = paymentId;
            if (method === 'cash') {
                orderData.ontvangen = extra.ontvangen;
                orderData.wisselgeld = extra.wisselgeld || 0;
            }

            transaction.create(orderRef, orderData);
            if (paymentRef) transaction.update(paymentRef, { orderId: orderRef.id });
        });

        return { id: orderRef.id, totaal: order.totaal };
    }
);

// ═══════════════════════════════════════════════
// GEDEELDE PUSH-VERSTUURFUNCTIE
// Verstuurt een pushmelding naar een reeks user-documenten
// (elk met .data().fcmTokens en .ref) en kuist ongeldige/
// verlopen tokens meteen op. Gebruikt door zowel de
// admin-meldingen als de leden-meldingen hieronder.
//
// "extra" is optioneel en wordt ongewijzigd meegestuurd in het
// data-payload (bv. { tag, groupTitle } voor live wedstrijdmeldingen,
// zodat de service worker events van dezelfde wedstrijd kan groeperen
// tot één uitklapbare melding i.p.v. een aparte melding per event).
// Alle waarden in "extra" moeten strings zijn (FCM data-veld eist dat).
// ═══════════════════════════════════════════════

async function sendPushToUserDocs(db, userDocs, title, body, clickUrl, extra = {}) {
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
            ...extra,
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
// MAN VAN DE MATCH STEMMING
// Zodra een wedstrijd afgelopen is, mogen de spelers die effectief
// speelden en de afgevaardigde van die ploeg stemmen. Dezelfde
// stemgerechtigden krijgen een pushmelding als ze een FCM-token hebben.
// ═══════════════════════════════════════════════

exports.onMotmVotingOpened = onDocumentWritten(
    { document: 'matches/{matchId}', region: 'europe-west1', retry: true },
    async (event) => {
        const before = event.data.before.exists ? event.data.before.data() : null;
        const matchSnap = event.data.after;
        if (!matchSnap.exists) return;

        const match = matchSnap.data();
        if (before?.status === 'finished' || match.status !== 'finished' || match.motmResults) return;
        if (!['zaterdag', 'zondag', 'veteranen'].includes(match.team)) return;

        const db = getFirestore();
        const matchRef = db.collection('matches').doc(event.params.matchId);
        const playerMinutesSnap = await matchRef.collection('playerMinutes').get();
        const candidateUids = new Set(
            Object.entries(match.lineup || {})
                .filter(([uid, player]) => !uid.startsWith('manual_') && player.status === 'starter')
                .map(([uid]) => uid)
        );
        const eligibleUids = new Set(candidateUids);
        playerMinutesSnap.docs.forEach(playerDoc => {
            if (!playerDoc.id.startsWith('manual_')) {
                candidateUids.add(playerDoc.id);
                eligibleUids.add(playerDoc.id);
            }
        });

        const [teamDelegates, allDelegates] = await Promise.all([
            db.collection('users').where('permissions', 'array-contains', `afgevaardigde:${match.team}`).get(),
            db.collection('users').where('permissions', 'array-contains', 'afgevaardigde:*').get()
        ]);
        teamDelegates.docs.forEach(userDoc => eligibleUids.add(userDoc.id));
        allDelegates.docs.forEach(userDoc => eligibleUids.add(userDoc.id));
        const eligibleUidList = [...eligibleUids];

        const claimed = await db.runTransaction(async transaction => {
            const freshSnap = await transaction.get(matchRef);
            if (!freshSnap.exists || freshSnap.data().motmPushSentAt) return false;

            const claim = freshSnap.data().motmPushClaim;
            if (claim && Date.now() - claim.createdAt < 10 * 60 * 1000) return false;

            transaction.update(matchRef, {
                motmCandidateUids: [...candidateUids],
                motmEligibleUids: eligibleUidList,
                motmPushClaim: { eventId: event.id, createdAt: Date.now() }
            });
            return true;
        });
        if (!claimed) return;

        try {
            const userDocs = await Promise.all(eligibleUidList.map(uid => db.collection('users').doc(uid).get()));
            const voters = userDocs.filter(userDoc => userDoc.exists);
            const home = match.thuisploeg || 'Thuis';
            const away = match.uitploeg || 'Uit';

            await sendPushToUserDocs(
                db,
                voters,
                '🏆 Stem op Man van de Match',
                `${home} - ${away}: de stemming is geopend. Breng je stem uit!`,
                `https://vvsrotselaar.be/${match.team}.html?motm=${event.params.matchId}`
            );
            await matchRef.update({
                motmPushSentAt: FieldValue.serverTimestamp(),
                motmPushClaim: FieldValue.delete()
            });
        } catch (err) {
            try {
                await matchRef.update({ motmPushClaim: FieldValue.delete() });
            } catch (releaseErr) {
                console.error('[motm] Pushclaim vrijgeven mislukt:', releaseErr);
            }
            throw err;
        }
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
// (aftrap, doelpunt, owngoal, penalty, kaart, einde) wordt
// toegevoegd door live.js/admin.js. Stuurt naar iedereen die dit
// team heeft toegevoegd aan pushSettings.liveTeams — los van
// teamlidmaatschap: je kan dit aanzetten voor eender welke ploeg,
// ook een ploeg waar je zelf niet in speelt.
//
// Alle events van dezelfde wedstrijd krijgen dezelfde "tag"
// (live-{matchId}) en een vaste "groupTitle" ({thuis} - {uit}) mee
// in het data-payload. De service worker gebruikt dat om ze te
// bundelen tot één (groeiende, uitklapbare) melding per wedstrijd
// i.p.v. een aparte melding per event.
// ═══════════════════════════════════════════════

const LIVE_NOTIFY_TYPES = new Set(['aftrap', 'goal', 'own-goal', 'penalty', 'yellow', 'yellow2red', 'red', 'einde']);

function formatLiveEventText(event, match) {
    const home = match.thuisploeg || 'Thuis';
    const away = match.uitploeg || 'Uit';
    const speler = event.speler || '';
    const min = event.minuut != null ? `${event.minuut}' ` : '';
    const scoreThuis = match.scoreThuis ?? 0;
    const scoreUit = match.scoreUit ?? 0;

    // Bouwt "Thuisploeg [x] - y Uitploeg", met vierkante haakjes rond de
    // score van de kant die net gescoord heeft (scoringSide: 'home' | 'away').
    function scoreline(scoringSide) {
        const h = scoringSide === 'home' ? `[${scoreThuis}]` : `${scoreThuis}`;
        const u = scoringSide === 'away' ? `[${scoreUit}]` : `${scoreUit}`;
        return `${home} ${h} - ${u} ${away}`;
    }

    switch (event.type) {
        case 'aftrap':
            return { title: '🏁 Aftrap', body: `🏁 Aftrap: ${home} - ${away}` };

        case 'goal':
            return { title: '⚽ Doelpunt!', body: `⚽ ${min}${speler || 'Doelpunt'} | ${scoreline(event.ploeg)}` };

        case 'penalty':
            return { title: '⚽ Penalty gescoord!', body: `⚽ ${min}${speler ? speler + ' (penalty)' : 'Penalty'} | ${scoreline(event.ploeg)}` };

        case 'own-goal': {
            // Bij een owngoal profiteert de tegenstander van de kant die de fout maakte
            const benefiting = event.ploeg === 'home' ? 'away' : 'home';
            return { title: '⚽ Owngoal', body: `⚽ ${min}${speler ? speler + ' (eigen doelpunt)' : 'Eigen doelpunt'} | ${scoreline(benefiting)}` };
        }

        case 'yellow': {
            const teamNaam = event.ploeg === 'home' ? home : away;
            return {
                title: '🟨 Gele kaart',
                body: speler ? `🟨 ${min}${speler} (${teamNaam}) krijgt geel.` : `🟨 ${min}Een speler van ${teamNaam} krijgt geel.`
            };
        }

        case 'yellow2red': {
            const teamNaam = event.ploeg === 'home' ? home : away;
            return {
                title: '🟨🟥 Tweede geel = rood',
                body: speler ? `🟨🟥 ${min}${speler} (${teamNaam}) moet van het veld.` : `🟨🟥 ${min}Een speler van ${teamNaam} krijgt zijn tweede gele kaart.`
            };
        }

        case 'red': {
            const teamNaam = event.ploeg === 'home' ? home : away;
            return {
                title: '🟥 Rode kaart',
                body: speler ? `🟥 ${min}${speler} (${teamNaam}) krijgt rood.` : `🟥 ${min}Een speler van ${teamNaam} krijgt rood.`
            };
        }

        case 'einde':
            return { title: '🏁 Einde wedstrijd', body: `🏁 Einde: ${home} ${scoreThuis} - ${scoreUit} ${away}` };

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

        const home = match.thuisploeg || 'Thuis';
        const away = match.uitploeg || 'Uit';

        await sendPushToUserDocs(
            db,
            subscribersSnap.docs,
            texts.title,
            texts.body,
            `https://vvsrotselaar.be/${match.team}.html`,
            {
                tag: `live-${matchId}`,
                groupTitle: `${home} - ${away}`,
            }
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

        // Keep this URL aligned with the deployed callback function.
        const callbackUrl = 'https://europe-west1-vvs-rotselaar-db.cloudfunctions.net/bancontactCallback';

        try {
            const authorization = req.get('Authorization') || '';
            const tokenMatch = authorization.match(/^Bearer (.+)$/);
            if (!tokenMatch) {
                return res.status(401).json({ error: 'Log in om een Bancontactbetaling te starten.' });
            }

            let userId;
            try {
                userId = (await getAuth().verifyIdToken(tokenMatch[1])).uid;
            } catch (error) {
                return res.status(401).json({ error: 'Ongeldige inlogsessie.' });
            }

            const db = getFirestore();
            const userSnap = await db.collection('users').doc(userId).get();
            if (!userSnap.exists) {
                return res.status(403).json({ error: 'Gebruikersprofiel niet gevonden.' });
            }
            const permissions = Array.isArray(userSnap.data().permissions) ? userSnap.data().permissions : [];
            if (permissions.includes('supporter') ||
                ((permissions.includes('tijdelijk') || permissions.includes('extern')) &&
                    !permissions.includes('rockwerchter') && !permissions.includes('werken'))) {
                return res.status(403).json({ error: 'Je hebt geen toegang tot Bancontactbetalingen.' });
            }

            const order = await calculateRockWerchterOrder(req.body?.items);
            const amount = order.amountCents;
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
            if (typeof data.paymentId !== 'string' || !data.paymentId ||
                data.paymentId.includes('/') || typeof qrUrl !== 'string' || !qrUrl) {
                return res.status(502).json({ error: 'Ongeldige betalingsgegevens ontvangen' });
            }

            // Sla de betaling op in Firestore met status PENDING
            await db.collection('rw_payments').doc(data.paymentId).set({
                paymentId:   data.paymentId,
                amount,
                status:      'PENDING',
                aangemaakt:  new Date()
            });
            await db.collection('rw_payment_private').doc(data.paymentId).set({
                uid: userId,
                cart: order.cart,
                totaal: order.totaal,
            });

            return res.status(200).json({
                paymentId: data.paymentId,
                qrUrl,
                amount
            });

        } catch (e) {
            if (e instanceof HttpsError) {
                return res.status(400).json({ error: e.message });
            }
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
        secrets: [bancontactApiKey],
        region: 'europe-west1'
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).send('Method not allowed');
        }

        try {
            const paymentId = req.body?.paymentId;
            if (typeof paymentId !== 'string' || !paymentId || paymentId.length > 200 ||
                paymentId.includes('/')) {
                return res.status(400).send('Ontbrekende velden');
            }

            const db = getFirestore();
            const paymentRef = db.collection('rw_payments').doc(paymentId);
            const paymentSnap = await paymentRef.get();
            if (!paymentSnap.exists) {
                return res.status(404).send('Onbekende betaling');
            }

            const providerResponse = await fetch(
                `https://merchant.api.bancontact.net/v3/payments/${encodeURIComponent(paymentId)}`,
                {
                    method: 'GET',
                    headers: { 'Authorization': bancontactApiKey.value() }
                }
            );
            if (!providerResponse.ok) {
                console.error('Bancontact statuscontrole mislukt:', providerResponse.status);
                return res.status(502).send('Betalingsstatus kon niet worden gecontroleerd');
            }

            const providerPayment = await providerResponse.json();
            if ((providerPayment.paymentId !== undefined && providerPayment.paymentId !== paymentId) ||
                providerPayment.amount !== paymentSnap.data().amount ||
                !['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(providerPayment.status)) {
                console.error('Bancontact gaf ongeldige betalingsgegevens terug:', paymentId);
                return res.status(502).send('Ongeldige betalingsstatus');
            }

            await db.runTransaction(async transaction => {
                const currentSnap = await transaction.get(paymentRef);
                if (!currentSnap.exists) {
                    throw new HttpsError('not-found', 'Onbekende betaling');
                }
                const currentStatus = currentSnap.data().status;
                const cannotRegress = currentStatus === 'SUCCEEDED' ||
                    (['FAILED', 'CANCELLED', 'EXPIRED'].includes(currentStatus) && providerPayment.status === 'PENDING');
                transaction.update(paymentRef, {
                    status: cannotRegress ? currentStatus : providerPayment.status,
                    bijgewerkt: new Date()
                });
            });

            return res.status(200).send('OK');

        } catch (e) {
            console.error('Callback fout:', e);
            return res.status(500).send('Interne fout');
        }
    }
);

exports.calendarFeed = require('./calendarFeed').calendarFeed;