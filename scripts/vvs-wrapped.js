// =====================================================
// VVS-WRAPPED.JS  –  V.V.S Rotselaar
// Toont een Spotify-Wrapped-stijl slideshow voor de
// ingelogde speler als de admin dit heeft ingeschakeld.
//
// Firestore-afhankelijkheden (read-only):
//   settings/siteSettings → { wrappedEnabled: bool }
//   users/{uid}           → stats: goals, assists, matchen,
//                           minuten, geel, rood, motmPunten
// =====================================================

import { db } from './firebase-config.js';
import {
    doc, getDoc, collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Triggered vanuit app.js na auth ────────────────────────────────────────────
export async function checkAndShowWrapped(user, userData) {
    if (!user || !userData) return;

    try {
        // 1. Is Wrapped ingeschakeld door admin?
        const settingsSnap = await getDoc(doc(db, 'settings', 'siteSettings'));
        if (!settingsSnap.exists() || !settingsSnap.data().wrappedEnabled) return;

        // 2. Haal verse spelerdata op (stats kunnen veranderd zijn)
        const userSnap = await getDocs(
            query(collection(db, 'users'), where('uid', '==', user.uid))
        );
        if (userSnap.empty) return;
        const stats = userSnap.docs[0].data();

        // 3. Al permanent afgewezen voor dit seizoen?
        // De seasonKey staat in Firestore — als admin een nieuw seizoen start,
        // verandert de key en ziet elke speler de Wrapped opnieuw.
        const seasonKey    = settingsSnap.data().wrappedSeasonKey || 'default';
        const dismissedKey = `vvs_wrapped_dismissed_${user.uid}_${seasonKey}`;
        if (localStorage.getItem(dismissedKey) === '1') return;

        // 4. Bouw slides op
        const slides = buildSlides(stats);
        if (slides.length === 0) return;

        // 5. Toon de Wrapped UI
        showWrappedModal(slides, stats.naam || stats.name || 'Speler', user, dismissedKey);

    } catch (e) {
        console.warn('[Wrapped] Kon niet laden:', e);
    }
}

// ── Willekeurige tekst picker ────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Slide-builder ─────────────────────────────────────────────────────────────
function buildSlides(s) {
    const slides = [];
    const voornaam = (s.naam || s.name || 'Speler').split(' ')[0];
    const goals   = s.goals       ?? s.Goals       ?? 0;
    const assists = s.assists     ?? s.Assists     ?? 0;
    const matchen = s.matchen     ?? s.matches     ?? 0;
    const minuten = s.minuten     ?? s.minutes     ?? 0;
    const geel    = s.geelKaarten ?? s.geel ?? s.yellowCards ?? 0;
    const rood    = s.roodKaarten ?? s.rood ?? s.redCards    ?? 0;
    const motm    = s.motmPunten  ?? 0;

    // Zijn alle speelstats 0?
    const allZero = goals === 0 && assists === 0 && matchen === 0
                 && minuten === 0 && motm === 0;

    // ── Welkomstslide — alleen als er echte stats zijn ──────────────────────
    if (!allZero) {
        slides.push({
            type: 'intro',
            icon: 'assets/logo.png', iconInvert: false,
            title: `${voornaam}'s`,
            subtitle: 'VVS WRAPPED',
            desc: pick([
                'Jouw seizoen in cijfers. Swipe of klik om verder te gaan.',
                'Dit is jouw seizoen bij VVS. Klaar voor de hoogtepunten?',
                'Een heel seizoen samengevat. Geniet ervan!',
                'Swipe door jouw persoonlijke VVS-terugblik!',
            ]),
            bg: 'linear-gradient(135deg, #0B1D3A 0%, #0047AB 100%)',
            color: '#fff',
        });
    }

    // ── Matchen ─────────────────────────────────────────────────────────────
    if (matchen > 0) {
        const desc = matchen >= 20
            ? pick([
                `Bijna elke wedstrijd stond jij op het veld. Dat noemen ze toewijding!`,
                `${matchen} matchen — de ploeg kon blindelings op jou rekenen. Respect!`,
                `Elke wedstrijd klaarstaan voor VVS — dat vraagt meer dan talent alleen.`,
              ])
            : matchen >= 12
            ? pick([
                `Een solide seizoen. De ploeg wist dat jij er was wanneer het telde.`,
                `${matchen} matchen — dat is bijna elke speeldag aanwezig. Top!`,
                `Meer dan de helft van het seizoen actief. Dat is pas inzet!`,
              ])
            : matchen >= 6
            ? pick([
                `De helft van het seizoen meegespeeld — en élke keer vol gegeven.`,
                `${matchen} matchen — goed voor een mooie bijdrage aan het team.`,
                `Niet elke match, maar als jij er was, voelde de ploeg het verschil.`,
              ])
            : pick([
                `Minder matchen dit seizoen, maar kwaliteit boven kwantiteit telt ook!`,
                `${matchen} keer het shirt van VVS gedragen — elk moment was er eentje waard.`,
                `Weinig matchen, maar wie weet wat volgend seizoen brengt!`,
              ]);
        slides.push({
            type: 'stat', icon: 'assets/calender.png', iconInvert: true,
            label: 'MATCHEN GESPEELD',
            value: matchen, rawValue: matchen,
            desc,
            bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            color: '#fff', accent: '#4fc3f7',
        });
    }

    // ── Minuten ─────────────────────────────────────────────────────────────
    if (minuten > 0 && matchen > 0) {
        const gem = Math.round(minuten / matchen);
        const sec = (minuten * 60).toLocaleString('nl-BE');
        const desc = gem >= 80
            ? pick([
                `Bijna elke minuut van elke match! ${minuten.toLocaleString('nl-BE')} min is leveren pur sang.`,
                `Jij was er bijna de volledige tijd. ${minuten.toLocaleString('nl-BE')} minuten — respect!`,
                `Gemiddeld ${gem} min per wedstrijd. De coach kon je moeilijk van het veld halen!`,
              ])
            : gem >= 60
            ? pick([
                `Gemiddeld ${gem} minuten per match — dat is maar liefst ${sec} seconden VVS-voetbal!`,
                `${minuten.toLocaleString('nl-BE')} minuten op het veld. De tegenstander zag je véél te veel!`,
                `${sec} seconden lang het shirt van VVS dragen — dat is geen toeval.`,
              ])
            : gem >= 35
            ? pick([
                `${minuten.toLocaleString('nl-BE')} minuten gespeeld — gemiddeld ${gem} min per wedstrijd. Elke minuut telt!`,
                `Dat zijn ${sec} seconden pure inzet voor de ploeg. Goed bezig!`,
                `${gem} minuten gemiddeld — jij gaf je kans als het ertoe deed.`,
              ])
            : pick([
                `${minuten.toLocaleString('nl-BE')} minuten — dat klinkt als ${sec} seconden pure inzet!`,
                `Kort maar krachtig: ${minuten.toLocaleString('nl-BE')} minuten actie voor VVS.`,
                `Elke minuut op het veld telt. En jij had er ${minuten.toLocaleString('nl-BE')} van!`,
              ]);
        slides.push({
            type: 'stat', icon: 'assets/stopwatch.png', iconInvert: true,
            label: 'MINUTEN OP HET VELD',
            value: minuten.toLocaleString('nl-BE'), rawValue: minuten,
            desc,
            bg: 'linear-gradient(135deg, #0d2137 0%, #1a4a6e 100%)',
            color: '#fff', accent: '#80deea',
        });
    }

    // ── Goals ────────────────────────────────────────────────────────────────
    if (goals > 0) {
        const desc = goals >= 20
            ? pick([
                `${goals} goals — een echte topschutter! De doelman sidderde bij jouw naam.`,
                `${goals} keer raak — jij bent de ster van de aanval. Indrukwekkend!`,
                `Doelpunt na doelpunt. ${goals} goals is geen toeval, dat is klasse.`,
              ])
            : goals >= 10
            ? pick([
                `Dubbele cijfers! ${goals} goals is een seizoen om in te kaderen.`,
                `${goals} goals — de keeper wist niet wat hem overkwam. Fantastisch!`,
                `Tien of meer is geen geluk, dat is talent. ${goals} goals dit seizoen!`,
              ])
            : goals >= 5
            ? pick([
                `${goals} goals — elke treffer was goud waard voor de ploeg!`,
                `Vijf of meer goals in een seizoen is écht iets om trots op te zijn.`,
                `${goals} keer vieren na het fluiten — daar doe je het voor!`,
              ])
            : goals === 1
            ? pick([
                `1 goal — en elke goal telt. Die ene zal je nooit vergeten!`,
                `Eén treffer, maar wat een treffer. Jij scoorde voor VVS!`,
                `Het enige dat telt is dat er eentje binnenging. Goed gedaan!`,
              ])
            : pick([
                `${goals} goals — de keeper werd nerveus als jij aankwam!`,
                `${goals} keer het net doen trillen dit seizoen. Meer alsjeblieft!`,
                `${goals} goals — niet slecht, maar volgend seizoen mikken we hoger!`,
              ]);
        slides.push({
            type: 'stat', icon: 'assets/goal.png', iconInvert: true,
            label: 'GOALS GESCOORD',
            value: goals, rawValue: goals,
            desc,
            bg: 'linear-gradient(135deg, #1b4332 0%, #2d6a4f 100%)',
            color: '#fff', accent: '#b7e4c7',
        });
    }

    // ── Assists ─────────────────────────────────────────────────────────────
    if (assists > 0) {
        const desc = assists >= 15
            ? pick([
                `${assists} assists! De spelmaker van de ploeg — zonder jou vallen er geen goals.`,
                `${assists} keer de perfecte pass. Jij maakt je ploegmaats beter!`,
                `Assistkoning! ${assists} assists is een cijfer om trots op te zijn.`,
              ])
            : assists >= 8
            ? pick([
                `${assists} assists — jij deelt uit als geen ander. De ploeg draait op jou!`,
                `${assists} keer de beslissende pass gegeven. Dat is teamplay op zijn best.`,
                `De spitsen danken jou. ${assists} assists is serieus werk!`,
              ])
            : assists === 1
            ? pick([
                `1 assist — die ene pass die alles veranderde. Zo klein, zo groot.`,
                `Eén assist, maar wat een assist. Jij maakte een goal mogelijk!`,
                `Bescheiden maar doeltreffend — 1 assist die de ploeg hielp.`,
              ])
            : pick([
                `${assists} assists — de scorers danken jou. Zonder jou geen goals!`,
                `${assists} keer de juiste pass op het juiste moment. Goed werk!`,
                `${assists} assists — jij ziet het spel zoals weinigen dat doen.`,
              ]);
        slides.push({
            type: 'stat', icon: 'assets/assist.png', iconInvert: true,
            label: 'ASSISTS GEGEVEN',
            value: assists, rawValue: assists,
            desc,
            bg: 'linear-gradient(135deg, #2c1654 0%, #4a0e8f 100%)',
            color: '#fff', accent: '#ce93d8',
        });
    }

    // ── Goals + Assists samen (als beide > 0) ─────────────────────────────
    if (goals > 0 && assists > 0) {
        const totaal = goals + assists;
        slides.push({
            type: 'double', icon: 'assets/goal.png', iconInvert: true,
            label: 'TOTALE BIJDRAGE',
            value1: goals, label1: 'Goals',
            value2: assists, label2: 'Assists',
            desc: pick([
                `${totaal} rechtstreekse betrokkenheden — jij bent onmisbaar voor VVS!`,
                `Goals én assists: jij was overal dit seizoen. ${totaal} keer betrokken bij een goal.`,
                `Scoren én creëren — ${totaal} bijdragen aan het scorebord. Dankjewel!`,
            ]),
            bg: 'linear-gradient(135deg, #7b1fa2 0%, #1565c0 100%)',
            color: '#fff', accent: '#f8bbd9',
        });
    }

    // ── MOTM-punten ─────────────────────────────────────────────────────────
    if (motm > 0) {
        const desc = motm >= 10
            ? pick([
                `${motm} MOTM-punten! De ploeg kiest keer op keer voor jou. Wat een seizoen!`,
                `${motm} punten als Man van de Match — jij bent de publiekslieveling.`,
                `Keer op keer de beste op het veld. ${motm} MOTM-punten spreekt voor zich!`,
              ])
            : motm >= 5
            ? pick([
                `${motm} MOTM-punten — meerdere keren de sterspeler van de dag. Knap!`,
                `${motm} punten — de ploeg weet wie er uitblinkt. Blijf zo presteren!`,
                `${motm} Man van de Match-punten. De fans zien hoe goed jij speelt!`,
              ])
            : pick([
                `${motm} MOTM-punt${motm > 1 ? 'en' : ''} — de ploeg erkent jouw bijdrage. Ga zo door!`,
                `Man van de Match zijn is bijzonder. Jij weet hoe dat voelt!`,
                `${motm} punten verdiend — je maakte indruk op je ploegmaats.`,
              ]);
        slides.push({
            type: 'stat', icon: 'assets/assist.png', iconInvert: true,
            label: 'MOTM-PUNTEN',
            value: motm, rawValue: motm,
            desc,
            bg: 'linear-gradient(135deg, #7f5a00 0%, #d4a017 100%)',
            color: '#fff', accent: '#ffe082',
        });
    }

    // ── Kaarten — ALTIJD (behalve als alles 0 is) ────────────────────────────
    if (!allZero) {
        let desc;
        if (rood >= 2) {
            desc = pick([
                `${rood} rode kaarten — volgend seizoen iets minder temperament? 😅 Maar die passie is ook een kracht!`,
                `De ref kende jou goed dit jaar. ${rood} rode kaarten — probeer het rustiger aan te pakken.`,
                `Heetgebakerd? Dat kan, maar ${rood} rode kaarten is toch iets om over na te denken.`,
            ]);
        } else if (rood === 1) {
            desc = pick([
                `1 rode kaart — iedereen heeft weleens een slechte dag. Volgend jaar beter!`,
                `Eén keer de kleedkamer in voor tijd. Leer ervan en ga sterker terug!`,
                `Rood gezien dit seizoen — dat hoort erbij, maar probeer het te vermijden.`,
            ]);
        } else if (geel >= 5) {
            desc = pick([
                `${geel} gele kaarten — de ref hield je goed in de gaten! Die inzet is bewonderenswaardig.`,
                `Vijf of meer gele kaarten: jij gaat altijd tot het uiterste. Maar pas op!`,
                `${geel} keer geel — je speelt met passie, maar een beetje minder zou ook kunnen 😄`,
            ]);
        } else if (geel > 0) {
            desc = pick([
                `${geel} gele kaart${geel > 1 ? 'en' : ''} — een klein dipje in een verder goed seizoen.`,
                `${geel}x geel. Niet ideaal, maar het hoort bij het spel. Ga zo door!`,
                `${geel} keer de naam genoteerd door de scheidsrechter. Kan beter, maar je komt er!`,
            ]);
        } else {
            desc = pick([
                `0 kaarten! Een perfect seizoen qua discipline — de ref had jou niet nodig 👏`,
                `Geen enkele kaart dit seizoen. Dat is sportiviteit op zijn best. Geweldig!`,
                `Nul kaarten — jij speelt hard maar fair. Zo hoort het! Ga zo voort!`,
            ]);
        }
        slides.push({
            type: 'cards', icon: rood > 0 ? 'assets/red.png' : 'assets/yellow.png', iconInvert: false,
            label: 'KAARTEN DIT SEIZOEN',
            geel, rood,
            desc,
            bg: rood > 0
                ? 'linear-gradient(135deg, #4a0000 0%, #8b1a1a 100%)'
                : 'linear-gradient(135deg, #3e2000 0%, #7c4a03 100%)',
            color: '#fff', accent: '#ffd54f',
        });
    }

    // ── Eindslide ────────────────────────────────────────────────────────────
    slides.push({
        type: 'outro',
        icon: 'assets/firework.png', iconInvert: false,
        title: pick([
            'Bedankt voor dit seizoen!',
            'Wat een jaar, ' + voornaam + '!',
            'Tot volgend seizoen!',
            voornaam + ', jij bent VVS!',
        ]),
        desc: pick([
            'VVS Rotselaar is er dankzij spelers zoals jij. Tot volgend seizoen!',
            'Zonder jou is VVS niet compleet. Bedankt voor alles dit jaar!',
            'Een nieuw seizoen wacht. Klaar om er opnieuw vol voor te gaan?',
            'Jij bent de reden waarom VVS Rotselaar zo speciaal is. Dankjewel!',
        ]),
        bg: 'linear-gradient(135deg, #0B1D3A 0%, #003380 100%)',
        color: '#fff',
    });

    return slides;
}

// ── Modal renderer ─────────────────────────────────────────────────────────────
function showWrappedModal(slides, naam, user, dismissedKey) {
    // Verwijder eventuele bestaande modal
    document.getElementById('vvsWrappedModal')?.remove();

    let idx = 0;

    const modal = document.createElement('div');
    modal.id = 'vvsWrappedModal';
    modal.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99990',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.88)', 'padding:1rem',
        'backdrop-filter:blur(6px)',
        'animation:vwFadeIn 0.4s ease',
    ].join(';');

    modal.innerHTML = `
<style>
@keyframes vwFadeIn  { from { opacity:0 } to { opacity:1 } }
@keyframes vwSlideUp { from { opacity:0; transform:translateY(30px) scale(0.97) }
                       to   { opacity:1; transform:none } }
@keyframes vwPulse   { 0%,100% { transform:scale(1) } 50% { transform:scale(1.08) } }

#vvsWrappedCard {
    position:relative;
    width:100%; max-width:440px; min-height:520px;
    border-radius:24px;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:2.5rem 2rem 2rem;
    text-align:center;
    box-shadow:0 32px 80px rgba(0,0,0,0.6);
    overflow:hidden;
    transition:background 0.5s ease;
    user-select:none;
    font-family:'Barlow Condensed',sans-serif;
}
#vvsWrappedCard .vw-close {
    position:absolute; top:1rem; right:1rem;
    background:rgba(255,255,255,0.18); border:none; color:#fff;
    width:32px; height:32px; border-radius:50%; font-size:1.1rem;
    cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:background 0.2s; z-index:2;
}
#vvsWrappedCard .vw-close:hover { background:rgba(255,255,255,0.3); }
#vvsWrappedCard .vw-progress {
    position:absolute; top:0; left:0; right:0;
    display:flex; gap:4px; padding:12px 14px 0;
}
#vvsWrappedCard .vw-prog-seg {
    height:3px; flex:1; border-radius:2px;
    background:rgba(255,255,255,0.28);
    transition:background 0.3s;
}
#vvsWrappedCard .vw-prog-seg.done { background:rgba(255,255,255,0.9); }
#vvsWrappedCard .vw-prog-seg.active { background:rgba(255,255,255,0.7); }

.vw-slide { animation:vwSlideUp 0.38s cubic-bezier(0.34,1.56,0.64,1); width:100%; }
.vw-icon { width:72px; height:72px; object-fit:contain;
           margin-bottom:0.75rem; display:block; margin-left:auto; margin-right:auto;
           animation:vwPulse 2s ease-in-out infinite; }
.vw-icon.invert { filter:invert(1); }
.vw-label { font-size:0.8rem; font-weight:800; letter-spacing:0.14em;
            color:rgba(255,255,255,0.88); text-transform:uppercase; margin-bottom:0.3rem; }
.vw-big   { font-size:5rem; font-weight:900; line-height:1;
            margin-bottom:0.5rem; text-shadow:0 2px 12px rgba(0,0,0,0.3); }
.vw-title { font-size:2.4rem; font-weight:900; line-height:1.1;
            margin-bottom:0.4rem; text-shadow:0 2px 8px rgba(0,0,0,0.25); }
.vw-subtitle { font-size:1.35rem; font-weight:700; color:rgba(255,255,255,0.92);
               margin-bottom:0.6rem; }
.vw-desc  { font-size:1.05rem; font-weight:600; color:rgba(255,255,255,0.95);
            line-height:1.55; max-width:340px; margin:0 auto 1.25rem;
            text-shadow:0 1px 4px rgba(0,0,0,0.35); }
.vw-double { display:flex; gap:1.5rem; justify-content:center;
             margin-bottom:0.6rem; }
.vw-double-item { display:flex; flex-direction:column; align-items:center; }
.vw-double-val  { font-size:3.8rem; font-weight:900; line-height:1;
                  text-shadow:0 2px 10px rgba(0,0,0,0.3); }
.vw-double-lbl  { font-size:0.8rem; font-weight:800; letter-spacing:.1em;
                  color:rgba(255,255,255,0.88); text-transform:uppercase; }
.vw-cards-row   { display:flex; gap:1.25rem; justify-content:center;
                  margin-bottom:0.7rem; }
.vw-card-item   { display:flex; flex-direction:column; align-items:center; gap:4px; }
.vw-card-val    { font-size:3.2rem; font-weight:900; line-height:1;
                  text-shadow:0 2px 8px rgba(0,0,0,0.3); }
.vw-card-lbl    { font-size:0.8rem; font-weight:800; letter-spacing:.08em;
                  color:rgba(255,255,255,0.88); text-transform:uppercase; }
.vw-nav {
    position:absolute; bottom:1.25rem; left:0; right:0;
    display:flex; align-items:center; justify-content:center; gap:0.75rem;
    flex-wrap:wrap; padding:0 1rem;
}
.vw-nav-btn {
    background:rgba(255,255,255,0.22); border:1.5px solid rgba(255,255,255,0.55);
    color:#fff; border-radius:50px; padding:0.5rem 1.3rem;
    font-size:0.88rem; font-weight:800; font-family:'Barlow Condensed',sans-serif;
    letter-spacing:0.06em; cursor:pointer; transition:all 0.2s;
    text-shadow:0 1px 3px rgba(0,0,0,0.2);
}
.vw-nav-btn:hover { background:rgba(255,255,255,0.36); border-color:rgba(255,255,255,0.8); }
.vw-nav-btn:disabled { opacity:0.25; cursor:default; }
.vw-share-top {
    position:absolute; top:1rem; right:3.5rem;
    background:rgba(255,255,255,0.18); border:none; color:#fff;
    width:32px; height:32px; border-radius:50%; font-size:1rem;
    cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:background 0.2s; z-index:2;
}
.vw-share-top:hover { background:rgba(255,255,255,0.32); }
.vw-dismiss-btn {
    background:transparent; border:none; color:rgba(255,255,255,0.55);
    font-size:0.78rem; font-weight:600; font-family:'Barlow Condensed',sans-serif;
    letter-spacing:0.04em; cursor:pointer; text-decoration:underline;
    padding:0.3rem 0.5rem; transition:color 0.2s;
}
.vw-dismiss-btn:hover { color:rgba(255,255,255,0.9); }
.vw-counter {
    font-size:0.8rem; font-weight:700; color:rgba(255,255,255,0.7);
    font-family:'Barlow Condensed',sans-serif; letter-spacing:.04em;
}
@media (max-width:480px) {
    #vvsWrappedCard { min-height:80svh; border-radius:20px; padding:2rem 1.25rem 5rem; }
    .vw-big  { font-size:4rem; }
    .vw-icon { width:56px; height:56px; }
    .vw-title { font-size:1.9rem; }
    .vw-desc  { font-size:0.97rem; }
}
</style>

<div id="vvsWrappedCard">
    <button class="vw-share-btn vw-share-top" id="vwShare" title="Deel deze slide"><img src="assets/share.png" alt="Deel" style="width:16px;height:16px;object-fit:contain;filter:invert(1);display:block;"></button>
    <button class="vw-close" id="vwClose" aria-label="Sluiten">✕</button>
    <div class="vw-progress" id="vwProgress"></div>
    <div id="vwSlideContent"></div>
    <div class="vw-nav">
        <button class="vw-nav-btn" id="vwPrev">← Vorige</button>
        <span class="vw-counter" id="vwCounter"></span>
        <button class="vw-nav-btn" id="vwNext">Volgende →</button>
        <button class="vw-dismiss-btn" id="vwDismiss" title="Nooit meer tonen">Niet meer tonen</button>
    </div>
</div>`;

    document.body.appendChild(modal);

    const card     = document.getElementById('vvsWrappedCard');
    const content  = document.getElementById('vwSlideContent');
    const progress = document.getElementById('vwProgress');
    const counter  = document.getElementById('vwCounter');
    const btnPrev  = document.getElementById('vwPrev');
    const btnNext  = document.getElementById('vwNext');
    const btnClose = document.getElementById('vwClose');
    const btnDismiss = document.getElementById('vwDismiss');

    // Build progress segments
    slides.forEach((_, i) => {
        const seg = document.createElement('div');
        seg.className = 'vw-prog-seg';
        seg.dataset.i = i;
        progress.appendChild(seg);
    });

    function render(i) {
        const s = slides[i];
        card.style.background = s.bg;

        // Progress
        progress.querySelectorAll('.vw-prog-seg').forEach((seg, j) => {
            seg.className = 'vw-prog-seg' + (j < i ? ' done' : j === i ? ' active' : '');
        });

        // Counter
        counter.textContent = `${i + 1} / ${slides.length}`;
        btnPrev.disabled = i === 0;
        btnNext.textContent = i === slides.length - 1 ? '✓ Klaar' : 'Volgende →';

        // Slide HTML
        let html = `<div class="vw-slide">`;
        const ac = s.accent || '#fff';

        switch (s.type) {
            case 'intro':
                html += `<img class="vw-icon${ s.iconInvert ? ' invert' : '' }" src="${ s.icon }" alt="">
                    <div class="vw-title" style="color:${ac}">${s.title}</div>
                    <div class="vw-subtitle" style="color:#fff">${s.subtitle}</div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;
            case 'stat':
                html += `<img class="vw-icon${ s.iconInvert ? ' invert' : '' }" src="${ s.icon }" alt="">
                    <div class="vw-label">${s.label}</div>
                    <div class="vw-big" style="color:${ac}">${s.value}</div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;
            case 'double':
                html += `<img class="vw-icon${ s.iconInvert ? ' invert' : '' }" src="${ s.icon }" alt="">
                    <div class="vw-label" style="color:${ac};margin-bottom:0.9rem;">${s.label}</div>
                    <div class="vw-double">
                        <div class="vw-double-item">
                            <span class="vw-double-val" style="color:${ac}">${s.value1}</span>
                            <span class="vw-double-lbl" style="color:${ac}">${s.label1}</span>
                        </div>
                        <div class="vw-double-item">
                            <span class="vw-double-val" style="color:${ac}">${s.value2}</span>
                            <span class="vw-double-lbl" style="color:${ac}">${s.label2}</span>
                        </div>
                    </div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;
            case 'cards':
                html += `<img class="vw-icon${ s.iconInvert ? ' invert' : '' }" src="${ s.icon }" alt="">
                    <div class="vw-label" style="color:${ac}">${s.label}</div>
                    <div class="vw-cards-row">
                        <div class="vw-card-item">
                            <span class="vw-card-val" style="color:#FFD600">${s.geel}</span>
                            <span class="vw-card-lbl" style="color:${ac}">Geel</span>
                        </div>
                        <div class="vw-card-item">
                            <span class="vw-card-val" style="color:#FF3D00">${s.rood}</span>
                            <span class="vw-card-lbl" style="color:${ac}">Rood</span>
                        </div>
                    </div>
                    <div class="vw-desc">${s.desc}</div>`;
                break;
            case 'outro':
                html += `<img class="vw-icon${ s.iconInvert ? ' invert' : '' }" src="${ s.icon }" alt="">
                    <div class="vw-title" style="color:#fff;font-size:1.8rem;">${s.title}</div>
                    <div class="vw-desc" style="margin-top:0.75rem;">${s.desc}</div>`;
                // Confetti on outro!
                if (typeof confetti === 'function') {
                    setTimeout(() => {
                        confetti({ particleCount: 80, spread: 90, origin: { y: 0.6 },
                                   colors: ['#0047AB','#ffffff','#FFD600'] });
                    }, 250);
                }
                break;
        }
        html += `</div>`;
        content.innerHTML = html;

        // ── Telanimatie voor .vw-big elementen met rawValue ──────────────
        if (s.rawValue !== undefined && !isNaN(s.rawValue) && s.rawValue > 0) {
            const bigEl = content.querySelector('.vw-big');
            if (bigEl) {
                const target   = s.rawValue;
                const formatted = s.value;
                // Duur: snel voor kleine getallen, langer voor grote
                const duration = Math.min(600 + Math.sqrt(target) * 80, 2000);
                let startTime  = null;

                function easeOutExpo(p) {
                    // Snel optellen, dan vertraagt de laatste 25% sterk (spanning)
                    return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
                }

                function tick(timestamp) {
                    if (!startTime) startTime = timestamp;
                    const elapsed = timestamp - startTime;
                    const p       = Math.min(elapsed / duration, 1);
                    const eased   = easeOutExpo(p);
                    const val     = Math.round(target * eased);
                    bigEl.textContent = val >= 1000
                        ? val.toLocaleString('nl-BE')
                        : String(val);
                    if (p < 1) {
                        requestAnimationFrame(tick);
                    } else {
                        bigEl.textContent = formatted;
                    }
                }

                bigEl.textContent = '0';
                requestAnimationFrame(tick);
            }
        }
    }

    function goTo(newIdx) {
        if (newIdx < 0 || newIdx > slides.length - 1) return;
        idx = newIdx;
        render(idx);
    }

    btnNext.addEventListener('click', () => {
        if (idx === slides.length - 1) { closeModal(); }
        else goTo(idx + 1);
    });
    btnPrev.addEventListener('click', () => goTo(idx - 1));
    btnClose.addEventListener('click', closeModal);
    btnDismiss?.addEventListener('click', () => {
        try { localStorage.setItem(dismissedKey, '1'); } catch (_) {}
        closeModal();
    });

    document.getElementById('vwShare')?.addEventListener('click', () => {
        shareSlide(slides[idx], naam);
    });

    // Swipe support
    let touchX = 0;
    card.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - touchX;
        if (dx > 50) goTo(idx - 1);
        else if (dx < -50) goTo(idx + 1);
    }, { passive: true });

    // Keyboard
    function onKey(e) {
        if (e.key === 'ArrowRight') goTo(idx + 1);
        if (e.key === 'ArrowLeft')  goTo(idx - 1);
        if (e.key === 'Escape')     closeModal();
    }
    document.addEventListener('keydown', onKey);

    function closeModal() {
        document.removeEventListener('keydown', onKey);
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.3s ease';
        setTimeout(() => modal.remove(), 300);
    }

    // Render first slide
    render(0);
}

// ── Deel-functie via Canvas API ───────────────────────────────────────────────
async function shareSlide(slide, naam) {
    const btn = document.getElementById('vwShare');
    if (btn) { btn.innerHTML = '<img src="assets/share.png" alt="" style="width:16px;height:16px;object-fit:contain;filter:invert(1);display:block;opacity:0.4;">'; btn.disabled = true; }

    try {
        const canvas = document.createElement('canvas');
        canvas.width  = 1080;
        canvas.height = 1920;  // 9:16 portret (Instagram Story formaat)
        const ctx = canvas.getContext('2d');

        // Achtergrond gradient
        const gradColors = parseGradient(slide.bg);
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0,   gradColors[0]);
        grad.addColorStop(1,   gradColors[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Subtiele overlay voor diepte
        const overlay = ctx.createLinearGradient(0, 0, 0, canvas.height);
        overlay.addColorStop(0,   'rgba(0,0,0,0.08)');
        overlay.addColorStop(1,   'rgba(0,0,0,0.28)');
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const cx     = canvas.width / 2;
        const cy     = canvas.height / 2;
        const accent = slide.accent || '#ffffff';

        // ── Vaste zones: header=top 160px, footer=bottom 130px, content=rest ──
        const H        = canvas.height;  // 1920
        const W        = canvas.width;   // 1080
        const headerH  = 160;
        const footerH  = 130;
        const contentY = headerH;
        const contentH = H - headerH - footerH;
        const midY     = contentY + contentH / 2;  // verticaal midden van content

        // ── Header: VVS label ─────────────────────────────────────────────────
        ctx.font         = 'bold 42px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle    = 'rgba(255,255,255,0.5)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('V.V.S ROTSELAAR', cx, headerH / 2);

        // ── Footer: naam ──────────────────────────────────────────────────────
        ctx.font      = 'bold 46px "Barlow Condensed", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(naam + ' · VVS Wrapped', cx, H - footerH / 2);

        // ── Content: type-afhankelijk, verticaal gecentreerd ─────────────────
        ctx.textBaseline = 'middle';

        if (slide.type === 'stat') {
            // Blok: icoon (200) + gap(40) + label(60) + gap(20) + getal(280) + gap(50) + desc(~130)
            const iconH    = 200;
            const labelH   = 60;
            const valueH   = 280;
            const descH    = 140;   // schatting 2-3 regels
            const gaps     = 40 + 20 + 50 + 50;
            const totalH   = iconH + labelH + valueH + descH + gaps;
            let   y        = midY - totalH / 2;

            await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, slide.iconInvert);
            y += iconH + 40;

            ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.fillText(slide.label, cx, y + labelH / 2);
            y += labelH + 20;

            ctx.font        = 'bold 280px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle   = accent;
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur  = 28;
            ctx.fillText(String(slide.value), cx, y + valueH / 2);
            ctx.shadowBlur  = 0;
            y += valueH + 50;

            wrapText(ctx, slide.desc, cx, y, 920, 62, 'rgba(255,255,255,0.92)', 'bold 52px "Barlow Condensed", Arial, sans-serif');

        } else if (slide.type === 'double') {
            const iconH  = 180;
            const labelH = 60;
            const valueH = 240;
            const subH   = 60;
            const descH  = 140;
            const gaps   = 36 + 20 + 24 + 50;
            const totalH = iconH + labelH + valueH + subH + descH + gaps;
            let   y      = midY - totalH / 2;

            await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, slide.iconInvert);
            y += iconH + 36;

            ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.fillText(slide.label, cx, y + labelH / 2);
            y += labelH + 20;

            ctx.font      = 'bold 240px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = accent;
            ctx.fillText(String(slide.value1), cx - 250, y + valueH / 2);
            ctx.fillText(String(slide.value2), cx + 250, y + valueH / 2);
            y += valueH + 24;

            ctx.font      = 'bold 56px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.72)';
            ctx.fillText(slide.label1, cx - 250, y + subH / 2);
            ctx.fillText(slide.label2, cx + 250, y + subH / 2);
            y += subH + 50;

            wrapText(ctx, slide.desc, cx, y, 920, 62, 'rgba(255,255,255,0.92)', 'bold 52px "Barlow Condensed", Arial, sans-serif');

        } else if (slide.type === 'cards') {
            // Layout: icoon, label, [geel getal | rood getal], [geel icon | rood icon], [Geel | Rood], desc
            const iconH    = 180;
            const labelH   = 60;
            const numH     = 200;
            const cardIconH= 180;
            const cardLblH = 60;
            const descH    = 140;
            const gaps     = 36 + 20 + 20 + 16 + 50;
            const totalH   = iconH + labelH + numH + cardIconH + cardLblH + descH + gaps;
            let   y        = midY - totalH / 2;

            // Hoofd-icoon (yellow of red afhankelijk van welke hoger is)
            await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, false);
            y += iconH + 36;

            ctx.font = 'bold 56px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.fillText(slide.label, cx, y + labelH / 2);
            y += labelH + 20;

            // Grote getallen naast elkaar
            ctx.font      = 'bold 200px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = '#FFD600';
            ctx.fillText(String(slide.geel), cx - 240, y + numH / 2);
            ctx.fillStyle = '#FF3D00';
            ctx.fillText(String(slide.rood), cx + 240, y + numH / 2);
            y += numH + 20;

            // Kaart-iconen onder de getallen
            await drawIcon(ctx, 'assets/yellow.png', cx - 240, y + cardIconH / 2, cardIconH, false);
            await drawIcon(ctx, 'assets/red.png',    cx + 240, y + cardIconH / 2, cardIconH, false);
            y += cardIconH + 16;

            // Labels Geel / Rood
            ctx.font      = 'bold 56px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.72)';
            ctx.fillText('Geel', cx - 240, y + cardLblH / 2);
            ctx.fillText('Rood', cx + 240, y + cardLblH / 2);
            y += cardLblH + 50;

            wrapText(ctx, slide.desc, cx, y, 920, 62, 'rgba(255,255,255,0.92)', 'bold 52px "Barlow Condensed", Arial, sans-serif');

        } else {
            // intro / outro — icoon groot, titel, desc
            const iconH  = 240;
            const titleH = 100;
            const descH  = 160;
            const gaps   = 50 + 40;
            const totalH = iconH + titleH + descH + gaps;
            let   y      = midY - totalH / 2;

            await drawIcon(ctx, slide.icon, cx, y + iconH / 2, iconH, slide.iconInvert || false);
            y += iconH + 50;

            ctx.font      = 'bold 100px "Barlow Condensed", Arial, sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText(slide.title || slide.subtitle || 'VVS Wrapped', cx, y + titleH / 2);
            y += titleH + 40;

            wrapText(ctx, slide.desc, cx, y, 920, 66, 'rgba(255,255,255,0.88)', 'bold 56px "Barlow Condensed", Arial, sans-serif');
        }

        // Probeer Web Share API (mobiel)
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], 'vvs-wrapped.png', { type: 'image/png' });

        if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({
                title: 'VVS Wrapped',
                text:  `${naam}'s VVS-seizoen in cijfers 💙`,
                files: [file],
            });
        } else {
            // Fallback: download
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = 'vvs-wrapped.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
        }

    } catch (e) {
        if (e.name !== 'AbortError') console.warn('[Wrapped] Delen mislukt:', e);
    } finally {
        if (btn) {
            btn.innerHTML = '<img src="assets/share.png" alt="Deel" style="width:16px;height:16px;object-fit:contain;filter:invert(1);display:block;">';
            btn.disabled = false;
        }
    }
}

// Laadt en tekent een PNG-icoon op canvas, met optionele invert via compositing
async function drawIcon(ctx, src, cx, cy, size, invert) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const half = size / 2;
            ctx.save();
            if (invert) {
                // Teken op offscreen canvas met invert filter
                const off = document.createElement('canvas');
                off.width  = size;
                off.height = size;
                const octx = off.getContext('2d');
                octx.filter = 'invert(1)';
                octx.drawImage(img, 0, 0, size, size);
                ctx.drawImage(off, cx - half, cy - half, size, size);
            } else {
                ctx.drawImage(img, cx - half, cy - half, size, size);
            }
            ctx.restore();
            resolve();
        };
        img.onerror = resolve; // stil falen
        img.src = src;
    });
}

function parseGradient(bg) {
    const matches = bg.match(/#[0-9a-fA-F]{3,6}/g) || ['#0B1D3A', '#0047AB'];
    return [matches[0], matches[matches.length - 1]];
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, color, font) {
    if (!text) return;
    ctx.font      = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    const words = text.split(' ');
    let line  = '';
    let curY  = y;
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, curY);
            line = word;
            curY += lineHeight;
        } else {
            line = test;
        }
    }
    if (line) ctx.fillText(line, x, curY);
}