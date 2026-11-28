import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Context } from '../src/context.ts';
import { exec } from '../src/exec.ts';
import { checkoutPull, clonedRepos, ensurePlace, gitDir, placeDir, prunePlaces, PRUNE_AFTER_MS, removePlace, reviewGit, workTree } from '../src/review-place.ts';

/** git を打つ（試しの repo を作る側。守りは付けない）。 */
const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/**
 * GitHub に見立てた手元の bare repo（<base>/remote/o/r.git）に、main と PR #1 の head（refs/pull/1/head）を置く。
 * レビューの場所（$ROSTER_REVIEW_DIR）と project の folder も一時の folder にする。
 */
function setup(): { ctx: Context, base: string, head1: string, push: (file: string) => string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'roster-review-place-')));
  const bare = join(base, 'remote', 'o', 'r.git');
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--quiet', '--bare');
  const work = join(base, 'work');
  mkdirSync(work);
  git(work, 'init', '--quiet');
  writeFileSync(join(work, 'a.txt'), 'main\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '--quiet', '-m', 'main');
  git(work, 'push', '--quiet', bare, 'HEAD:refs/heads/main');
  const push = (file: string): string => {
    writeFileSync(join(work, file), `${file}\n`);
    git(work, 'add', file);
    git(work, 'commit', '--quiet', '-m', file);
    git(work, 'push', '--quiet', '--force', bare, 'HEAD:refs/pull/1/head');
    return git(work, 'rev-parse', 'HEAD');
  };
  const head1 = push('b.txt');
  const project = join(base, 'project');
  mkdirSync(project);
  const env = { ROSTER_REVIEW_DIR: join(base, 'review'), ROSTER_REVIEW_REMOTE: join(base, 'remote') };
  const ctx = { env, project, exec, now: () => new Date() } as unknown as Context;
  return { ctx, base, head1, push };
}

const PR = 'https://github.com/o/r/pull/1';

