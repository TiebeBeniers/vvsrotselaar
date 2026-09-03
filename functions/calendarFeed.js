// ════════════════════════════════════════════════════════════════
// calendarFeed.js — Live .ics-abonnementsfeed per team
// ════════════════════════════════════════════════════════════════
//
// Dit is de server-side helft van "Abonneren" in de kalender-dropdown.
// Apple Kalender, Outlook en Google Calendar kunnen zich abonneren op
// een URL die telkens verse .ics-inhoud teruggeeft. Zij halen die URL
// zelf periodiek opnieuw op (elke paar uur, interval bepaalt de
// kalender-app zelf — niet instant, maar wél automatisch).
//
// VEREIST:
//   - Firebase Functions (2nd gen) + firebase-admin
//   - firebase.json rewrite zodat /kalender/:team.ics naar deze
//     function wijst (zie onderaan dit bestand)
//
// INSTALLEREN:
//   cd functions && npm install firebase-functions firebase-admin
//
// DEPLOYEN:
//   firebase deploy --only functions:calendarFeed

const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) initializeApp();
const db = getFirestore();

const VALID_TEAMS = ['veteranen', 'zaterdag', 'zondag'];
const TEAM_LABELS = { veteranen: 'Veteranen', zaterdag: 'Zaterdagploeg', zondag: 'Zondagploeg' };
// Hardcoded i.p.v. afgeleid uit req.get('host'): via de Firebase Hosting ->
// Cloud Run rewrite komt daar soms de interne *.a.run.app-URL uit i.p.v. het
// echte domein. Dit is publieke, gedeelde inhoud — vaste waarde is veiliger.
const SITE_ORIGIN = 'https://vvsrotselaar.be';
const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

function pad2(n) { return String(n).padStart(2, '0'); }

function isBrusselsDST(y, m, d) {
    const lastSunday = (year, month) => {
        const last = new Date(Date.UTC(year, month + 1, 0));
        last.setUTCDate(last.getUTCDate() - last.getUTCDay());
        return last;
    };
    const dstStart = lastSunday(y, 2);
    const dstEnd   = lastSunday(y, 9);
    const check = new Date(Date.UTC(y, m, d));
    return check >= dstStart && check < dstEnd;
}

function brusselsToUtcDate(datumStr, uurStr) {
    const [y, mo, d] = (datumStr || '').split('-').map(Number);
    const [h, mi] = (uurStr || '00:00').split(':').map(Number);
    if (!y || !mo || !d) return new Date();
    const offset = isBrusselsDST(y, mo - 1, d) ? 2 : 1;
    return new Date(Date.UTC(y, mo - 1, d, (h || 0) - offset, mi || 0));
}

