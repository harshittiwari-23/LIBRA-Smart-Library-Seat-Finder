'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseQR,hashQR,verifiedToken,expired,occupiedMs,BREAK_MS,RESERVATION_MS} = require('../core');
test('QR payload rejects invalid values and mismatches',()=>{
  const token='a'.repeat(43);
  assert.deepEqual(parseQR(`LIBRA:v1:F2-S11:${token}`),{seatId:'F2-S11',token});
  assert.equal(parseQR('F2-S11'),null);
  assert.equal(parseQR('LIBRA:v1:F9-S11:'+token),null);
  assert.equal(verifiedToken(token,hashQR(token)),true);
  assert.equal(verifiedToken('b'.repeat(43),hashQR(token)),false);
});
test('expiry boundaries use absolute server timestamps',()=>{
  assert.equal(BREAK_MS,1200000);
  assert.equal(RESERVATION_MS,600000);
  assert.equal(expired('break',{breakExpiresAtMs:1200},1200),true);
  assert.equal(expired('break',{breakExpiresAtMs:1201},1200),false);
  assert.equal(expired('reserved',{reservedUntilMs:150},150),true);
  assert.equal(expired('occupied',{breakExpiresAtMs:1},100000),false);
});
test('occupied time does not count break duration',()=>{
  assert.equal(occupiedMs({status:'occupied',occupiedSinceMs:1000,totalOccupiedMs:2000},5000),6000);
  assert.equal(occupiedMs({status:'break',occupiedSinceMs:null,totalOccupiedMs:2000},500000),2000);
});
