# V.V.S. Rotselaar Website

Een moderne, responsive website voor voetbalclub V.V.S. Rotselaar met real-time wedstrijdvolging via Firebase.

## 🎯 Features

### Voor Alle Bezoekers
- ✅ Responsive design (mobiel & desktop)
- ✅ Live wedstrijden volgen met real-time updates
- ✅ Overzichtelijke homepage met carousel
- ✅ Team overzicht (Veteranen, Zaterdag, Zondag)
- ✅ Contactinformatie

### Voor Clubleden
- ✅ Persoonlijk profiel
- ✅ Wedstrijden starten (alleen aangeduide persoon)
- ✅ Live events invoeren tijdens wedstrijd

### Voor Administrators
- ✅ Leden beheren (toevoegen, wijzigen, verwijderen)
- ✅ Wedstrijden aanmaken
- ✅ Aangeduide persoon per wedstrijd selecteren
- ✅ Volledige controle over systeem

## 🚀 Snelstart

### 1. Firebase Project Aanmaken

1. Ga naar [Firebase Console](https://console.firebase.google.com/)
2. Klik op "Add project" / "Project toevoegen"
3. Geef je project een naam (bv. "vvs-rotselaar")
4. Volg de stappen om het project aan te maken

### 2. Firebase Services Inschakelen

#### Authentication
1. Ga naar "Authentication" in het linker menu
2. Klik op "Get started"
3. Klik op "Email/Password" provider
4. Schakel "Email/Password" in
5. Klik op "Save"

#### Firestore Database
1. Ga naar "Firestore Database" in het linker menu
2. Klik op "Create database"
3. Kies "Start in production mode"
4. Selecteer een locatie (bv. europe-west1)
5. Klik op "Enable"

### 3. Firestore Security Rules Instellen

Ga naar "Firestore Database" → "Rules" en vervang de inhoud met:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users collectie - alleen lezen voor ingelogde gebruikers
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.rol == 'admin';
    }
    
    // Matches collectie
    match /matches/{matchId} {
      // Iedereen kan matches lezen
      allow read: if true;
      
      // Alleen admin kan matches aanmaken/verwijderen
      allow create, delete: if request.auth != null && 
                                get(/databases/$(database)/documents/users/$(request.auth.uid)).data.rol == 'admin';
      
      // Alleen admin of aangeduide persoon kan match updaten
      allow update: if request.auth != null && (
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.rol == 'admin' ||
        resource.data.aangeduidePersoon == request.auth.uid
      );
    }
    
    // Events collectie
    match /events/{eventId} {
      // Iedereen kan events lezen
      allow read: if true;
      
      // Alleen aangeduide persoon kan events toevoegen
      allow create: if request.auth != null && 
                       exists(/databases/$(database)/documents/matches/$(request.resource.data.matchId)) &&
                       get(/databases/$(database)/documents/matches/$(request.resource.data.matchId)).data.aangeduidePersoon == request.auth.uid;
      
      // Alleen admin kan events verwijderen
      allow delete: if request.auth != null && 
                       get(/databases/$(database)/documents/users/$(request.auth.uid)).data.rol == 'admin';
    }
  }
}
```

Klik op "Publish" om de rules op te slaan.

### 4. Firebase Config Toevoegen

1. Ga naar "Project settings" (tandwiel icoon bovenaan)
2. Scroll naar beneden naar "Your apps"
3. Klik op het web icon (</>) om een web app toe te voegen
4. Geef de app een naam (bv. "VVS Rotselaar Website")
5. Kopieer de `firebaseConfig` object
6. Open `firebase-config.js` en vervang de placeholder waarden:

```javascript
const firebaseConfig = {
    apiKey: "JOUW_API_KEY",
    authDomain: "JOUW_PROJECT.firebaseapp.com",
    projectId: "JOUW_PROJECT_ID",
    storageBucket: "JOUW_PROJECT.appspot.com",
    messagingSenderId: "JOUW_SENDER_ID",
    appId: "JOUW_APP_ID"
};
```

### 5. Eerste Admin Gebruiker Aanmaken

Om de eerste admin gebruiker aan te maken, moet je eerst de Firestore security rules tijdelijk aanpassen:

1. Ga naar Firestore Database → Rules
2. Vervang tijdelijk met:
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
4. Open de website en ga naar `login.html`
5. Open de browser console (F12)
6. Voer deze code uit (vervang met jouw gegevens):

```javascript
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { addDoc, collection } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { auth, db } from './firebase-config.js';

const email = "admin@vvsrotselaar.be";
const password = "JouwVeiligWachtwoord123!";

