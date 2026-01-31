// ===============================================
// ADMIN PAGE - FINAL FIX
// V.V.S Rotselaar
// Fix: CreateUser zonder admin logout + form validation
// ===============================================

import { auth, db, app } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

console.log('Admin.js loaded (FINAL FIX VERSION)');

// ===============================================
// SECONDARY FIREBASE APP FOR USER CREATION
// Dit voorkomt dat de admin uitlogt bij nieuwe user
// ===============================================

// We gebruiken dezelfde config als de main app
// maar als een aparte instance
let secondaryApp = null;
let secondaryAuth = null;

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
// GLOBAL VARIABLES
// ===============================================

let currentUser = null;
let currentUserData = null;
let allMembers = [];
let allEvenementen = [];

// ===============================================
// ACCESS CONTROL
// ===============================================

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        console.log('User not logged in, redirecting to login');
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = user;
    console.log('User logged in:', user.uid);
    
    try {
        const userQuery = query(collection(db, 'users'), where('uid', '==', user.uid));
        const userSnapshot = await getDocs(userQuery);
        
        if (userSnapshot.empty) {
            console.error('User not found in database');
            window.location.href = 'index.html';
            return;
        }
        
        currentUserData = userSnapshot.docs[0].data();
        console.log('User data loaded:', currentUserData.naam, 'Role:', currentUserData.rol);
        
        if (currentUserData.rol !== 'admin') {
            console.log('User is not admin, redirecting');
            window.location.href = 'index.html';
            return;
        }
        
        console.log('Admin access granted, initializing page...');
        
        // Initialize secondary Firebase app for user creation
        await initializeSecondaryApp();
        
        await initializeAdminPage();
    } catch (error) {
        console.error('Error checking user permissions:', error);
    }
});

async function initializeSecondaryApp() {
    try {
        // Get Firebase config from main app
        const firebaseConfig = app.options;
        
        // Try to get existing secondary app, or create new one
        try {
            secondaryApp = initializeApp(firebaseConfig, 'Secondary');
        } catch (error) {
            // App already exists, that's fine
            console.log('Secondary app already initialized');
            const { getApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
            secondaryApp = getApp('Secondary');
        }
        
        secondaryAuth = getAuth(secondaryApp);
        console.log('Secondary Firebase app initialized for user creation');
    } catch (error) {
        console.error('Error initializing secondary app:', error);
    }
}

// ===============================================
// TAB MANAGEMENT
// ===============================================

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        console.log('Switching to tab:', targetTab);
        
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`${targetTab}Tab`).classList.add('active');
    });
});

// ===============================================
// INITIALIZE ADMIN PAGE
// ===============================================

async function initializeAdminPage() {
    console.log('Initializing admin page...');
    try {
        await loadMembers();
        await loadMatches();
        await loadEvenementen();
        console.log('Admin page initialized successfully');
    } catch (error) {
        console.error('Error initializing admin page:', error);
    }
}

// ===============================================
// MEMBERS MANAGEMENT
// ===============================================

const addMemberBtn = document.getElementById('addMemberBtn');
const memberModal = document.getElementById('memberModal');
const memberForm = document.getElementById('memberForm');
const memberModalCancel = document.getElementById('memberModalCancel');

if (addMemberBtn) {
    addMemberBtn.addEventListener('click', () => {
        console.log('Opening add member modal');
        document.getElementById('memberModalTitle').textContent = 'Nieuw Lid Toevoegen';
        document.getElementById('memberUid').value = '';
        memberForm.reset();
        
        // Show and enable password field for new members
        const passwordField = document.getElementById('memberPassword');
        const passwordGroup = passwordField.closest('.form-group');
        if (passwordGroup) {
            passwordGroup.style.display = 'block';
            passwordField.required = true;
            passwordField.disabled = false;
        }
        
        memberModal.classList.add('active');
    });
}