describe('レビューの場所（t-n4j9 の段 2）', () => {
  test('PR の head を、git の folder を作業の木の外に分けた clone に出す。push の先は無い', () => {
    const { ctx, head1 } = setup();
    const out = checkoutPull(ctx, 'AI-8', PR);
    expect(out).toEqual({ tree: workTree(ctx, 'AI-8', 'r'), head: head1 });
    expect(readFileSync(join(out.tree, 'b.txt'), 'utf8')).toBe('b.txt\n');
    // 作業の木の .git は file で、git の folder は場所の .git-r。
    expect(readFileSync(join(out.tree, '.git'), 'utf8')).toContain(gitDir(ctx, 'AI-8', 'r'));
    expect(clonedRepos(ctx, 'AI-8')).toEqual(['r']);
    const pushUrl = exec('git', [`--git-dir=${gitDir(ctx, 'AI-8', 'r')}`, 'remote', 'get-url', '--push', 'origin']).stdout.trim();
    expect(pushUrl).toBe('no-push');
  });

  test('見直しでは、同じ clone に新しい head を出し直す（build の物は残す）', () => {
    const { ctx, push } = setup();
    const first = checkoutPull(ctx, 'AI-8', PR);
    writeFileSync(join(first.tree, 'target.out'), 'build\n');
    const head2 = push('c.txt');
    expect(checkoutPull(ctx, 'AI-8', PR)).toEqual({ tree: first.tree, head: head2 });
    expect(existsSync(join(first.tree, 'c.txt'))).toBe(true);
    expect(existsSync(join(first.tree, 'target.out'))).toBe(true);
  });

  test('作業の木の .git の file と入れ子の .git を書き替えても、手元の git は場所の git の folder の config だけを使う（段 0 の 6）', () => {
    const { ctx, base, head1 } = setup();
    const { tree } = checkoutPull(ctx, 'AI-8', PR);
    const mark = join(base, 'PWNED');
    // container の中のコードが仕込む形: .git を自前の folder へ向け替え、入れ子の .git にも fsmonitor を置く。
    const evil = join(tree, 'evil-git');
    git(tree, 'init', '--quiet', '--bare', evil);
    writeFileSync(join(evil, 'config'), `[core]\n\tbare = false\n\tfsmonitor = touch ${mark}\n`, { flag: 'a' });
    writeFileSync(join(tree, '.git'), 'gitdir: ./evil-git\n');
    mkdirSync(join(tree, 'sub'));
    git(join(tree, 'sub'), 'init', '--quiet');
    writeFileSync(join(tree, 'sub', '.git', 'config'), `[core]\n\tfsmonitor = touch ${mark}\n`, { flag: 'a' });
    const status = reviewGit(ctx, 'AI-8', {}, ['status', '--short']);
    expect(status.status).toBe(0);
    expect(reviewGit(ctx, 'AI-8', {}, ['rev-parse', 'HEAD']).stdout.trim()).toBe(head1);
    // 見直しの checkout も、仕込んだ物を動かさない。
    checkoutPull(ctx, 'AI-8', PR);
    expect(existsSync(mark)).toBe(false);
    // 対照: 名指さずに入れ子の中で素の git を打つと、仕込んだ物が動く（席の素の git を止める訳。段 1b）。
    spawnSync('git', ['status', '--short'], { cwd: join(tree, 'sub'), encoding: 'utf8' });
    expect(existsSync(mark)).toBe(true);
  });

  test('roster review git は、読むだけの命令だけを通し、外の道具を動かす旗を断る', () => {
    const { ctx } = setup();
    checkoutPull(ctx, 'AI-8', PR);
    expect(reviewGit(ctx, 'AI-8', {}, ['log', '--oneline', '-1']).stdout).toMatch(/b\.txt/);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['checkout', 'main'])).toThrow(/読むだけの命令だけ/);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['config', 'core.fsmonitor', 'x'])).toThrow(/読むだけの命令だけ/);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['diff', '--ext-diff'])).toThrow(/--ext-diff/);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['grep', '-Oless', 'x'])).toThrow(/-Oless/);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['log', '--output=/tmp/x'])).toThrow(/--output/);
    expect(() => reviewGit(ctx, 'AI-8', { repo: 'other' }, ['log'])).toThrow(/other の clone がありません/);
    expect(() => reviewGit(ctx, 'AI-9', {}, ['log'])).toThrow(/clone がありません/);
  });

  test('--main は、project の直下の本体を読む', () => {
    const { ctx } = setup();
    const main = join(ctx.project, 'r');
    mkdirSync(main);
    git(main, 'init', '--quiet');
    writeFileSync(join(main, 'm.txt'), 'm\n');
    git(main, 'add', 'm.txt');
    git(main, 'commit', '--quiet', '-m', 'main-checkout');
    expect(reviewGit(ctx, 'AI-8', { main: 'r' }, ['log', '--oneline', '-1']).stdout).toMatch(/main-checkout/);
    expect(() => reviewGit(ctx, 'AI-8', { main: 'nope' }, ['log'])).toThrow(/本体がありません/);
  });

  test('本体があれば物を借りて clone し、借りたままにしない（--dissociate）', () => {
    const { ctx, base } = setup();
    git(ctx.project, 'clone', '--quiet', join(base, 'remote', 'o', 'r.git'), 'r');
    checkoutPull(ctx, 'AI-8', PR);
    expect(existsSync(join(gitDir(ctx, 'AI-8', 'r'), 'objects', 'info', 'alternates'))).toBe(false);
  });

  test('Key と repo の名を確かめ、場所の外を指す名を断る（review-8 の指摘 1・2）', () => {
    const { ctx } = setup();
    const keep = ensurePlace(ctx, 'AI-1');
    for (const key of ['', '.', '..', '../x', 'a/b', '../../..', '-x']) {
      expect(() => removePlace(ctx, key)).toThrow(/英数字で始まり/);
    }
    expect(existsSync(keep)).toBe(true);
    expect(() => reviewGit(ctx, 'AI-8', { main: '../x' }, ['log'])).toThrow(/英数字で始まり/);
    expect(() => reviewGit(ctx, 'AI-8', { repo: '../r' }, ['log'])).toThrow(/英数字で始まり/);
    // .git が gitdir の file の folder（場所の作業の木の形）は、本体とみなさない。
    checkoutPull(ctx, 'AI-8', PR);
    symlinkSync(workTree(ctx, 'AI-8', 'r'), join(ctx.project, 'linked'));
    expect(() => reviewGit(ctx, 'AI-8', { main: 'linked' }, ['log'])).toThrow(/本体がありません/);
    expect(() => checkoutPull(ctx, 'AI-8', 'https://github.com/o/../pull/1')).toThrow(/PR の URL ではありません/);
  });

  test('git の長い旗の略しと submodule の旗も断る（review-8 の指摘 3・4）', () => {
    const { ctx } = setup();
    checkoutPull(ctx, 'AI-8', PR);
    for (const flag of ['--open-files=sh', '--outp=/tmp/x', '--ext', '--textc', '--recurse-sub', '--submodule=diff', '--ignore-sub=none', '-Ovim', '-nOsh']) {
      expect(() => reviewGit(ctx, 'AI-8', {}, ['diff', flag])).toThrow(/旗を通しません/);
    }
    expect(reviewGit(ctx, 'AI-8', {}, ['log', '--oneline', '-1']).status).toBe(0);
    expect(reviewGit(ctx, 'AI-8', {}, ['diff', '--text']).status).toBe(0);
  });

  test('gitlink の path に置いた .git があっても、手元の git は子の git を起こさない（review-8 の指摘 3）', () => {
    const { ctx, base } = setup();
    // head に gitlink（submodule の入り口）を入れる。
    const work = join(base, 'work');
    const sha = git(work, 'rev-parse', 'HEAD');
    git(work, 'update-index', '--add', '--cacheinfo', `160000,${sha},sub`);
    git(work, 'commit', '--quiet', '-m', 'gitlink');
    git(work, 'push', '--quiet', '--force', join(base, 'remote', 'o', 'r.git'), 'HEAD:refs/pull/1/head');
    const { tree } = checkoutPull(ctx, 'AI-8', PR);
    // container が置く形: gitlink の path に子の repo を作り、中を変える。
    mkdirSync(join(tree, 'sub'), { recursive: true });
    git(join(tree, 'sub'), 'init', '--quiet');
    writeFileSync(join(tree, 'sub', 'x.txt'), 'x\n');
    const trace = join(base, 'trace.txt');
    const traced = (run: () => void): string => {
      process.env.GIT_TRACE = trace;
      try {
        run();
      }
      finally {
        delete process.env.GIT_TRACE;
      }
      const text = existsSync(trace) ? readFileSync(trace, 'utf8') : '';
      writeFileSync(trace, '');
      return text;
    };
    // 対照: 素の git status は、子の git を起こす。
    expect(traced(() => spawnSync('git', ['status', '--short'], { cwd: tree, encoding: 'utf8' }))).toMatch(/run_command:.*status --porcelain/);
    expect(traced(() => reviewGit(ctx, 'AI-8', {}, ['status', '--short']))).not.toMatch(/run_command:.*status --porcelain/);
    expect(traced(() => reviewGit(ctx, 'AI-8', {}, ['diff']))).not.toMatch(/run_command:.*status --porcelain/);
  });

  test('場所を消す。名簿に居ない Key の場所は、1 時間より古い物だけを消す', () => {
    const { ctx } = setup();
    const alive = ensurePlace(ctx, 'AI-1');
    const fresh = ensurePlace(ctx, 'AI-2');
    const stale = ensurePlace(ctx, 'AI-3');
    const old = (Date.now() - PRUNE_AFTER_MS - 60_000) / 1000;
    utimesSync(stale, old, old);
    utimesSync(alive, old, old);
    expect(prunePlaces(ctx, k => k === 'AI-1')).toEqual([stale]);
    expect([existsSync(alive), existsSync(fresh), existsSync(stale)]).toEqual([true, true, false]);
    expect(removePlace(ctx, 'AI-2')).toBe(placeDir(ctx, 'AI-2'));
    expect(removePlace(ctx, 'AI-2')).toBeUndefined();
  });
});
