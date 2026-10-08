import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { repoRoot, git, sourceFingerprint, distFingerprint, gatePath } from './source-fingerprint.mjs';
const source = sourceFingerprint();
const commit = git(['rev-parse','HEAD']);
for (const script of ['test','lint','build']) {
  execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d','/s','/c',`npm run ${script}`] : ['run',script], {cwd:repoRoot,stdio:'inherit'});
}
if (sourceFingerprint() !== source || git(['rev-parse','HEAD']) !== commit) throw new Error('检查过程中源码已改变，请重新验证');
writeFileSync(gatePath(),JSON.stringify({sourceFingerprint:source,sourceCommit:commit,distFingerprint:distFingerprint(),checkedAt:new Date().toISOString(),checks:['test','lint','build']},null,2));
