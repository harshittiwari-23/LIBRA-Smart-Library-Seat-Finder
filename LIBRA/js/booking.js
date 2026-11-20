import {functions} from './firebase-config.js';
import {httpsCallable} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-functions.js';
function call(name,payload={}) {
  if (!functions) return Promise.reject(new Error('Firebase is not configured. See README.md.'));
  if (!navigator.onLine) return Promise.reject(new Error('You are offline. Reconnect before changing bookings.'));
  return httpsCallable(functions,name)(payload).then(result=>result.data);
}
export const bookSeat = seatId => call('bookSeat',{seatId});
export const cancelBooking = () => call('cancelBooking');
export const startBreak = () => call('startBreak');
export const checkIn = rawQR => call('checkIn',{rawQR});
export const setSeatMaintenance = (seatId,unavailable) => call('setSeatMaintenance',{seatId,unavailable});
