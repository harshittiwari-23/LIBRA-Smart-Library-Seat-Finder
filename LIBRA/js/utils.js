export function $(id) {return document.getElementById(id)}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
export function formatDate(ms) {
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}) : '—';
}
export function humanDuration(ms) {
  const min = Math.max(0,Math.floor(ms/60000));
  return min >= 60 ? `${Math.floor(min/60)}h ${min%60}m` : `${min}m`;
}
export function notify(message,type='warning',target='notice') {
  const element = $(target);
  if (!element) {window.alert(message);return}
  element.textContent = message;
  element.className = `notice ${type}`;
  element.hidden = !message;
}
export function readableError(err) {
  if (!navigator.onLine) return 'You are offline. Reconnect and try again.';
  const text = err?.message || 'Something went wrong. Please try again.';
  return text.replace(/^functions\/[a-z-]+\s*:?\s*/i,'').replace(/^FirebaseError:\s*/,'');
}
export function statusClass(status) {return ['available','reserved','occupied','break','unavailable','ended'].includes(status) ? status : 'unavailable'}
export function formatSeconds(ms) {
  const seconds = Math.max(0,Math.ceil(ms/1000));
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
