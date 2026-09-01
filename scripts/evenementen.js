import { auth, db } from './firebase-config.js';
import { tcGet, tcSet, CACHE_TTL, PAGE_REFRESHED } from './vvs-cache.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, getDocs, doc, setDoc, deleteDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let currentUser = null;

// ── Auth ──────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const ll = document.getElementById('loginLink');
    if (ll) ll.textContent = user ? 'PROFIEL' : 'LOGIN';
    document.querySelectorAll('.inschrijf-btn-wrap').forEach(w => updateInschrijfButton(w));
});

// ── Load evenementen ──────────────────────────────────────────────────
async function loadEvenementen() {
    const featuredEl = document.getElementById('featuredEvenement');
    const upcomingEl = document.getElementById('upcomingEvenementen');
    const noEvents   = document.getElementById('noEvenementen');

    try {
        // Cache: 6 uur (evenementen veranderen hoogstens een paar keer per maand)
        const _cacheKey = 'evenementen_list';
        const _cachedDocs = tcGet(_cacheKey, CACHE_TTL.event);

        let rawDocs;
        if (_cachedDocs && !PAGE_REFRESHED) {
            // Verse cache — geen Firestore read nodig
            rawDocs = _cachedDocs;
        } else {
            // Cache miss of refresh — laad van Firestore
            const snap = await getDocs(collection(db, 'evenementen'));
            rawDocs = [];
            snap.forEach(d => rawDocs.push({ id: d.id, ...d.data() }));
            tcSet(_cacheKey, rawDocs);
        }

        if (!rawDocs.length) {
            featuredEl.style.display = 'none';
            noEvents.style.display = 'block';
            renderPastEvenementen([]);
            return;
        }

        const now = new Date();
        const upcoming = [];
        const past = [];

        rawDocs.forEach(data => {
            const startDt = new Date(data.datum + 'T' + data.tijd);
            // Einde van het evenement: bij meerdaagse events de eindDatum (+ eindTijd of einde van de dag),
            // anders blijft een evenement gewoon lopen tot het einde van de startdag.
            const endDt = data.eindDatum
                ? new Date(data.eindDatum + 'T' + (data.eindTijd || '23:59'))
                : new Date(data.datum + 'T23:59:59');

            if (endDt > now) {
                upcoming.push({ ...data, dateTime: startDt, isOngoing: startDt <= now });
            } else {
                past.push({ ...data, dateTime: startDt });
            }
        });

        if (upcoming.length === 0) {
            featuredEl.style.display = 'none';
            upcomingEl.innerHTML = '';
            noEvents.style.display = 'block';
        } else {
            noEvents.style.display = 'none';

            // Altijd chronologisch sorteren
            upcoming.sort((a, b) => a.dateTime - b.dateTime);

            // Split: uitgelicht (pinned) vs gewoon
            const pinned  = upcoming.filter(e => e.pinned === true);
            const regular = upcoming.filter(e => !e.pinned);

            // Geen uitgelicht: toon het eerstvolgende als enkel featured card
            if (pinned.length === 0 && regular.length > 0) {
                pinned.push(regular.shift());
            }

            featuredEl.innerHTML = '';
            featuredEl.classList.remove('loading');
            featuredEl.style.display = '';

            if (pinned.length === 1) {
                // Enkel: groot split-layout
                featuredEl.appendChild(buildFeaturedCard(pinned[0], false));
            } else {
                // Meerdere: responsive grid
                const grid = document.createElement('div');
                grid.className = 'uitgelicht-grid';
                pinned.forEach(ev => grid.appendChild(buildFeaturedCard(ev, true)));
                featuredEl.appendChild(grid);
            }

            upcomingEl.innerHTML = '';
            regular.forEach(ev => upcomingEl.appendChild(buildSmallCard(ev)));
        }

        renderPastEvenementen(past);

        document.querySelectorAll('.inschrijf-btn-wrap').forEach(w => updateInschrijfButton(w));

    } catch (err) {
        console.error(err);
        featuredEl.innerHTML = '<p class="error">Fout bij laden van evenementen.</p>';
    }
}