function formatIcsUtc(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function icsEscape(str) {
    return String(str || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function icsFold(line) {
    if (line.length <= 75) return line;
    let result = line.slice(0, 75);
    let rest = line.slice(75);
    while (rest.length > 0) {
        result += '\r\n ' + rest.slice(0, 74);
        rest = rest.slice(74);
    }
    return result;
}

function buildVEvent(match) {
    const start = brusselsToUtcDate(match.datum, match.uur || '00:00');
    const end   = new Date(start.getTime() + MATCH_DURATION_MS);
    const uid   = `match-${match.id}@vvsrotselaar.be`;
    const home  = match.thuisploeg || 'Thuis';
    const away  = match.uitploeg   || 'Uit';
    const summary = `⚽ ${home} vs ${away}`;
    const descParts = [];
    if (match.isBekermatch) descParts.push('Bekermatch');
    if (match.isForfait)    descParts.push('Forfait');
    if (match.beschrijving) descParts.push(match.beschrijving);
    descParts.push(`Volg live: ${SITE_ORIGIN}/live.html`);

    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        // DTSTAMP is het moment van *genereren* van de feed, niet van de wedstrijd zelf.
        // Kalender-apps gebruiken dit + de feed-refresh om te zien of er iets gewijzigd is.
        `DTSTAMP:${formatIcsUtc(new Date())}`,
        `DTSTART:${formatIcsUtc(start)}`,
        `DTEND:${formatIcsUtc(end)}`,
        `SUMMARY:${icsEscape(summary)}`,
        match.locatie ? `LOCATION:${icsEscape(match.locatie)}` : null,
        `DESCRIPTION:${icsEscape(descParts.join('\n'))}`,
        `URL:${SITE_ORIGIN}/live.html`,
        // Status meegeven zodat afgelaste/forfait-wedstrijden zichtbaar anders zijn
        match.isForfait ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
        // Twee herinneringen: 2u en 1u op voorhand. Let op: bij een geabonneerde
        // (webcal) kalender negeren zowel Apple Kalender als Google Calendar dit
        // doorgaans — zie de kanttekening in het chatantwoord. Werkt wel voor een
        // eenmalige .ics-download/import.
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(`Wedstrijd over 1 uur: ${home} vs ${away}`)}`,
        'TRIGGER:-PT1H',
        'END:VALARM',
        'END:VEVENT'
    ].filter(Boolean);

    return lines.map(icsFold).join('\r\n');
}

exports.calendarFeed = onRequest({ cors: true, region: 'europe-west1' }, async (req, res) => {
    // Firebase Hosting rewrites geven het originele pad door (geen automatische
    // query-mapping), dus we lezen het team-segment rechtstreeks uit de URL:
    // /kalender/zaterdag.ics -> "zaterdag"
    const pathMatch = req.path.match(/\/kalender\/([a-z]+)\.ics$/i)
                    || req.path.match(/^\/([a-z]+)\.ics$/i); // fallback als function direct aangeroepen wordt
    const teamType = String(pathMatch?.[1] || req.query.team || '').toLowerCase();

    if (!VALID_TEAMS.includes(teamType)) {
        res.status(404).send('Onbekend team.');
        return;
    }

    try {
        const snapshot = await db.collection('matches')
            .where('team', '==', teamType)
            .where('status', '==', 'planned')
            .get();

        const matches = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const events = matches.map(buildVEvent);
        const teamLabel = TEAM_LABELS[teamType] || teamType;

        const ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//VVS Rotselaar//Wedstrijdkalender//NL',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            `X-WR-CALNAME:VVS Rotselaar - ${teamLabel}`,
            'X-WR-TIMEZONE:Europe/Brussels',
            // Vraagt kalender-apps om ongeveer elk uur te verversen.
            // Wordt niet door alle clients gerespecteerd (Google negeert dit doorgaans
            // en hanteert een eigen, langere cyclus).
            'X-PUBLISHED-TTL:PT1H',
            'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
            ...events,
            'END:VCALENDAR'
        ].join('\r\n');

        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=1800'); // 30 min edge-cache, geen instant sync
        res.status(200).send(ics);
    } catch (err) {
        console.error('calendarFeed error:', err);
        res.status(500).send('Er ging iets mis bij het genereren van de kalenderfeed.');
    }
});

// ════════════════════════════════════════════════════════════════
// firebase.json — voeg deze rewrite toe onder "hosting"."rewrites"
// (zorgt voor de nette URL /kalender/zaterdag.ics i.p.v. de rauwe
// Cloud Functions URL)
// ════════════════════════════════════════════════════════════════
//
// {
//   "hosting": {
//     "rewrites": [
//       {
//         "source": "/kalender/**",
//         "function": "calendarFeed"
//       }
//     ]
//   }
// }
//
// "/kalender/**" i.p.v. "/kalender/:team.ics" — Firebase Hosting geeft geen
// route-param door aan de function, dus we parsen het teamnaam-segment
// zelf uit req.path (zie hierboven). "**" matcht simpelweg elk pad onder
// /kalender/ en stuurt de volledige originele request door.