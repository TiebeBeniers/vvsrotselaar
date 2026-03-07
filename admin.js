// ===============================================
// ADMIN PAGE - FINAL FIX
// V.V.S Rotselaar
// Fix: CreateUser zonder admin logout + form validation
// Updated: Password decryption for account requests
// ===============================================

import { auth, db, app } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, setDoc, query, where, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { decryptPassword } from './crypto-utils.js';

console.log('Admin.js loaded (FINAL FIX VERSION with password decryption)');

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
let allMatchesCache = [];   // cache for client-side filter
let currentMatchFilter = 'all';

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

// ── Match filter buttons ──
document.querySelectorAll('[data-match-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-match-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMatchFilter = btn.getAttribute('data-match-filter');
        renderMatchList();
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
        await updateRequestsBadge(); // Update badge on page load
        await updateContactberichtenBadge(); // Update contactberichten badge
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
const manageRequestsBtn = document.getElementById('manageRequestsBtn');
const requestsModal = document.getElementById('requestsModal');
const requestsModalClose = document.getElementById('requestsModalClose');

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

// Account Requests Modal
if (manageRequestsBtn) {
    manageRequestsBtn.addEventListener('click', async () => {
        console.log('Opening account requests modal');
        await loadAccountRequests();
        requestsModal.classList.add('active');
    });
}

if (requestsModalClose) {
    requestsModalClose.addEventListener('click', () => {
        requestsModal.classList.remove('active');
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
// ACCOUNT REQUESTS MANAGEMENT
// ===============================================

async function updateRequestsBadge() {
    const badge = document.getElementById('requestsBadge');
    if (!badge) return;
    
    try {
        const requestsQuery = query(
            collection(db, 'account_requests'),
            where('status', '==', 'pending')
        );
        const requestsSnapshot = await getDocs(requestsQuery);
        
        const count = requestsSnapshot.size;
        
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('Error updating requests badge:', error);
        badge.style.display = 'none';
    }
}

async function updateContactberichtenBadge() {
    const badge = document.getElementById('contactberichtenBadge');
    if (!badge) return;
    
    try {
        const berichtenQuery = query(
            collection(db, 'contactberichten'),
            where('gelezen', '==', false)
        );
        const berichtenSnapshot = await getDocs(berichtenQuery);
        
        const count = berichtenSnapshot.size;
        
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    } catch (error) {
        console.error('Error updating contactberichten badge:', error);
        badge.style.display = 'none';
    }
}

async function loadAccountRequests() {
    const requestsList = document.getElementById('requestsList');
    
    try {
        console.log('Loading account requests...');
        requestsList.innerHTML = '<div class="loading">Laden...</div>';
        
        // Get all pending requests
        // Note: We removed orderBy to avoid needing a composite index
        // We'll sort in memory instead
        const requestsQuery = query(
            collection(db, 'account_requests'),
            where('status', '==', 'pending')
        );
        const requestsSnapshot = await getDocs(requestsQuery);
        
        requestsList.innerHTML = '';
        
        if (requestsSnapshot.empty) {
            console.log('No pending requests found');
            requestsList.innerHTML = '<p class="text-center" style="padding: 2rem; color: #666;">Geen openstaande aanvragen.</p>';
            return;
        }
        
        console.log('Found', requestsSnapshot.size, 'pending requests');
        
        // Collect all requests and sort by creation date
        const requests = [];
        requestsSnapshot.forEach(docSnap => {
            const request = { id: docSnap.id, ...docSnap.data() };
            requests.push(request);
        });
        
        // Sort by createdAt (newest first)
        requests.sort((a, b) => {
            if (!a.createdAt) return 1;
            if (!b.createdAt) return -1;
            return b.createdAt.toMillis() - a.createdAt.toMillis();
        });
        
        // Create cards for sorted requests
        requests.forEach(request => {
            const requestCard = createRequestCard(request);
            requestsList.appendChild(requestCard);
        });
        
        console.log('Account requests loaded successfully');
        
    } catch (error) {
        console.error('Error loading account requests:', error);
        requestsList.innerHTML = '<p class="text-center error-text">Fout bij laden: ' + error.message + '</p>';
    }
}

function createRequestCard(request) {
    const card = document.createElement('div');
    card.className = 'request-card';
    
    // Format date
    let dateText = 'Onbekend';
    if (request.createdAt) {
        const date = request.createdAt.toDate();
        dateText = date.toLocaleDateString('nl-BE', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    const teamText = request.categorie ? request.categorie.charAt(0).toUpperCase() + request.categorie.slice(1) : 'Onbekend';
    
    // Use encryptedPassword instead of plain password
    const encryptedPwd = request.encryptedPassword || '';
    
    const phoneDisplay = request.telefoon ? `<p><strong>Tel:</strong> ${request.telefoon}</p>` : '';
    const phonePassed = request.telefoon || '';
    card.innerHTML = `
        <div class="request-info">
            <h4>${request.naam}</h4>
            <p><strong>Email:</strong> ${request.email}</p>
            ${phoneDisplay}
            <p><strong>Ploeg:</strong> ${teamText}</p>
            <p class="request-date"><strong>Aangevraagd op:</strong> ${dateText}</p>
        </div>
        <div class="request-actions">
            <button class="btn-accept" onclick="acceptRequest('${request.id}', '${request.naam}', '${request.email}', '${encryptedPwd}', '${request.categorie}', '${phonePassed}')">
                ✓ Goedkeuren
            </button>
            <button class="btn-reject" onclick="rejectRequest('${request.id}')">
                ✗ Afwijzen
            </button>
        </div>
    `;
    
    return card;
}

// Make functions globally accessible
window.acceptRequest = async function(requestId, naam, email, encryptedPassword, categorie, telefoon = '') {
    console.log('Accepting request:', requestId);
    
    try {
        // Confirm action
        if (!confirm(`Account goedkeuren voor ${naam}?`)) {
            return;
        }
        
        // Check if secondary auth is available
        if (!secondaryAuth) {
            alert('Fout: Secundaire authenticatie niet geïnitialiseerd');
            return;
        }
        
        // Decrypt password
        console.log('Decrypting password...');
        let password;
        try {
            password = await decryptPassword(encryptedPassword);
            console.log('Password decrypted successfully');
        } catch (decryptError) {
            console.error('Password decryption failed:', decryptError);
            alert('Fout bij het decrypteren van het wachtwoord. Mogelijk is de aanvraag beschadigd.');
            return;
        }
        
        // Create user in Firebase Auth using secondary app
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUser = userCredential.user;
        
        console.log('User created in Auth:', newUser.uid);
        
        // Sign out from secondary app immediately to avoid affecting admin session
        await secondaryAuth.signOut();
        
        // Add user to Firestore users collection
        await addDoc(collection(db, 'users'), {
            uid: newUser.uid,
            naam: naam,
            email: email,
            categorie: categorie,
            rol: 'speler',
            ...(telefoon && { telefoon })
        });
        
        console.log('User added to Firestore');
        
        // DELETE the request document completely (don't keep password data)
        await deleteDoc(doc(db, 'account_requests', requestId));
        
        console.log('Request document deleted from Firestore');
        
        // Reload requests list
        await loadAccountRequests();
        
        // Reload members list if on that tab
        await loadMembers();
        
        // Update badge count
        updateRequestsBadge();
        
        alert(`Account succesvol aangemaakt voor ${naam}!`);
        
    } catch (error) {
        console.error('Error accepting request:', error);
        
        let errorText = 'Er is een fout opgetreden bij het goedkeuren van de aanvraag.';
        
        if (error.code === 'auth/email-already-in-use') {
            errorText = 'Dit e-mailadres is al in gebruik.';
        } else if (error.code === 'auth/invalid-email') {
            errorText = 'Ongeldig e-mailadres.';
        } else if (error.code === 'auth/weak-password') {
            errorText = 'Wachtwoord is te zwak.';
        }
        
        alert(errorText + '\n\nDetails: ' + error.message);
    }
};

window.rejectRequest = async function(requestId) {
    console.log('Rejecting request:', requestId);
    
    try {
        // Confirm action
        if (!confirm('Weet je zeker dat je deze aanvraag wilt afwijzen?')) {
            return;
        }
        
        // DELETE the request document completely (don't keep password data)
        await deleteDoc(doc(db, 'account_requests', requestId));
        
        console.log('Request document deleted from Firestore');
        
        // Reload requests list
        await loadAccountRequests();
        
        // Update badge count
        updateRequestsBadge();
        
        alert('Aanvraag afgewezen en verwijderd.');
        
    } catch (error) {
        console.error('Error rejecting request:', error);
        alert('Er is een fout opgetreden bij het afwijzen van de aanvraag: ' + error.message);
    }
};

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
        allMatchesCache = [];
        renderMatchList();
        return;
    }

    console.log('Found', matchesSnapshot.size, 'matches');

    allMatchesCache = [];
    matchesSnapshot.forEach(docSnap => {
        allMatchesCache.push({ id: docSnap.id, ...docSnap.data() });
    });

    renderMatchList();
    console.log('Matches loaded successfully');
}

function renderMatchList() {
    const matchesList = document.getElementById('matchesList');
    matchesList.innerHTML = '';

    let filtered = allMatchesCache;

    if (currentMatchFilter === 'planned') {
        filtered = allMatchesCache.filter(m => m.status === 'planned');
        // Sort by soonest first
        const today = new Date();
        filtered.sort((a, b) => {
            const da = new Date(a.datum + 'T' + (a.uur || '00:00'));
            const db_ = new Date(b.datum + 'T' + (b.uur || '00:00'));
            // Future matches first (ascending), then past planned matches
            const aFuture = da >= today;
            const bFuture = db_ >= today;
            if (aFuture && !bFuture) return -1;
            if (!aFuture && bFuture) return 1;
            return aFuture ? da - db_ : db_ - da;
        });
    } else if (currentMatchFilter === 'finished') {
        filtered = allMatchesCache.filter(m => m.status === 'finished' || m.status === 'live' || m.status === 'rust');
        filtered.sort((a, b) => new Date(b.datum) - new Date(a.datum));
    } else {
        // All: most recent first
        filtered = [...allMatchesCache].sort((a, b) => new Date(b.datum) - new Date(a.datum));
    }

    if (filtered.length === 0) {
        matchesList.innerHTML = '<p class="text-center">Geen wedstrijden gevonden voor dit filter.</p>';
        return;
    }

    filtered.forEach(match => {
        const matchCard = createMatchCard(match);
        matchesList.appendChild(matchCard);
    });
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

            // Delete events subcollection
            const eventsSnapshot = await getDocs(
                query(collection(db, 'events'), where('matchId', '==', match.id))
            );
            console.log('Deleting', eventsSnapshot.size, 'events');

            // Delete availability subcollection
            const availabilitySnapshot = await getDocs(
                collection(db, 'matches', match.id, 'availability')
            );
            console.log('Deleting', availabilitySnapshot.size, 'availability records');

            // Delete playerMinutes subcollection
            const playerMinutesSnapshot = await getDocs(
                collection(db, 'matches', match.id, 'playerMinutes')
            );
            console.log('Deleting', playerMinutesSnapshot.size, 'playerMinutes records');

            // Delete all subcollection docs in parallel, then the match itself
            await Promise.all([
                ...eventsSnapshot.docs.map(d => deleteDoc(d.ref)),
                ...availabilitySnapshot.docs.map(d => deleteDoc(d.ref)),
                ...playerMinutesSnapshot.docs.map(d => deleteDoc(d.ref))
            ]);

            await deleteDoc(doc(db, 'matches', match.id));
            console.log('Match and all related data deleted');

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
    
    // Check if message is long (more than 200 characters)
    const isLongMessage = bericht.bericht.length > 200;
    
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
        <div class="message-content ${isLongMessage ? 'collapsed' : ''}" data-full-text="${bericht.bericht.replace(/"/g, '&quot;')}">${bericht.bericht}</div>
        ${isLongMessage ? '<div class="message-expand-hint">Klik om volledig bericht te tonen</div>' : ''}
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
    
    // Add click-to-expand functionality for long messages
    if (isLongMessage) {
        const messageContent = card.querySelector('.message-content');
        const expandHint = card.querySelector('.message-expand-hint');
        
        messageContent.addEventListener('click', () => {
            if (messageContent.classList.contains('collapsed')) {
                messageContent.classList.remove('collapsed');
                messageContent.classList.add('expanded');
                if (expandHint) expandHint.style.display = 'none';
            } else {
                messageContent.classList.add('collapsed');
                messageContent.classList.remove('expanded');
                if (expandHint) expandHint.style.display = 'block';
            }
        });
    }
    
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
        await updateContactberichtenBadge(); // Update badge after marking as read
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
        await updateContactberichtenBadge(); // Update badge after deleting
    } catch (error) {
        console.error('Error deleting message:', error);
        alert('Fout bij verwijderen: ' + error.message);
    }
}

// ===============================================
// RANKING MANAGEMENT — Firebase versie
// Firestore structuur: ranking/{team} → { teams: [...], updatedAt }
// ===============================================

// ── Sub-tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.ranking-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.ranking-subtab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ranking-subtab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.subtab).classList.add('active');

        // Laad huidig klassement wanneer die tab opengaat
        if (btn.dataset.subtab === 'currentTab') {
            loadCurrentRankingView();
        }
    });
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function showRankingStatus(elId, type, message) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = `ranking-status ${type}`;
    el.textContent = message;
    el.style.display = 'block';
    if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ── Parse ranking input (hergebruikt van oud systeem) ──────────────────────────
