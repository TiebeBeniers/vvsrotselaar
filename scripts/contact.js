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
                 alert('Vul alle velden in.');
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
            alert('Bedankt voor uw bericht! We nemen zo snel mogelijk contact met u op.');
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
            
            alert(errorMessage);
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}