createUserWithEmailAndPassword(auth, email, password)
  .then(async (userCredential) => {
    const user = userCredential.user;
    
    await addDoc(collection(db, 'users'), {
      uid: user.uid,
      naam: "Admin",
      email: email,
      rol: "admin",
      teams: "veteranen"
    });
    
    console.log("Admin gebruiker aangemaakt!");
  })
  .catch((error) => {
    console.error("Error:", error);
  });
```

7. Ga terug naar Firestore Rules en herstel de veilige rules (zie stap 3)
8. Log in met je nieuwe admin account

### 6. Afbeeldingen Toevoegen

Plaats de volgende afbeeldingen in de `/assets` folder:
- `logo.png` - Clublogo
- `hero1.jpg` tot `hero4.jpg` - Carousel afbeeldingen
- `veteranen.jpg`, `zaterdag.jpg`, `zondag.jpg` - Team foto's

Zie `/assets/README.md` voor meer details over afbeeldingsformaten.

### 7. Website Uploaden

#### Optie A: GitHub Pages
1. Maak een GitHub repository
2. Upload alle bestanden
3. Ga naar Settings → Pages
4. Selecteer de main branch
5. Je website is beschikbaar op `https://jouwusername.github.io/repository-name`

#### Optie B: Eigen Hosting
1. Upload alle bestanden naar je webserver
2. Zorg dat de server HTTPS ondersteunt
3. Open `index.html` in een browser

## 📊 Database Structuur

### Collection: `users`
```javascript
{
  uid: "firebase-user-id",        // String - Firebase Auth UID
  naam: "Jan Janssens",           // String - Volledige naam
  email: "jan@example.com",       // String - E-mailadres
  rol: "speler",                  // String - "admin" of "speler"
  teams: "zaterdag"               // String - "veteranen", "zaterdag" of "zondag"
}
```

### Collection: `matches`
```javascript
{
  datum: "2024-03-15",                    // String - Datum (YYYY-MM-DD)
  uur: "15:00",                           // String - Tijd (HH:MM)
  locatie: "Sportpark Rotselaar",         // String - Locatie
  thuisploeg: "VVS Rotselaar",            // String - Naam thuisploeg
  uitploeg: "FC Aarschot",                // String - Naam uitploeg
  teamType: "veteranen",                  // String - "veteranen" of "other"
  aangeduidePersoon: "firebase-uid",      // String - UID van aangeduide persoon
  status: "planned",                      // String - "planned", "live", "rust", "finished"
  startTimestamp: Timestamp,              // Timestamp - Wanneer wedstrijd gestart is
  currentMinute: 0,                       // Number - Huidige minuut
  scoreThuis: 0,                          // Number - Score thuisploeg
  scoreUit: 0                             // Number - Score uitploeg
}
```

### Collection: `events`
```javascript
{
  matchId: "match-document-id",      // String - Referentie naar match
  minuut: 23,                        // Number - Minuut van event
  type: "goal",                      // String - "goal", "penalty", "own-goal", "geel", "rood", "wissel"
  ploeg: "home",                     // String - "home" of "away"
  spelerIn: "Jan Janssens",          // String - Naam speler (bij wissel: speler die in komt)
  spelerUit: "Piet Pieters",         // String - Naam speler die uit gaat (alleen bij wissel)
  timestamp: Timestamp               // Timestamp - Wanneer event toegevoegd is
}
```

## 🔄 Wedstrijd Flow

### 1. Wedstrijd Aanmaken (Admin)
- Admin maakt wedstrijd aan via admin pagina
- Vult datum, tijd, locatie, teams in
- Selecteert aangeduide persoon (clublid)
- Wedstrijd krijgt status "planned"

### 2. Voor de Wedstrijd (30 min van tevoren)
- Aangeduide persoon ziet "START WEDSTRIJD" knop op homepage
- Andere bezoekers zien nog steeds de carousel

### 3. Wedstrijd Starten
- Aangeduide persoon klikt op "START WEDSTRIJD"
- Status wordt "live"
- Timer start automatisch
- Homepage toont live match card voor ALLE bezoekers
- Aangeduide persoon wordt automatisch doorgestuurd naar live pagina

### 4. Tijdens de Wedstrijd
- Aangeduide persoon ziet bedieningspaneel op live pagina
- Kan events invoeren (goals, kaarten, wissels)
- Alle events zijn real-time zichtbaar voor alle bezoekers
- Score wordt automatisch bijgewerkt

### 5. Rust
- Aangeduide persoon klikt op "RUST"
- Timer pauzeert
- Status wordt "rust"

