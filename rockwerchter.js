// ===============================================
// ROCKWERCHTER DRANKKAART
// V.V.S Rotselaar
// ===============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Rockwerchter.js loaded');

// ===============================================
// PAYCONIQ CONFIG
// Vervang met jouw echte merchant ID.
// Het bedrag wordt als queryparameter in centen
// meegegeven zodat de klant het NIET zelf hoeft in te
// vullen in de Payconiq-app.
// ===============================================
const PAYCONIQ_MERCHANT_ID = '6311028018dada62cdf95ea2';

// ===============================================
// GLOBAL STATE
// ===============================================

let currentUser     = null;
let currentUserData = null;
let isLoggedIn      = false;

const drankjes = {
    'Primus':         { prijs:  4.00, count: 0, img: 'assets/rockwerchter/Primus.png' },
    'Mystic':         { prijs:  4.00, count: 0, img: 'assets/rockwerchter/Mystic.png' },
    'Stella 0.0':     { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Stella00.png' },
    'Cava of Wijn':   { prijs:  5.00, count: 0, img: 'assets/rockwerchter/CavaWijn.png' },
    'Plat water':     { prijs:  3.30, count: 0, img: 'assets/rockwerchter/PlatWater.png' },
    'Bruisend water': { prijs:  3.30, count: 0, img: 'assets/rockwerchter/BruisendWater.png' },
    'Cola':           { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Cola.png' },
    'Cola Zero':      { prijs:  3.30, count: 0, img: 'assets/rockwerchter/ColaZero.png' },
    'Fanta':          { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Fanta.png' },
    'Fuzetea':        { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Fuzetea.png' },
    'Chips':          { prijs:  3.30, count: 0, img: 'assets/rockwerchter/Chips.png' },
    'Cup Refund':     { prijs: -0.70, count: 0, img: 'assets/rockwerchter/CupRefund.png' }
};

// ===============================================
// HAMBURGER MENU
// ===============================================

const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');
if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
    navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        });
    });
}

// ===============================================
// AUTH STATE
// ===============================================

onAuthStateChanged(auth, async (user) => {
    const loginLink    = document.getElementById('loginLink');
    const loginBanner  = document.getElementById('loginBanner');
    const orderSummary = document.getElementById('orderSummary');
    const paymentBtns  = document.getElementById('paymentButtons');

    initializeDrankjes();

    if (user) {
        currentUser = user;
        isLoggedIn  = true;
        try {
            const q    = query(collection(db, 'users'), where('uid', '==', user.uid));
            const snap = await getDocs(q);
            if (!snap.empty) {
                currentUserData = snap.docs[0].data();
                if (loginLink)    loginLink.textContent     = 'PROFIEL';
                if (loginBanner)  loginBanner.style.display = 'none';
                if (orderSummary) orderSummary.style.display = 'block';
                if (paymentBtns)  paymentBtns.style.display  = 'flex';
            } else { guestMode(); }
        } catch (e) { console.error(e); guestMode(); }
    } else {
        currentUser = null; currentUserData = null; isLoggedIn = false;
        if (loginLink) loginLink.textContent = 'LOGIN';
        guestMode();
    }
});

function guestMode() {
    const el = (id) => document.getElementById(id);
    if (el('loginBanner'))  el('loginBanner').style.display  = 'flex';
    if (el('orderSummary')) el('orderSummary').style.display = 'none';
    if (el('paymentButtons')) el('paymentButtons').style.display = 'none';
}

// ===============================================
// DRANKJES GRID
// ===============================================

function initializeDrankjes() {
    const container = document.getElementById('drankContainer');
    container.innerHTML = '';
    for (const naam in drankjes) container.appendChild(createDrankCard(naam, drankjes[naam]));
}

function createDrankCard(naam, drankje) {
    const card   = document.createElement('div');
    card.className = 'drank-card';
    const prijs  = drankje.prijs < 0
        ? `- ${formatEuro(Math.abs(drankje.prijs))}`
        : formatEuro(drankje.prijs);
    card.innerHTML = `
        <div class="drank-img-wrapper">
            <img src="${drankje.img}" alt="${naam}" class="drank-img"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="drank-img-fallback" style="display:none;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                    <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
                </svg>
            </div>
            <div class="drank-count-badge" id="badge-${naam.replace(/\s+/g,'-')}" style="display:none;">0</div>
        </div>
        <p class="drank-naam">${naam}</p>
        <p class="drank-prijs">${prijs}</p>`;
    card.addEventListener('click', () => {
        if (!isLoggedIn) {
            card.classList.add('shake');
            setTimeout(() => card.classList.remove('shake'), 600);
            return;
        }
        voegToe(naam);
    });
    return card;
}

// ===============================================
// BESTELLING LOGICA
// ===============================================

