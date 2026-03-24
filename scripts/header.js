import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ── Teams dropdown ────────────────────────────────────────────────────────────
const teamsBtn  = document.getElementById('teamsDropdownBtn');
const teamsMenu = document.getElementById('teamsDropdownMenu');

function openDropdown(btn, menu) {
    menu.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
}
function closeDropdown(btn, menu) {
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
}

if (teamsBtn && teamsMenu) {
    teamsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        teamsMenu.classList.contains('open')
            ? closeDropdown(teamsBtn, teamsMenu)
            : openDropdown(teamsBtn, teamsMenu);
    });

    document.addEventListener('click', (e) => {
        if (!teamsBtn.contains(e.target) && !teamsMenu.contains(e.target)) {
            closeDropdown(teamsBtn, teamsMenu);
        }
    });

    teamsMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            closeDropdown(teamsBtn, teamsMenu);
            document.getElementById('hamburger')?.classList.remove('active');
            document.getElementById('navMenu')?.classList.remove('active');
        });
    });
}

// ── Hamburger ─────────────────────────────────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const navMenu   = document.getElementById('navMenu');
if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
    navMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
    }));
}

// ── Evenementen dropdown (enkel voor ingelogde gebruikers) ────────────────────
// We zoeken de <a href="evenementen.html"> en vervangen die (indien ingelogd)
// door een dropdown met "Evenementen" + "Werklijst".

function buildEvenementenDropdown() {
    const navMenu = document.getElementById('navMenu');
    if (!navMenu) return;

    // Bepaal welke pagina actief is
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const evActive = page === 'evenementen.html';
    const wlActive = page === 'werklijst.html';
    const anyActive = evActive || wlActive;

    // Vind de bestaande <li> met de evenementen-link
    const evLink = navMenu.querySelector('a[href="evenementen.html"]');
    if (!evLink) return;
    const evLi = evLink.closest('li');
    if (!evLi) return;

    // Vervang door nav-dropdown structuur
    evLi.className = 'nav-dropdown';
    evLi.innerHTML = `
        <button class="nav-dropdown-btn${anyActive ? ' active' : ''}"
                id="evenementenDropdownBtn"
                aria-expanded="false" aria-haspopup="true">
            EVENEMENTEN
            <svg class="dropdown-chevron" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" width="14" height="14">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
        </button>
        <ul class="nav-dropdown-menu" id="evenementenDropdownMenu">
            <li><a href="evenementen.html"${evActive ? ' class="active"' : ''}>Evenementen</a></li>
            <li><a href="werklijst.html"${wlActive ? ' class="active"' : ''}>Werklijst</a></li>
        </ul>`;

    const btn  = evLi.querySelector('#evenementenDropdownBtn');
    const menu = evLi.querySelector('#evenementenDropdownMenu');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open')
            ? closeDropdown(btn, menu)
            : openDropdown(btn, menu);
    });

    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !menu.contains(e.target)) {
            closeDropdown(btn, menu);
        }
    });

    menu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            closeDropdown(btn, menu);
            document.getElementById('hamburger')?.classList.remove('active');
            document.getElementById('navMenu')?.classList.remove('active');
        });
    });
}

// Auth check: dropdown enkel voor ingelogden
onAuthStateChanged(auth, (user) => {
    const loginLink = document.getElementById('loginLink');
    if (loginLink) loginLink.textContent = user ? 'PROFIEL' : 'LOGIN';

    if (user) {
        buildEvenementenDropdown();
    }
    // Als niet ingelogd: gewone <a href="evenementen.html"> link blijft staan
});
