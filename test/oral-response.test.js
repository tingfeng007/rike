import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOralResponse } from '../src/services/ai.js';

test('oral response rejects objects masquerading as renderable replies', () => {
  assert.throws(() => normalizeOralResponse({ replyText: { text: 'Hi' } }), /格式/);
  assert.throws(() => normalizeOralResponse({ replyText: ' ' }), /格式/);
});
test('oral response never exposes unvalidated model objects to React', () => {
  const response = normalizeOralResponse({replyText:'Hello!', replyTextCn:{bad:true}, feedback:{hasSlip:'true', corrected:{bad:true}}, suggestedReplies:['Fine', {}, 3, null]});
  assert.equal(response.replyTextCn, '');
  assert.equal(response.feedback.hasSlip, false);
  assert.deepEqual(response.suggestedReplies, ['Fine']);
});
test('a correction requires both the learner phrase and a usable correction', () => {
  const response = normalizeOralResponse({replyText:'Good effort',feedback:{hasSlip:true,userOriginal:'I goes',corrected:'I go',explanationZh:'一般现在时'}});
  assert.equal(response.feedback.hasSlip, true);
});
