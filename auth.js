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

// ── Cache helpers (identiek aan speler.js) ───────────────────────────────────
// Sla userData 30 min op — verandert zelden (rol, naam).
// Bij uitloggen wordt de cache gewist.
const AUTH_CACHE_TTL = 30 * 60 * 1000;

function authCacheGet(uid) {
    try {
        const raw = localStorage.getItem(`vvs_authuser_${uid}`);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > AUTH_CACHE_TTL) {
            localStorage.removeItem(`vvs_authuser_${uid}`);
            return null;
        }
        return data;
    } catch (_) { return null; }
}

function authCacheSet(uid, data) {
    try {
        localStorage.setItem(`vvs_authuser_${uid}`, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {}
}

function authCacheClear(uid) {
    try { localStorage.removeItem(`vvs_authuser_${uid}`); } catch (_) {}
}

// ── DOM elementen ─────────────────────────────────────────────────────────────
const loginForm = document.getElementById('loginForm');
const loggedInView = document.getElementById('loggedInView');
const errorMessage = document.getElementById('errorMessage');
const logoutBtn = document.getElementById('logoutBtn');
const adminBtn = document.getElementById('adminBtn');
const profileBtn = document.getElementById('profileBtn');
const requestAccountView = document.getElementById('requestAccountView');
const showRequestFormBtn = document.getElementById('showRequestForm');
const backToLoginBtn = document.getElementById('backToLogin');
const requestAccountForm = document.getElementById('requestAccountForm');
const loginBoxHeader = document.querySelector('.login-box h2');
const loginSubtitle = document.getElementById('loginSubtitle');

console.log('Auth.js loaded (with password show/hide + encryption)');


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

if (profileBtn) {
    profileBtn.addEventListener('click', () => {
        window.location.href = 'speler.html';
    });
}

// ===============================================
// AUTH STATE LISTENER
// ===============================================

onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log('User logged in:', user.uid);
        try {
            // ── Probeer cache eerst — spaart 1 Firestore read bij elke paginabezoek ──
            let userData = authCacheGet(user.uid);

            if (!userData) {
                console.log('[firestore] userData ophalen voor', user.uid);
                const userSnapshot = await getDocs(
                    query(collection(db, 'users'), where('uid', '==', user.uid))
                );
                if (userSnapshot.empty) {
                    console.error('No user data found for UID:', user.uid);
                    alert('Gebruikersgegevens niet gevonden. Neem contact op met de beheerder.');
                    await signOut(auth);
                    return;
                }
                userData = userSnapshot.docs[0].data();
                authCacheSet(user.uid, userData);
            } else {
                console.log('[cache] userData geladen voor', user.uid);
            }

            // Formulieren verbergen, ingelogd-scherm tonen
            if (loginForm)        loginForm.style.display        = 'none';
            if (requestAccountView) requestAccountView.style.display = 'none';
            if (loggedInView)     loggedInView.style.display     = 'block';

            // Gebruikersinfo invullen
            const userNameEl  = document.getElementById('userName');
            const userEmailEl = document.getElementById('userEmail');
            const userRoleEl  = document.getElementById('userRole');

            if (userNameEl)  userNameEl.textContent  = userData.naam  || 'Gebruiker';
            if (userEmailEl) userEmailEl.textContent = userData.email || user.email;

            const isAdmin       = userData.rol === 'admin';
            const isBestuurslid = userData.categorie === 'bestuurslid' || userData.rol === 'bestuurslid';
            const isPrivileged  = isAdmin || isBestuurslid;

            if (userRoleEl) userRoleEl.textContent = isAdmin ? 'Administrator' : (isBestuurslid ? 'Bestuurslid' : 'Clublid');

            // Admin-knop: enkel voor admin/bestuurslid
            if (adminBtn)   adminBtn.style.display   = isPrivileged ? 'block' : 'none';

            // Profiel-knop: enkel voor gewone leden (niet admin/bestuurslid)
            if (profileBtn) profileBtn.style.display = isPrivileged ? 'none' : 'block';

        } catch (error) {
            console.error('Error fetching user data:', error);
            alert('Fout bij ophalen gebruikersgegevens: ' + error.message);
        }
    } else {
        console.log('User logged out');

        // Cache wissen bij uitloggen zodat volgende gebruiker verse data krijgt
        // (we kennen de uid niet meer, maar alle vvs_authuser_* items wissen is veilig)
        try {
            Object.keys(localStorage)
                .filter(k => k.startsWith('vvs_authuser_'))
                .forEach(k => localStorage.removeItem(k));
        } catch (_) {}

        if (loginBoxHeader)  loginBoxHeader.textContent  = 'Inloggen';
        if (loginSubtitle)   loginSubtitle.textContent   = 'Toegang voor clubleden';

        if (loginForm) {
            loginForm.style.display = 'flex';
            loginForm.style.flexDirection = 'column';
        }
        if (requestAccountView) requestAccountView.style.display = 'none';
        if (loggedInView)       loggedInView.style.display       = 'none';

        if (loginForm)       loginForm.reset();
        if (requestAccountForm) requestAccountForm.reset();
        if (errorMessage)    errorMessage.style.display = 'none';

        const requestSuccessMessage = document.getElementById('requestSuccessMessage');
        const requestErrorMessage   = document.getElementById('requestErrorMessage');
        if (requestSuccessMessage) requestSuccessMessage.style.display = 'none';
        if (requestErrorMessage)   requestErrorMessage.style.display   = 'none';
    }
});