if (memberModalCancel) {
    memberModalCancel.addEventListener('click', () => {
        memberModal.classList.remove('active');
    });
}

if (memberForm) {
    memberForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('memberName').value.trim();
        const email = document.getElementById('memberEmail').value.trim();
        const passwordField = document.getElementById('memberPassword');
        const password = passwordField ? passwordField.value : '';
        const categorie = document.getElementById('memberCategorie').value;
        const role = document.getElementById('memberRole').value;
        const uid = document.getElementById('memberUid').value;
        
        console.log('Submitting member form:', { name, email, categorie, role, isUpdate: !!uid });
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig...';
        }
        
        try {
            if (uid) {
                // Update existing member
                console.log('Updating member with UID:', uid);
                const memberQuery = query(collection(db, 'users'), where('uid', '==', uid));
                const memberSnapshot = await getDocs(memberQuery);
                
                if (!memberSnapshot.empty) {
                    const memberDoc = memberSnapshot.docs[0];
                    const updateData = {
                        naam: name,
                        email: email,
                        categorie: categorie,
                        rol: role
                    };
                    
                    console.log('Updating document:', memberDoc.id, updateData);
                    await updateDoc(doc(db, 'users', memberDoc.id), updateData);
                    console.log('Member updated successfully');
                    
                    alert('Lid bijgewerkt!');
                    memberModal.classList.remove('active');
                    memberForm.reset();
                    await loadMembers();
                }
            } else {
                // Create new member using SECONDARY AUTH
                // This prevents the admin from being logged out!
                console.log('Creating new member using secondary auth...');
                
                if (!password || password.length < 6) {
                    throw new Error('Wachtwoord moet minimaal 6 karakters zijn');
                }
                
                if (!secondaryAuth) {
                    throw new Error('Secondary auth not initialized. Please refresh the page.');
                }
                
                // Create user in Firebase Auth using SECONDARY app
                console.log('Creating Firebase Auth user (secondary)...');
                const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
                const newUser = userCredential.user;
                console.log('Auth user created with UID:', newUser.uid);
                
                // Sign out the secondary auth immediately
                await secondaryAuth.signOut();
                console.log('Secondary auth signed out');
                
                // Add user to Firestore using MAIN db instance
                const userData = {
                    uid: newUser.uid,
                    naam: name,
                    email: email,
                    rol: role,
                    categorie: categorie
                };
                
                console.log('Adding user to Firestore:', userData);
                const docRef = await addDoc(collection(db, 'users'), userData);
                console.log('User document created with ID:', docRef.id);
                
                // Admin blijft ingelogd! 🎉
                console.log('New user created successfully. Admin remains logged in.');
                
                alert('Nieuw lid succesvol toegevoegd!');
                memberModal.classList.remove('active');
                memberForm.reset();
                await loadMembers();
            }
            
        } catch (error) {
            console.error('Error saving member:', error);
            console.error('Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            
            let errorText = 'Er is een fout opgetreden: ' + error.message;
            
            if (error.code === 'auth/email-already-in-use') {
                errorText = 'Dit e-mailadres is al in gebruik.';
            } else if (error.code === 'auth/weak-password') {
                errorText = 'Het wachtwoord is te zwak. Gebruik minimaal 6 karakters.';
            } else if (error.code === 'permission-denied') {
                errorText = 'Geen toestemming. Controleer of je ingelogd bent als admin en of de Firebase Security Rules correct zijn.';
            }
            
            alert(errorText);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Opslaan';
            }
        }
    });
}