// ── Afgelopen evenementen ──────────────────────────────────────────────
function renderPastEvenementen(past) {
    const sectionEl = document.getElementById('pastEvenementenSection');
    const pastEl    = document.getElementById('pastEvenementen');
    if (!sectionEl || !pastEl) return;

    if (!past.length) {
        sectionEl.style.display = 'none';
        pastEl.innerHTML = '';
        return;
    }

    // Meest recent afgelopen eerst
    past.sort((a, b) => b.dateTime - a.dateTime);

    pastEl.innerHTML = '';
    past.forEach(ev => pastEl.appendChild(buildPastCard(ev)));
    sectionEl.style.display = '';
}

function buildPastCard(ev) {
    const card = document.createElement('div');
    card.className = 'evenement-card afgelopen';

    const imgSrc = ev.afbeeldingNaam
        ? (ev.afbeeldingNaam.startsWith('http') ? ev.afbeeldingNaam : 'assets/' + ev.afbeeldingNaam)
        : null;
    const imgHtml = imgSrc
        ? '<img src="' + imgSrc + '" alt="' + htmlEsc(ev.titel) + '">'
        : '<div class="evenement-placeholder"></div>';
    const preview  = ev.beschrijving
        ? (ev.beschrijving.length > 100 ? ev.beschrijving.substring(0, 100) + '...' : ev.beschrijving)
        : '';

    const content = document.createElement('div');
    content.className = 'evenement-card-content';
    content.innerHTML =
        '<h3>' + htmlEsc(ev.titel) + '</h3>' +
        '<p class="evenement-date">' + formatDateRange(ev) + (ev.eindDatum ? '' : (' om ' + htmlEsc(ev.tijd))) + '</p>' +
        '<p class="evenement-location">' + htmlEsc(ev.locatie) + '</p>' +
        '<p class="evenement-preview">' + htmlEsc(preview) + '</p>';

    card.innerHTML = '<div class="evenement-card-image">' + imgHtml + '</div>';
    card.appendChild(content);
    return card;
}

// ── Card builders ─────────────────────────────────────────────────────
function buildFeaturedCard(ev, isGrid = false) {
    const wrap = document.createElement('div');
    // isGrid: compact card in multi-uitgelicht grid; else: full-width split layout
    wrap.className = isGrid ? 'featured-evenement featured-evenement--grid' : 'featured-evenement';

    const dateFmt = formatDateRangeLong(ev);

    const imgSrc = ev.afbeeldingNaam
        ? (ev.afbeeldingNaam.startsWith('http') ? ev.afbeeldingNaam : 'assets/' + ev.afbeeldingNaam)
        : null;
    const imgHtml = imgSrc
        ? '<div class="evenement-image"><img src="' + imgSrc + '" alt="' + htmlEsc(ev.titel) + '"></div>'
        : '';
    const linkHtml = ev.link
        ? '<a href="' + ev.link + '" target="_blank" rel="noopener noreferrer" class="evenement-link">Meer info &rarr;</a>'
        : '';

    const content = document.createElement('div');
    content.className = 'featured-evenement-content';
    content.innerHTML =
        '<h2>' + htmlEsc(ev.titel) + '</h2>' +
        '<div class="evenement-meta">' +
            '<div class="meta-item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
                dateFmt +
            '</div>' +
            '<div class="meta-item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                (ev.eindDatum
                    ? (htmlEsc(ev.tijd) + (ev.eindTijd ? ' — ' + htmlEsc(ev.eindTijd) : '') + ' <span class="period-badge">Meerdaags</span>')
                    : htmlEsc(ev.tijd)) +
            '</div>' +
            '<div class="meta-item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                htmlEsc(ev.locatie) +
            '</div>' +
        '</div>' +
        '<p class="evenement-beschrijving">' + htmlEsc(ev.beschrijving) + '</p>' +
        linkHtml;

    if (ev.inschrijvingenAan) content.appendChild(buildInschrijfWrap(ev));

    wrap.innerHTML = imgHtml;
    wrap.appendChild(content);
    return wrap;
}

