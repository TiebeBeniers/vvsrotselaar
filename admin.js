// ===============================================
// ADMIN PAGE
// ===============================================

import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ===============================================
// HAMBURGER MENU
// ===============================================

const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');

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
// ACCESS CONTROL
// ===============================================

let currentUser = null;
let currentUserData = null;
let allMembers = [];

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        // Not logged in, redirect to login
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = user;
    
    // Check if user is admin
    const userQuery = query(collection(db, 'users'), where('uid', '==', user.uid));
    const userSnapshot = await getDocs(userQuery);
    
    if (userSnapshot.empty) {
        alert('Gebruiker niet gevonden.');
        window.location.href = 'index.html';
        return;
    }
    
    currentUserData = userSnapshot.docs[0].data();
    
    if (currentUserData.rol !== 'admin') {
        window.location.href = 'index.html';
        return;
    }
    
    // Initialize admin page
    initializeAdminPage();
});

// ===============================================
// TAB MANAGEMENT
// ===============================================

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        
        // Remove active class from all tabs
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab
        btn.classList.add('active');
        document.getElementById(`${targetTab}Tab`).classList.add('active');
    });
});

// ===============================================
// INITIALIZE ADMIN PAGE
// ===============================================

async function initializeAdminPage() {
    await loadMembers();
    await loadMatches();
}

// ===============================================
// MEMBERS MANAGEMENT
// ===============================================

const addMemberBtn = document.getElementById('addMemberBtn');
const memberModal = document.getElementById('memberModal');
const memberForm = document.getElementById('memberForm');
const memberModalCancel = document.getElementById('memberModalCancel');

addMemberBtn.addEventListener('click', () => {
    document.getElementById('memberModalTitle').textContent = 'Nieuw Lid Toevoegen';
    document.getElementById('memberUid').value = '';
    memberForm.reset();
    memberModal.classList.add('active');
});

memberModalCancel.addEventListener('click', () => {
    memberModal.classList.remove('active');
});

memberForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('memberName').value;
    const email = document.getElementById('memberEmail').value;
    const password = document.getElementById('memberPassword').value;
    const team = document.getElementById('memberTeam').value;
    const role = document.getElementById('memberRole').value;
    const uid = document.getElementById('memberUid').value;
    
    try {
        if (uid) {
            // Update existing member
            const memberQuery = query(collection(db, 'users'), where('uid', '==', uid));
            const memberSnapshot = await getDocs(memberQuery);
            
            if (!memberSnapshot.empty) {
                const memberDoc = memberSnapshot.docs[0];
                await updateDoc(doc(db, 'users', memberDoc.id), {
                    naam: name,
                    email: email,
                    teams: team,
                    rol: role
                });
                
                alert('Lid succesvol bijgewerkt!');
            }
        } else {
            // Create new member
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const newUser = userCredential.user;
            
            // Add to Firestore
            await addDoc(collection(db, 'users'), {
                uid: newUser.uid,
                naam: name,
                email: email,
                rol: role,
                teams: team
            });
            
            alert('Nieuw lid succesvol toegevoegd!');
        }
        
        memberModal.classList.remove('active');
        memberForm.reset();
        await loadMembers();
        
    } catch (error) {
        console.error('Error saving member:', error);
        
        let errorText = 'Er is een fout opgetreden.';
        if (error.code === 'auth/email-already-in-use') {
            errorText = 'Dit e-mailadres is al in gebruik.';
        } else if (error.code === 'auth/weak-password') {
            errorText = 'Het wachtwoord is te zwak.';
        }
        
        alert(errorText);
    }
});

async function loadMembers() {
    const membersList = document.getElementById('membersList');
    membersList.innerHTML = '<div class="loading">Laden...</div>';
    
    try {
        const membersSnapshot = await getDocs(collection(db, 'users'));
        allMembers = [];
        
        membersList.innerHTML = '';
        
        if (membersSnapshot.empty) {
            membersList.innerHTML = '<p class="text-center">Geen leden gevonden.</p>';
            return;
        }
        
        membersSnapshot.forEach(doc => {
            const member = { id: doc.id, ...doc.data() };
            allMembers.push(member);
            
            const memberCard = createMemberCard(member);
            membersList.appendChild(memberCard);
        });
        
    } catch (error) {
        console.error('Error loading members:', error);
        membersList.innerHTML = '<p class="text-center">Fout bij laden van leden.</p>';
    }
}

