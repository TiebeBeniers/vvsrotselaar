# Firestore- en applicatiebeveiliging

## Samenvatting

De oorspronkelijke Firestore-regels boden onvoldoende afscherming voor privégebruikersgegevens, MOTM-stemmen, werklijstinschrijvingen en Rock Werchter-bestellingen. Tijdens het oplossen kwamen ook een onbetrouwbare Bancontact-callback, verouderde browsercaches met profielgegevens en publiek leesbare betalingsstatussen aan het licht.

Alle onderstaande bevindingen zijn in de huidige werkboom aangepakt. De wijzigingen zijn nog niet naar Firebase-productie gedeployed.

## Bevindingen

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | `firestore.rules` | 179-201 | Privé-accountvelden waren openbaar leesbaar. Gebruikersdocumenten zijn nu privé; alleen een beperkte projectie met toegestane naam-, ploeg- en statistiekgegevens staat in `public_profiles`. | 9/10 |
| 2 | 🟠 HIGH | `firestore.rules` | 224-281 | MOTM-stemmen waren te ruim leesbaar en onvoldoende beschermd tegen ongeldige stemmen. Stemdocumenten zijn beperkt tot de eigenaar en bevoegde beheerders; kandidaat, rangorde en stemrecht worden gecontroleerd en de uitslag wordt server-side verwerkt. | 9/10 |
| 3 | 🟡 MEDIUM | `firestore.rules` | 318-333 | Clients konden werklijstinschrijvingen rechtstreeks aanpassen. Directe clientwrites zijn geblokkeerd; aan- en afmeldingen worden transactioneel door een callable function gevalideerd. | 9/10 |
| 4 | 🟠 HIGH | `functions/index.js` | 462-580 | Rock Werchter-orders en betaalgegevens konden niet volledig op vertrouwde serverdata steunen. De server berekent prijzen vanuit de catalogus, valideert winkelwagen en accountrechten, verifieert Bancontact-betalingen en voorkomt hergebruik van een betaling. | 9/10 |
| 5 | 🟠 HIGH | `functions/index.js` | 998-1159 | De Bancontact-callback vertrouwde eerder de aangeleverde status. De callback haalt nu de betalingsstatus op bij de provider; betalingsaanmaak vereist een geldig Firebase-token en de betaling wordt privé aan de eigenaar gekoppeld. | 9/10 |
| 6 | 🟡 MEDIUM | `scripts/speler.js` | 34-48, 440-478 | Profielcaches konden privégegevens bewaren en die op een gedeelde browser tonen. Verouderde profielcaches worden verwijderd; eigen privéprofielen worden niet gecachet en publieke profielen gebruiken een aparte cache-sleutel. | 8/10 |
| 7 | ⚪ LOW | `firestore.rules` | 349-356 | Betalingsstatussen waren zonder eigenaarscontrole leesbaar. Alleen de eigenaar en beheerders kunnen de status nu lezen; privébetaalmetadata blijft ontoegankelijk voor clients. | 9/10 |

## Validatie

- Firestore Emulator heeft de regels gecompileerd.
- Emulator-smoketests slaagden voor privégebruikersdata, openbare profielprojecties, eigenaars- en niet-eigenaarsrechten op betalingsstatussen en afgeschermde betaalmetadata.
- `node --check` slaagde voor de gewijzigde JavaScript-bestanden.
- Firebase-configuratie parseerde geldig en `git diff --check` gaf geen whitespacefouten.
- De Cloud Functions Emulator heeft de functiedefinities geladen.
- Er is geen productie-uitrol uitgevoerd. Voor livegebruik moeten de Firestore Rules, Cloud Functions en hostingwijzigingen passend worden gedeployed; voer daarna de bestaande profiel- en evenemententellerbackfill uit als beheerder.
