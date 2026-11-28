import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Context } from '../src/context.ts';
import { withoutRosterEnv } from '../src/env.ts';
import { exec } from '../src/exec.ts';
import { checkoutPull, clonedRepos, ensurePlace, gitDir, mainGitDir, mainTree, placeDir, prunePlaces, PRUNE_AFTER_MS, removePlace, reviewGit, workTree } from '../src/review-place.ts';

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
    // range-diff は見直しの依頼書が載せる（rebase の後。t-vqhy）。外の diff を切って打つ。
    const range = reviewGit(ctx, 'AI-8', {}, ['range-diff', 'refs/remotes/origin/main', 'HEAD', 'HEAD']);
    expect(range.status, range.stderr).toBe(0);
    expect(range.stdout).toMatch(/ = /);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['range-diff', '--ext-diff', 'a...b'])).toThrow(/--ext-diff/);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['grep', '-Oless', 'x'])).toThrow(/-Oless/);
    expect(() => reviewGit(ctx, 'AI-8', {}, ['log', '--output=/tmp/x'])).toThrow(/--output/);
    expect(() => reviewGit(ctx, 'AI-8', { repo: 'other' }, ['log'])).toThrow(/other の clone がありません/);
    expect(() => reviewGit(ctx, 'AI-9', {}, ['log'])).toThrow(/clone がありません/);
  });

  /** GitHub に見立てた bare repo の main に、commit を 1 つ足す（PR の head とは別の作業の木で）。 */
  const pushMain = (base: string, file: string): string => {
    const dir = join(base, 'main-work');
    if (!existsSync(dir)) git(base, 'clone', '--quiet', join(base, 'remote', 'o', 'r.git'), 'main-work');
    writeFileSync(join(dir, file), `${file}\n`);
    git(dir, 'add', file);
    git(dir, 'commit', '--quiet', '-m', file);
    git(dir, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
    return git(dir, 'rev-parse', 'HEAD');
  };

  test('--main <owner>/<repo> は、project の folder に本体が無い repo（web-capture の下の repo など）の main を GitHub から取って読む（t-rgd2）', () => {
    const { ctx } = setup();
    // project の folder に r は無い。PR の clone も無い。
    expect(existsSync(join(ctx.project, 'r'))).toBe(false);
    const r = reviewGit(ctx, 'AI-8', { main: 'o/r' }, ['log', '--oneline', '-1']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ main$/m);
    expect(r.stderr).toMatch(/r の origin\/main を GitHub から取り直して読む/);
    // file も、main の作業の木に出ている（Read tool で読める）。PR の clone には数えない。
    expect(readFileSync(join(mainTree(ctx, 'AI-8', 'r'), 'a.txt'), 'utf8')).toBe('main\n');
    expect(clonedRepos(ctx, 'AI-8')).toEqual([]);
    // 前に取った main の clone があれば、<repo> だけでも origin から引ける。
    expect(reviewGit(ctx, 'AI-8', { main: 'r' }, ['log', '--oneline', '-1']).stdout).toMatch(/ main$/m);
    // push の先は無い。
    expect(exec('git', [`--git-dir=${mainGitDir(ctx, 'AI-8', 'r')}`, 'remote', 'get-url', '--push', 'origin']).stdout.trim()).toBe('no-push');
  });

  test('--main <repo> は、PR の clone の origin から main を取り、PR の head は替えない', () => {
    const { ctx, head1 } = setup();
    checkoutPull(ctx, 'AI-8', PR);
    expect(reviewGit(ctx, 'AI-8', { main: 'r' }, ['log', '--oneline', '-1']).stdout).toMatch(/ main$/m);
    expect(reviewGit(ctx, 'AI-8', {}, ['rev-parse', 'HEAD']).stdout.trim()).toBe(head1);
    expect(clonedRepos(ctx, 'AI-8')).toEqual(['r']);
    // 物は借りたままにしない（--dissociate）。
    expect(existsSync(join(mainGitDir(ctx, 'AI-8', 'r'), 'objects', 'info', 'alternates'))).toBe(false);
  });

  test('--main は、project の本体が古くても、打つたびに GitHub から取り直した最新の main を読む', () => {
    const { ctx, base } = setup();
    // project の直下に、古いままの本体を置く（物を借りるだけで、中身は読まない）。
    git(ctx.project, 'clone', '--quiet', join(base, 'remote', 'o', 'r.git'), 'r');
    const old = git(join(ctx.project, 'r'), 'rev-parse', 'HEAD');
    const first = pushMain(base, 'n1.txt');
    expect(reviewGit(ctx, 'AI-8', { main: 'o/r' }, ['rev-parse', 'HEAD']).stdout.trim()).toBe(first);
    expect(git(join(ctx.project, 'r'), 'rev-parse', 'HEAD')).toBe(old);
    // 席が居る間に main が進んでも、次の --main で取り直す。
    const second = pushMain(base, 'n2.txt');
    expect(reviewGit(ctx, 'AI-8', { main: 'r' }, ['rev-parse', 'HEAD']).stdout.trim()).toBe(second);
    expect(readFileSync(join(mainTree(ctx, 'AI-8', 'r'), 'n2.txt'), 'utf8')).toBe('n2.txt\n');
  });

  test('PR の clone の origin/main も、checkout と --main のたびに最新に合わせる（PR の head と今の main を比べる。review-1 の指摘 3）', () => {
    const { ctx, base } = setup();
    checkoutPull(ctx, 'AI-8', PR);
    const first = pushMain(base, 'n1.txt');
    // checkout の見直しで取り直す。
    checkoutPull(ctx, 'AI-8', PR);
    expect(reviewGit(ctx, 'AI-8', {}, ['rev-parse', 'origin/main']).stdout.trim()).toBe(first);
    // --main で取り直した commit に、PR の clone の origin/main も合う。
    const second = pushMain(base, 'n2.txt');
    expect(reviewGit(ctx, 'AI-8', { main: 'r' }, ['rev-parse', 'HEAD']).stdout.trim()).toBe(second);
    expect(reviewGit(ctx, 'AI-8', {}, ['rev-parse', 'origin/main']).stdout.trim()).toBe(second);
    expect(reviewGit(ctx, 'AI-8', {}, ['diff', '--name-only', 'origin/main...HEAD']).stdout.trim()).toBe('b.txt');
  });

  test('--main と checkout を並べて打っても、lock で 1 つずつになり、みな通って読んだ commit と字が合う（review-1 の指摘 1・2）', async () => {
    const { ctx, base } = setup();
    checkoutPull(ctx, 'AI-8', PR);
    const script = join(base, 'many.ts');
    const src = join(import.meta.dirname, '..', 'src');
    writeFileSync(script, [
      `import { exec } from ${JSON.stringify(join(src, 'exec.ts'))};`,
      `import { checkoutPull, reviewGit } from ${JSON.stringify(join(src, 'review-place.ts'))};`,
      `const ctx = { env: ${JSON.stringify(ctx.env)}, project: ${JSON.stringify(ctx.project)}, exec, now: () => new Date() };`,
      `if (process.argv[2] === 'checkout') { checkoutPull(ctx, 'AI-8', ${JSON.stringify(PR)}); console.log('ok'); }`,
      `else { const r = reviewGit(ctx, 'AI-8', { main: 'o/r' }, ['rev-parse', 'HEAD']); console.log(r.stdout.trim().slice(0, 7) + ' ' + /（([0-9a-f]{7})・/.exec(r.stderr)?.[1]); }`,
    ].join('\n'));
    const once = (arg: string): Promise<{ status: number | null, out: string, err: string }> => new Promise((done) => {
      const child = spawn(process.execPath, [script, arg], { env: withoutRosterEnv(process.env) });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        err += d.toString();
      });
      child.on('close', status => done({ status, out, err }));
    });
    for (let round = 0; round < 2; round += 1) {
      pushMain(base, `p${round}.txt`);
      const results = await Promise.all([...['main', 'main', 'checkout', 'main', 'main', 'main'].map(once)]);
      for (const r of results) {
        expect(r.err).toBe('');
        expect(r.status).toBe(0);
        const [read, said] = r.out.trim().split(' ');
        if (said !== undefined) expect(read).toBe(said);
      }
    }
    // lock は残らない。
    expect(readdirSync(placeDir(ctx, 'AI-8')).filter(n => n.startsWith('.lock-'))).toEqual([]);
  }, 60_000);

  test('取った roster が居ない lock（切られた）は、古い lock とみなして取り直す', () => {
    const { ctx } = setup();
    const lock = join(ensurePlace(ctx, 'AI-8'), '.lock-r');
    mkdirSync(lock);
    // 居ない pid（終わった子の pid）を書く。
    const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(lock, 'pid'), gone);
    expect(reviewGit(ctx, 'AI-8', { main: 'o/r' }, ['log', '--oneline', '-1']).status).toBe(0);
    expect(existsSync(lock)).toBe(false);
  });

  test('--main は、取り直せなければ止まり、前に取った古い main を読まない', () => {
    const { ctx, base } = setup();
    expect(reviewGit(ctx, 'AI-8', { main: 'o/r' }, ['log', '--oneline', '-1']).status).toBe(0);
    // GitHub が応えない見立て: bare repo を退ける。
    renameSync(join(base, 'remote', 'o', 'r.git'), join(base, 'remote', 'o', 'gone.git'));
    expect(() => reviewGit(ctx, 'AI-8', { main: 'r' }, ['log', '--oneline', '-1'])).toThrow(/r の origin の main を取り直せませんでした（前に取った古い main は読みません/);
    // clone が無く、owner も分からなければ、<owner>/<repo> を求める。
    expect(() => reviewGit(ctx, 'AI-9', { main: 'r' }, ['log'])).toThrow(/--main <owner>\/r で名指してください/);
    expect(() => reviewGit(ctx, 'AI-9', { main: 'o/r/x' }, ['log'])).toThrow(/英数字で始まり/);
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
    // --main は project の folder を見ないので、そこに置いた物（場所の作業の木への link など）を本体とみなさない。
    checkoutPull(ctx, 'AI-8', PR);
    symlinkSync(workTree(ctx, 'AI-8', 'r'), join(ctx.project, 'linked'));
    expect(() => reviewGit(ctx, 'AI-8', { main: 'linked' }, ['log'])).toThrow(/linked の clone がありません/);
    expect(() => checkoutPull(ctx, 'AI-8', 'https://github.com/o/../pull/1')).toThrow(/PR の URL ではありません/);
  });

  test('patch を出す diff・show・log -p が通り、git の設定に外の diff があっても動かさない（台帳 #493）', () => {
    const { ctx, base } = setup();
    checkoutPull(ctx, 'AI-8', PR);
    // 外の diff を、clone の git の設定に仕込む（動けば mark を作る）。
    const mark = join(base, 'ext-diff-ran');
    const tool = join(base, 'ext-diff.sh');
    writeFileSync(tool, `#!/bin/sh\ntouch '${mark}'\n`, { mode: 0o755 });
    git(base, 'config', '--file', join(gitDir(ctx, 'AI-8', 'r'), 'config'), 'diff.external', tool);
    const diff = reviewGit(ctx, 'AI-8', {}, ['diff', 'origin/main', 'HEAD']);
    expect(diff.stderr).toBe('');
    expect(diff.status).toBe(0);
    expect(diff.stdout).toMatch(/^\+b\.txt$/m);
    expect(reviewGit(ctx, 'AI-8', {}, ['show', 'HEAD']).stdout).toMatch(/^\+b\.txt$/m);
    expect(reviewGit(ctx, 'AI-8', {}, ['log', '-p', '-1']).stdout).toMatch(/^\+b\.txt$/m);
    // --main の道も同じ。
    expect(reviewGit(ctx, 'AI-8', { main: 'r' }, ['diff', 'HEAD', 'refs/remotes/origin/main']).status).toBe(0);
    expect(existsSync(mark)).toBe(false);
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