async function loadMembers() {
    const membersList = document.getElementById('membersList');
    if (!membersList) {
        console.error('membersList element not found');
        return;
    }
    
    membersList.innerHTML = '<div class="loading">Laden...</div>';
    console.log('Loading members...');
    
    try {
        const membersSnapshot = await getDocs(collection(db, 'users'));
        allMembers = [];
        
        membersList.innerHTML = '';
        
        if (membersSnapshot.empty) {
            console.log('No members found');
            membersList.innerHTML = '<p class="text-center">Geen leden gevonden.</p>';
            return;
        }
        
        console.log('Found', membersSnapshot.size, 'members');
        
        membersSnapshot.forEach(docSnap => {
            const member = { id: docSnap.id, ...docSnap.data() };
            allMembers.push(member);
            
            const memberCard = createMemberCard(member);
            membersList.appendChild(memberCard);
        });
        
        console.log('Members loaded successfully');
        
    } catch (error) {
        console.error('Error loading members:', error);
        membersList.innerHTML = '<p class="text-center">Fout bij laden: ' + error.message + '</p>';
    }
}

function createMemberCard(member) {
    const card = document.createElement('div');
    card.className = 'member-card';
    
    const roleText = member.rol === 'admin' ? 'Admin' : 'Speler';
    const categorieText = member.categorie || 'Geen categorie';
    
    card.innerHTML = `
        <div class="member-info">
            <h4>${member.naam}</h4>
            <p>${member.email}</p>
            <span class="member-badge">${roleText}</span>
            <span class="member-badge">${categorieText}</span>
        </div>
        <div class="card-actions">
            <button class="action-btn edit" data-id="${member.id}">Bewerken</button>
            <button class="action-btn delete" data-id="${member.id}">Verwijderen</button>
        </div>
    `;
    
    card.querySelector('.edit').addEventListener('click', () => editMember(member));
    card.querySelector('.delete').addEventListener('click', () => deleteMember(member));
    
    return card;
}

function editMember(member) {
    console.log('Editing member:', member.naam);
    document.getElementById('memberModalTitle').textContent = 'Lid Bewerken';
    document.getElementById('memberUid').value = member.uid;
    document.getElementById('memberName').value = member.naam;
    document.getElementById('memberEmail').value = member.email;
    document.getElementById('memberCategorie').value = member.categorie || 'veteranen';
    document.getElementById('memberRole').value = member.rol || 'speler';
    
    // CRITICAL FIX: Hide password field completely when editing
    const passwordField = document.getElementById('memberPassword');
    const passwordGroup = passwordField.closest('.form-group');
    if (passwordGroup) {
        passwordGroup.style.display = 'none';
        passwordField.required = false; // Not required
        passwordField.disabled = true;  // Disabled to prevent validation
        passwordField.value = '';       // Clear value
    }
    
    memberModal.classList.add('active');
}

