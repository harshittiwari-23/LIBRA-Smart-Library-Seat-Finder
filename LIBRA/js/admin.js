import {auth,db,isConfigured} from './firebase-config.js';
import {onAuthStateChanged,getIdTokenResult,signOut} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {collection,onSnapshot,query,orderBy,limit} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import {$,escapeHTML,formatDate,humanDuration,notify,readableError,statusClass} from './utils.js';

let seats=[];
let bookings=[];
let charts={};
let initialized=false;
$('logoutBtn').addEventListener('click',async()=>{if(auth) await signOut(auth);location.replace('login.html')});
$('printQR').addEventListener('click',()=>window.print());
window.addEventListener('offline',()=>notify('You are offline. Admin reports may be outdated.','warning'));
window.addEventListener('online',()=>notify('Reconnected. Live reports are updating.','success'));
if (!isConfigured) {
  notify('Firebase is not configured. Follow README.md first.');
} else {
  onAuthStateChanged(auth,async user=>{
    if (!user) {location.replace('login.html');return}
    try {
      const idToken=await getIdTokenResult(user,true);
      if (idToken.claims.admin!==true) {location.replace('dashboard.html');return}
      if (!initialized) {initialized=true;subscribe()}
    } catch(err) {notify(`Unable to verify admin privileges: ${readableError(err)}`)}
  });
}
function subscribe() {
  onSnapshot(collection(db,'seats'),snapshot=>{
    seats=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    if(snapshot.metadata.fromCache) notify('Using cached reports — they may be outdated.');
    render();
  },err=>notify(`Seat data error: ${readableError(err)}`));
  onSnapshot(query(collection(db,'bookings'),orderBy('bookedAtMs','desc'),limit(500)),snapshot=>{
    bookings=snapshot.docs.map(d=>({id:d.id,...d.data()}));
    render();
  },err=>notify(`Booking history error: ${readableError(err)}`));
  onSnapshot(collection(db,'seatSecrets'),snapshot=>renderQR(snapshot.docs.map(d=>({id:d.id,...d.data()}))),err=>notify(`QR data error: ${readableError(err)}`));
}
function render() {
  $('totalCount').textContent=seats.length||'—';
  for(const key of ['available','occupied','break']) $(key+'Count').textContent=seats.filter(s=>s.status===key).length;
  $('bookingTotal').textContent=bookings.length;
  $('checkinTotal').textContent=bookings.filter(b=>Number.isFinite(b.checkInAtMs)).length;
  $('expiredTotal').textContent=bookings.filter(b=>b.endReason==='break-expired').length;
  $('lastUpdated').textContent=`Updated ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`;
  renderCharts();renderHogging();renderHistory();
}
function paintChart(name,canvas,config) {
  if (!window.Chart) return;
  if (charts[name]) charts[name].destroy();
  charts[name]=new window.Chart($(canvas),{
    ...config,
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{family:'DM Sans',size:10},boxWidth:11,boxHeight:11}}},scales:config.type==='doughnut'?{}:{x:{ticks:{font:{size:10},color:'#91a0b4'},grid:{display:false}},y:{beginAtZero:true,ticks:{precision:0,font:{size:10},color:'#91a0b4'},grid:{color:'#edf2f8'}}},...config.options}
  });
}
function renderCharts() {
  const hourly=Array(24).fill(0);
  for(const booking of bookings) if(Number.isFinite(booking.checkInAtMs)) hourly[new Date(booking.checkInAtMs).getHours()]++;
  paintChart('peak','peakChart',{type:'bar',data:{labels:Array.from({length:24},(_,i)=>`${i}:00`),datasets:[{label:'Check-ins',data:hourly,backgroundColor:'#6e8af5',borderRadius:5,maxBarThickness:16}]},options:{plugins:{legend:{display:false}}}});
  const floors=[1,2,3];
  paintChart('floors','floorChart',{type:'bar',data:{labels:floors.map(f=>`Floor ${f}`),datasets:[
    {label:'Occupied',data:floors.map(f=>seats.filter(s=>s.floor===f&&s.status==='occupied').length),backgroundColor:'#ed7983',borderRadius:5},
    {label:'On break',data:floors.map(f=>seats.filter(s=>s.floor===f&&s.status==='break').length),backgroundColor:'#f0ba65',borderRadius:5},
    {label:'Available',data:floors.map(f=>seats.filter(s=>s.floor===f&&s.status==='available').length),backgroundColor:'#6acfa2',borderRadius:5}
  ]},options:{scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true,ticks:{precision:0}}}}});
  const counts=new Map();
  for(const b of bookings) if(Number.isFinite(b.checkInAtMs)) counts.set(b.seatId,(counts.get(b.seatId)||0)+1);
  const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,8);
  paintChart('seats','seatChart',{type:'bar',data:{labels:top.length?top.map(x=>x[0]):['No data'],datasets:[{label:'QR check-ins',data:top.length?top.map(x=>x[1]):[0],backgroundColor:'#7894ed',borderRadius:6}]},options:{indexAxis:'y',plugins:{legend:{display:false}}}});
}
function elapsedOccupied(booking) {
  const base=Number(booking.totalOccupiedMs)||0;
  return base+(booking.status==='occupied'&&Number.isFinite(booking.occupiedSinceMs)?Math.max(0,Date.now()-booking.occupiedSinceMs):0);
}
function renderHogging() {
  const groups=new Map();
  for(const booking of bookings) {
    if(!Number.isFinite(booking.checkInAtMs)) continue;
    const current=groups.get(booking.seatId)||{seatId:booking.seatId,overTwoHours:0,maxMs:0,totalMs:0};
    const duration=elapsedOccupied(booking);
    current.totalMs+=duration;
    current.maxMs=Math.max(current.maxMs,duration);
    if(duration>=2*60*60*1000) current.overTwoHours++;
    groups.set(booking.seatId,current);
  }
  const ranked=[...groups.values()].filter(x=>x.overTwoHours>0).sort((a,b)=>b.overTwoHours-a.overTwoHours || b.totalMs-a.totalMs).slice(0,6);
  $('hoggingList').innerHTML=ranked.length?ranked.map(x=>`<div class="hogging-item"><div><b>${escapeHTML(x.seatId)}</b><small>${x.overTwoHours} long session${x.overTwoHours===1?'':'s'} · longest ${humanDuration(x.maxMs)}</small></div><strong>${x.overTwoHours} flagged</strong></div>`).join(''):'<p class="muted" style="font-size:12px;padding-top:12px">No sessions over two hours have been recorded yet. Flags measure prolonged occupancy, not intentional misuse.</p>';
}
function renderHistory() {
  $('historyBody').innerHTML=bookings.length?bookings.slice(0,100).map(b=>`<tr><td>${escapeHTML(b.seatId)}</td><td>${escapeHTML(b.email||'Student')}</td><td>${formatDate(b.bookedAtMs)}</td><td><span class="chip ${statusClass(b.status)}">${escapeHTML(b.status)}</span></td><td>${humanDuration(elapsedOccupied(b))}</td><td>${escapeHTML(b.endReason||'—')}</td></tr>`).join(''):'<tr><td colspan="6">No bookings yet. Check in to see live statistics.</td></tr>';
}
function renderQR(records) {
  const holder=$('qrSheet');holder.replaceChildren();
  const sorted=records.sort((a,b)=>a.id.localeCompare(b.id));
  if(!sorted.length) {holder.innerHTML='<p class="muted">Run the seed script to create secure codes for all 60 seats.</p>';return}
  if(!window.QRCode) {holder.innerHTML='<p class="muted">QR generator library did not load. Check internet/CDN access.</p>';return}
  for(const record of sorted) {
    if(typeof record.token!=='string') continue;
    const card=document.createElement('article');card.className='qr-card';
    const title=document.createElement('strong');title.textContent=record.id;
    const small=document.createElement('small');small.textContent='LIBRA · Smart Library';
    const wrap=document.createElement('div');wrap.className='qr-canvas';
    const note=document.createElement('p');note.textContent='Scan at this seat to check in';
    const payload=`LIBRA:v1:${record.id}:${record.token}`;
    const copy=document.createElement('button');copy.className='qr-copy-btn';copy.type='button';copy.textContent='Copy QR text (demo)';
    copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(payload);copy.textContent='Copied!'}catch(_){window.prompt('Copy this admin-only QR payload:',payload)}});
    card.append(title,small,wrap,note,copy);holder.appendChild(card);
    new window.QRCode(wrap,{text:payload,width:128,height:128,colorDark:'#0d2350',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M});
  }
}