function parseRankingInput(input) {
    const lines = input.trim().split('\n');
    const rankingArray = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        let parts = trimmedLine.split('\t').filter(p => p.trim());
        if (parts.length !== 10) parts = trimmedLine.split(/\s+/);
        if (parts.length !== 10) continue;

        try {
            const pos = parseInt(parts[0]);
            if (isNaN(pos)) continue;

            let teamName = parts[1].replace(/^Logo\s*/i, '').trim();

            // RBFA plakt de naam dubbel aan elkaar (logo-tekst + zichtbare tekst),
            // soms zonder spatie: "VC TORENPLOEGVC TORENPLOEG"
            // soms met spatie:    "VC TORENPLOEG VC TORENPLOEG"
            // Oplossing 1: regex die een aaneengeplakte herhaling vangt
            const concatMatch = teamName.match(/^(.+)\1$/);
            if (concatMatch) {
                teamName = concatMatch[1].trim();
            } else {
                // Oplossing 2: spatie-gescheiden herhaling (oude fallback)
                const words = teamName.split(/\s+/).filter(w => w.trim());
                const half  = Math.floor(words.length / 2);
                if (words.length > 0 && words.length % 2 === 0 && half > 0) {
                    const a = words.slice(0, half).join(' ');
                    const b = words.slice(half).join(' ');
                    if (a === b) teamName = a;
                }
            }

            const played      = parseInt(parts[2]);
            const won         = parseInt(parts[3]);
            const lost        = parseInt(parts[4]);
            const draw        = parseInt(parts[5]);
            const goalsFor    = parseInt(parts[6]);
            const goalsAgainst = parseInt(parts[7]);
            const saldo       = parseInt(parts[8]);
            const pnt         = parseInt(parts[9]);

            if ([played, won, draw, lost, goalsFor, goalsAgainst, saldo, pnt].some(isNaN)) continue;

            rankingArray.push({ pos, team: teamName.trim(), pnt, played, won, draw, lost,
                goals_for: goalsFor, goals_against: goalsAgainst, saldo });
        } catch (_) { continue; }
    }
    return rankingArray;
}