async function deleteMember(member) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');
    
    confirmMessage.textContent = `Weet je zeker dat je ${member.naam} wilt verwijderen? (Dit verwijdert alleen het Firestore document, niet het Firebase Auth account)`;
    confirmModal.classList.add('active');
    
    confirmCancel.onclick = () => {
        confirmModal.classList.remove('active');
    };
    
    confirmDelete.onclick = async () => {
        try {
            console.log('Deleting member:', member.naam);
            
            const memberQuery = query(collection(db, 'users'), where('uid', '==', member.uid));
            const memberSnapshot = await getDocs(memberQuery);
            
            if (!memberSnapshot.empty) {
                const memberDoc = memberSnapshot.docs[0];
                await deleteDoc(doc(db, 'users', memberDoc.id));
                console.log('Member deleted successfully from Firestore');
            }
            
            confirmModal.classList.remove('active');
            await loadMembers();
        } catch (error) {
            console.error('Error deleting member:', error);
            alert('Fout bij verwijderen: ' + error.message);
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

if (addMatchBtn) {
    addMatchBtn.addEventListener('click', () => {
        console.log('Opening add match modal');
        document.getElementById('matchModalTitle').textContent = 'Nieuwe Wedstrijd Aanmaken';
        document.getElementById('matchId').value = '';
        matchForm.reset();
        populateDesignatedPersonsSelect();
        matchModal.classList.add('active');
    });
}

if (matchModalCancel) {
    matchModalCancel.addEventListener('click', () => {
        matchModal.classList.remove('active');
    });
}

function populateDesignatedPersonsSelect() {
    const container = document.getElementById('designatedPersonsContainer');
    if (!container) {
        console.error('designatedPersonsContainer not found in HTML');
        return;
    }
    
    container.innerHTML = '';
    
    console.log('Populating designated persons, total members:', allMembers.length);
    
    if (allMembers.length === 0) {
        container.innerHTML = '<p style="padding: 10px;">Geen leden beschikbaar. Voeg eerst leden toe.</p>';
        return;
    }
    
    allMembers.forEach(member => {
        const checkbox = document.createElement('div');
        checkbox.className = 'checkbox-item';
        checkbox.innerHTML = `
            <label>
                <input type="checkbox" name="designatedPerson" value="${member.uid}">
                ${member.naam} (${member.categorie || 'geen categorie'})
            </label>
        `;
        container.appendChild(checkbox);
    });
}

if (matchForm) {
    matchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const matchId = document.getElementById('matchId').value;
        const date = document.getElementById('matchDate').value;
        const time = document.getElementById('matchTime').value;
        const location = document.getElementById('matchLocation').value.trim();
        const homeTeam = document.getElementById('matchHomeTeam').value.trim();
        const awayTeam = document.getElementById('matchAwayTeam').value.trim();
        const team = document.getElementById('matchTeam').value;
        const descriptionField = document.getElementById('matchDescription');
        const description = descriptionField ? descriptionField.value.trim() : '';
        
        // Get selected designated persons
        const checkboxes = document.querySelectorAll('input[name="designatedPerson"]:checked');
        const aangeduidePersonen = Array.from(checkboxes).map(cb => cb.value);
        
        console.log('Submitting match form:', {
            matchId,
            date,
            time,
            location,
            homeTeam,
            awayTeam,
            team,
            description,
            aangeduidePersonen
        });
        
        if (aangeduidePersonen.length === 0) {
            console.warn('No designated persons selected');
            alert('Selecteer minimaal één persoon die toegang heeft tot deze wedstrijd.');
            return;
        }
        
        const matchData = {
            datum: date,
            uur: time,
            locatie: location,
            thuisploeg: homeTeam,
            uitploeg: awayTeam,
            team: team,
            beschrijving: description,
            aangeduidePersonen: aangeduidePersonen,
            status: 'planned',
            scoreThuis: 0,
            scoreUit: 0
        };
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig...';
        }
        
        try {
            if (matchId) {
                console.log('Updating match:', matchId);
                await updateDoc(doc(db, 'matches', matchId), matchData);
                console.log('Match updated successfully');
            } else {
                console.log('Creating new match...');
                const docRef = await addDoc(collection(db, 'matches'), matchData);
                console.log('Match created with ID:', docRef.id);
            }
            
            alert('Wedstrijd opgeslagen!');
            matchModal.classList.remove('active');
            matchForm.reset();
            await loadMatches();
            
        } catch (error) {
            console.error('Error saving match:', error);
            console.error('Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            alert('Fout bij opslaan: ' + error.message + '\n\nControleer de Console (F12) voor meer details.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Opslaan';
            }
        }
    });
}

async function loadMatches() {
    const matchesList = document.getElementById('matchesList');
    if (!matchesList) {
        console.error('matchesList element not found');
        return;
    }
    
    matchesList.innerHTML = '<div class="loading">Laden...</div>';
    console.log('Loading matches...');
    
    try {
        try {
            const matchesQuery = query(collection(db, 'matches'), orderBy('datum', 'desc'));
            const matchesSnapshot = await getDocs(matchesQuery);
            displayMatches(matchesSnapshot);
        } catch (orderError) {
            if (orderError.code === 'failed-precondition') {
                console.log('Index not found, loading without orderBy');
                const matchesSnapshot = await getDocs(collection(db, 'matches'));
                displayMatches(matchesSnapshot);
            } else {
                throw orderError;
            }
        }
    } catch (error) {
        console.error('Error loading matches:', error);
        matchesList.innerHTML = '<p class="text-center">Fout bij laden: ' + error.message + '</p>';
    }
}

