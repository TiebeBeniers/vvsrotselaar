// ===== MOBIEL MENU FUNCTIONALITEIT =====
document.addEventListener('DOMContentLoaded', function() {
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');
    const body = document.body;
    
    // Toggle mobiel menu
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', function() {
            mobileMenu.classList.toggle('active');
            
            // Animeer hamburger icoon
            this.classList.toggle('active');
            
            // Voorkom scrollen wanneer menu open is
            if (mobileMenu.classList.contains('active')) {
                body.style.overflow = 'hidden';
            } else {
                body.style.overflow = '';
            }
        });
    }
    
    // Sluit menu wanneer er buiten geklikt wordt
    document.addEventListener('click', function(event) {
        if (mobileMenu.classList.contains('active') && 
            !mobileMenu.contains(event.target) && 
            !mobileMenuToggle.contains(event.target)) {
            mobileMenu.classList.remove('active');
            mobileMenuToggle.classList.remove('active');
            body.style.overflow = '';
        }
    });
    
    // Sluit menu wanneer er op een link geklikt wordt
    const mobileNavLinks = document.querySelectorAll('.mobile-nav .nav-link');
    mobileNavLinks.forEach(link => {
        link.addEventListener('click', function() {
            mobileMenu.classList.remove('active');
            mobileMenuToggle.classList.remove('active');
            body.style.overflow = '';
        });
    });
});

// ===== FUNCTIE VOOR HET LADEN VAN WEDSTRIJDGEGEVENS =====
// Deze functie zal later gebruikt worden om data uit JSON te laden
function loadNextMatch() {
    // Placeholder functie - implementeer later met JSON data
    console.log('Laden van eerstvolgende wedstrijd...');
    
    // Voorbeeld van hoe je later JSON zou kunnen laden:
    // fetch('data/matches.json')
    //     .then(response => response.json())
    //     .then(data => {
    //         updateMatchCard(data);
    //     })
    //     .catch(error => console.error('Error loading match data:', error));
}

// ===== FUNCTIE VOOR HET TONEN VAN AANKONDIGINGEN =====
function checkAnnouncements() {
    // Placeholder functie - implementeer later met JSON data
    const announcementsSection = document.querySelector('.announcements-section');
    
    // Voorbeeld: als er aankondigingen zijn, toon de sectie
    // const hasAnnouncements = false; // Dit komt later uit JSON
    // if (hasAnnouncements) {
    //     announcementsSection.style.display = 'block';
    // } else {
    //     announcementsSection.style.display = 'none';
    // }
}

// ===== SMOOTH SCROLL VOOR INTERNE LINKS =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ===== INITIALISATIE =====
// Roep functies aan wanneer de pagina geladen is
document.addEventListener('DOMContentLoaded', function() {
    loadNextMatch();
    checkAnnouncements();
});