function voegToe(naam, aantal = 1) {
    if (!isLoggedIn) return;
    if (naam === 'Cup Refund') {
        const max = drankjes['Primus'].count + drankjes['Mystic'].count + drankjes['Cava of Wijn'].count;
        if (drankjes['Cup Refund'].count + aantal > max) {
            alert('Je kan maximum 1 refund per beker drankje indienen.');
            return;
        }
    }
    drankjes[naam].count += aantal;
    updateCardBadge(naam); updateTotaal(); updateOverzicht(); updatePaymentButtons();
}

function verwijder(naam) {
    if (!isLoggedIn || drankjes[naam].count === 0) return;
    drankjes[naam].count--;
    clampRefunds(naam);
    updateCardBadge(naam); updateTotaal(); updateOverzicht(); updatePaymentButtons();
}

function verwijderAlles(naam) {
    if (!isLoggedIn) return;
    drankjes[naam].count = 0;
    clampRefunds(naam);
    updateCardBadge(naam); updateTotaal(); updateOverzicht(); updatePaymentButtons();
}

function clampRefunds(naam) {
    if (['Primus','Mystic','Cava of Wijn'].includes(naam)) {
        const max = drankjes['Primus'].count + drankjes['Mystic'].count + drankjes['Cava of Wijn'].count;
        if (drankjes['Cup Refund'].count > max) {
            drankjes['Cup Refund'].count = max;
            updateCardBadge('Cup Refund');
        }
    }
}

function updateCardBadge(naam) {
    const badge = document.getElementById(`badge-${naam.replace(/\s+/g,'-')}`);
    if (badge) {
        const c = drankjes[naam].count;
        badge.textContent = c;
        badge.style.display = c > 0 ? 'flex' : 'none';
    }
}

function getTotaal() {
    let t = 0;
    for (const n in drankjes) t += drankjes[n].prijs * drankjes[n].count;
    return t;
}

function heeftItems() {
    for (const n in drankjes) if (drankjes[n].count > 0) return true;
    return false;
}

function formatEuro(n) {
    return `\u20AC${n.toFixed(2).replace('.', ',')}`;
}

function updateTotaal() {
    const el = document.getElementById('totaalPrijs');
    if (el) el.textContent = `Totaal: ${formatEuro(getTotaal())}`;
}

function updatePaymentButtons() {
    const heeft = heeftItems() && isLoggedIn;
    ['kaartBtn','qrBtn','cashBtn'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.disabled = !heeft;
    });
}

function updateOverzicht() {
    const el = document.getElementById('overzichtContainer');
    el.innerHTML = '';
    let iets = false;
    for (const naam in drankjes) {
        const d = drankjes[naam];
        if (d.count > 0) {
            iets = true;
            const item = document.createElement('div');
            item.className = 'overzicht-item';
            item.innerHTML = `
                <span class="item-naam">${d.count}\u00D7 ${naam}</span>
                <div class="item-knoppen">
                    <button class="item-btn plus-btn">+3</button>
                    <button class="item-btn min-btn">\u22121</button>
                    <button class="item-btn delete-btn">\u00D7</button>
                </div>`;
            item.querySelector('.plus-btn').addEventListener('click',   () => voegToe(naam, 3));
            item.querySelector('.min-btn').addEventListener('click',    () => verwijder(naam));
            item.querySelector('.delete-btn').addEventListener('click', () => verwijderAlles(naam));
            el.appendChild(item);
        }
    }
    if (!iets) el.innerHTML = '<p class="empty-message">Nog niets geselecteerd.</p>';
}

function resetAlles() {
    if (!confirm('Weet je zeker dat je alles wilt resetten?')) return;
    for (const n in drankjes) { drankjes[n].count = 0; updateCardBadge(n); }
    updateTotaal(); updateOverzicht(); updatePaymentButtons();
}

document.getElementById('resetBtn').addEventListener('click', resetAlles);

// ===============================================
// FIRESTORE – BESTELLING OPSLAAN
// Vereist deze Firestore security rule:
//   match /rockwerchter_bestellingen/{doc} {
//     allow read, write: if request.auth != null;
//   }
// ===============================================

async function slaBestellingOp(methode, extra = {}) {
    const items = {};
    let aantalItems = 0;
    for (const n in drankjes) {
        if (drankjes[n].count > 0) {
            items[n] = {
                count:     drankjes[n].count,
                prijs:     drankjes[n].prijs,
                subtotaal: +(drankjes[n].prijs * drankjes[n].count).toFixed(2)
            };
            aantalItems += drankjes[n].count;
        }
    }
    const bestellingDoc = {
        userId:        currentUser?.uid ?? 'gast',
        userName:      currentUserData?.naam ?? 'Onbekend',
        items,
        aantalItems,
        totaal:        +getTotaal().toFixed(2),
        betaalmethode: methode,
        datum:         serverTimestamp(),
        ...extra
    };
    const ref = await addDoc(collection(db, 'rockwerchter_bestellingen'), bestellingDoc);
    console.log('Bestelling opgeslagen:', ref.id);
    return ref.id;
}