function displayMatches(matchesSnapshot) {
    const matchesList = document.getElementById('matchesList');
    matchesList.innerHTML = '';
    
    if (matchesSnapshot.empty) {
        console.log('No matches found');
        matchesList.innerHTML = '<p class="text-center">Geen wedstrijden gevonden.</p>';
        return;
    }
    
    console.log('Found', matchesSnapshot.size, 'matches');
    
    const matches = [];
    matchesSnapshot.forEach(docSnap => {
        matches.push({ id: docSnap.id, ...docSnap.data() });
    });
    
    matches.sort((a, b) => new Date(b.datum) - new Date(a.datum));
    
    matches.forEach(match => {
        const matchCard = createMatchCard(match);
        matchesList.appendChild(matchCard);
    });
    
    console.log('Matches loaded successfully');
}

function createMatchCard(match) {
    const card = document.createElement('div');
    card.className = 'match-card';
    
    const statusBadge = getMatchStatusBadge(match.status);
    const dateFormatted = new Date(match.datum).toLocaleDateString('nl-BE');
    
    // Get designated persons names
    const personenNames = (match.aangeduidePersonen || []).map(uid => {
        const person = allMembers.find(m => m.uid === uid);
        return person ? person.naam : 'Onbekend';
    }).join(', ') || 'Niemand';
    
    card.innerHTML = `
        <div class="match-info-admin">
            <h4>${match.thuisploeg} - ${match.uitploeg}</h4>
            <p>${dateFormatted} om ${match.uur} | ${match.locatie}</p>
            <p>Team: ${match.team || 'Niet gespecificeerd'}</p>
            ${match.beschrijving ? `<p class="match-description">${match.beschrijving}</p>` : ''}
            <p>Toegang: ${personenNames}</p>
            ${statusBadge}
            ${match.status !== 'planned' ? `<span class="member-badge">Score: ${match.scoreThuis || 0} - ${match.scoreUit || 0}</span>` : ''}
        </div>
        <div class="card-actions">
            ${match.status === 'planned' ? `<button class="action-btn edit" data-id="${match.id}">Bewerken</button>` : ''}
            <button class="action-btn delete" data-id="${match.id}">Verwijderen</button>
        </div>
    `;
    
    const editBtn = card.querySelector('.edit');
    if (editBtn) {
        editBtn.addEventListener('click', () => editMatch(match));
    }
    
    card.querySelector('.delete').addEventListener('click', () => deleteMatch(match));
    
    return card;
}

function getMatchStatusBadge(status) {
    const statusMap = {
        'planned': { class: 'upcoming', text: 'Gepland' },
        'live': { class: 'live', text: 'Live' },
        'rust': { class: 'live', text: 'Rust' },
        'finished': { class: 'finished', text: 'Afgelopen' }
    };
    
    const s = statusMap[status] || { class: '', text: status };
    return `<span class="match-badge ${s.class}">${s.text}</span>`;
}

