# ⚡ SNELLE START GIDS

## 📋 Checklist voor Live Gaan

### 1️⃣ Firebase Setup (30 minuten)
- [ ] Firebase project aangemaakt op console.firebase.google.com
- [ ] Authentication ingeschakeld (Email/Password)
- [ ] Firestore Database aangemaakt
- [ ] Firestore Security Rules ingesteld (zie README.md)
- [ ] Firebase config gekopieerd naar `firebase-config.js`

### 2️⃣ Admin Account (5 minuten)
- [ ] Eerste admin gebruiker aangemaakt (zie ADMIN_SETUP.md)
- [ ] Ingelogd en admin pagina getest

### 3️⃣ Afbeeldingen (10 minuten)
- [ ] Logo toegevoegd: `assets/logo.png`
- [ ] Hero carousel afbeeldingen: `assets/hero1-4.jpg`
- [ ] Team foto's: `assets/veteranen.jpg`, `assets/zaterdag.jpg`, `assets/zondag.jpg`

### 4️⃣ Website Live (15 minuten)
- [ ] Bestanden geüpload naar hosting/GitHub Pages
- [ ] Website getest in browser
- [ ] Mobiele weergave gecontroleerd

### 5️⃣ Content Toevoegen
- [ ] Clubleden toegevoegd via admin pagina
- [ ] Eerste wedstrijd aangemaakt
- [ ] Contactgegevens aangepast in `index.html` (regel 56-89)

---

## 🚀 In 5 Stappen Live

### STAP 1: Firebase Project
```
1. Ga naar: https://console.firebase.google.com/
2. Klik: "Add project"
3. Naam: "vvs-rotselaar"
4. Volg de wizard
```

### STAP 2: Services Activeren
```
Authentication:
  → Email/Password inschakelen
  
Firestore:
  → Database aanmaken
  → Production mode
  → Locatie: europe-west1
```

### STAP 3: Config Kopiëren
```
1. Project Settings → Scroll naar beneden
2. Klik op web icon (</>)
3. Kopieer firebaseConfig object
4. Plak in firebase-config.js
```

### STAP 4: Security Rules
```
1. Firestore → Rules
2. Kopieer rules uit README.md
3. Publish
```

### STAP 5: Admin Aanmaken
```
Methode 1 (Aanbevolen):
  1. Authentication → Users → Add user
  2. Firestore → users collection aanmaken
  3. Document toevoegen met admin gegevens
  
Methode 2:
  Zie ADMIN_SETUP.md voor gedetailleerde instructies
```

---

## 🎯 Eerste Gebruik

### Als Admin Ingelogd

1. **Leden Toevoegen**
   - Ga naar Admin pagina
   - Tab "Leden Beheren"
   - Klik "+ Nieuw Lid"
   - Vul gegevens in

2. **Wedstrijd Aanmaken**
   - Tab "Wedstrijden Beheren"
   - Klik "+ Nieuwe Wedstrijd"
   - Vul datum, tijd, teams in
   - Selecteer aangeduide persoon
   - Opslaan

3. **Wedstrijd Starten**
   - Log in als aangeduide persoon
   - 30 min voor wedstrijd: "START WEDSTRIJD" knop verschijnt
   - Klik om te starten
   - Voer live events in

---

## 📝 Snelle Aanpassingen

### Contactgegevens Wijzigen
**Bestand**: `index.html`
**Regels**: 56-89
```html
<p>info@vvsrotselaar.be</p>      <!-- Email -->
<p>016 25 11 22</p>               <!-- Telefoon -->
<p>Sportpark Rotselaar...</p>     <!-- Locatie -->
```

### Kleuren Aanpassen
**Bestand**: `styles.css`
**Regels**: 8-17
```css
--primary-blue: #0047AB;    /* Hoofdkleur */
--dark-blue: #003380;       /* Donkere variant */
--light-blue: #4A90E2;      /* Lichte variant */
```

### Club Naam Wijzigen
Zoek in alle HTML bestanden naar "V.V.S. ROTSELAAR" en vervang.

---

## ⚠️ Veelvoorkomende Fouten

### ❌ "Permission denied"
**Oorzaak**: Security rules niet correct
**Oplossing**: Controleer Firestore rules en herlaad pagina

### ❌ "Firebase not initialized"
**Oorzaak**: firebase-config.js niet correct ingevuld
**Oplossing**: Check alle velden in firebaseConfig object

### ❌ Afbeeldingen laden niet
**Oorzaak**: Verkeerde bestandsnamen of locatie
**Oplossing**: Controleer `/assets` folder en bestandsnamen

### ❌ Timer loopt niet
**Oorzaak**: Match status is niet "live"
**Oplossing**: Check in Firestore of status correct is

---

## 🎓 Leermaterialen

### Firebase Documentatie
- **Auth**: https://firebase.google.com/docs/auth
- **Firestore**: https://firebase.google.com/docs/firestore
- **Security Rules**: https://firebase.google.com/docs/rules

### Hulpmiddelen
- **Firebase Console**: https://console.firebase.google.com/
- **Browser DevTools**: Druk F12 voor console errors
- **Test Database**: Firestore console voor live data

---

## 📞 Hulp Nodig?

1. ✅ Lees deze gids eerst
2. ✅ Check README.md voor details
3. ✅ Bekijk browser console (F12) voor errors
4. ✅ Controleer Firebase console voor auth/database issues
5. ✅ Zie ADMIN_SETUP.md voor admin account problemen

---

## 🎉 Klaar voor Gebruik!

Je website is klaar wanneer:
- ✅ Firebase volledig geconfigureerd
- ✅ Admin account werkt
- ✅ Afbeeldingen zichtbaar
- ✅ Eerste wedstrijd aangemaakt
- ✅ Live functionaliteit getest

**Veel succes met V.V.S. Rotselaar! ⚽️**

---

© TiebeBeniers | Voor support zie README.md
