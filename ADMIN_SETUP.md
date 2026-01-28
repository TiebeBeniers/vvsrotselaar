# EERSTE ADMIN GEBRUIKER AANMAKEN

Er zijn twee methoden om de eerste admin gebruiker aan te maken.

## Methode 1: Via Firebase Console (Aanbevolen)

### Stap 1: Gebruiker aanmaken in Authentication
1. Ga naar Firebase Console → Authentication → Users
2. Klik op "Add user"
3. Vul in:
   - Email: `admin@vvsrotselaar.be`
   - Password: Een sterk wachtwoord (min. 6 karakters)
4. Klik op "Add user"
5. **Kopieer de User UID** (staat in de users tabel)

### Stap 2: Gebruiker toevoegen aan Firestore
1. Ga naar Firebase Console → Firestore Database
2. Klik op "Start collection"
3. Collection ID: `users`
4. Document ID: Laat automatisch genereren (of kies zelf een ID)
5. Vul de volgende velden in:

| Field | Type | Value |
|-------|------|-------|
| uid | string | [De User UID uit stap 1] |
| naam | string | Admin |
| email | string | admin@vvsrotselaar.be |
| rol | string | admin |
| teams | string | veteranen |

6. Klik op "Save"

### Stap 3: Testen
1. Ga naar je website
2. Klik op "LOGIN"
3. Log in met:
   - Email: `admin@vvsrotselaar.be`
   - Password: [Het wachtwoord uit stap 1]
4. Je zou nu toegang moeten hebben tot de admin pagina!

---

## Methode 2: Via Browser Console

### Stap 1: Security Rules Tijdelijk Aanpassen
⚠️ **BELANGRIJK**: Dit maakt je database tijdelijk onveilig!

1. Ga naar Firestore Database → Rules
2. Vervang met:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
3. Klik op "Publish"

### Stap 2: Script Uitvoeren
1. Open je website in een browser
2. Druk op F12 om Developer Tools te openen
3. Ga naar het "Console" tabblad
4. Kopieer en plak deze code (pas email en wachtwoord aan):

```javascript
// Importeer Firebase modules
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { addDoc, collection } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { auth, db } from './firebase-config.js';

// Admin gegevens
const adminEmail = "admin@vvsrotselaar.be";
const adminPassword = "JouwVeiligWachtwoord123!";  // PAS DIT AAN!
const adminNaam = "Admin";

// Maak admin gebruiker aan
createUserWithEmailAndPassword(auth, adminEmail, adminPassword)
  .then(async (userCredential) => {
    const user = userCredential.user;
    console.log("Firebase Auth gebruiker aangemaakt met UID:", user.uid);
    
    // Voeg gebruiker toe aan Firestore
    await addDoc(collection(db, 'users'), {
      uid: user.uid,
      naam: adminNaam,
      email: adminEmail,
      rol: "admin",
      teams: "veteranen"
    });
    
    console.log("✅ Admin gebruiker succesvol aangemaakt!");
    console.log("Email:", adminEmail);
    console.log("Je kunt nu inloggen op de website.");
  })
  .catch((error) => {
    console.error("❌ Error bij aanmaken admin:", error.code, error.message);
  });
```

5. Druk op Enter om het script uit te voeren
6. Wacht op de bevestiging in de console

### Stap 3: Security Rules Herstellen
⚠️ **ZEER BELANGRIJK**: Herstel onmiddellijk de veilige rules!

1. Ga terug naar Firestore Database → Rules
2. Vervang met de veilige rules uit de README.md
3. Klik op "Publish"

### Stap 4: Testen
1. Ga naar je website
2. Klik op "LOGIN"
3. Log in met de admin credentials
4. Controleer of je toegang hebt tot de admin pagina

---

## Extra Admin Gebruikers Toevoegen

Na het aanmaken van de eerste admin, kun je eenvoudig extra admins toevoegen:

1. Log in als admin
2. Ga naar de Admin pagina
3. Klik op "Nieuw Lid Toevoegen"
4. Vul de gegevens in
5. Selecteer rol: "Admin"
6. Klik op "Opslaan"

---

## Troubleshooting

### "Email already in use"
**Probleem**: Email is al geregistreerd
**Oplossing**: 
- Gebruik een ander email adres, of
- Verwijder de bestaande gebruiker in Firebase Console → Authentication

### "Permission denied"
**Probleem**: Geen toegang tot Firestore
**Oplossing**: 
- Controleer of je de tijdelijke rules hebt ingesteld (alleen bij Methode 2)
- Controleer of de rules correct zijn na het aanmaken

### "Weak password"
**Probleem**: Wachtwoord is te zwak
**Oplossing**: Gebruik minimaal 6 karakters, bij voorkeur met hoofdletters, cijfers en speciale tekens

### Script geeft errors in console
**Probleem**: Import errors of Firebase errors
**Oplossing**: 
- Controleer of `firebase-config.js` correct is ingesteld
- Zorg dat je op de website bent (niet lokaal bestand)
- Controleer of Firebase initialized is

---

## Veiligheid Tips

1. ✅ Gebruik een sterk admin wachtwoord
2. ✅ Gebruik een echt email adres (voor wachtwoord reset)
3. ✅ Herstel security rules direct na aanmaken (Methode 2)
4. ✅ Deel admin credentials niet met teveel mensen
5. ✅ Monitor Firebase console regelmatig voor verdachte activiteit
6. ✅ Gebruik 2FA op je Firebase account

---

Voor meer hulp, zie README.md of neem contact op met de ontwikkelaar.
