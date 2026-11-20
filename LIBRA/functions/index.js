'use strict';
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {onTaskDispatched} = require('firebase-functions/v2/tasks');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {logger} = require('firebase-functions');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {getFunctions} = require('firebase-admin/functions');
const {BREAK_MS, RESERVATION_MS, SEAT_PATTERN, parseQR, verifiedToken, expired, occupiedMs} = require('./core');

initializeApp();
const db = getFirestore();
const REGION = 'asia-south1';
const callable = {region: REGION, maxInstances: 20};
const taskOptions = {region: REGION, retryConfig: {maxAttempts: 8, minBackoffSeconds: 10}, rateLimits: {maxConcurrentDispatches: 15}};

function requireUser(req) {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Please log in first.');
  return req.auth.uid;
}
function requireAdmin(req) {
  requireUser(req);
  if (req.auth.token.admin !== true) throw new HttpsError('permission-denied', 'Administrator access required.');
}
function fail(message) {throw new HttpsError('failed-precondition', message);}
function seatRef(id) {return db.collection('seats').doc(id);}
function activeRef(uid) {return db.collection('activeBookings').doc(uid);}
function bookingRef(id) {return db.collection('bookings').doc(id);}
const serverTime = () => FieldValue.serverTimestamp();

// Best-effort precise dispatch; scheduled fallback below handles queue failures.
async function enqueueExpiry(seatId, bookingId, dueMs) {
  try {
    const name = `locations/${REGION}/functions/expireSeatTask`;
    await getFunctions().taskQueue(name).enqueue({seatId, bookingId}, {scheduleTime: new Date(dueMs)});
  } catch (error) {
    logger.error('Expiry task enqueue failed; 1-minute scheduled cleanup remains active.', {seatId, bookingId, error});
  }
}

exports.bookSeat = onCall(callable, async req => {
  const uid = requireUser(req);
  const seatId = req.data?.seatId;
  if (typeof seatId !== 'string' || !SEAT_PATTERN.test(seatId)) throw new HttpsError('invalid-argument','Invalid seat ID.');
  const now = Date.now();
  const until = now + RESERVATION_MS;
  const newBooking = db.collection('bookings').doc();
  await db.runTransaction(async tx => {
    const [seatSnap, activeSnap] = await Promise.all([tx.get(seatRef(seatId)), tx.get(activeRef(uid))]);
    if (!seatSnap.exists) fail('Seat not found.');
    if (activeSnap.exists) fail('You already have an active seat. Cancel it before booking another.');
    if (seatSnap.data().status !== 'available') fail('This seat has just been reserved or is not available.');
    const seat = seatSnap.data();
    tx.update(seatRef(seatId), {status:'reserved', activeBookingId:newBooking.id, reservedUntilMs:until, breakExpiresAtMs:null, updatedAt:serverTime()});
    tx.create(newBooking, {
      uid, email:req.auth.token.email || '', seatId, floor:seat.floor, status:'reserved',
      bookedAtMs:now, reservedUntilMs:until, checkInAtMs:null, occupiedSinceMs:null,
      breakExpiresAtMs:null, currentBreakId:null, totalOccupiedMs:0, breakCount:0,
      endedAtMs:null, endReason:null, createdAt:serverTime(), updatedAt:serverTime()
    });
    tx.create(activeRef(uid), {bookingId:newBooking.id, seatId, floor:seat.floor, status:'reserved', reservedUntilMs:until, breakExpiresAtMs:null, updatedAt:serverTime()});
  });
  await enqueueExpiry(seatId, newBooking.id, until);
  return {bookingId:newBooking.id, seatId, reservedUntilMs:until};
});

