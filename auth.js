// ===============================================
// AUTHENTICATION PAGE
// V.V.S Rotselaar
// Updated: Password show/hide + encryption
// ===============================================

import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { encryptPassword } from './crypto-utils.js';

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
// PASSWORD SHOW/HIDE FUNCTIONALITY
// ===============================================

function setupPasswordToggle(toggleButtonId, passwordInputId) {
    const toggleButton = document.getElementById(toggleButtonId);
    const passwordInput = document.getElementById(passwordInputId);
    
    if (toggleButton && passwordInput) {
        toggleButton.addEventListener('click', () => {
            const eyeOpen = toggleButton.querySelector('.eye-open');
            const eyeClosed = toggleButton.querySelector('.eye-closed');
            
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                eyeOpen.style.display = 'none';
                eyeClosed.style.display = 'block';
            } else {
                passwordInput.type = 'password';
                eyeOpen.style.display = 'block';
                eyeClosed.style.display = 'none';
            }
        });
    }
}

// Initialize password toggles when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setupPasswordToggle('toggleLoginPassword', 'password');
    setupPasswordToggle('toggleRequestPassword', 'requestPassword');
});

// ===============================================
// DOM ELEMENTS
// ===============================================

const loginForm = document.getElementById('loginForm');
const loggedInView = document.getElementById('loggedInView');
const errorMessage = document.getElementById('errorMessage');
const logoutBtn = document.getElementById('logoutBtn');
const adminBtn = document.getElementById('adminBtn');
const requestAccountView = document.getElementById('requestAccountView');
const showRequestFormBtn = document.getElementById('showRequestForm');
const backToLoginBtn = document.getElementById('backToLogin');
const requestAccountForm = document.getElementById('requestAccountForm');
const loginBoxHeader = document.querySelector('.login-box h2');
const loginSubtitle = document.getElementById('loginSubtitle');

// Debug: Check if all elements are found
console.log('Auth.js loaded (with password show/hide + encryption)');
console.log('Elements found:', {
    loginForm: !!loginForm,
    loggedInView: !!loggedInView,
    errorMessage: !!errorMessage,
    logoutBtn: !!logoutBtn,
    adminBtn: !!adminBtn,
    requestAccountView: !!requestAccountView,
    showRequestFormBtn: !!showRequestFormBtn,
    backToLoginBtn: !!backToLoginBtn,
    requestAccountForm: !!requestAccountForm,
    loginBoxHeader: !!loginBoxHeader,
    loginSubtitle: !!loginSubtitle
});

// ===============================================
// SHOW/HIDE ACCOUNT REQUEST FORM
// ===============================================

if (showRequestFormBtn) {
    showRequestFormBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Show request form clicked');
        
        // Update header and subtitle
        if (loginBoxHeader) {
            loginBoxHeader.textContent = 'Account Aanvragen';
        }
        if (loginSubtitle) {
            loginSubtitle.textContent = 'Vul onderstaand formulier in om een account aan te vragen';
        }
        
        // Hide login form, show request form
        if (loginForm) {
            loginForm.style.display = 'none';
        }
        if (requestAccountView) {
            requestAccountView.style.display = 'block';
        }
        
        // Clear any previous messages
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        if (requestSuccessMessage) requestSuccessMessage.style.display = 'none';
        if (requestErrorMessage) requestErrorMessage.style.display = 'none';
    });
}

if (backToLoginBtn) {
    backToLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Back to login clicked');
        
        // Reset header and subtitle
        if (loginBoxHeader) {
            loginBoxHeader.textContent = 'Inloggen';
        }
        if (loginSubtitle) {
            loginSubtitle.textContent = 'Toegang voor clubleden';
        }
        
        // Hide request form, show login form
        if (requestAccountView) {
            requestAccountView.style.display = 'none';
        }
        if (loginForm) {
            loginForm.style.display = 'flex';
            loginForm.style.flexDirection = 'column';
        }
        
        // Clear request form
        if (requestAccountForm) {
            requestAccountForm.reset();
        }
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        if (requestSuccessMessage) requestSuccessMessage.style.display = 'none';
        if (requestErrorMessage) requestErrorMessage.style.display = 'none';
        // Clear login error too
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
    });
}

// ===============================================
// ACCOUNT REQUEST FUNCTIONALITY
// ===============================================

