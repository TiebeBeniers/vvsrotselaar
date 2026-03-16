import { db } from './firebase-config.js';
import { collection, addDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
        
// Contact form submission
const contactForm = document.getElementById('contactForm');

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
                
        const submitBtn = contactForm.querySelector('.submit-btn');
        const originalText = submitBtn.textContent;
                
        try {
            submitBtn.textContent = 'VERZENDEN...';
            submitBtn.disabled = true;
            
            const email = document.getElementById('email').value.trim();
            const message = document.getElementById('message').value.trim();
            
            if (!email || !message) {
                 showToast('Vul alle velden in', 'error');
                 return;
            }
     
            console.log('Submitting contact form...', { email, messageLength: message.length });
            
            // Save to Firestore with explicit timestamp
            const docRef = await addDoc(collection(db, 'contactberichten'), {
                email: email,
                bericht: message,
                datum: Timestamp.now(),
                gelezen: false,
                createdAt: new Date().toISOString()
            });
            
            console.log('Contact bericht saved with ID:', docRef.id);
            
            // Success
            showToast('Bericht verzonden! We nemen snel contact op.', 'success');
            contactForm.reset();
            
        } catch (error) {
            console.error('Error submitting form:', error);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            
            let errorMessage = 'Er is een fout opgetreden. ';
            if (error.code === 'permission-denied') {
                errorMessage += 'Geen toegang tot de database. Neem contact op met de beheerder.';
            } else if (error.code === 'unavailable') {
                errorMessage += 'Database niet bereikbaar. Probeer het later opnieuw.';
            } else {
                errorMessage += 'Probeer het later opnieuw.';
            }
            
            showToast(errorMessage, 'error');
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}
// ── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    let t = document.getElementById('adminToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'adminToast';
        t.style.cssText = `position:fixed;bottom:1.75rem;right:1.75rem;background:var(--text-dark);color:var(--white);padding:0.75rem 1.3rem;border-radius:9px;font-size:0.88rem;font-weight:600;z-index:9999;transform:translateY(80px);opacity:0;transition:all 0.3s cubic-bezier(0.34,1.56,0.64,1);box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;max-width:320px;`;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--text-dark)';
    t.style.transform  = 'translateY(0)';
    t.style.opacity    = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.transform = 'translateY(80px)'; t.style.opacity = '0'; }, 3500);
}
