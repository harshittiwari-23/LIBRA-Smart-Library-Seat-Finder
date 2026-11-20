// Public Firebase Web App configuration — replace the placeholders after creating your Firebase project.
// Firebase Web API keys are NOT secret service-account credentials. Security comes from Rules + Cloud Functions.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {getAuth} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {getFirestore} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import {getFunctions} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-functions.js';

const firebaseConfig = {
  apiKey: 'PASTE_YOUR_FIREBASE_WEB_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  appId: 'PASTE_YOUR_FIREBASE_WEB_APP_ID'
};
export const isConfigured = !firebaseConfig.apiKey.startsWith('PASTE_') && firebaseConfig.projectId !== 'YOUR_PROJECT_ID';
export const app = isConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app,'asia-south1') : null;
