'use strict';
const {createHash, timingSafeEqual} = require('node:crypto');
const BREAK_MS = 20 * 60 * 1000;
const RESERVATION_MS = 10 * 60 * 1000;
const QR_PATTERN = /^LIBRA:v1:(F[123]-S(?:0[1-9]|1[0-9]|20)):([a-zA-Z0-9_-]{32,128})$/;
const SEAT_PATTERN = /^F[123]-S(?:0[1-9]|1[0-9]|20)$/;

function parseQR(payload) {
  if (typeof payload !== 'string' || payload.length > 240) return null;
  const match = payload.trim().match(QR_PATTERN);
  return match ? {seatId: match[1], token: match[2]} : null;
}
function hashQR(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
function verifiedToken(token, storedHash) {
  if (typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  const actual = Buffer.from(hashQR(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(actual, expected);
}
function expired(status, seat, now) {
  if (status === 'reserved') return Number.isFinite(seat.reservedUntilMs) && seat.reservedUntilMs <= now;
  if (status === 'break') return Number.isFinite(seat.breakExpiresAtMs) && seat.breakExpiresAtMs <= now;
  return false;
}
function occupiedMs(booking, now) {
  return (booking.totalOccupiedMs || 0) + (booking.status === 'occupied' && Number.isFinite(booking.occupiedSinceMs)
    ? Math.max(0, now - booking.occupiedSinceMs) : 0);
}
module.exports = {BREAK_MS, RESERVATION_MS, SEAT_PATTERN, parseQR, hashQR, verifiedToken, expired, occupiedMs};
