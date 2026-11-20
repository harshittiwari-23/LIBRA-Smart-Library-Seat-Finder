'use strict';
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const email = process.argv[2];
if (!email) {console.error('Usage: npm run admin -- admin@example.com');process.exit(1)}
initializeApp({credential:applicationDefault()});
(async()=>{
  const user = await getAuth().getUserByEmail(email);
  await getAuth().setCustomUserClaims(user.uid,{...(user.customClaims || {}),admin:true});
  console.log(`Admin claim granted to ${email}. Sign out and sign in again to refresh the ID token.`);
})().catch(error=>{console.error(error);process.exitCode=1});
