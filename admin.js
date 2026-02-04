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
        await loadContactberichten();
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
        
        // Reset match type to upcoming (default)
        document.getElementById('matchType').value = 'upcoming';
        document.getElementById('btnUpcoming').classList.add('active');
        document.getElementById('btnFinished').classList.remove('active');
        document.getElementById('scoreFields').style.display = 'none';
        document.getElementById('designatedPersonsGroup').style.display = 'block';
        
        // Remove required from score fields
        document.getElementById('matchHomeScore').removeAttribute('required');
        document.getElementById('matchAwayScore').removeAttribute('required');
        
        populateDesignatedPersonsSelect();
        matchModal.classList.add('active');
    });
}

if (matchModalCancel) {
    matchModalCancel.addEventListener('click', () => {
        matchModal.classList.remove('active');
    });
}

// Match type selector functionality
const btnUpcoming = document.getElementById('btnUpcoming');
const btnFinished = document.getElementById('btnFinished');
const scoreFields = document.getElementById('scoreFields');
const designatedPersonsGroup = document.getElementById('designatedPersonsGroup');
const matchTypeInput = document.getElementById('matchType');
const matchHomeScore = document.getElementById('matchHomeScore');
const matchAwayScore = document.getElementById('matchAwayScore');

if (btnUpcoming) {
    btnUpcoming.addEventListener('click', () => {
        console.log('Switched to upcoming match type');
        btnUpcoming.classList.add('active');
        btnFinished.classList.remove('active');
        scoreFields.style.display = 'none';
        designatedPersonsGroup.style.display = 'block';
        matchTypeInput.value = 'upcoming';
        
        // Remove required from score fields
        matchHomeScore.removeAttribute('required');
        matchAwayScore.removeAttribute('required');
    });
}

if (btnFinished) {
    btnFinished.addEventListener('click', () => {
        console.log('Switched to finished match type');
        btnFinished.classList.add('active');
        btnUpcoming.classList.remove('active');
        scoreFields.style.display = 'flex';
        designatedPersonsGroup.style.display = 'none';
        matchTypeInput.value = 'finished';
        
        // Add required to score fields
        matchHomeScore.setAttribute('required', 'required');
        matchAwayScore.setAttribute('required', 'required');
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
        const matchType = document.getElementById('matchType').value;
        
        console.log('Submitting match form:', {
            matchId,
            date,
            time,
            location,
            homeTeam,
            awayTeam,
            team,
            description,
            matchType
        });
        
        let matchData;
        
        if (matchType === 'upcoming') {
            // Planned match
            const checkboxes = document.querySelectorAll('input[name="designatedPerson"]:checked');
            const aangeduidePersonen = Array.from(checkboxes).map(cb => cb.value);
            
            if (aangeduidePersonen.length === 0) {
                console.warn('No designated persons selected');
                alert('Selecteer minimaal één persoon die toegang heeft tot deze wedstrijd.');
                return;
            }
            
            matchData = {
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
        } else {
            // Finished match
            const homeScore = parseInt(document.getElementById('matchHomeScore').value) || 0;
            const awayScore = parseInt(document.getElementById('matchAwayScore').value) || 0;
            
            // Create timestamp from date and time
            const matchDateTime = new Date(`${date}T${time}`);
            
            matchData = {
                datum: date,
                uur: time,
                locatie: location,
                thuisploeg: homeTeam,
                uitploeg: awayTeam,
                team: team,
                beschrijving: description,
                aangeduidePersonen: [],
                status: 'finished',
                scoreThuis: homeScore,
                scoreUit: awayScore,
                halfTimeReached: true,
                pausedAt: null,
                pausedDuration: 0,
                startedAt: matchDateTime,
                resumeStartedAt: matchDateTime
            };
        }
        
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

// ===============================================
// CONTACTBERICHTEN MANAGEMENT
// ===============================================

let currentFilter = 'all';

async function loadContactberichten() {
    console.log('Loading contactberichten...');
    const container = document.getElementById('contactberichtenList');
    
    if (!container) {
        console.error('Container not found');
        return;
    }
    
    container.innerHTML = '<div class="loading">Laden...</div>';
    
    try {
        // Try to load with ordering - if it fails, we'll catch it and load without ordering
        let snapshot;
        try {
            const berichtenQuery = query(
                collection(db, 'contactberichten'),
                orderBy('datum', 'desc')
            );
            snapshot = await getDocs(berichtenQuery);
        } catch (orderError) {
            // If ordering fails (likely missing index), load without ordering
            console.warn('Could not order by datum, loading without ordering:', orderError.message);
            console.log('You may need to create a Firestore index for this query.');
            
            const berichtenQuery = collection(db, 'contactberichten');
            snapshot = await getDocs(berichtenQuery);
        }
        
        if (snapshot.empty) {
            container.innerHTML = `
                <div class="messages-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                    <h3>Geen berichten</h3>
                    <p>Er zijn nog geen contactberichten ontvangen.</p>
                </div>
            `;
            updateMessageStats(0, 0);
            return;
        }
        
        const berichten = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            berichten.push({ 
                id: docSnap.id, 
                ...data
            });
        });
        
        // Sort manually if we couldn't order in the query
        berichten.sort((a, b) => {
            const dateA = a.datum?.toDate ? a.datum.toDate() : new Date(a.createdAt || 0);
            const dateB = b.datum?.toDate ? b.datum.toDate() : new Date(b.createdAt || 0);
            return dateB - dateA;
        });
        
        console.log('Loaded', berichten.length, 'contactberichten');
        
        // Update stats
        const unreadCount = berichten.filter(b => !b.gelezen).length;
        updateMessageStats(berichten.length, unreadCount);
        
        // Display berichten
        displayContactberichten(berichten);
        
        // Setup filter buttons
        setupFilterButtons(berichten);
        
    } catch (error) {
        console.error('Error loading contactberichten:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        let errorHTML = '<div class="error-message"><p class="error">Fout bij laden van berichten.</p>';
        
        if (error.code === 'permission-denied') {
            errorHTML += '<p>Je hebt geen toegang tot de contactberichten. Controleer je Firestore regels.</p>';
        } else if (error.code === 'failed-precondition' || error.message.includes('index')) {
            errorHTML += '<p>Er is een database index vereist. Klik op de link in de browser console om deze aan te maken.</p>';
        }
        
        errorHTML += '<button onclick="location.reload()" class="retry-btn">Opnieuw proberen</button></div>';
        
        container.innerHTML = errorHTML;
    }
}

function updateMessageStats(total, unread) {
    const totalEl = document.getElementById('totalMessages');
    const unreadEl = document.getElementById('unreadMessages');
    
    if (totalEl) totalEl.textContent = total;
    if (unreadEl) unreadEl.textContent = unread;
}

function setupFilterButtons(berichten) {
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentFilter = btn.getAttribute('data-filter');
            displayContactberichten(berichten);
        });
    });
}