// ── SUBTAB 1: Verwerken & Opslaan in Firebase ──────────────────────────────────
const processRankingBtn = document.getElementById('processRankingBtn');
if (processRankingBtn) {
    processRankingBtn.addEventListener('click', async () => {
        const team  = document.getElementById('rankingTeam').value;
        const input = document.getElementById('rankingInput').value;

        if (!team)        { showRankingStatus('rankingStatus', 'error', 'Selecteer eerst een team!'); return; }
        if (!input.trim()) { showRankingStatus('rankingStatus', 'error', 'Voer rangschikking data in!'); return; }

        processRankingBtn.disabled = true;
        processRankingBtn.textContent = 'Bezig…';

        try {
            const parsed = parseRankingInput(input);
            if (parsed.length === 0) {
                showRankingStatus('rankingStatus', 'error', 'Geen geldige data gevonden. Controleer het formaat!');
                return;
            }

            // Opslaan in Firestore: ranking/{team}
            await setDoc(doc(db, 'ranking', team), {
                teams: parsed,
                updatedAt: serverTimestamp()
            });

            // Preview tonen
            document.getElementById('previewTeamName').textContent =
                team.charAt(0).toUpperCase() + team.slice(1);
            document.getElementById('rankingPreviewContent').textContent =
                JSON.stringify(parsed, null, 2);
            document.getElementById('rankingPreview').style.display = 'block';

            showRankingStatus('rankingStatus', 'success',
                `✅ ${parsed.length} ploegen opgeslagen voor ${team}!`);

            // Invalideer localStorage cache op team-pagina
            localStorage.removeItem(`vvs_ranking_${team}`);

        } catch (err) {
            console.error('processRanking error:', err);
            showRankingStatus('rankingStatus', 'error', 'Fout bij opslaan: ' + err.message);
        } finally {
            processRankingBtn.disabled = false;
            processRankingBtn.textContent = '🔄 Verwerken & Opslaan in Firebase';
        }
    });
}

