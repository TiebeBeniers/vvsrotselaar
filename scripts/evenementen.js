// ===== MOBIEL MENU FUNCTIONALITEIT =====
document.addEventListener('DOMContentLoaded', function() {
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');
    const body = document.body;
    
    // Toggle mobiel menu
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', function() {
            mobileMenu.classList.toggle('active');
            this.classList.toggle('active');
            
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

// ===== FUNCTIE VOOR HET LADEN VAN EVENEMENTEN =====
function loadEvents() {
    // Placeholder functie - implementeer later met JSON data
    console.log('Laden van evenementen...');
    
    // Voorbeeld van hoe je later JSON zou kunnen laden:
    // fetch('data/events.json')
    //     .then(response => response.json())
    //     .then(data => {
    //         updateFeaturedEvent(data.featured);
    //         updateUpcomingEvents(data.upcoming);
    //     })
    //     .catch(error => console.error('Error loading events data:', error));
}

// ===== FUNCTIE VOOR HET UPDATEN VAN HET FEATURED EVENEMENT =====
function updateFeaturedEvent(eventData) {
    // Placeholder functie - implementeer later
    // Deze functie zou het featured event updaten met echte data
    console.log('Featured event updaten met data:', eventData);
}

// ===== FUNCTIE VOOR HET UPDATEN VAN AANKOMENDE EVENEMENTEN =====
function updateUpcomingEvents(eventsData) {
    // Placeholder functie - implementeer later
    // Deze functie zou de lijst van aankomende evenementen updaten met echte data
    console.log('Aankomende evenementen updaten met data:', eventsData);
}

// ===== FUNCTIE VOOR HET ACTIVEREN VAN EVENEMENTEN =====
// Deze functie zou bepalen welke evenementen actief/beschikbaar zijn
function checkEventAvailability() {
    // Placeholder functie - implementeer later
    // Deze functie zou checken of het eerstvolgende evenement voorbij is
    // en dan het volgende evenement activeren
    
    // Voorbeeld logica:
    // const currentDate = new Date();
    // const featuredEventDate = new Date('2026-02-15');
    // 
    // if (currentDate > featuredEventDate) {
    //     // Activeer het volgende evenement
    //     activateNextEvent();
    // }
}

// ===== EVENT LISTENER VOOR FEATURED EVENT BUTTON =====
document.addEventListener('DOMContentLoaded', function() {
    const featuredEventBtn = document.querySelector('.event-action-btn');
    
    if (featuredEventBtn) {
        featuredEventBtn.addEventListener('click', function() {
            console.log('Meer informatie over featured event...');
            // Hier zou je naar een detail pagina navigeren of een modal openen
            // window.location.href = 'event-detail.html?id=featured';
        });
    }
});

// ===== VOORKOM KLIKKEN OP DISABLED EVENT CARDS =====
document.addEventListener('DOMContentLoaded', function() {
    const disabledCards = document.querySelectorAll('.event-card.disabled');
    
    disabledCards.forEach(card => {
        card.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('Dit evenement is nog niet beschikbaar');
        });
        
        const disabledBtn = card.querySelector('.event-card-btn.disabled');
        if (disabledBtn) {
            disabledBtn.addEventListener('click', function(e) {
                e.preventDefault();
                console.log('Dit evenement is nog niet beschikbaar');
            });
        }
    });
});

// ===== INITIALISATIE =====
document.addEventListener('DOMContentLoaded', function() {
    loadEvents();
    checkEventAvailability();
});

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
