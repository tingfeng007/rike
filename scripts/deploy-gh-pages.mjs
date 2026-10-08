#!/usr/bin/env node
/**
 * Publish the built app to the GitHub Pages branch.
 *
 * Why this exists: the gh-pages branch used to be updated by hand. Because every build
 * emits new content-hashed chunk names and nothing ever removed the old ones, the branch
 * accumulated ~859 KB of unreachable files across a few releases, and it was easy to
 * forget to publish at all (the live site once lagged several commits behind main).
 *
 * What it does:
 *   1. checks dist/ looks like a real build;
 *   2. checks out the deploy branch into a throwaway git worktree;
 *   3. replaces its contents with dist/ + .nojekyll (so removed files are really removed);
 *   4. commits and pushes as a normal fast-forward — never a forced update.
 *
 * Usage:  node scripts/deploy-gh-pages.mjs [--dry-run]
 *   (npm run deploy builds first, then calls this.)
 *
 * Note: the worktree is removed in a `finally` block, so the script must never call
 * process.exit() inside the try — that skips unwinding and leaks the worktree.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { sourceFingerprint, distFingerprint, gatePath } from './source-fingerprint.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DIST_DIR = join(REPO_ROOT, 'dist');
const REMOTE = process.env.DEPLOY_REMOTE || 'origin';
const BRANCH = process.env.DEPLOY_BRANCH || 'gh-pages';
const dryRun = process.argv.includes('--dry-run');

function run(args, { cwd = REPO_ROOT, capture = true } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function entryChunk() {
  try {
    const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
    return html.match(/assets\/index-[^"']+\.js/)?.[0] || '(未识别)';
  } catch {
    return '(未识别)';
  }
}

function main() {
  const gate = existsSync(gatePath()) ? JSON.parse(readFileSync(gatePath(),'utf8')) : null;
  if (!gate || gate.sourceCommit !== run(['rev-parse','HEAD']).trim() || gate.sourceFingerprint !== sourceFingerprint() || gate.distFingerprint !== distFingerprint()) {
    throw new Error('当前源码与构建尚未通过发布检查，请执行 npm run validate');
  }
  // 1. Sanity-check the build output.
  if (!existsSync(join(DIST_DIR, 'index.html'))) {
    throw new Error('dist/index.html 不存在，请先执行 npm run build');
  }
  if (!existsSync(join(DIST_DIR, 'sw.js'))) {
    console.warn('⚠ dist/ 中没有 sw.js —— 确认这是完整的构建产物。');
  }

  run(['fetch', REMOTE, BRANCH]);

  // 2. Throwaway worktree for the deploy branch.
  const deployName = `lingoflow-deploy-${process.pid}-${Date.now()}`;
  const worktree = resolve(tmpdir(), deployName);
  if (dirname(worktree) !== resolve(tmpdir())) throw new Error('部署目录越界');
  let added = false;
  try {
    run(['worktree', 'add', '--detach', worktree, `${REMOTE}/${BRANCH}`], { capture: false });
    added = true;

    // 3. Replace the tree so files deleted from dist/ disappear from the branch too.
    for (const entry of readdirSync(worktree)) {
      if (entry === '.git') continue;
      const target = resolve(worktree, entry);
      if (!target.startsWith(`${worktree}${sep}`)) throw new Error('清理目标越界');
      rmSync(target, { recursive: true, force: true });
    }
    cpSync(DIST_DIR, worktree, { recursive: true });
    writeFileSync(join(worktree, '.nojekyll'), '');

    run(['add', '-A'], { cwd: worktree });
    const staged = run(['status', '--porcelain'], { cwd: worktree }).trim();

    if (!staged) {
      console.log('✓ 部署内容与远端一致，无需发布。');
      return;
    }

    const changed = staged.split('\n').length;
    console.log(`准备发布 ${changed} 个文件变更，新入口分块 ${entryChunk()}`);

    if (dryRun) {
      console.log('— dry-run：跳过提交与推送 —');
      return;
    }

    run(['commit', '-q', '-m', `deploy: 发布最新构建（${new Date().toISOString().slice(0, 10)}）`], { cwd: worktree });
    run(['push', REMOTE, `HEAD:${BRANCH}`], { cwd: worktree, capture: false });
    console.log(`✓ 已发布到 ${REMOTE}/${BRANCH}`);
  } finally {
    if (added) {
      try {
        run(['worktree', 'remove', '--force', worktree]);
      } catch {
        rmSync(worktree, { recursive: true, force: true });
      }
      try { run(['worktree', 'prune']); } catch { /* ignore */ }
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`\n✖ ${error.message}`);
  process.exitCode = 1;
}
