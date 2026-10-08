import { git, sourceFingerprint } from './source-fingerprint.mjs';
import { DICTIONARY_VERSION } from '../src/services/dictionary.js';
export function buildInfoPlugin() {
  return { name:'lingoflow-build-info', apply:'build', generateBundle() {
    this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({sourceCommit:git(['rev-parse','HEAD']),sourceFingerprint:sourceFingerprint(),dataVersion:DICTIONARY_VERSION,builtAt:new Date().toISOString()},null,2)});
  }};
}