function createMemberCard(member) {
    const card = document.createElement('div');
    card.className = 'member-card';
    
    const roleText = member.rol === 'admin' ? 'Admin' : 'Speler';
    const teamText = member.teams || 'Geen team';
    
    card.innerHTML = `
        <div class="member-info">
            <h4>${member.naam}</h4>
            <p>${member.email}</p>
            <span class="member-badge">${roleText}</span>
            <span class="member-badge">${teamText}</span>
        </div>
        <div class="card-actions">
            <button class="action-btn edit" data-id="${member.id}">Bewerken</button>
            <button class="action-btn delete" data-id="${member.id}">Verwijderen</button>
        </div>
    `;
    
    // Edit button
    card.querySelector('.edit').addEventListener('click', () => editMember(member));
    
    // Delete button
    card.querySelector('.delete').addEventListener('click', () => deleteMember(member));
    
    return card;
}

function editMember(member) {
    document.getElementById('memberModalTitle').textContent = 'Lid Bewerken';
    document.getElementById('memberName').value = member.naam;
    document.getElementById('memberEmail').value = member.email;
    document.getElementById('memberPassword').value = '******';
    document.getElementById('memberPassword').disabled = true; // Can't change password here
    document.getElementById('memberTeam').value = member.teams || 'veteranen';
    document.getElementById('memberRole').value = member.rol;
    document.getElementById('memberUid').value = member.uid;
    
    memberModal.classList.add('active');
}

async function deleteMember(member) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');
    
    confirmMessage.textContent = `Weet je zeker dat je ${member.naam} wilt verwijderen?`;
    confirmModal.classList.add('active');
    
    confirmCancel.onclick = () => {
        confirmModal.classList.remove('active');
    };
    
    confirmDelete.onclick = async () => {
        try {
            await deleteDoc(doc(db, 'users', member.id));
            confirmModal.classList.remove('active');
            alert('Lid succesvol verwijderd!');
            await loadMembers();
        } catch (error) {
            console.error('Error deleting member:', error);
            alert('Er is een fout opgetreden bij het verwijderen.');
        }
    };
}

// ===============================================
// MATCHES MANAGEMENT
// ===============================================

const addMatchBtn = document.getElementById('addMatchBtn');
const matchModal = document.getElementById('matchModal');
const matchForm = document.getElementById('matchForm');
const matchModalCancel = document.getElementById('matchModalCancel');

addMatchBtn.addEventListener('click', () => {
    document.getElementById('matchModalTitle').textContent = 'Nieuwe Wedstrijd Aanmaken';
    document.getElementById('matchId').value = '';
    matchForm.reset();
    populateDesignatedPersonDropdown();
    matchModal.classList.add('active');
});

matchModalCancel.addEventListener('click', () => {
    matchModal.classList.remove('active');
});

function populateDesignatedPersonDropdown() {
    const select = document.getElementById('matchDesignatedPerson');
    select.innerHTML = '<option value="">Selecteer een clublid...</option>';
    
    // Only show members with role 'speler' or 'admin'
    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member.uid;
        option.textContent = `${member.naam} (${member.teams || 'geen team'})`;
        select.appendChild(option);
    });
}

matchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const matchId = document.getElementById('matchId').value;
    const date = document.getElementById('matchDate').value;
    const time = document.getElementById('matchTime').value;
    const location = document.getElementById('matchLocation').value;
    const homeTeam = document.getElementById('matchHomeTeam').value;
    const awayTeam = document.getElementById('matchAwayTeam').value;
    const teamType = document.getElementById('matchTeamType').value;
    const designatedPerson = document.getElementById('matchDesignatedPerson').value;
    
    if (!designatedPerson) {
        alert('Selecteer een aangeduide persoon.');
        return;
    }
    
    const matchData = {
        datum: date,
        uur: time,
        locatie: location,
        thuisploeg: homeTeam,
        uitploeg: awayTeam,
        teamType: teamType,
        aangeduidePersoon: designatedPerson,
        status: 'planned',
        scoreThuis: 0,
        scoreUit: 0,
        currentMinute: 0
    };
    
    try {
        if (matchId) {
            // Update existing match
            await updateDoc(doc(db, 'matches', matchId), matchData);
            alert('Wedstrijd succesvol bijgewerkt!');
        } else {
            // Create new match
            await addDoc(collection(db, 'matches'), matchData);
            alert('Wedstrijd succesvol aangemaakt!');
        }
        
        matchModal.classList.remove('active');
        matchForm.reset();
        await loadMatches();
        
    } catch (error) {
        console.error('Error saving match:', error);
        alert('Er is een fout opgetreden bij het opslaan.');
    }
});