function editMatch(match) {
    console.log('Editing match:', match.thuisploeg, '-', match.uitploeg);
    document.getElementById('matchModalTitle').textContent = 'Wedstrijd Bewerken';
    document.getElementById('matchId').value = match.id;
    document.getElementById('matchDate').value = match.datum;
    document.getElementById('matchTime').value = match.uur;
    document.getElementById('matchLocation').value = match.locatie;
    document.getElementById('matchHomeTeam').value = match.thuisploeg;
    document.getElementById('matchAwayTeam').value = match.uitploeg;
    document.getElementById('matchTeam').value = match.team || 'veteranen';
    
    const descField = document.getElementById('matchDescription');
    if (descField) descField.value = match.beschrijving || '';
    
    populateDesignatedPersonsSelect();
    
    // Check the designated persons
    (match.aangeduidePersonen || []).forEach(uid => {
        const checkbox = document.querySelector(`input[name="designatedPerson"][value="${uid}"]`);
        if (checkbox) checkbox.checked = true;
    });
    
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
            console.log('Deleting match:', match.id);
            
            await deleteDoc(doc(db, 'matches', match.id));
            console.log('Match deleted');
            
            // Delete events
            const eventsQuery = query(collection(db, 'events'), where('matchId', '==', match.id));
            const eventsSnapshot = await getDocs(eventsQuery);
            
            console.log('Deleting', eventsSnapshot.size, 'events');
            
            const deletePromises = eventsSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
            await Promise.all(deletePromises);
            
            confirmModal.classList.remove('active');
            await loadMatches();
        } catch (error) {
            console.error('Error deleting match:', error);
            alert('Fout bij verwijderen: ' + error.message);
        }
    };
}

// ===============================================
// EVENEMENTEN MANAGEMENT
// ===============================================

const addEvenementBtn = document.getElementById('addEvenementBtn');
const evenementModal = document.getElementById('evenementModal');
const evenementForm = document.getElementById('evenementForm');
const evenementModalCancel = document.getElementById('evenementModalCancel');

if (addEvenementBtn) {
    addEvenementBtn.addEventListener('click', () => {
        console.log('Opening add evenement modal');
        document.getElementById('evenementModalTitle').textContent = 'Nieuw Evenement Aanmaken';
        document.getElementById('evenementId').value = '';
        evenementForm.reset();
        evenementModal.classList.add('active');
    });
} else {
    console.warn('addEvenementBtn not found');
}

if (evenementModalCancel) {
    evenementModalCancel.addEventListener('click', () => {
        evenementModal.classList.remove('active');
    });
}

if (evenementForm) {
    evenementForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const evenementId = document.getElementById('evenementId').value;
        const datum = document.getElementById('evenementDatum').value;
        const tijd = document.getElementById('evenementTijd').value;
        const titel = document.getElementById('evenementTitel').value.trim();
        const locatie = document.getElementById('evenementLocatie').value.trim();
        const beschrijving = document.getElementById('evenementBeschrijving').value.trim();
        const afbeeldingNaam = document.getElementById('evenementAfbeelding').value.trim();
        const linkField = document.getElementById('evenementLink');
        const link = linkField ? linkField.value.trim() : '';
        
        console.log('Submitting evenement form:', { titel, datum, tijd });
        
        const evenementData = {
            datum,
            tijd,
            titel,
            locatie,
            beschrijving,
            afbeeldingNaam,
            link,
            createdAt: serverTimestamp()
        };
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig...';
        }
        
        try {
            if (evenementId) {
                console.log('Updating evenement:', evenementId);
                await updateDoc(doc(db, 'evenementen', evenementId), evenementData);
                console.log('Evenement updated');
            } else {
                console.log('Creating new evenement...');
                const docRef = await addDoc(collection(db, 'evenementen'), evenementData);
                console.log('Evenement created with ID:', docRef.id);
            }
            
            alert('Evenement opgeslagen!');
            evenementModal.classList.remove('active');
            evenementForm.reset();
            await loadEvenementen();
            
        } catch (error) {
            console.error('Error saving evenement:', error);
            console.error('Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            alert('Fout bij opslaan: ' + error.message + '\n\nControleer de Console (F12) voor meer details.');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Opslaan';
            }
        }
    });
}

