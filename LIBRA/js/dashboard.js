import {auth,db,isConfigured} from './firebase-config.js';
import {onAuthStateChanged,signOut,getIdTokenResult} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {onSnapshot,collection,doc} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import {$,escapeHTML,formatDate,notify,readableError,statusClass} from './utils.js';
import {bookSeat,cancelBooking,startBreak} from './booking.js';
import {startCountdown,clearCountdown} from './break-timer.js';
import {openScanner,initScanner} from './qr.js';

const floors={1:'Quiet Zone',2:'Study Hub',3:'Research Wing'};
let seats=[];
let floor=1;
let selectedId=null;
let myActive=null;
let previousActive=null;
let currentUser=null;
let ongoingAction=false;
let unsubscribeSeats=()=>{};
let unsubscribeActive=()=>{};

$('dateLabel').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});
initScanner();
$('logoutBtn').addEventListener('click',async()=>{if (auth) await signOut(auth);window.location.replace('login.html')});
window.addEventListener('offline',()=>notify('You are offline. Displayed seats may be outdated; bookings are disabled.'));
window.addEventListener('online',()=>notify('Connection restored. Live updates are reconnecting.','success'));
if (!isConfigured) {
  notify('Firebase has not been configured. Open js/firebase-config.js and follow README.md.');
  $('seatMap').innerHTML='<div class="skeleton">Connect Firebase and seed the seats to see live availability.</div>';
} else {
  onAuthStateChanged(auth,async user=>{
    unsubscribeSeats();unsubscribeActive();clearCountdown();
    if (!user) {window.location.replace('login.html');return}
    currentUser=user;
    const token=await getIdTokenResult(user);
    if (token.claims.admin===true) { /* Admins may also test the student experience. */ }
    const name=user.displayName || user.email?.split('@')[0] || 'Student';
    $('studentName').textContent=name.split(' ')[0];
    $('avatar').textContent=name.charAt(0).toUpperCase();
    subscribe();
  });
}
for (const button of document.querySelectorAll('[data-floor]')) {
  button.addEventListener('click',()=>{
    floor=Number(button.dataset.floor);
    for (const tab of document.querySelectorAll('[data-floor]')) {
      const active=Number(tab.dataset.floor)===floor;
      tab.classList.toggle('active',active);
      tab.setAttribute('aria-selected',String(active));
    }
    selectedId=null;
    render();
  });
}
function subscribe() {
  unsubscribeSeats=onSnapshot(collection(db,'seats'),{includeMetadataChanges:true},snapshot=>{
    seats=snapshot.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.floor-b.floor || a.seatNumber-b.seatNumber);
    if (snapshot.metadata.fromCache) notify('Offline/cached data may not reflect current seat availability.','warning');
    else if (navigator.onLine) notify('','success');
    render();
  },err=>notify(`Could not load seats: ${readableError(err)}`));
  unsubscribeActive=onSnapshot(doc(db,'activeBookings',currentUser.uid),snapshot=>{
    previousActive=myActive;
    myActive=snapshot.exists()?snapshot.data():null;
    if (previousActive && !myActive && !ongoingAction) {
      const reason=previousActive.status==='break' && previousActive.breakExpiresAtMs<=Date.now()
        ? 'Your 20-minute break expired. The seat was released automatically.'
        : previousActive.status==='reserved' && previousActive.reservedUntilMs<=Date.now()
          ? 'Your reservation expired because no QR check-in was completed.'
          : 'Your booking is no longer active.';
      notify(reason,'warning');
    }
    render();
  },err=>notify(`Could not load your booking: ${readableError(err)}`));
}
function render() {
  const count=status=>seats.filter(s=>s.status===status).length;
  $('totalCount').textContent=seats.length || '—';
  $('availableCount').textContent=count('available');
  $('occupiedCount').textContent=count('occupied');
  $('breakCount').textContent=count('break');
  $('floorTitle').textContent=`Floor ${floor} · ${floors[floor]}`;
  renderSeats();renderSelected();renderBooking();
}
function renderSeats() {
  const map=$('seatMap');map.replaceChildren();
  const current=seats.filter(seat=>seat.floor===floor);
  if (!current.length) {map.innerHTML='<div class="skeleton">No seats yet. Admin: run the seed script in README.md.</div>';return}
  for (const seat of current) {
    const button=document.createElement('button');
    const mine=myActive?.seatId===seat.id;
    button.type='button';
    button.className=`seat ${statusClass(seat.status)} ${selectedId===seat.id?'selected':''} ${mine?'mine':''}`;
    button.textContent=seat.label || seat.id;
    button.title=`${seat.id}: ${seat.status}${mine?' (your seat)':''}`;
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed',String(selectedId===seat.id));
    button.addEventListener('click',()=>{selectedId=seat.id;renderSelected();renderSeats()});
    map.appendChild(button);
  }
}
function renderSelected() {
  const seat=seats.find(s=>s.id===selectedId);
  const container=$('selectedSeat');
  if (!seat) {container.innerHTML='<div class="empty-selection">Select a seat on the map to see its details.</div>';return}
  container.innerHTML=`<div class="selected-seat-number">${escapeHTML(seat.id)}</div><p class="selected-seat-info">Floor ${seat.floor} · ${escapeHTML(seat.zone)} · Seat ${escapeHTML(seat.label)}</p><div class="detail-row"><span>Current status</span><b><span class="chip ${statusClass(seat.status)}">${escapeHTML(seat.status)}</span></b></div><div class="detail-row"><span>Entry check-in</span><b>Required QR scan</b></div><div class="booking-actions"><button class="btn btn-primary" id="bookSelected" ${seat.status!=='available'||!!myActive||ongoingAction||!navigator.onLine?'disabled':''}>${myActive?'You already have a booking':seat.status==='available'?'Reserve this seat →':'Seat unavailable'}</button></div>`;
  $('bookSelected').addEventListener('click',()=>withAction(async()=>{
    const response=await bookSeat(seat.id);
    notify(`${seat.id} is reserved! Scan its QR code within 10 minutes.`, 'success');
    return response;
  }));
}
function renderBooking() {
  clearCountdown();
  const container=$('myBooking');
  if (!myActive) {
    container.innerHTML='<div class="empty-booking"><span class="empty-illustration">▣</span><b>No active booking yet</b><p>Choose a green seat on the map and it will appear here.</p></div>';
    return;
  }
  const booking=myActive;
  const expiry=booking.status==='break'?booking.breakExpiresAtMs:booking.status==='reserved'?booking.reservedUntilMs:null;
  container.innerHTML=`<div class="booking-summary"><div class="booking-summary-head"><strong>${escapeHTML(booking.seatId)}</strong><span class="chip ${statusClass(booking.status)}">${booking.status==='break'?'On break':escapeHTML(booking.status)}</span></div><div class="detail-row"><span>Location</span><b>Floor ${booking.floor} · ${escapeHTML(floors[booking.floor]||'Library')}</b></div><div class="detail-row"><span>Check-in</span><b>${booking.status==='reserved'?'Pending QR scan':escapeHTML(booking.status)}</b></div>${expiry?`<div class="timer-box"><small>${booking.status==='break'?'Break ends in':'Scan QR within'}</small><strong id="countdown">--:--</strong></div>`:''}</div><div class="booking-actions">${['reserved','break'].includes(booking.status)?'<button class="btn btn-primary" id="checkInBtn">⌗ Scan seat QR to check in</button>':''}${booking.status==='occupied'?'<button class="btn btn-primary" id="startBreakBtn">◷ Start 20-minute break</button>':''}<button class="btn btn-outline btn-danger" id="cancelBtn">${booking.status==='reserved'?'Cancel reservation':'End session / release seat'}</button></div>`;
  $('checkInBtn')?.addEventListener('click',()=>openScanner(message=>notify(message,'success')));
  $('startBreakBtn')?.addEventListener('click',()=>withAction(async()=>{
    await startBreak();notify('Your 20-minute break has started. Scan the seat QR to return.','success');
  }));
  $('cancelBtn')?.addEventListener('click',()=>{
    if (!confirm('Release your seat? This cannot be undone.')) return;
    withAction(async()=>{await cancelBooking();notify('Your seat was released.','success')});
  });
  if (expiry) startCountdown(expiry,$('countdown'),()=>{
    const el=$('countdown');
    if (el) el.parentElement.querySelector('small').textContent='Time expired — awaiting server release';
  });
}
async function withAction(action) {
  if (ongoingAction) return;
  ongoingAction=true;renderSelected();
  try {await action()} catch (err){notify(readableError(err),'warning')}
  finally {ongoingAction=false;renderSelected()}
}
