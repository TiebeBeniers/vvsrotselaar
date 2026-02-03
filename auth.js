// ===============================================
// AUTHENTICATION PAGE
// ===============================================

import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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
// DOM ELEMENTS
// ===============================================

const loginForm = document.getElementById('loginForm');
const loggedInView = document.getElementById('loggedInView');
const errorMessage = document.getElementById('errorMessage');
const logoutBtn = document.getElementById('logoutBtn');
const adminBtn = document.getElementById('adminBtn');

// Debug: Check if all elements are found
console.log('Auth.js loaded');
console.log('Elements found:', {
    loginForm: !!loginForm,
    loggedInView: !!loggedInView,
    errorMessage: !!errorMessage,
    logoutBtn: !!logoutBtn,
    adminBtn: !!adminBtn
});

// ===============================================
// LOGIN FUNCTIONALITY
// ===============================================

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    // Hide error message
    errorMessage.style.display = 'none';
    
    try {
        // Sign in with Firebase Auth
        await signInWithEmailAndPassword(auth, email, password);
        
        // Auth state listener will handle the UI update
    } catch (error) {
        console.error('Login error:', error);
        
        let errorText = 'Er is een fout opgetreden bij het inloggen.';
        
        switch (error.code) {
            case 'auth/invalid-email':
                errorText = 'Ongeldig e-mailadres.';
                break;
            case 'auth/user-disabled':
                errorText = 'Dit account is uitgeschakeld.';
                break;
            case 'auth/user-not-found':
            case 'auth/wrong-password':
                errorText = 'Onjuist e-mailadres of wachtwoord.';
                break;
            case 'auth/too-many-requests':
                errorText = 'Te veel mislukte pogingen. Probeer later opnieuw.';
                break;
        }
        
        errorMessage.textContent = errorText;
        errorMessage.style.display = 'block';
    }
});

// ===============================================
// LOGOUT FUNCTIONALITY
// ===============================================

logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        // Auth state listener will handle the UI update
    } catch (error) {
        console.error('Logout error:', error);
        alert('Er is een fout opgetreden bij het uitloggen.');
    }
});

// ===============================================
// ADMIN NAVIGATION
// ===============================================

if (adminBtn) {
    adminBtn.addEventListener('click', () => {
        window.location.href = 'admin.html';
    });
}

// ===============================================
// AUTH STATE LISTENER
// ===============================================

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is logged in
        console.log('User logged in:', user.uid);
        try {
            // Get user data from Firestore
            const userQuery = query(
                collection(db, 'users'),
                where('uid', '==', user.uid)
            );
            const userSnapshot = await getDocs(userQuery);
            
            if (!userSnapshot.empty) {
                const userData = userSnapshot.docs[0].data();
                console.log('User data found:', userData);
                
                // Hide login form, show logged in view
                if (loginForm) {
                    loginForm.style.display = 'none';
                }
                if (loggedInView) {
                    loggedInView.style.display = 'block';
                }
                
                // Update user info
                const userNameEl = document.getElementById('userName');
                const userEmailEl = document.getElementById('userEmail');
                const userRoleEl = document.getElementById('userRole');
                
                if (userNameEl) userNameEl.textContent = userData.naam || 'Gebruiker';
                if (userEmailEl) userEmailEl.textContent = userData.email || user.email;
                
                const roleText = userData.rol === 'admin' ? 'Administrator' : 'Clublid';
                if (userRoleEl) userRoleEl.textContent = roleText;
                
                // Show admin button if user is admin
                if (adminBtn) {
                    if (userData.rol === 'admin') {
                        adminBtn.style.display = 'block';
                        console.log('Admin button shown');
                    } else {
                        adminBtn.style.display = 'none';
                    }
                }
                
                console.log('UI updated - loginForm hidden, loggedInView shown');
            } else {
                console.error('No user data found in Firestore for UID:', user.uid);
                // Show error and logout
                alert('Gebruikersgegevens niet gevonden. Neem contact op met de beheerder.');
                await signOut(auth);
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
            alert('Fout bij ophalen gebruikersgegevens: ' + error.message);
        }
    } else {
        // User is logged out
        console.log('User logged out');
        
        if (loginForm) {
            loginForm.style.display = 'flex';
            loginForm.style.flexDirection = 'column';
        }
        if (loggedInView) {
            loggedInView.style.display = 'none';
        }
        
        // Clear form
        if (loginForm) {
            loginForm.reset();
        }
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
    }
});