// ===============================================
// ANNOUNCEMENT BANNER
// V.V.S Rotselaar
// Dynamisch announcement systeem met Firebase
// ===============================================

import { db } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Default tekst als er niks in Firebase staat
const DEFAULT_ANNOUNCEMENT = "Bier van de maand: Primus";

// Laad announcement vanuit Firebase
async function loadAnnouncement() {
    try {
        const announcementRef = doc(db, 'settings', 'announcement');
        const announcementDoc = await getDoc(announcementRef);
        
        if (announcementDoc.exists() && announcementDoc.data().text) {
            displayAnnouncement(announcementDoc.data().text);
        } else {
            console.log('Geen announcement in Firebase, gebruik default');
            displayAnnouncement(DEFAULT_ANNOUNCEMENT);
        }
    } catch (error) {
        console.error('Error loading announcement:', error);
        displayAnnouncement(DEFAULT_ANNOUNCEMENT);
    }
}

function displayAnnouncement(text) {
    const announcementContent = document.getElementById('announcementContent');
    
    if (announcementContent) {
        // Maak 4 duplicates voor naadloze oneindig scroll
        const items = Array(9).fill(text).map(txt => 
            `<span class="announcement-item">${txt}</span>`
        ).join('');
        
        announcementContent.innerHTML = items;
    }
}

// Start wanneer de pagina geladen is
document.addEventListener('DOMContentLoaded', () => {
    loadAnnouncement();
});

// Herlaad elke 5 minuten voor updates
setInterval(loadAnnouncement, 5 * 60 * 1000);