async function loadMatches() {
    const matchesList = document.getElementById('matchesList');
    matchesList.innerHTML = '<div class="loading">Laden...</div>';
    
    try {
        const matchesQuery = query(collection(db, 'matches'), orderBy('datum', 'desc'));
        const matchesSnapshot = await getDocs(matchesQuery);
        
        matchesList.innerHTML = '';
        
        if (matchesSnapshot.empty) {
            matchesList.innerHTML = '<p class="text-center">Geen wedstrijden gevonden.</p>';
            return;
        }
        
        matchesSnapshot.forEach(doc => {
            const match = { id: doc.id, ...doc.data() };
            const matchCard = createMatchCard(match);
            matchesList.appendChild(matchCard);
        });
        
    } catch (error) {
        console.error('Error loading matches:', error);
        matchesList.innerHTML = '<p class="text-center">Fout bij laden van wedstrijden.</p>';
    }
}

function createMatchCard(match) {
    const card = document.createElement('div');
    card.className = 'match-card';
    
    const statusBadge = getMatchStatusBadge(match.status);
    const dateFormatted = new Date(match.datum).toLocaleDateString('nl-BE');
    
    // Find designated person name
    const designatedPerson = allMembers.find(m => m.uid === match.aangeduidePersoon);
    const personName = designatedPerson ? designatedPerson.naam : 'Onbekend';
    
    card.innerHTML = `
        <div class="match-info-admin">
            <h4>${match.thuisploeg} - ${match.uitploeg}</h4>
            <p>${dateFormatted} om ${match.uur} | ${match.locatie}</p>
            <p>Aangeduide persoon: ${personName}</p>
            ${statusBadge}
            ${match.status !== 'planned' ? `<span class="member-badge">Score: ${match.scoreThuis} - ${match.scoreUit}</span>` : ''}
        </div>
        <div class="card-actions">
            ${match.status === 'planned' ? `<button class="action-btn edit" data-id="${match.id}">Bewerken</button>` : ''}
            <button class="action-btn delete" data-id="${match.id}">Verwijderen</button>
        </div>
    `;
    
    // Edit button (only for planned matches)
    const editBtn = card.querySelector('.edit');
    if (editBtn) {
        editBtn.addEventListener('click', () => editMatch(match));
    }
    
    // Delete button
    card.querySelector('.delete').addEventListener('click', () => deleteMatch(match));
    
    return card;
}

function getMatchStatusBadge(status) {
    let className = 'match-badge';
    let text = '';
    
    switch(status) {
        case 'planned':
            className += ' upcoming';
            text = 'Gepland';
            break;
        case 'live':
            className += ' live';
            text = 'Live';
            break;
        case 'rust':
            className += ' live';
            text = 'Rust';
            break;
        case 'finished':
            className += ' finished';
            text = 'Afgelopen';
            break;
        default:
            text = status;
    }
    
    return `<span class="${className}">${text}</span>`;
}

function editMatch(match) {
    document.getElementById('matchModalTitle').textContent = 'Wedstrijd Bewerken';
    document.getElementById('matchId').value = match.id;
    document.getElementById('matchDate').value = match.datum;
    document.getElementById('matchTime').value = match.uur;
    document.getElementById('matchLocation').value = match.locatie;
    document.getElementById('matchHomeTeam').value = match.thuisploeg;
    document.getElementById('matchAwayTeam').value = match.uitploeg;
    document.getElementById('matchTeamType').value = match.teamType || 'other';
    
    populateDesignatedPersonDropdown();
    document.getElementById('matchDesignatedPerson').value = match.aangeduidePersoon;
    
    matchModal.classList.add('active');
}

async function deleteMatch(match) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');
    
    confirmMessage.textContent = `Weet je zeker dat je de wedstrijd ${match.thuisploeg} - ${match.uitploeg} wilt verwijderen?`;
    confirmModal.classList.add('active');
    
    confirmCancel.onclick = () => {
        confirmModal.classList.remove('active');
    };
    
    confirmDelete.onclick = async () => {
        try {
            // Delete match
            await deleteDoc(doc(db, 'matches', match.id));
            
            // Delete associated events
            const eventsQuery = query(collection(db, 'events'), where('matchId', '==', match.id));
            const eventsSnapshot = await getDocs(eventsQuery);
            
            const deletePromises = eventsSnapshot.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(deletePromises);
            
            confirmModal.classList.remove('active');
            alert('Wedstrijd succesvol verwijderd!');
            await loadMatches();
        } catch (error) {
            console.error('Error deleting match:', error);
            alert('Er is een fout opgetreden bij het verwijderen.');
        }
    };
}