function buildSmallCard(ev) {
    const card = document.createElement('div');
    card.className = 'evenement-card ' + (ev.isOngoing ? 'ongoing' : 'disabled');

    const dateFmt  = ev.dateTime.toLocaleDateString('nl-BE');
    const imgSrc = ev.afbeeldingNaam
        ? (ev.afbeeldingNaam.startsWith('http') ? ev.afbeeldingNaam : 'assets/' + ev.afbeeldingNaam)
        : null;
    const imgHtml = imgSrc
        ? '<img src="' + imgSrc + '" alt="' + htmlEsc(ev.titel) + '">'
        : '<div class="evenement-placeholder"></div>';
    const preview  = ev.beschrijving
        ? (ev.beschrijving.length > 100 ? ev.beschrijving.substring(0, 100) + '...' : ev.beschrijving)
        : '';

    const content = document.createElement('div');
    content.className = 'evenement-card-content';
    content.innerHTML =
        '<h3>' + htmlEsc(ev.titel) + '</h3>' +
        '<p class="evenement-date">' + formatDateRange(ev) + (ev.eindDatum ? '' : (' om ' + htmlEsc(ev.tijd))) + (ev.eindDatum ? ' <span class="period-badge">Meerdaags</span>' : '') + '</p>' +
        '<p class="evenement-location">' + htmlEsc(ev.locatie) + '</p>' +
        '<p class="evenement-preview">' + htmlEsc(preview) + '</p>';

    if (ev.inschrijvingenAan) content.appendChild(buildInschrijfWrap(ev));

    card.innerHTML = '<div class="evenement-card-image">' + imgHtml + '</div>';
    card.appendChild(content);
    return card;
}

function buildInschrijfWrap(ev) {
    const wrap = document.createElement('div');
    wrap.className = 'inschrijf-btn-wrap';
    wrap.dataset.evenementId = ev.id;
    wrap.dataset.max = ev.maxDeelnemers || '';
    wrap.dataset.secties = JSON.stringify(getEffectieveSecties(ev));
    wrap.dataset.inschrijfBeschrijving = ev.inschrijfBeschrijving || '';
    wrap.dataset.basisPrijs = ev.basisPrijs || 0;

    const locked = isInschrijvingLocked(ev);
    wrap.dataset.locked = locked ? '1' : '';

    const dagen = parseInt(ev.inschrijfSluitDagenVoor);
    if (!locked && dagen > 0 && ev.dateTime) {
        const lockMoment = new Date(ev.dateTime.getTime() - dagen * 86400000);
        const hint = document.createElement('p');
        hint.className = 'inschrijf-sluit-hint';
        hint.textContent = `⏳ Inschrijven/wijzigen mogelijk tot ${lockMoment.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })}`;
        wrap.appendChild(hint);
    }

    const btn = document.createElement('button');
    btn.className   = 'inschrijf-btn';
    btn.disabled    = true;
    btn.textContent = 'Laden...';
    wrap.appendChild(btn);
    return wrap;
}

// Vanaf X dagen vóór de startdatum: geen nieuwe inschrijvingen, uitschrijvingen
// of wijzigingen meer mogelijk (bv. om een definitief aantal door te geven aan een traiteur).
function isInschrijvingLocked(ev) {
    const dagen = parseInt(ev.inschrijfSluitDagenVoor);
    if (!dagen || isNaN(dagen) || dagen <= 0) return false;
    if (!ev.dateTime) return false;
    const lockMoment = new Date(ev.dateTime.getTime() - dagen * 86400000);
    return new Date() >= lockMoment;
}