const clearRankingBtn = document.getElementById('clearRankingBtn');
if (clearRankingBtn) {
    clearRankingBtn.addEventListener('click', () => {
        document.getElementById('rankingTeam').value = '';
        document.getElementById('rankingInput').value = '';
        document.getElementById('rankingPreview').style.display = 'none';
        showRankingStatus('rankingStatus', 'success', 'Gewist.');
    });
}

// ── SUBTAB 2: Matchresultaat ───────────────────────────────────────────────────
const matchResultTeamSel = document.getElementById('matchResultTeam');
if (matchResultTeamSel) {
    matchResultTeamSel.addEventListener('change', async () => {
        const team = matchResultTeamSel.value;
        document.getElementById('matchTeamSelects').style.display  = 'none';
        document.getElementById('matchScoreRow').style.display     = 'none';
        document.getElementById('matchResultActions').style.display = 'none';
        document.getElementById('matchResultPreview').style.display = 'none';
        document.getElementById('matchResultStatus').style.display  = 'none';

        if (!team) return;

        showRankingStatus('matchResultStatus', '', 'Ploegen laden…');
        try {
            const snap = await getDoc(doc(db, 'ranking', team));

            if (!snap.exists()) {
                showRankingStatus('matchResultStatus', 'error',
                    'Geen klassement gevonden voor ' + team + '. Upload het eerst via "Volledig Plakken".');
                return;
            }

            const teams = snap.data().teams || [];
            const home  = document.getElementById('rankingHomeTeam');
            const away  = document.getElementById('rankingAwayTeam');
            [home, away].forEach(sel => {
                sel.innerHTML = '<option value="">Kies ploeg…</option>';
                teams.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.team;
                    opt.textContent = t.team;
                    sel.appendChild(opt);
                });
            });

            document.getElementById('matchTeamSelects').style.display  = '';
            document.getElementById('matchScoreRow').style.display     = '';
            document.getElementById('matchResultActions').style.display = '';
            document.getElementById('matchResultStatus').style.display  = 'none';

        } catch (err) {
            showRankingStatus('matchResultStatus', 'error', 'Fout: ' + err.message);
        }
    });
}

