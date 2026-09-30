import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityClock } from '../src/services/activityClock.js';

test('study minutes exclude background and idle time and are consumed once', () => {
  let now = 0;
  const clock = createActivityClock(() => now);
  now = 30000;
  clock.setVisible(false);
  now = 600000;
  clock.setVisible(true);
  now += 120000;
  assert.equal(clock.takeMinutes(), 1.5);
  assert.equal(clock.takeMinutes(), 0);
  clock.activity();
  now += 15000;
  assert.equal(clock.takeMinutes(), 0.25);
});
