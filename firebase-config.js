// ===============================================
// FIREBASE CONFIGURATION
// ===============================================
// Vervang deze waarden met je eigen Firebase project configuratie

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase configuratie
// BELANGRIJK: Vervang deze waarden met je eigen Firebase project gegevens
const firebaseConfig = {
  apiKey: "AIzaSyDS9uRPtr5W4r_A2i3HOM-xk47RTisCgwg",
  authDomain: "vvs-rotselaar-db.firebaseapp.com",
  projectId: "vvs-rotselaar-db",
  storageBucket: "vvs-rotselaar-db.firebasestorage.app",
  messagingSenderId: "776733736506",
  appId: "1:776733736506:web:864e8c0f9cf68a04e9bf03",
  measurementId: "G-10YHEL7ZRX"
};



// Initialiseer Firebase
const app = initializeApp(firebaseConfig);

// Exporteer services
export const auth = getAuth(app);
export const db = getFirestore(app);