// ===============================================
// MODAL HELPERS
// ===============================================

function openModal(id)  { document.getElementById(id)?.classList.add('active');    document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); document.body.style.overflow = ''; }

document.querySelectorAll('.rw-modal-backdrop').forEach(bd => {
    bd.addEventListener('click', e => {
        if (e.target === bd) { bd.classList.remove('active'); document.body.style.overflow = ''; }
    });
});

function resetNaBetaling() {
    for (const n in drankjes) { drankjes[n].count = 0; updateCardBadge(n); }
    updateTotaal(); updateOverzicht(); updatePaymentButtons();
}

// ===============================================
// 1) KAART
// ===============================================

let geselecteerdeTerminal = null;

document.getElementById('kaartBtn').addEventListener('click', () => {
    document.getElementById('kaartTotaal').textContent = `Te betalen: ${formatEuro(getTotaal())}`;
    document.getElementById('kaartStatus').style.display = 'none';
    document.getElementById('kaartBevestig').disabled = true;
    geselecteerdeTerminal = null;
    document.querySelectorAll('.terminal-btn').forEach(b => b.classList.remove('selected'));
    openModal('kaartModal');
});
document.getElementById('kaartModalClose').addEventListener('click',  () => closeModal('kaartModal'));
document.getElementById('kaartModalCancel').addEventListener('click', () => closeModal('kaartModal'));

document.querySelectorAll('.terminal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.terminal-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        geselecteerdeTerminal = btn.dataset.terminal;
        document.getElementById('kaartBevestig').disabled = false;
    });
});

document.getElementById('kaartBevestig').addEventListener('click', async () => {
    const btn = document.getElementById('kaartBevestig');
    const st  = document.getElementById('kaartStatus');
    btn.disabled = true; btn.textContent = 'Bezig...';
    try {
        const id = await slaBestellingOp('kaart', { terminal: `Terminal ${geselecteerdeTerminal}` });
        st.className = 'modal-status success';
        st.innerHTML = `\u2713 Verzonden naar Terminal ${geselecteerdeTerminal}!<br><small>ID: ${id}</small>`;
        st.style.display = 'block';
        btn.textContent = 'Verzonden \u2713';
        setTimeout(() => { closeModal('kaartModal'); btn.textContent = 'Verzenden naar terminal'; btn.disabled = false; resetNaBetaling(); }, 2500);
    } catch {
        st.className = 'modal-status error';
        st.textContent = 'Fout bij opslaan. Probeer opnieuw.';
        st.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Verzenden naar terminal';
    }
});

// ===============================================
// 2) PAYCONIQ – QR-code met bedrag in centen
//
// Hoe het werkt:
//   - Het totaalbedrag wordt omgezet naar centen
//     (bv. €12,60 → 1260)
//   - Dit cijfer wordt als ?amount=1260 meegegeven
//     in de Payconiq merchant deep-link
//   - De QRCode-library genereert hiervan een QR
//   - De klant scant de QR → Payconiq opent met
//     het bedrag al ingevuld
//
// Vereiste: jouw club moet een Payconiq
// merchant account hebben.  Vervang
// PAYCONIQ_MERCHANT_ID bovenaan dit bestand.
// ===============================================

document.getElementById('qrBtn').addEventListener('click', () => {
    const totaal         = getTotaal();
    const bedragInCenten = Math.round(totaal * 100);

    document.getElementById('qrTotaal').textContent = `Te betalen: ${formatEuro(totaal)}`;
    document.getElementById('qrStatus').style.display = 'none';

    // Payconiq merchant deep-link met bedrag
    const payconiqUrl =
        `https://payconiq.com/merchant/1/${PAYCONIQ_MERCHANT_ID}` +
        `?amount=${bedragInCenten}&description=VVS+Rockwerchter`;

    // QR genereren via cdn.jsdelivr.net/npm/qrcode
    const canvas = document.getElementById('qrCanvas');
    if (typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvas, payconiqUrl, {
            width:  220,
            margin: 2,
            color:  { dark: '#1a1a1a', light: '#ffffff' }
        }, err => { if (err) console.error('QR fout:', err); });
    } else {
        console.warn('QRCode library niet geladen');
    }

    openModal('qrModal');
});

document.getElementById('qrModalClose').addEventListener('click',  () => closeModal('qrModal'));
document.getElementById('qrModalCancel').addEventListener('click', () => closeModal('qrModal'));