const applyMatchResultBtn = document.getElementById('applyMatchResultBtn');
if (applyMatchResultBtn) {
    applyMatchResultBtn.addEventListener('click', async () => {
        const team      = document.getElementById('matchResultTeam').value;
        const homeName  = document.getElementById('rankingHomeTeam').value;
        const awayName  = document.getElementById('rankingAwayTeam').value;
        const homeScore = parseInt(document.getElementById('rankingHomeScore').value);
        const awayScore = parseInt(document.getElementById('rankingAwayScore').value);

        if (!team || !homeName || !awayName) {
            showRankingStatus('matchResultStatus', 'error', 'Selecteer reeks en beide ploegen.');
            return;
        }
        if (homeName === awayName) {
            showRankingStatus('matchResultStatus', 'error', 'Kies twee verschillende ploegen.');
            return;
        }
        if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
            showRankingStatus('matchResultStatus', 'error', 'Voer geldige scores in (0 of meer).');
            return;
        }

        applyMatchResultBtn.disabled = true;
        applyMatchResultBtn.textContent = 'Bezig…';

        try {
            const snap  = await getDoc(doc(db, 'ranking', team));
            if (!snap.exists()) throw new Error('Klassement niet gevonden.');
            const teams = snap.data().teams.map(t => ({ ...t }));

            const homeTeam = teams.find(t => t.team === homeName);
            const awayTeam = teams.find(t => t.team === awayName);
            if (!homeTeam || !awayTeam) throw new Error('Ploeg niet gevonden in klassement.');

            // Update statistieken
            function applyResult(t, goalsFor, goalsAgainst) {
                t.played = (t.played || 0) + 1;
                t.goals_for     = (t.goals_for     || 0) + goalsFor;
                t.goals_against = (t.goals_against || 0) + goalsAgainst;
                t.saldo = t.goals_for - t.goals_against;
                if (goalsFor > goalsAgainst) {
                    t.won  = (t.won  || 0) + 1;
                    t.pnt  = (t.pnt  || 0) + 3;
                } else if (goalsFor < goalsAgainst) {
                    t.lost = (t.lost || 0) + 1;
                } else {
                    t.draw = (t.draw || 0) + 1;
                    t.pnt  = (t.pnt  || 0) + 1;
                }
            }
            applyResult(homeTeam, homeScore, awayScore);
            applyResult(awayTeam, awayScore, homeScore);

            // Herbereken posities op basis van punten → saldo → goals_for
            teams.sort((a, b) =>
                b.pnt - a.pnt || b.saldo - a.saldo || b.goals_for - a.goals_for
            );
            let pos = 1;
            teams.forEach((t, i) => {
                if (i > 0 &&
                    t.pnt    === teams[i-1].pnt &&
                    t.saldo  === teams[i-1].saldo &&
                    t.goals_for === teams[i-1].goals_for) {
                    t.pos = teams[i-1].pos;
                } else {
                    t.pos = pos;
                }
                pos++;
            });

            // Opslaan
            await setDoc(doc(db, 'ranking', team), { teams, updatedAt: serverTimestamp() });
            localStorage.removeItem(`vvs_ranking_${team}`);

            // Preview
            const result = homeScore > awayScore ? `${homeName} wint`
                         : homeScore < awayScore ? `${awayName} wint`
                         : 'Gelijkspel';

            document.getElementById('matchResultPreviewContent').textContent =
                `${homeName} ${homeScore} – ${awayScore} ${awayName}\n${result}\n\n` +
                `${homeName}: ${homeTeam.pnt} pnt, ${homeTeam.played} gespeeld\n` +
                `${awayName}: ${awayTeam.pnt} pnt, ${awayTeam.played} gespeeld`;
            document.getElementById('matchResultPreview').style.display = 'block';

            showRankingStatus('matchResultStatus', 'success',
                `✅ Klassement bijgewerkt: ${homeName} ${homeScore}–${awayScore} ${awayName}`);

        } catch (err) {
            console.error('applyMatchResult error:', err);
            showRankingStatus('matchResultStatus', 'error', 'Fout: ' + err.message);
        } finally {
            applyMatchResultBtn.disabled = false;
            applyMatchResultBtn.textContent = '⚽ Resultaat Verwerken & Opslaan';
        }
    });
}