### 6. Hervatten
- Aangeduide persoon klikt op "HERVAT"
- Timer hervat op correcte minuut:
  - Veteranen: minuut 35
  - Andere teams: minuut 45

### 7. Na de Wedstrijd
- Admin kan wedstrijd verwijderen via admin pagina
- Events worden automatisch ook verwijderd

## 🎨 Styling & Huisstijl

De website gebruikt een moderne blauw-wit huisstijl:
- **Primair Blauw**: `#0047AB`
- **Donker Blauw**: `#003380`
- **Licht Blauw**: `#4A90E2`
- **Accent Blauw**: `#00A3E0`
- **Wit**: `#FFFFFF`

Alle kleuren zijn gedefinieerd als CSS variabelen in `styles.css` en kunnen eenvoudig aangepast worden.

## 📱 Responsive Design

De website is volledig responsive en geoptimaliseerd voor:
- **Desktop** (1920px en hoger)
- **Laptop** (1366px - 1920px)
- **Tablet** (768px - 1366px)
- **Mobiel** (320px - 768px)

## 🔒 Beveiliging

### Firebase Security
- Firestore rules zorgen voor toegangscontrole
- Alleen admins kunnen leden beheren
- Alleen aangeduide personen kunnen wedstrijd events invoeren
- Matches zijn leesbaar voor iedereen

### Best Practices
- Gebruik sterke wachtwoorden (min. 8 karakters, hoofdletters, cijfers, speciale tekens)
- Bewaar Firebase config veilig
- Update security rules regelmatig
- Monitor Firebase console voor verdachte activiteit

## 🐛 Troubleshooting

### "Permission denied" errors
**Probleem**: Firestore geeft permission denied errors
**Oplossing**: Controleer de Firestore security rules en zorg dat ze correct zijn ingesteld

### Timer loopt niet
**Probleem**: De wedstrijdtimer update niet automatisch
**Oplossing**: 
- Controleer of de match status "live" is
- Ververs de pagina
- Controleer browser console voor errors

### Events verschijnen niet
**Probleem**: Events worden niet getoond in de timeline
**Oplossing**:
- Controleer of de gebruiker de aangeduide persoon is
- Controleer browser console voor errors
- Controleer Firestore security rules

### Login werkt niet
**Probleem**: Kan niet inloggen met email/password
**Oplossing**:
- Controleer of Email/Password auth ingeschakeld is in Firebase
- Controleer of het wachtwoord minimaal 6 karakters bevat
- Check browser console voor specifieke error codes

### Afbeeldingen laden niet
**Probleem**: Logo of achtergrondafbeeldingen worden niet getoond
**Oplossing**:
- Controleer of afbeeldingen in de `/assets` folder staan
- Controleer bestandsnamen (hoofdlettergevoelig!)
- Controleer of afbeeldingsformaten correct zijn (JPG/PNG)

## 📝 Verder Ontwikkelen

### Suggesties voor Uitbreidingen
- 📸 **Galerij**: Foto's uploaden per wedstrijd/evenement
- 📅 **Kalender**: Overzicht van alle geplande wedstrijden
- 📊 **Statistieken**: Topscorers, kaarten, etc.
- 💬 **Nieuws**: Nieuwsberichten plaatsen
- 👥 **Spelersprofielen**: Uitgebreide profielen per speler
- 📱 **Push Notificaties**: Notificaties bij goals en belangrijke events

### Code Structuur
```
/
├── index.html              # Homepage
├── live.html              # Live wedstrijd pagina
├── login.html             # Login/profiel pagina
├── admin.html             # Admin dashboard
├── evenementen.html       # Placeholder
├── sponsors.html          # Placeholder
├── galerij.html          # Placeholder
├── contact.html          # Placeholder
├── styles.css            # Main stylesheet
├── firebase-config.js    # Firebase configuratie
├── app.js               # Homepage functionaliteit
├── live.js              # Live wedstrijd functionaliteit
├── auth.js              # Authenticatie functionaliteit
├── admin.js             # Admin functionaliteit
└── assets/              # Afbeeldingen
    └── README.md        # Assets documentatie
```

## 📞 Support

Voor vragen of problemen:
1. Check deze README eerst
2. Bekijk de browser console voor errors (F12)
3. Controleer Firebase console voor database/auth issues
4. Neem contact op met de ontwikkelaar

## 📄 Licentie

Deze website is ontwikkeld voor V.V.S. Rotselaar.
© TiebeBeniers

---

**Veel succes met je website! ⚽️**