exports.checkIn = onCall(callable, async req => {
  const uid = requireUser(req);
  const parsed = parseQR(req.data?.rawQR);
  if (!parsed) throw new HttpsError('invalid-argument', 'Invalid QR format. Scan the QR at your assigned seat.');
  const now = Date.now();
  const {seatId, token} = parsed;
  const result = await db.runTransaction(async tx => {
    const [activeSnap, secretSnap] = await Promise.all([
      tx.get(activeRef(uid)), tx.get(db.collection('seatSecrets').doc(seatId))
    ]);
    if (!activeSnap.exists) fail('No active seat reservation.');
    const active = activeSnap.data();
    if (active.seatId !== seatId) fail('This QR is for a different seat.');
    if (!secretSnap.exists || !verifiedToken(token, secretSnap.data().tokenHash)) {
      throw new HttpsError('permission-denied','QR verification failed. Use the code at the actual seat.');
    }
    const [bookingSnap, seatSnap] = await Promise.all([
      tx.get(bookingRef(active.bookingId)), tx.get(seatRef(seatId))
    ]);
    if (!bookingSnap.exists || !seatSnap.exists) fail('Seat booking is missing.');
    const booking = bookingSnap.data();
    if (booking.uid !== uid || seatSnap.data().activeBookingId !== active.bookingId) fail('Booking ownership could not be verified.');
    if (booking.status === 'reserved') {
      if (booking.reservedUntilMs <= now) fail('Reservation expired. Please book a seat again.');
      tx.update(bookingRef(active.bookingId), {status:'occupied', checkInAtMs:now, occupiedSinceMs:now, updatedAt:serverTime()});
      tx.update(seatRef(seatId), {status:'occupied', reservedUntilMs:null, updatedAt:serverTime()});
      tx.update(activeRef(uid), {status:'occupied', reservedUntilMs:null, updatedAt:serverTime()});
      return {message:'Checked in successfully!', status:'occupied'};
    }
    if (booking.status === 'break') {
      if (booking.breakExpiresAtMs <= now) fail('Your 20-minute break has expired.');
      if (!booking.currentBreakId) fail('Break session record missing.');
      const breakRef = db.collection('breakSessions').doc(booking.currentBreakId);
      const breakSnap = await tx.get(breakRef);
      if (!breakSnap.exists || breakSnap.data().uid !== uid || breakSnap.data().status !== 'active') fail('Break session is no longer active.');
      tx.update(breakRef, {status:'returned', returnedAtMs:now, updatedAt:serverTime()});
      tx.update(bookingRef(active.bookingId), {status:'occupied', occupiedSinceMs:now, breakExpiresAtMs:null, currentBreakId:null, updatedAt:serverTime()});
      tx.update(seatRef(seatId), {status:'occupied', breakExpiresAtMs:null, updatedAt:serverTime()});
      tx.update(activeRef(uid), {status:'occupied', breakExpiresAtMs:null, updatedAt:serverTime()});
      return {message:'Welcome back! Your seat is occupied again.', status:'occupied'};
    }
    fail('Your booking is not awaiting a QR check-in.');
  });
  return result;
});

exports.startBreak = onCall(callable, async req => {
  const uid = requireUser(req);
  const now = Date.now();
  const until = now + BREAK_MS;
  const response = await db.runTransaction(async tx => {
    const activeSnap = await tx.get(activeRef(uid));
    if (!activeSnap.exists) fail('You do not have an active booking.');
    const active = activeSnap.data();
    const [bookingSnap, seatSnap] = await Promise.all([
      tx.get(bookingRef(active.bookingId)), tx.get(seatRef(active.seatId))
    ]);
    if (!bookingSnap.exists || !seatSnap.exists) fail('Booking not found.');
    const booking = bookingSnap.data();
    if (booking.uid !== uid || booking.status !== 'occupied' || seatSnap.data().activeBookingId !== active.bookingId) fail('Check in before starting a break.');
    const count = (booking.breakCount || 0) + 1;
    const breakId = `${active.bookingId}-b${count}`;
    tx.update(bookingRef(active.bookingId), {status:'break', totalOccupiedMs:occupiedMs(booking,now), occupiedSinceMs:null, breakCount:count, breakExpiresAtMs:until, currentBreakId:breakId, updatedAt:serverTime()});
    tx.update(seatRef(active.seatId), {status:'break', breakExpiresAtMs:until, updatedAt:serverTime()});
    tx.update(activeRef(uid), {status:'break', breakExpiresAtMs:until, updatedAt:serverTime()});
    tx.create(db.collection('breakSessions').doc(breakId), {uid, bookingId:active.bookingId, seatId:active.seatId, startedAtMs:now, expiresAtMs:until, status:'active', returnedAtMs:null, updatedAt:serverTime()});
    return {seatId:active.seatId, bookingId:active.bookingId};
  });
  await enqueueExpiry(response.seatId, response.bookingId, until);
  return {breakExpiresAtMs:until};
});

