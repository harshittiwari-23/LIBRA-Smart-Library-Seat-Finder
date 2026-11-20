import {checkIn} from './booking.js';
import {readableError} from './utils.js';
let scanner=null;
let busy=false;
let onSuccess=null;
const element=id=>document.getElementById(id);
async function stopCamera() {
  if (!scanner) return;
  const previous=scanner;
  scanner=null;
  try {await previous.stop()} catch (_) {}
  try {previous.clear()} catch (_) {}
}
export async function closeScanner() {
  await stopCamera();
  element('scanModal').hidden=true;
  element('scanStatus').textContent='';
  busy=false;
}
async function verify(raw) {
  if (busy) return;
  busy=true;
  element('scanStatus').textContent='Verifying seat QR with Firebase…';
  await stopCamera();
  try {
    const result=await checkIn(raw.trim());
    await closeScanner();
    onSuccess?.(result.message || 'QR verification successful.');
  } catch (err) {
    element('scanStatus').textContent=readableError(err);
  } finally {busy=false}
}
export async function openScanner(successCallback) {
  onSuccess=successCallback;
  element('scanModal').hidden=false;
  element('scanStatus').textContent='Requesting camera permission…';
  element('manualQR').value='';
  if (!window.Html5Qrcode) {
    element('scanStatus').textContent='Camera scanner library unavailable. Use the manual QR fallback below.';
    return;
  }
  try {
    scanner=new window.Html5Qrcode('qr-reader');
    await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},decoded=>verify(decoded),()=>{});
    element('scanStatus').textContent='Point your camera at the QR code posted on your seat.';
  } catch (err) {
    await stopCamera();
    element('scanStatus').textContent='Camera is unavailable or permission was denied. Use the labeled manual QR fallback.';
  }
}
export function initScanner() {
  element('closeScan')?.addEventListener('click',closeScanner);
  element('manualCheckIn')?.addEventListener('click',()=>{
    const raw=element('manualQR').value.trim();
    if (!raw) {element('scanStatus').textContent='Paste a QR payload first.';return}
    verify(raw);
  });
  element('scanModal')?.addEventListener('click',event=>{if (event.target===element('scanModal')) closeScanner()});
  document.addEventListener('keydown',event=>{if (event.key==='Escape'&&!element('scanModal').hidden) closeScanner()});
}
