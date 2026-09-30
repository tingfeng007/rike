import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRequest } from '../src/services/latestRequest.js';

test('a replaced or closed lookup cannot apply a late provider response', async () => {
  const gate = createLatestRequest();
  const a = gate.start();
  const b = gate.start();
  let shown = 'B';
  await Promise.resolve().then(() => { if (a.isCurrent()) shown = 'A'; });
  assert.equal(shown, 'B');
  assert.equal(a.signal.aborted, true);
  assert.equal(b.isCurrent(), true);
  gate.cancel();
  assert.equal(b.isCurrent(), false);
});