exports.cancelBooking = onCall(callable, async req => {
  const uid = requireUser(req);
  const now = Date.now();
  return db.runTransaction(async tx => {
    const activeSnap = await tx.get(activeRef(uid));
    if (!activeSnap.exists) fail('You have no active booking to cancel.');
    const active = activeSnap.data();
    const [bookingSnap, seatSnap] = await Promise.all([
      tx.get(bookingRef(active.bookingId)), tx.get(seatRef(active.seatId))
    ]);
    if (!bookingSnap.exists || bookingSnap.data().uid !== uid || !seatSnap.exists || seatSnap.data().activeBookingId !== active.bookingId) fail('Booking consistency check failed.');
    const booking = bookingSnap.data();
    let breakRef = null;
    if (booking.status === 'break' && booking.currentBreakId) {
      breakRef = db.collection('breakSessions').doc(booking.currentBreakId);
      await tx.get(breakRef);
    }
    tx.update(bookingRef(active.bookingId), {status:'ended', totalOccupiedMs:occupiedMs(booking,now), occupiedSinceMs:null, breakExpiresAtMs:null, currentBreakId:null, endedAtMs:now, endReason:'cancelled-by-student', updatedAt:serverTime()});
    if (breakRef) tx.update(breakRef, {status:'cancelled', endedAtMs:now, updatedAt:serverTime()});
    tx.update(seatRef(active.seatId), {status:'available', activeBookingId:null, reservedUntilMs:null, breakExpiresAtMs:null, updatedAt:serverTime()});
    tx.delete(activeRef(uid));
    return {message:'Your seat has been released.'};
  });
});

async function releaseExpiredSeat(seatId, bookingId) {
  if (!SEAT_PATTERN.test(seatId) || typeof bookingId !== 'string' || !/^[A-Za-z0-9]{12,40}$/.test(bookingId)) return false;
  const now = Date.now();
  return db.runTransaction(async tx => {
    const [seatSnap, bookingSnap] = await Promise.all([tx.get(seatRef(seatId)), tx.get(bookingRef(bookingId))]);
    if (!seatSnap.exists || !bookingSnap.exists) return false;
    const seat = seatSnap.data(), booking = bookingSnap.data();
    if (seat.activeBookingId !== bookingId || booking.seatId !== seatId || !expired(seat.status,seat,now)) return false;
    if (!['break','reserved'].includes(booking.status)) return false;
    const userActive = activeRef(booking.uid);
    const activeSnap = await tx.get(userActive);
    let breakRef = null;
    if (seat.status === 'break' && booking.currentBreakId) {
      breakRef = db.collection('breakSessions').doc(booking.currentBreakId);
      await tx.get(breakRef);
    }
    const reason = seat.status === 'break' ? 'break-expired' : 'reservation-expired';
    tx.update(seatRef(seatId), {status:'available', activeBookingId:null, reservedUntilMs:null, breakExpiresAtMs:null, updatedAt:serverTime()});
    tx.update(bookingRef(bookingId), {status:'ended', endedAtMs:now, endReason:reason, currentBreakId:null, breakExpiresAtMs:null, updatedAt:serverTime()});
    if (activeSnap.exists && activeSnap.data().bookingId === bookingId) tx.delete(userActive);
    if (breakRef) tx.update(breakRef, {status:'expired', endedAtMs:now, updatedAt:serverTime()});
    logger.info('Automatically released seat', {seatId, bookingId, reason});
    return true;
  });
}

exports.expireSeatTask = onTaskDispatched(taskOptions, async req => {
  const {seatId, bookingId} = req.data || {};
  return {released:await releaseExpiredSeat(seatId,bookingId)};
});

// Backup for delayed/lost queue enqueue or task dispatch (not an exact-time guarantee).
exports.reconcileExpiredSeats = onSchedule({schedule:'every 1 minutes',region:REGION,timeoutSeconds:120}, async () => {
  const snapshot = await db.collection('seats').get(); // 60 demo seats: small scan avoids composite indexes.
  const now = Date.now();
  const due = snapshot.docs.filter(doc => ['break','reserved'].includes(doc.data().status) && expired(doc.data().status,doc.data(),now) && doc.data().activeBookingId);
  const results = await Promise.allSettled(due.map(doc => releaseExpiredSeat(doc.id,doc.data().activeBookingId)));
  results.filter(item => item.status === 'rejected').forEach(item => logger.error('Fallback release failed',item.reason));
});

// Admin repair/maintenance: create or clear an unavailable seat without allowing client writes.
exports.setSeatMaintenance = onCall(callable, async req => {
  requireAdmin(req);
  const seatId = req.data?.seatId;
  const unavailable = req.data?.unavailable;
  if (typeof seatId !== 'string' || !SEAT_PATTERN.test(seatId) || typeof unavailable !== 'boolean') throw new HttpsError('invalid-argument','Invalid seat maintenance request.');
  await db.runTransaction(async tx => {
    const snap = await tx.get(seatRef(seatId));
    if (!snap.exists) fail('Seat not found.');
    const status = snap.data().status;
    if (!['available','unavailable'].includes(status)) fail('A seat cannot be changed while it has an active booking.');
    tx.update(seatRef(seatId), {status:unavailable?'unavailable':'available', updatedAt:serverTime()});
  });
  return {seatId, status:unavailable?'unavailable':'available'};
});