// Format a date range: "di 18 mei" of "di 18 mei – vr 21 mei 2025"
function formatDateRange(ev) {
    const startFmt = ev.dateTime.toLocaleDateString('nl-BE', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
    if (!ev.eindDatum) return startFmt;
    const eindDt = new Date(ev.eindDatum + 'T12:00');
    const eindFmt = eindDt.toLocaleDateString('nl-BE', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
    return startFmt + ' — ' + eindFmt;
}

function formatDateRangeLong(ev) {
    const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const startFmt = ev.dateTime.toLocaleDateString('nl-BE', opts);
    if (!ev.eindDatum) return startFmt;
    const eindDt = new Date(ev.eindDatum + 'T12:00');
    const eindFmt = eindDt.toLocaleDateString('nl-BE', opts);
    return startFmt + ' — ' + eindFmt;
}

function htmlEsc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Backwards compat: oude evenementen met platte extraVelden krijgen 1 automatische sectie
function getEffectieveSecties(ev) {
    if (Array.isArray(ev.inschrijfSecties) && ev.inschrijfSecties.length > 0) return ev.inschrijfSecties;
    if (Array.isArray(ev.extraVelden) && ev.extraVelden.length > 0) {
        return [{
            id: 'sectie_legacy', titel: 'Extra personen meebrengen', beschrijving: '',
            verplicht: false, telAlsPersonen: true, velden: ev.extraVelden
        }];
    }
    return [];
}

// ── Inschrijvingen ────────────────────────────────────────────────────
async function updateInschrijfButton(wrap) {
    const btn         = wrap.querySelector('.inschrijf-btn');
    const evenementId = wrap.dataset.evenementId;
    const maxD        = parseInt(wrap.dataset.max) || null;
    if (!btn) return;

    if (!currentUser) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.disabled      = true;
    btn.textContent   = 'Laden...';

    try {
        const myRef  = doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid);
        const mySnap = await getDoc(myRef);
        const isIn   = mySnap.exists();

        btn.onclick = null;

        const existingRow = wrap.querySelector('.inschrijf-btn-row');
        if (existingRow) {
            wrap.insertBefore(btn, existingRow);
            existingRow.remove();
        }

        // Gesloten periode: geen nieuwe inschrijvingen, uitschrijvingen of wijzigingen meer
        if (wrap.dataset.locked === '1') {
            btn.textContent = isIn ? '\u{1F512} Ingeschreven — afgesloten' : '\u{1F512} Inschrijvingen gesloten';
            btn.className   = 'inschrijf-btn locked';
            btn.disabled    = true;
            return;
        }

        const allSnap = await getDocs(collection(db, 'evenementen', evenementId, 'inschrijvingen'));
        const total   = allSnap.size;
        const vol     = maxD && total >= maxD && !isIn;

        const secties = JSON.parse(wrap.dataset.secties || '[]');
        const heeftWijzigbareVelden = secties.some(s => (s.velden || []).some(v => v.wijzigbaar));

        if (isIn) {
            const row = document.createElement('div');
            row.className = 'inschrijf-btn-row';

            btn.textContent = '\u2705 Ingeschreven';
            btn.className   = 'inschrijf-btn ingeschreven';
            btn.style.flex  = '';
            btn.disabled    = false;
            btn.onclick     = () => handleUitschrijven(wrap);

            row.appendChild(btn);

            if (heeftWijzigbareVelden) {
                const extraBtn = document.createElement('button');
                extraBtn.className   = 'inschrijf-extra-btn';
                extraBtn.textContent = 'Aanpassen';
                extraBtn.onclick     = () => openBewerkExtrasPopup(wrap);
                row.appendChild(extraBtn);
            }

            wrap.appendChild(row);
        } else if (vol) {
            btn.textContent = 'Volzet (' + total + '/' + maxD + ')';
            btn.className   = 'inschrijf-btn volzet';
            btn.disabled    = true;
        } else {
            btn.textContent = 'Inschrijven';
            btn.className   = 'inschrijf-btn';
            btn.disabled    = false;
            btn.onclick     = () => openInschrijfPopup(wrap);
        }
    } catch (e) {
        btn.textContent = 'Fout bij laden';
        btn.disabled    = true;
        console.error(e);
    }
}

// ── Popup helpers ─────────────────────────────────────────────────────
function getOrCreateModal() {
    let modal = document.getElementById('inschrijfPopupModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'inschrijfPopupModal';
        modal.className = 'inschrijf-popup-overlay';
        document.body.appendChild(modal);
    }
    return modal;
}

function buildSectiesHtml(secties, bestaandeAntwoorden = []) {
    if (!secties.length) return '';
    return secties.map(sec => {
        if (!sec.velden || sec.velden.length === 0) return '';
        return `
        <div class="inschrijf-popup-extra-sectie">
            <div class="inschrijf-popup-extra-header">
                <span>${htmlEsc(sec.titel || 'Extra vragen')}</span>
                <span class="inschrijf-popup-optioneel ${sec.verplicht ? 'verplicht' : ''}">${sec.verplicht ? 'verplicht' : 'optioneel'}</span>
            </div>
            ${sec.beschrijving ? `<p class="inschrijf-sectie-beschrijving">${htmlEsc(sec.beschrijving)}</p>` : ''}
            ${sec.velden.map(v => {
                const bestaand = bestaandeAntwoorden.find(a => a.veldId === v.id);
                const waarde = bestaand ? (parseInt(bestaand.waarde) || 0) : 0;
                return `
                <div class="inschrijf-popup-veld">
                    <div class="inschrijf-popup-veld-header">
                        <label>${htmlEsc(v.label)}</label>
                        ${v.pricePerUnit > 0
                            ? `<span class="inschrijf-prijs-hint">€${Number(v.pricePerUnit).toFixed(2)} ${htmlEsc(v.eenheid || 'p.p.')}</span>`
                            : `<span class="inschrijf-prijs-hint gratis">Gratis</span>`}
                    </div>
                    ${v.toelichting ? `<small>${htmlEsc(v.toelichting)}</small>` : ''}
                    <div class="inschrijf-aantal-control">
                        <button type="button" class="aantal-minus" data-target="inp_${v.id}">−</button>
                        <input type="number" id="inp_${v.id}" class="inschrijf-popup-input"
                            data-veld-id="${v.id}" data-prijs="${v.pricePerUnit || 0}"
                            min="0" value="${waarde}">
                        <button type="button" class="aantal-plus" data-target="inp_${v.id}">+</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');
}

function clampPositiveInt(inp) {
    const val = parseInt(inp.value);
    inp.value = (isNaN(val) || val < 0) ? 0 : Math.floor(val);
}

function bindVeldControls(modal) {
    modal.querySelectorAll('.aantal-minus, .aantal-plus').forEach(btn => {
        btn.addEventListener('click', () => {
            const inp = modal.querySelector('#' + btn.dataset.target);
            if (!inp) return;
            const delta = btn.classList.contains('aantal-plus') ? 1 : -1;
            inp.value = Math.max(0, (parseInt(inp.value) || 0) + delta);
            inp.dispatchEvent(new Event('input'));
        });
    });
    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
        inp.addEventListener('blur', () => clampPositiveInt(inp));
        inp.addEventListener('keydown', (e) => {
            if (e.key === '-' || e.key === '.' || e.key === ',') e.preventDefault();
        });
    });
}

function updateSamenvatting(modal, secties, isBewerken = false, basisPrijs = 0) {
    const totalDiv  = modal.querySelector('#inschrijfPopupSamenvatting');
    const kostenDiv = modal.querySelector('#inschrijfPopupKosten');

    const veldMeta = {};
    secties.forEach(sec => (sec.velden || []).forEach(v => {
        veldMeta[v.id] = { telAlsPersonen: sec.telAlsPersonen !== false, pricePerUnit: v.pricePerUnit || 0 };
    }));

    let totaalPersonen = 0;
    let totaalKosten = isBewerken ? 0 : basisPrijs;
    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
        const aantal = parseInt(inp.value) || 0;
        const meta = veldMeta[inp.dataset.veldId] || { telAlsPersonen: true, pricePerUnit: parseFloat(inp.dataset.prijs) || 0 };
        if (meta.telAlsPersonen) totaalPersonen += aantal;
        totaalKosten += aantal * meta.pricePerUnit;
    });

    if (totalDiv) {
        if (totaalPersonen === 0) {
            totalDiv.textContent = isBewerken ? 'Geen extra personen' : 'Alleen jezelf — geen extra personen';
            totalDiv.className = 'inschrijf-popup-samenvatting neutraal';
        } else {
            totalDiv.textContent = `Jezelf + ${totaalPersonen} extra persoon${totaalPersonen > 1 ? 'en' : ''} = ${totaalPersonen + 1} personen in totaal`;
            totalDiv.className = 'inschrijf-popup-samenvatting actief';
        }
    }

    if (kostenDiv) {
        if (totaalKosten > 0) {
            kostenDiv.style.display = 'block';
            kostenDiv.textContent = `Te betalen: €${totaalKosten.toFixed(2)}`;
        } else {
            kostenDiv.style.display = 'none';
        }
    }
}

