import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningLookup } from '../src/services/learningLookup.js';
const entry = { word: 'coffee', phonetic: '/ˈkɒfi/', pos: 'n.', meanings: [{pos:'n.',text:'咖啡'}], contextSentence:'Drink coffee.',contextSentenceCn:'喝咖啡。' };
test('basic lookup uses dictionary without AI and preserves the actual reading context', async () => {
  let calls = 0;
  const lookup = createLearningLookup({ dictionary:{lookup:async()=>entry},getWords:()=>[],analyze:()=>{calls++;},hasKey:()=>false });
  const result = await lookup('coffee', 'Coffee helps me wake up.');
  assert.equal(result.translation,'咖啡'); assert.equal(result.phonetic,'/ˈkɒfi/'); assert.equal(result.contextSentence,'Coffee helps me wake up.'); assert.equal(result.contextSentenceCn,''); assert.equal(calls,0);
});
test('missing basic entries never trigger a paid fallback', async () => {
  const lookup = createLearningLookup({ dictionary:{lookup:async()=>null},getWords:()=>[],analyze:()=>assert.fail('automatic AI'),hasKey:()=>true });
  assert.equal(await lookup('notaword'),null);
});
test('explicit enrichment checks configuration and cancellation', async () => {
  const lookup = createLearningLookup({dictionary:{lookup:async()=>entry},getWords:()=>[],hasKey:()=>false});
  await assert.rejects(lookup('coffee','',{enrich:true}),/基础词义无需/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(lookup('coffee','',{signal:controller.signal}),{name:'AbortError'});
});
