'use strict';
// Run only with Admin SDK credentials from your local machine. Never deploy this script to the browser.
const {randomBytes} = require('node:crypto');
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {hashQR} = require('../core');
initializeApp({credential: applicationDefault()});
const db = getFirestore();
async function main() {
  let created = 0, existing = 0;
  for (let floor = 1; floor <= 3; floor++) {
    for (let number = 1; number <= 20; number++) {
      const id = `F${floor}-S${String(number).padStart(2,'0')}`;
      const seatRef = db.collection('seats').doc(id);
      const secretRef = db.collection('seatSecrets').doc(id);
      // Transaction avoids token rotation or seat resets on repeated runs.
      await db.runTransaction(async tx => {
        const [seatSnap, secretSnap] = await Promise.all([tx.get(seatRef),tx.get(secretRef)]);
        if (!seatSnap.exists) {
          tx.create(seatRef, {floor, seatNumber:number, label:`S${String(number).padStart(2,'0')}`, zone:['Quiet Zone','Study Hub','Research Wing'][floor-1], status:(floor===1&&number===20)||(floor===2&&number===19)?'unavailable':'available', activeBookingId:null, reservedUntilMs:null, breakExpiresAtMs:null, createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()});
          created++;
        } else existing++;
        if (!secretSnap.exists) {
          const token = randomBytes(32).toString('base64url');
          tx.create(secretRef, {token, tokenHash:hashQR(token), createdAt:FieldValue.serverTimestamp()});
        }
      });
    }
  }
  console.log(`Done: ${created} seats added, ${existing} already existed. QR secrets preserved.`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