function valideerVerplichteSecties(modal, secties) {
    for (const sec of secties) {
        if (!sec.verplicht) continue;
        const som = (sec.velden || []).reduce((acc, v) => {
            const inp = modal.querySelector(`#inp_${v.id}`);
            return acc + (parseInt(inp?.value) || 0);
        }, 0);
        if (som === 0) return `Vul minstens één aantal in bij "${sec.titel}".`;
    }
    return null;
}

// ── Inschrijven popup ──────────────────────────────────────────────────
function openInschrijfPopup(wrap) {
    const evenementId     = wrap.dataset.evenementId;
    const secties         = JSON.parse(wrap.dataset.secties || '[]');
    const inschrijfBeschr = wrap.dataset.inschrijfBeschrijving || '';
    const basisPrijs      = parseFloat(wrap.dataset.basisPrijs) || 0;
    const modal = getOrCreateModal();
    const sectiesHtml = buildSectiesHtml(secties);
    const heeftPersonenSectie = secties.some(s => s.telAlsPersonen !== false && (s.velden || []).length > 0);

    modal.innerHTML = `
        <div class="inschrijf-popup-card">
            <h3>Inschrijven</h3>
            ${inschrijfBeschr ? `<p class="inschrijf-popup-beschrijving">${htmlEsc(inschrijfBeschr)}</p>` : ''}
            <div class="inschrijf-popup-jijzelf">
                <span class="inschrijf-popup-check">✓</span>
                <span>Jij schrijft jezelf in</span>
                ${basisPrijs > 0 ? `<span class="inschrijf-prijs-hint">€${basisPrijs.toFixed(2)}</span>` : `<span class="inschrijf-prijs-hint gratis">Gratis</span>`}
            </div>
            ${sectiesHtml}
            ${heeftPersonenSectie ? `<div id="inschrijfPopupSamenvatting" class="inschrijf-popup-samenvatting neutraal">Alleen jezelf — geen extra personen</div>` : ''}
            <div id="inschrijfPopupKosten" class="inschrijf-popup-kosten" style="display:none;"></div>
            <div id="inschrijfPopupStatus"></div>
            <div class="inschrijf-popup-actions">
                <button class="inschrijf-popup-btn confirm" id="inschrijfPopupConfirm">Bevestigen</button>
                <button class="inschrijf-popup-btn cancel" id="inschrijfPopupCancel">Annuleren</button>
            </div>
        </div>`;

    modal.style.display = 'flex';
    bindVeldControls(modal);
    updateSamenvatting(modal, secties, false, basisPrijs);
    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp =>
        inp.addEventListener('input', () => updateSamenvatting(modal, secties, false, basisPrijs))
    );
    modal.querySelector('#inschrijfPopupCancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

    modal.querySelector('#inschrijfPopupConfirm').onclick = async () => {
        const confirmBtn = modal.querySelector('#inschrijfPopupConfirm');
        const statusDiv  = modal.querySelector('#inschrijfPopupStatus');

        const validatieFout = valideerVerplichteSecties(modal, secties);
        if (validatieFout) { statusDiv.textContent = validatieFout; return; }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Bezig...';
        statusDiv.textContent = '';

        const extraAntwoorden = [];
        modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
            extraAntwoorden.push({ veldId: inp.dataset.veldId, waarde: inp.value || '0' });
        });

        try {
            let naam = currentUser.displayName || currentUser.email;
            try {
                const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
                if (userSnap.exists() && userSnap.data().name) naam = userSnap.data().name;
            } catch (_) {}

            await setDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid), {
                uid: currentUser.uid, naam, email: currentUser.email,
                extraAntwoorden,
                ingeschrevenOp: new Date()
            });

            modal.style.display = 'none';
            await updateInschrijfButton(wrap);
        } catch (e) {
            statusDiv.textContent = 'Fout: ' + e.message;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Bevestigen';
        }
    };
}

