// ===============================================
// PARTNERS.JS  v2
// Cache: CACHE_TTL.static (7 dagen) met SWR
// Sponsors veranderen nauwelijks — 7 dagen is veilig.
// Admin kan cache wissen via: tcClear('clubpartners')
// ===============================================

import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { tcSwr, CACHE_TTL } from './vvs-cache.js';

async function loadPartners() {
    const container = document.getElementById('clubpartnersLijst');
    if (!container) return;

    try {
        await tcSwr(
            'sponsors',
            CACHE_TTL.static,
            async () => {
                const snap = await getDocs(
                    query(collection(db, 'sponsors'), orderBy('volgorde', 'asc'))
                );
                const partners = [];
                snap.forEach(d => partners.push({ id: d.id, ...d.data() }));
                return partners;
            },
            (partners) => render(container, partners)
        );
    } catch (err) {
        console.error('Partners laden mislukt:', err);
        container.innerHTML =
            '<p style="text-align:center;color:var(--danger);padding:3rem 0;">Fout bij laden van sponsors.</p>';
    }
}

function render(container, partners) {
    if (!partners.length) {
        container.innerHTML =
            '<p style="text-align:center;color:var(--text-gray);padding:3rem 0;">Geen sponsors gevonden.</p>';
        return;
    }
    container.innerHTML = '';
    partners.forEach(s => container.appendChild(buildPartnerCard(s)));
}

function buildPartnerCard(partner) {
    const card = document.createElement('div');
    card.className = 'clubpartner-item';

    const logoDiv = document.createElement('div');
    logoDiv.className = 'clubpartner-visual';
    const imgUrl = partner.afbeeldingUrl || (partner.afbeeldingNaam ? 'assets/' + partner.afbeeldingNaam : null);
    if (partner.website) {
        const a = document.createElement('a');
        a.href = partner.website; a.target = '_blank'; a.rel = 'noopener noreferrer';
        if (imgUrl) {
            const img = document.createElement('img');
            img.src = imgUrl;
            img.alt = (partner.naam || '') + ' logo';
            a.appendChild(img);
        }
        logoDiv.appendChild(a);
    } else if (imgUrl) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = (partner.naam || '') + ' logo';
        logoDiv.appendChild(img);
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'clubpartner-tekst';

    const h3 = document.createElement('h3');
    h3.textContent = partner.naam || '';
    infoDiv.appendChild(h3);

    if (partner.beschrijving) {
        const p = document.createElement('p');
        p.textContent = partner.beschrijving;
        infoDiv.appendChild(p);
    }

    if (partner.website) {
        const a = document.createElement('a');
        a.href = partner.website; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'clubpartner-url';
        a.textContent = partner.websiteLabel || 'Bezoek website →';
        infoDiv.appendChild(a);
    }

    card.appendChild(logoDiv);
    card.appendChild(infoDiv);
    return card;
}

loadPartners();