import {auth,db,isConfigured} from './firebase-config.js';
import {createUserWithEmailAndPassword,signInWithEmailAndPassword,updateProfile,getIdTokenResult,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {doc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import {$} from './utils.js';

const isRegister = !!$('registerForm');
const form = $(isRegister ? 'registerForm' : 'loginForm');
let handlingSubmit = false;
if (!isConfigured) {
  $('setupNote').hidden=false;
  $('submitBtn').disabled=true;
}
async function redirect(user) {
  const token=await getIdTokenResult(user);
  window.location.href=token.claims.admin===true?'admin.html':'dashboard.html';
}
if (isConfigured) {
  onAuthStateChanged(auth,user=>{if (user && !handlingSubmit) redirect(user).catch(console.error)});
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    handlingSubmit = true;
    const button=$('submitBtn');
    const error=$('formError');
    error.hidden=true;
    button.disabled=true;
    button.textContent='Working…';
    try {
      const email=$('email').value.trim();
      const password=$('password').value;
      if (isRegister) {
        const name=$('name').value.trim();
        if (name.length<2) throw new Error('Please enter your full name.');
        const result=await createUserWithEmailAndPassword(auth,email,password);
        await updateProfile(result.user,{displayName:name});
        try {
          await setDoc(doc(db,'users',result.user.uid),{displayName:name,email:result.user.email,createdAt:serverTimestamp()});
        } catch (profileError) {
          console.warn('Profile document could not be created; Firebase Auth account exists.', profileError);
        }
        await redirect(result.user);
      } else {
        const result=await signInWithEmailAndPassword(auth,email,password);
        await redirect(result.user);
      }
    } catch (err) {
      handlingSubmit = false;
      const code=err?.code || '';
      const known={
        'auth/email-already-in-use':'This email is already registered. Try logging in.',
        'auth/invalid-email':'Please enter a valid email address.',
        'auth/weak-password':'Use a stronger password (at least 6 characters).',
        'auth/invalid-credential':'Email or password is incorrect.',
        'auth/network-request-failed':'Network error. Please check your internet connection.'
      };
      error.textContent=known[code] || err.message || 'Unable to continue.';
      error.hidden=false;
      button.disabled=false;
      button.textContent=isRegister?'Create account →':'Log in →';
    }
  });
}