// ── Extra's bewerken popup (na inschrijving) ───────────────────────────
async function openBewerkExtrasPopup(wrap) {
    const evenementId = wrap.dataset.evenementId;
    const alleSecties = JSON.parse(wrap.dataset.secties || '[]');
    // Alleen secties/velden tonen die achteraf wijzigbaar zijn
    const secties = alleSecties
        .map(s => ({ ...s, velden: (s.velden || []).filter(v => v.wijzigbaar) }))
        .filter(s => s.velden.length > 0);
    const modal = getOrCreateModal();

    modal.innerHTML = `<div class="inschrijf-popup-card"><p>Laden...</p></div>`;
    modal.style.display = 'flex';

    let bestaandeAntwoorden = [];
    try {
        const snap = await getDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid));
        if (snap.exists()) bestaandeAntwoorden = snap.data().extraAntwoorden || [];
    } catch (_) {}

    const sectiesHtml = buildSectiesHtml(secties, bestaandeAntwoorden);
    const heeftPersonenSectie = secties.some(s => s.telAlsPersonen !== false && (s.velden || []).length > 0);

    modal.innerHTML = `
        <div class="inschrijf-popup-card">
            <h3>Extra's aanpassen</h3>
            <p class="inschrijf-popup-beschrijving" style="margin-bottom:1rem;">
                Je bent al ingeschreven. Pas hier de aantallen aan.
            </p>
            ${sectiesHtml}
            ${heeftPersonenSectie ? `<div id="inschrijfPopupSamenvatting" class="inschrijf-popup-samenvatting neutraal">Laden...</div>` : ''}
            <div id="inschrijfPopupKosten" class="inschrijf-popup-kosten" style="display:none;"></div>
            <div id="inschrijfPopupStatus"></div>
            <div class="inschrijf-popup-actions">
                <button class="inschrijf-popup-btn confirm" id="inschrijfPopupConfirm">Opslaan</button>
                <button class="inschrijf-popup-btn cancel" id="inschrijfPopupCancel">Annuleren</button>
            </div>
        </div>`;

    modal.style.display = 'flex';
    bindVeldControls(modal);
    modal.querySelectorAll('.inschrijf-popup-input').forEach(inp =>
        inp.addEventListener('input', () => updateSamenvatting(modal, secties, true))
    );
    updateSamenvatting(modal, secties, true);

    modal.querySelector('#inschrijfPopupCancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };

    modal.querySelector('#inschrijfPopupConfirm').onclick = async () => {
        const confirmBtn = modal.querySelector('#inschrijfPopupConfirm');
        const statusDiv  = modal.querySelector('#inschrijfPopupStatus');

        const validatieFout = valideerVerplichteSecties(modal, secties);
        if (validatieFout) { statusDiv.textContent = validatieFout; return; }

        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Bezig...';
        statusDiv.textContent = '';

        // Start van bestaande antwoorden, overschrijf enkel de wijzigbare velden
        const antwoordenMap = new Map(bestaandeAntwoorden.map(a => [a.veldId, a.waarde]));
        modal.querySelectorAll('.inschrijf-popup-input').forEach(inp => {
            antwoordenMap.set(inp.dataset.veldId, inp.value || '0');
        });
        const extraAntwoorden = Array.from(antwoordenMap, ([veldId, waarde]) => ({ veldId, waarde }));

        try {
            await setDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid),
                { extraAntwoorden }, { merge: true });
            modal.style.display = 'none';
            await updateInschrijfButton(wrap);
        } catch (e) {
            statusDiv.textContent = 'Fout: ' + e.message;
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Opslaan';
        }
    };
}

async function handleUitschrijven(wrap) {
    if (!currentUser) return;
    if (!confirm('Wil je je uitschrijven voor dit evenement?')) return;
    const btn         = wrap.querySelector('.inschrijf-btn');
    const evenementId = wrap.dataset.evenementId;
    btn.disabled      = true;
    btn.textContent   = 'Bezig...';
    try {
        await deleteDoc(doc(db, 'evenementen', evenementId, 'inschrijvingen', currentUser.uid));
        await updateInschrijfButton(wrap);
    } catch (e) {
        btn.textContent = 'Fout \u2014 probeer opnieuw';
        btn.disabled    = false;
        console.error(e);
    }
}
loadEvenementen();