function displayContactberichten(berichten) {
    const container = document.getElementById('contactberichtenList');
    if (!container) return;
    
    // Filter berichten
    let filtered = berichten;
    if (currentFilter === 'unread') {
        filtered = berichten.filter(b => !b.gelezen);
    } else if (currentFilter === 'read') {
        filtered = berichten.filter(b => b.gelezen);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="messages-empty">
                <p>Geen berichten in deze categorie.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    filtered.forEach(bericht => {
        const card = createMessageCard(bericht);
        container.appendChild(card);
    });
}

function createMessageCard(bericht) {
    const card = document.createElement('div');
    card.className = `message-card ${bericht.gelezen ? 'read' : 'unread'}`;
    
    const datum = bericht.datum?.toDate 
        ? bericht.datum.toDate().toLocaleString('nl-BE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
        : 'Onbekende datum';
    
    card.innerHTML = `
        <div class="message-header">
            <div class="message-info">
                <div class="message-email">${bericht.email}</div>
                <div class="message-date">${datum}</div>
            </div>
            <span class="message-badge ${bericht.gelezen ? 'read' : 'unread'}">
                ${bericht.gelezen ? 'Gelezen' : 'Nieuw'}
            </span>
        </div>
        <div class="message-content">${bericht.bericht}</div>
        <div class="message-actions">
            ${!bericht.gelezen ? `
                <button class="message-action-btn mark-read" data-id="${bericht.id}">
                    ✓ Markeer als gelezen
                </button>
            ` : ''}
            <button class="message-action-btn delete" data-id="${bericht.id}">
                🗑 Verwijderen
            </button>
        </div>
    `;
    
    // Add event listeners
    const markReadBtn = card.querySelector('.mark-read');
    if (markReadBtn) {
        markReadBtn.addEventListener('click', () => markAsRead(bericht.id));
    }
    
    const deleteBtn = card.querySelector('.delete');
    deleteBtn.addEventListener('click', () => deleteMessage(bericht.id));
    
    return card;
}

async function markAsRead(berichtId) {
    try {
        console.log('Marking message as read:', berichtId);
        await updateDoc(doc(db, 'contactberichten', berichtId), {
            gelezen: true
        });
        
        console.log('Message marked as read');
        await loadContactberichten();
    } catch (error) {
        console.error('Error marking message as read:', error);
        alert('Fout bij markeren als gelezen: ' + error.message);
    }
}

async function deleteMessage(berichtId) {
    if (!confirm('Weet je zeker dat je dit bericht wilt verwijderen?')) {
        return;
    }
    
    try {
        console.log('Deleting message:', berichtId);
        await deleteDoc(doc(db, 'contactberichten', berichtId));
        
        console.log('Message deleted');
        await loadContactberichten();
    } catch (error) {
        console.error('Error deleting message:', error);
        alert('Fout bij verwijderen: ' + error.message);
    }
}

// ===============================================
// RANKING MANAGEMENT
// ===============================================

let processedRankingData = null;
let currentRankingData = null;

// File upload handler
const rankingFileUpload = document.getElementById('rankingFileUpload');
if (rankingFileUpload) {
    rankingFileUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                currentRankingData = JSON.parse(event.target.result);
                console.log('Ranking file loaded:', currentRankingData);
                
                // Show file info
                document.getElementById('currentFileName').textContent = file.name;
                document.getElementById('currentFileInfo').style.display = 'block';
                
                showRankingStatus('success', `✅ Bestand "${file.name}" succesvol geladen!`);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                showRankingStatus('error', 'Fout bij laden bestand. Controleer of het een geldig JSON bestand is.');
                currentRankingData = null;
            }
        };
        reader.readAsText(file);
    });
}

