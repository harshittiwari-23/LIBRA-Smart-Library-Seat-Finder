import {formatSeconds} from './utils.js';
let currentInterval=null;
export function clearCountdown() {if (currentInterval) clearInterval(currentInterval);currentInterval=null}
export function startCountdown(expiresAtMs, element, onElapsed) {
  clearCountdown();
  let alreadyElapsed=false;
  function tick() {
    const remaining=expiresAtMs-Date.now();
    if (element) element.textContent=formatSeconds(remaining);
    if (remaining<=0 && !alreadyElapsed) {
      alreadyElapsed=true;
      clearCountdown();
      onElapsed?.();
    }
  }
  tick();
  if (!alreadyElapsed) currentInterval=setInterval(tick,1000);
}