async function loadEvenementen() {
    const evenementenList = document.getElementById('evenementenList');
    if (!evenementenList) {
        console.error('evenementenList element not found');
        return;
    }
    
    evenementenList.innerHTML = '<div class="loading">Laden...</div>';
    console.log('Loading evenementen...');
    
    try {
        const evenementenSnapshot = await getDocs(collection(db, 'evenementen'));
        
        evenementenList.innerHTML = '';
        
        if (evenementenSnapshot.empty) {
            console.log('No evenementen found');
            evenementenList.innerHTML = '<p class="text-center">Geen evenementen gevonden.</p>';
            return;
        }
        
        console.log('Found', evenementenSnapshot.size, 'evenementen');
        
        allEvenementen = [];
        evenementenSnapshot.forEach(docSnap => {
            const evenement = { id: docSnap.id, ...docSnap.data() };
            allEvenementen.push(evenement);
        });
        
        // Sort by date
        allEvenementen.sort((a, b) => new Date(a.datum + 'T' + a.tijd) - new Date(b.datum + 'T' + b.tijd));
        
        allEvenementen.forEach(evenement => {
            const card = createEvenementCard(evenement);
            evenementenList.appendChild(card);
        });
        
        console.log('Evenementen loaded successfully');
        
    } catch (error) {
        console.error('Error loading evenementen:', error);
        evenementenList.innerHTML = '<p class="text-center">Fout bij laden: ' + error.message + '</p>';
    }
}

function createEvenementCard(evenement) {
    const card = document.createElement('div');
    card.className = 'evenement-card';
    
    const dateFormatted = new Date(evenement.datum).toLocaleDateString('nl-BE');
    
    card.innerHTML = `
        <div class="evenement-info">
            <h4>${evenement.titel}</h4>
            <p>${dateFormatted} om ${evenement.tijd}</p>
            <p>${evenement.locatie}</p>
            ${evenement.beschrijving ? `<p class="evenement-description">${evenement.beschrijving.substring(0, 100)}...</p>` : ''}
        </div>
        <div class="card-actions">
            <button class="action-btn edit">Bewerken</button>
            <button class="action-btn delete">Verwijderen</button>
        </div>
    `;
    
    card.querySelector('.edit').addEventListener('click', () => editEvenement(evenement));
    card.querySelector('.delete').addEventListener('click', () => deleteEvenement(evenement));
    
    return card;
}

function editEvenement(evenement) {
    console.log('Editing evenement:', evenement.titel);
    document.getElementById('evenementModalTitle').textContent = 'Evenement Bewerken';
    document.getElementById('evenementId').value = evenement.id;
    document.getElementById('evenementDatum').value = evenement.datum;
    document.getElementById('evenementTijd').value = evenement.tijd;
    document.getElementById('evenementTitel').value = evenement.titel;
    document.getElementById('evenementLocatie').value = evenement.locatie;
    document.getElementById('evenementBeschrijving').value = evenement.beschrijving;
    document.getElementById('evenementAfbeelding').value = evenement.afbeeldingNaam || '';
    
    const linkField = document.getElementById('evenementLink');
    if (linkField) linkField.value = evenement.link || '';
    
    evenementModal.classList.add('active');
}

async function deleteEvenement(evenement) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmDelete = document.getElementById('confirmDelete');
    const confirmCancel = document.getElementById('confirmCancel');
    
    confirmMessage.textContent = `Weet je zeker dat je het evenement "${evenement.titel}" wilt verwijderen?`;
    confirmModal.classList.add('active');
    
    confirmCancel.onclick = () => {
        confirmModal.classList.remove('active');
    };
    
    confirmDelete.onclick = async () => {
        try {
            console.log('Deleting evenement:', evenement.id);
            await deleteDoc(doc(db, 'evenementen', evenement.id));
            console.log('Evenement deleted');
            
            confirmModal.classList.remove('active');
            await loadEvenementen();
        } catch (error) {
            console.error('Error deleting evenement:', error);
            alert('Fout bij verwijderen: ' + error.message);
        }
    };
}

console.log('Admin.js (FINAL FIX) initialization complete');
