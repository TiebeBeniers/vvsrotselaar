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

// ===== FUNCTIE VOOR HET LADEN VAN TEAM WEDSTRIJDGEGEVENS =====
function loadTeamNextMatch(teamName) {
    // Placeholder functie - implementeer later met JSON data
    console.log(`Laden van eerstvolgende wedstrijd voor ${teamName}...`);
    
    // Voorbeeld van hoe je later JSON zou kunnen laden:
    // fetch(`data/matches_${teamName.toLowerCase()}.json`)
    //     .then(response => response.json())
    //     .then(data => {
    //         updateMatchCard(data);
    //     })
    //     .catch(error => console.error('Error loading match data:', error));
}

// ===== FUNCTIE VOOR HET LADEN VAN RANGSCHIKKING =====
function loadRanking(teamName) {
    // Placeholder functie - implementeer later met JSON data
    console.log(`Laden van rangschikking voor ${teamName}...`);
    
    // Voorbeeld van hoe je later JSON zou kunnen laden:
    // fetch(`data/ranking_${teamName.toLowerCase()}.json`)
    //     .then(response => response.json())
    //     .then(data => {
    //         updateRankingTable(data);
    //     })
    //     .catch(error => console.error('Error loading ranking data:', error));
}

// ===== FUNCTIE VOOR HET LADEN VAN UITSLAGEN =====
let currentResultsCount = 5; // Aantal momenteel getoonde uitslagen
const resultsPerLoad = 5; // Aantal uitslagen om te laden per keer

function loadResults(teamName, count = 5) {
    // Placeholder functie - implementeer later met JSON data
    console.log(`Laden van laatste ${count} uitslagen voor ${teamName}...`);
    
    // Voorbeeld van hoe je later JSON zou kunnen laden:
    // fetch(`data/results_${teamName.toLowerCase()}.json`)
    //     .then(response => response.json())
    //     .then(data => {
    //         updateResultsList(data.slice(0, count));
    //     })
    //     .catch(error => console.error('Error loading results data:', error));
}

// ===== LOAD MORE FUNCTIONALITEIT =====
document.addEventListener('DOMContentLoaded', function() {
    const loadMoreBtn = document.querySelector('.load-more-btn');
    
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', function() {
            currentResultsCount += resultsPerLoad;
            
            // Hier zou je meer uitslagen laden uit JSON
            // loadResults(teamName, currentResultsCount);
            
            // Placeholder feedback
            this.textContent = 'Meer uitslagen laden...';
            
            setTimeout(() => {
                this.textContent = 'Meer uitslagen laden';
                
                // Optioneel: verberg knop als er geen uitslagen meer zijn
                // if (currentResultsCount >= totalResults) {
                //     this.style.display = 'none';
                // }
            }, 1000);
        });
    }
});

// ===== FUNCTIE VOOR HET UPDATEN VAN MATCH CARD =====
function updateMatchCard(matchData) {
    // Placeholder functie - implementeer later
    // Deze functie zou de match card updaten met echte data
    console.log('Match card updaten met data:', matchData);
}

// ===== FUNCTIE VOOR HET UPDATEN VAN RANGSCHIKKING TABEL =====
function updateRankingTable(rankingData) {
    // Placeholder functie - implementeer later
    // Deze functie zou de rangschikking tabel updaten met echte data
    console.log('Rangschikking tabel updaten met data:', rankingData);
}

// ===== FUNCTIE VOOR HET UPDATEN VAN UITSLAGEN LIJST =====
function updateResultsList(resultsData) {
    // Placeholder functie - implementeer later
    // Deze functie zou de uitslagen lijst updaten met echte data
    console.log('Uitslagen lijst updaten met data:', resultsData);
}

// ===== INITIALISATIE =====
document.addEventListener('DOMContentLoaded', function() {
    // Bepaal welk team dit is op basis van de pagina
    const teamTitle = document.querySelector('.team-title');
    const teamName = teamTitle ? teamTitle.textContent : 'Unknown';
    
    // Laad team-specifieke data
    loadTeamNextMatch(teamName);
    loadRanking(teamName);
    loadResults(teamName, currentResultsCount);
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
