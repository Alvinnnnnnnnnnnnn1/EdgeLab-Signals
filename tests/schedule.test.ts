import test from 'node:test';
import assert from 'node:assert/strict';
import {melbourneInstant,localParts,researchSchedule,nextRoutineAt,notificationWindow} from '../src/research/schedule';

test('Melbourne research windows follow DST transitions rather than UTC or host time',()=>{
  assert.equal(melbourneInstant('2026-10-03','07:15'),'2026-10-02T21:15:00.000Z');
  assert.equal(melbourneInstant('2026-10-04','07:15'),'2026-10-03T20:15:00.000Z');
  assert.equal(melbourneInstant('2027-04-03','07:15'),'2027-04-02T20:15:00.000Z');
  assert.equal(melbourneInstant('2027-04-04','07:15'),'2027-04-03T21:15:00.000Z');
  assert.throws(()=>melbourneInstant('2026-10-04','02:30'),/Nonexistent/);
  assert.equal(melbourneInstant('2027-04-04','02:30'),'2027-04-03T15:30:00.000Z');
});
test('quiet hours have exact boundaries and resolve 07:00 across both DST changes',()=>{
  for(const date of ['2026-10-04','2027-04-04','2026-11-22']){
    for(const time of ['00:30','01:00','06:59']){
      const p=notificationWindow(melbourneInstant(date,time));assert.equal(p.state,'deferred');assert.equal(p.nextAt,melbourneInstant(date,'07:00'));
    }
    for(const time of ['00:29','07:00','23:59'])assert.equal(notificationWindow(melbourneInstant(date,time)).state,'ready');
  }
  for(const at of ['2027-04-03T15:30:00.000Z','2027-04-03T16:30:00.000Z'])assert.equal(notificationWindow(at).nextAt,'2027-04-03T21:00:00.000Z');
});
test('heartbeat admission closes after 30 minutes; next routine window uses Melbourne date rollover',()=>{
  const start=melbourneInstant('2026-11-22','07:15');assert.equal(researchSchedule(start).activeWindow,start);
  assert.equal(researchSchedule(melbourneInstant('2026-11-22','07:44')).activeWindow,start);
  assert.equal(researchSchedule(melbourneInstant('2026-11-22','07:45')).activeWindow,null);
  assert.equal(nextRoutineAt(melbourneInstant('2026-11-22','23:59')),melbourneInstant('2026-11-23','07:15'));
  assert.equal(localParts('2026-12-31T14:00:00.000Z').date,'2027-01-01');
});
test('quiet-hour deferral expires pregame opportunities before morning release or tip-off',()=>{
  const at=melbourneInstant('2026-11-22','02:30');
  assert.equal(notificationWindow(at,melbourneInstant('2026-11-22','04:00')).state,'expired');
  assert.equal(notificationWindow(at,melbourneInstant('2026-11-22','07:00')).state,'expired');
  assert.equal(notificationWindow(at,melbourneInstant('2026-11-22','08:00')).state,'deferred');
  assert.equal(notificationWindow(melbourneInstant('2026-11-22','08:01'),melbourneInstant('2026-11-22','08:00')).state,'expired');
});
