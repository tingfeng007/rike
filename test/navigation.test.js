import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLearningRoute, formatLearningRoute } from '../src/services/navigation.js';
test('learning routes preserve deep link targets and reject invalid pages', () => {
  const target = { lesson:'001&002.Excuse Me',entry:'review' };
  assert.deepEqual(parseLearningRoute(formatLearningRoute('nce',target)),{tab:'nce',options:target});
  assert.equal(parseLearningRoute('#/unknown'),null);
  assert.deepEqual(parseLearningRoute('#/vocab?section=grammar'),{tab:'vocab',options:{section:'grammar'}});
});