// Clear button
const clearRankingBtn = document.getElementById('clearRankingBtn');
if (clearRankingBtn) {
    clearRankingBtn.addEventListener('click', () => {
        // Clear all fields
        document.getElementById('rankingTeam').value = '';
        document.getElementById('rankingInput').value = '';
        document.getElementById('rankingFileUpload').value = '';
        document.getElementById('currentFileInfo').style.display = 'none';
        document.getElementById('rankingPreview').style.display = 'none';
        document.getElementById('downloadRankingBtn').style.display = 'none';
        
        // Reset data
        currentRankingData = null;
        processedRankingData = null;
        
        showRankingStatus('success', 'Formulier gewist');
    });
}

// Load current ranking data (fallback als er geen file geupload is)
async function loadCurrentRanking() {
    // If file already uploaded, use that
    if (currentRankingData) {
        console.log('Using uploaded ranking data');
        return currentRankingData;
    }
    
    // Otherwise create empty structure
    console.log('No file uploaded, creating empty structure');
    currentRankingData = {
        "veteranen": [],
        "zaterdag": [],
        "zondag": []
    };
    return currentRankingData;
}

// Parse ranking input - handles tab-separated format from RBFA
function parseRankingInput(input, team) {
    const lines = input.trim().split('\n');
    const rankingArray = [];
    
    console.log('Parsing ranking input for team:', team);
    console.log('Number of lines:', lines.length);
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Split by tabs first (RBFA standard format)
        let parts = trimmedLine.split('\t').filter(p => p.trim());
        
        console.log('Line parts (tab-split):', parts);
        
        // If tab split gives us exactly 10 parts, use it
        // Otherwise try space split as fallback
        if (parts.length !== 10) {
            parts = trimmedLine.split(/\s+/);
            console.log('Line parts (space-split):', parts);
        }
        
        // We need exactly 10 parts:
        // 0: Positie
        // 1: Logo + Naam (dubbel)
        // 2: Gespeeld
        // 3: Gewonnen
        // 4: Verloren (LET OP: komt VOOR gelijk!)
        // 5: Gelijk (LET OP: komt NA verloren!)
        // 6: Goals Voor
        // 7: Goals Tegen
        // 8: Saldo
        // 9: Punten
        if (parts.length !== 10) {
            console.warn('Skipping line - expected 10 parts, got', parts.length, ':', trimmedLine);
            continue;
        }
        
        try {
            // Parse position
            const pos = parseInt(parts[0]);
            if (isNaN(pos)) {
                console.warn('Invalid position:', parts[0]);
                continue;
            }
            
            // Parse team name (parts[1])
            // Example: "Logo KORBEEK SPORTKORBEEK SPORT" -> "KORBEEK SPORT"
            let teamName = parts[1];
            
            // Remove "Logo" prefix (case insensitive)
            teamName = teamName.replace(/^Logo\s*/i, '');
            
            // Fix doubled names
            // Split into words and check if first half equals second half
            const words = teamName.split(/\s+/).filter(w => w.trim());
            const halfLength = Math.floor(words.length / 2);
            
            if (words.length > 0 && words.length % 2 === 0 && halfLength > 0) {
                const firstHalf = words.slice(0, halfLength).join(' ');
                const secondHalf = words.slice(halfLength).join(' ');
                
                if (firstHalf === secondHalf) {
                    teamName = firstHalf;
                    console.log('Fixed doubled name:', parts[1], '->', teamName);
                }
            }
            
            // Parse statistics (parts[2] through parts[9])
            // Volgorde volgens RBFA: Gespeeld, Gewonnen, VERLOREN, GELIJK, Voor, Tegen, Saldo, Punten
            const played = parseInt(parts[2]);     // Matchen gespeeld
            const won = parseInt(parts[3]);        // Matchen gewonnen  
            const lost = parseInt(parts[4]);       // Matchen verloren (LET OP: komt VOOR gelijk!)
            const draw = parseInt(parts[5]);       // Matchen gelijk (LET OP: komt NA verloren!)
            const goalsFor = parseInt(parts[6]);   // Goals voor
            const goalsAgainst = parseInt(parts[7]); // Goals tegen
            const saldo = parseInt(parts[8]);      // Saldo
            const pnt = parseInt(parts[9]);        // Punten
            
            // Validate all numbers
            if ([played, won, draw, lost, goalsFor, goalsAgainst, saldo, pnt].some(isNaN)) {
                console.warn('Invalid numbers in line:', parts);
                continue;
            }
            
            const teamData = {
                pos,
                team: teamName.trim(),
                pnt,
                played,
                won,
                draw,
                lost,
                goals_for: goalsFor,
                goals_against: goalsAgainst,
                saldo
            };
            
            console.log('Parsed team:', teamData);
            rankingArray.push(teamData);
            
        } catch (error) {
            console.error('Error parsing line:', trimmedLine, error);
            continue;
        }
    }
    
    console.log('Total teams parsed:', rankingArray.length);
    console.log('Final ranking array:', rankingArray);
    
    return rankingArray;
}

