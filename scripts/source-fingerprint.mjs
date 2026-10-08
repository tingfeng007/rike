import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
export const repoRoot = resolve(import.meta.dirname, '..');
export function git(args) { return execFileSync('git', args, {cwd:repoRoot,encoding:'utf8'}).trim(); }
export function sourceFingerprint() {
  const paths = execFileSync('git', ['ls-files','--cached','--others','--exclude-standard','-z'], {cwd:repoRoot,encoding:'utf8'}).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const name of [...new Set(paths)].sort()) {
    const path = join(repoRoot,name);
    hash.update(name).update('\0').update(existsSync(path) ? readFileSync(path) : 'DELETED').update('\0');
  }
  return hash.digest('hex');
}
export function distFingerprint(directory = join(repoRoot,'dist')) {
  const hash = createHash('sha256');
  function walk(dir, prefix='') {
    for (const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(join(dir,entry.name),`${name}/`);
      else hash.update(name).update('\0').update(readFileSync(join(dir,entry.name))).update('\0');
    }
  }
  walk(directory);
  return hash.digest('hex');
}
export function gatePath() { return resolve(repoRoot,git(['rev-parse','--git-path','lingoflow-release-gate.json'])); }