if (requestAccountForm) {
    requestAccountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('requestName').value.trim();
        const email = document.getElementById('requestEmail').value.trim();
        const password = document.getElementById('requestPassword').value;
        const team = document.getElementById('requestTeam').value;
        
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        
        // Hide messages
        requestSuccessMessage.style.display = 'none';
        requestErrorMessage.style.display = 'none';
        
        // Disable submit button
        const submitBtn = requestAccountForm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Bezig met indienen...';
        }
        
        try {
            // Check if email already exists in requests
            const existingRequestQuery = query(
                collection(db, 'account_requests'),
                where('email', '==', email),
                where('status', '==', 'pending')
            );
            
            let existingRequestSnapshot;
            try {
                existingRequestSnapshot = await getDocs(existingRequestQuery);
            } catch (queryError) {
                // If query fails due to permissions, that's okay - we'll try to create anyway
                console.log('Could not check existing requests (expected for non-authenticated users)');
                existingRequestSnapshot = { empty: true };
            }
            
            if (!existingRequestSnapshot.empty) {
                requestErrorMessage.textContent = 'Er bestaat al een aanvraag voor dit e-mailadres.';
                requestErrorMessage.style.display = 'block';
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'AANVRAAG INDIENEN';
                }
                return;
            }
            
            // Check if user already exists (only if we can query)
            try {
                const existingUserQuery = query(
                    collection(db, 'users'),
                    where('email', '==', email)
                );
                const existingUserSnapshot = await getDocs(existingUserQuery);
                
                if (!existingUserSnapshot.empty) {
                    requestErrorMessage.textContent = 'Dit e-mailadres is al geregistreerd. Probeer in te loggen.';
                    requestErrorMessage.style.display = 'block';
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'AANVRAAG INDIENEN';
                    }
                    return;
                }
            } catch (userQueryError) {
                // If we can't query users, that's okay - admin will catch duplicate during approval
                console.log('Could not check existing users (expected for non-authenticated users)');
            }
            
            // Encrypt password before storing
            console.log('Encrypting password...');
            const encryptedPassword = await encryptPassword(password);
            console.log('Password encrypted successfully');
            
            // Create account request in Firestore with encrypted password
            await addDoc(collection(db, 'account_requests'), {
                naam: name,
                email: email,
                encryptedPassword: encryptedPassword, // Store encrypted password
                categorie: team,
                status: 'pending',
                createdAt: serverTimestamp()
            });
            
            console.log('Account request created successfully');
            
            // Clear form first
            requestAccountForm.reset();
            
            // Switch back to login view
            if (requestAccountView) {
                requestAccountView.style.display = 'none';
            }
            if (loginForm) {
                loginForm.style.display = 'flex';
                loginForm.style.flexDirection = 'column';
            }
            
            // Reset header and subtitle
            if (loginBoxHeader) {
                loginBoxHeader.textContent = 'Inloggen';
            }
            if (loginSubtitle) {
                loginSubtitle.textContent = 'Toegang voor clubleden';
            }
            
            // Show success message on login form
            const loginSuccessMessage = document.createElement('div');
            loginSuccessMessage.className = 'success-message';
            loginSuccessMessage.style.marginBottom = '1rem';
            loginSuccessMessage.textContent = 'Je aanvraag is succesvol ingediend! Reactie over goedkeuring volgt binnen enkele dagen.';
            
            // Insert before login button
            const loginButton = loginForm.querySelector('button[type="submit"]');
            if (loginButton) {
                loginForm.insertBefore(loginSuccessMessage, loginButton);
                
                // Remove message after 10 seconds
                setTimeout(() => {
                    loginSuccessMessage.remove();
                }, 10000);
            }
            
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
        } catch (error) {
            console.error('Account request error:', error);
            
            let errorText = 'Er is een fout opgetreden bij het indienen van je aanvraag.';
            
            if (error.code === 'permission-denied') {
                errorText = 'Fout bij het indienen. Meldt het bij de beheerder.';
            } else if (error.message) {
                errorText = 'Fout: ' + error.message;
            }
            
            requestErrorMessage.textContent = errorText;
            requestErrorMessage.style.display = 'block';
        } finally {
            // Re-enable submit button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'AANVRAAG INDIENEN';
            }
        }
    });
}

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
                
                // Hide both login and request forms, show logged in view
                if (loginForm) {
                    loginForm.style.display = 'none';
                }
                if (requestAccountView) {
                    requestAccountView.style.display = 'none';
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
                
                console.log('UI updated - forms hidden, loggedInView shown');
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
        
        // Reset header and subtitle to login state
        if (loginBoxHeader) {
            loginBoxHeader.textContent = 'Inloggen';
        }
        if (loginSubtitle) {
            loginSubtitle.textContent = 'Toegang voor clubleden';
        }
        
        // Show login form, hide request and logged in views
        if (loginForm) {
            loginForm.style.display = 'flex';
            loginForm.style.flexDirection = 'column';
        }
        if (requestAccountView) {
            requestAccountView.style.display = 'none';
        }
        if (loggedInView) {
            loggedInView.style.display = 'none';
        }
        
        // Clear forms
        if (loginForm) {
            loginForm.reset();
        }
        if (requestAccountForm) {
            requestAccountForm.reset();
        }
        if (errorMessage) {
            errorMessage.style.display = 'none';
        }
        
        // Clear request messages
        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage = document.getElementById('requestErrorMessage');
        if (requestSuccessMessage) requestSuccessMessage.style.display = 'none';
        if (requestErrorMessage) requestErrorMessage.style.display = 'none';
    }
});