document.getElementById('qrBevestig').addEventListener('click', async () => {
    const btn = document.getElementById('qrBevestig');
    const st  = document.getElementById('qrStatus');
    btn.disabled = true; btn.textContent = 'Bezig...';
    try {
        const id = await slaBestellingOp('payconiq');
        st.className = 'modal-status success';
        st.innerHTML = `\u2713 Payconiq betaling bevestigd!<br><small>ID: ${id}</small>`;
        st.style.display = 'block';
        btn.textContent = 'Bevestigd \u2713';
        setTimeout(() => { closeModal('qrModal'); btn.textContent = 'Betaling bevestigen'; btn.disabled = false; resetNaBetaling(); }, 2500);
    } catch {
        st.className = 'modal-status error';
        st.textContent = 'Fout bij opslaan. Probeer opnieuw.';
        st.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Betaling bevestigen';
    }
});

// ===============================================
// 3) CASH – snelknoppen + typveld + wisselgeld
// ===============================================

let cashOntvangen = 0;

function updateCashUI() {
    const totaal   = getTotaal();
    const input    = document.getElementById('cashOntvangen');
    const wDisplay = document.getElementById('wisselgeldDisplay');
    const wBedrag  = document.getElementById('wisselgeldBedrag');
    const btn      = document.getElementById('cashBevestig');

    input.value = cashOntvangen > 0 ? cashOntvangen.toFixed(2) : '';

    if (cashOntvangen > 0) {
        const wisselgeld = cashOntvangen - totaal;
        wDisplay.style.display = 'flex';
        if (wisselgeld < -0.001) {
            wBedrag.textContent = `Te weinig (${formatEuro(Math.abs(wisselgeld))} tekort)`;
            wBedrag.className   = 'wisselgeld-bedrag te-weinig';
            btn.disabled        = true;
        } else {
            wBedrag.textContent = formatEuro(Math.max(0, wisselgeld));
            wBedrag.className   = 'wisselgeld-bedrag';
            btn.disabled        = false;
        }
    } else {
        wDisplay.style.display = 'none';
        btn.disabled = true;
    }
}

// Snelknoppen: cumulatief optellen
document.querySelectorAll('.cash-snel-btn[data-bedrag]').forEach(btn => {
    btn.addEventListener('click', () => {
        cashOntvangen = +(cashOntvangen + parseFloat(btn.dataset.bedrag)).toFixed(2);
        updateCashUI();
    });
});

// Vinkje = exact bedrag
document.getElementById('cashExact').addEventListener('click', () => {
    cashOntvangen = +getTotaal().toFixed(2);
    updateCashUI();
});

// Kruisje = reset
document.getElementById('cashReset').addEventListener('click', () => {
    cashOntvangen = 0;
    updateCashUI();
});

// Handmatig typen
document.getElementById('cashOntvangen').addEventListener('input', (e) => {
    cashOntvangen = parseFloat(e.target.value) || 0;
    updateCashUI();
});

// Open cash modal
document.getElementById('cashBtn').addEventListener('click', () => {
    cashOntvangen = 0;
    document.getElementById('cashTotaal').textContent    = `Te betalen: ${formatEuro(getTotaal())}`;
    document.getElementById('cashOntvangen').value       = '';
    document.getElementById('wisselgeldDisplay').style.display = 'none';
    document.getElementById('cashBevestig').disabled     = true;
    document.getElementById('cashStatus').style.display  = 'none';
    openModal('cashModal');
});

document.getElementById('cashModalClose').addEventListener('click',  () => closeModal('cashModal'));
document.getElementById('cashModalCancel').addEventListener('click', () => closeModal('cashModal'));

document.getElementById('cashBevestig').addEventListener('click', async () => {
    const totaal     = getTotaal();
    const wisselgeld = +(cashOntvangen - totaal).toFixed(2);
    const btn        = document.getElementById('cashBevestig');
    const st         = document.getElementById('cashStatus');
    btn.disabled = true; btn.textContent = 'Bezig...';
    try {
        const id = await slaBestellingOp('cash', { ontvangen: +cashOntvangen.toFixed(2), wisselgeld });
        st.className = 'modal-status success';
        st.innerHTML = `\u2713 Cash geregistreerd! Wisselgeld: ${formatEuro(Math.max(0, wisselgeld))}<br><small>ID: ${id}</small>`;
        st.style.display = 'block';
        btn.textContent = 'Geregistreerd \u2713';
        setTimeout(() => { closeModal('cashModal'); btn.textContent = 'Bevestigen'; btn.disabled = false; resetNaBetaling(); }, 2500);
    } catch {
        st.className = 'modal-status error';
        st.textContent = 'Fout bij opslaan. Probeer opnieuw.';
        st.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Bevestigen';
    }
});

console.log('Rockwerchter.js initialization complete');