// Show ranking status message
function showRankingStatus(type, message) {
    const statusEl = document.getElementById('rankingStatus');
    statusEl.className = `ranking-status ${type}`;
    statusEl.textContent = message;
    statusEl.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 5000);
    }
}

// Process ranking button
const processRankingBtn = document.getElementById('processRankingBtn');
if (processRankingBtn) {
    processRankingBtn.addEventListener('click', async () => {
        const team = document.getElementById('rankingTeam').value;
        const input = document.getElementById('rankingInput').value;
        
        if (!team) {
            showRankingStatus('error', 'Selecteer eerst een team!');
            return;
        }
        
        if (!input.trim()) {
            showRankingStatus('error', 'Voer rangschikking data in!');
            return;
        }
        
        processRankingBtn.disabled = true;
        processRankingBtn.textContent = 'Bezig met verwerken...';
        
        try {
            // Load current ranking if not already loaded
            if (!currentRankingData) {
                await loadCurrentRanking();
                if (!currentRankingData) {
                    processRankingBtn.disabled = false;
                    processRankingBtn.textContent = '🔄 Verwerken';
                    return;
                }
            }
            
            // Parse the input
            const parsedData = parseRankingInput(input, team);
            
            if (parsedData.length === 0) {
                showRankingStatus('error', 'Geen geldige data gevonden. Controleer het formaat!');
                processRankingBtn.disabled = false;
                processRankingBtn.textContent = '🔄 Verwerken';
                return;
            }
            
            // Update the ranking data
            processedRankingData = { ...currentRankingData };
            processedRankingData[team] = parsedData;
            
            // Show preview with team name
            const previewEl = document.getElementById('rankingPreview');
            const previewContent = document.getElementById('rankingPreviewContent');
            const previewTeamName = document.getElementById('previewTeamName');
            
            previewTeamName.textContent = team.charAt(0).toUpperCase() + team.slice(1);
            previewContent.textContent = JSON.stringify(processedRankingData[team], null, 2);
            previewEl.style.display = 'block';
            
            // Show download button
            document.getElementById('downloadRankingBtn').style.display = 'inline-block';
            
            showRankingStatus('success', `✅ Rangschikking voor ${team} succesvol verwerkt! ${parsedData.length} teams gevonden.`);
            
        } catch (error) {
            console.error('Error processing ranking:', error);
            showRankingStatus('error', 'Fout bij verwerken: ' + error.message);
        } finally {
            processRankingBtn.disabled = false;
            processRankingBtn.textContent = '🔄 Verwerken';
        }
    });
}

// Download ranking button
const downloadRankingBtn = document.getElementById('downloadRankingBtn');
if (downloadRankingBtn) {
    downloadRankingBtn.addEventListener('click', () => {
        if (!processedRankingData) {
            showRankingStatus('error', 'Verwerk eerst de rangschikking data!');
            return;
        }
        
        // Create download link
        const dataStr = JSON.stringify(processedRankingData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ranking.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showRankingStatus('success', '💾 ranking.json gedownload! Upload dit bestand naar je website.');
    });
}

console.log('Admin.js (FINAL FIX) initialization complete');