// ── SUBTAB 3: Huidig klassement bekijken ──────────────────────────────────────
const viewRankingTeamSel = document.getElementById('viewRankingTeam');
if (viewRankingTeamSel) {
    viewRankingTeamSel.addEventListener('change', loadCurrentRankingView);
}

async function loadCurrentRankingView() {
    const team = document.getElementById('viewRankingTeam')?.value;
    const container = document.getElementById('currentRankingTable');
    if (!team || !container) return;

    container.innerHTML = '<div class="loading">Laden…</div>';
    try {
        const snap = await getDoc(doc(db, 'ranking', team));

        if (!snap.exists() || !(snap.data().teams?.length)) {
            container.innerHTML = '<p style="color:#666;margin-top:1rem;">Geen data gevonden. Upload via "Volledig Plakken".</p>';
            return;
        }

        const teams = snap.data().teams;
        const updated = snap.data().updatedAt?.toDate?.()?.toLocaleDateString('nl-BE') || '?';

        container.innerHTML = `
            <p style="font-size:0.82rem;color:#888;margin-bottom:0.75rem;">
                Laatste update: ${updated} · ${teams.length} ploegen
            </p>
            <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
                <thead>
                    <tr style="background:var(--primary-blue);color:white;">
                        <th style="padding:0.5rem 0.6rem;text-align:center;">#</th>
                        <th style="padding:0.5rem 0.6rem;text-align:left;">Ploeg</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;" title="Punten">Pnt</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;" title="Gespeeld">Sp</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;" title="Gewonnen">W</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;" title="Gelijk">G</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;" title="Verlies">V</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;">Voor</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;">Tgn</th>
                        <th style="padding:0.5rem 0.6rem;text-align:center;">Saldo</th>
                    </tr>
                </thead>
                <tbody>
                    ${teams.map((t, i) => {
                        const isVVS = t.team.includes('V.V.S');
                        const bg = isVVS ? 'background:#fff3cd;font-weight:600;'
                                        : i % 2 === 0 ? '' : 'background:#f8fafc;';
                        return `<tr style="${bg}">
                            <td style="padding:0.4rem 0.6rem;text-align:center;">${t.pos}</td>
                            <td style="padding:0.4rem 0.6rem;">${t.team}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;font-weight:700;">${t.pnt}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;">${t.played}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;">${t.won}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;">${t.draw}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;">${t.lost}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;">${t.goals_for}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;">${t.goals_against}</td>
                            <td style="padding:0.4rem 0.6rem;text-align:center;color:${t.saldo >= 0 ? 'green' : 'red'};">
                                ${t.saldo >= 0 ? '+' : ''}${t.saldo}
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>`;

    } catch (err) {
        container.innerHTML = `<p style="color:red;">Fout: ${err.message}</p>`;
    }
}

console.log('Admin.js (FINAL FIX) initialization complete');
