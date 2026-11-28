import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parsePushChecks, push, PUSH_EXIT, PUSH_LOG, type PushRecord } from '../src/commands/push.ts';
import type { Context } from '../src/context.ts';
import { exec } from '../src/exec.ts';
import { world } from './helpers.ts';

// 実の git で、一時の folder に bare の remote と clone を作って試す（roster push は git と確かめの命令を実に打つ）。
const saved: Record<string, string | undefined> = {};
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
beforeAll(() => {
  for (const [k, v] of Object.entries(GIT_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function sh(cwd: string, ...args: string[]): string {
  const r = exec('git', args, { cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const PASS = ['node', '-e', ''];
const FAIL = ['node', '-e', 'console.log("boom-line"); process.exit(3)'];

/** 確かめの宣言（push の欄）を持つ config.jsonc の字。checks が undefined なら push の欄を書かない。 */
const configText = (checks?: unknown[]): string => JSON.stringify(checks === undefined ? { tracker: 'none' } : { push: { checks } }, null, 2);

interface Repo {
  remote: string
  work: string
  ctx: Context
  records: () => PushRecord[]
}

/** remote（bare）と、main に config を入れた clone。clone は branch b に居る。 */
function repo(checks?: unknown[]): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'roster-push-'));
  const remote = join(dir, 'remote.git');
  const work = join(dir, 'work');
  sh(dir, 'init', '--quiet', '--bare', '-b', 'main', remote);
  sh(dir, 'clone', '--quiet', remote, work);
  sh(work, 'checkout', '--quiet', '-b', 'main');
  mkdirSync(join(work, '.claude', 'roles'), { recursive: true });
  writeFileSync(join(work, '.claude', 'roles', 'config.jsonc'), configText(checks));
  writeFileSync(join(work, 'a.txt'), 'a\n');
  sh(work, 'add', '.claude/roles/config.jsonc', 'a.txt');
  sh(work, 'commit', '--quiet', '-m', 'init');
  sh(work, 'push', '--quiet', '-u', 'origin', 'main');
  sh(work, 'remote', 'set-head', 'origin', 'main');
  sh(work, 'checkout', '--quiet', '-b', 'b');
  writeFileSync(join(work, 'a.txt'), 'b\n');
  sh(work, 'commit', '--quiet', '-am', 'change');
  const w = world();
  const ctx: Context = { ...w.role('t-x', 'file:swe'), exec };
  return { remote, work, ctx, records: () => ctx.state.lines<PushRecord>(PUSH_LOG) };
}

const remoteSha = (r: Repo, ref: string): string | undefined => {
  const x = exec('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: r.remote });
  return x.status === 0 ? x.stdout.trim() : undefined;
};

describe('roster push', () => {
  test('確かめがみな通れば、確かめた commit を同じ名の branch へ push し、記録に残す', () => {
    const r = repo([{ name: 'one', run: PASS }, { name: 'two', run: PASS }]);
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(remoteSha(r, 'refs/heads/b')).toBe(sh(r.work, 'rev-parse', 'HEAD'));
    expect(res.lines.join('\n')).toContain('通った: one');
    expect(sh(r.work, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/b');
    const rec = r.records().at(-1);
    expect(rec).toMatchObject({ result: 'pushed', code: 0, target: 'b', key: 't-x', checks: [{ name: 'one', code: 0 }, { name: 'two', code: 0 }] });
  });

  test('確かめが 1 つ落ちれば push せず 10。残りの確かめも流し、落ちた出力の終わりを出す', () => {
    const r = repo([{ name: 'bad', run: FAIL }, { name: 'after', run: PASS }]);
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.failed);
    expect(remoteSha(r, 'refs/heads/b')).toBeUndefined();
    const out = res.lines.join('\n');
    expect(out).toContain('落ちた: bad（終了コード 3');
    expect(out).toContain('通った: after');
    expect(out).toContain('boom-line');
    expect(r.records().at(-1)).toMatchObject({ result: 'failed', code: 10 });
  });

  test('一覧は origin の既定の branch から読む（branch の中で落ちる確かめを消しても効かない）', () => {
    const r = repo([{ name: 'bad', run: FAIL }]);
    writeFileSync(join(r.work, '.claude', 'roles', 'config.jsonc'), configText([{ name: 'ok', run: PASS }]));
    sh(r.work, 'commit', '--quiet', '-am', 'weaken');
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.failed);
  });

  test('dir の下で流し、env を足す', () => {
    const r = repo([{ name: 'where', dir: 'sub', run: ['node', '-e', 'process.exit(process.cwd().endsWith("sub") && process.env.X === "1" ? 0 : 4)'], env: { X: '1' } }]);
    mkdirSync(join(r.work, 'sub'));
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.pushed);
  });

  test('追われた file の変更が残れば断る。untracked だけなら push し、名を注意に出す', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    writeFileSync(join(r.work, 'a.txt'), 'dirty\n');
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.error);
    sh(r.work, 'checkout', '--quiet', '--', 'a.txt');
    writeFileSync(join(r.work, 'new.txt'), 'x\n');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(res.lines.join('\n')).toContain('注意: git に入っていない file がある');
    expect(res.lines.join('\n')).toContain('new.txt');
  });

  test('確かめの間に HEAD が動いたら push しない', () => {
    const r = repo([{ name: 'moves', run: ['git', 'commit', '--quiet', '--allow-empty', '-m', 'during'] }]);
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.error);
    expect(res.lines.join('\n')).toContain('HEAD か追われている file が動いた');
    expect(remoteSha(r, 'refs/heads/b')).toBeUndefined();
  });

  test('detached と既定の branch の上では断る', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    sh(r.work, 'checkout', '--quiet', '--detach');
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.error);
    sh(r.work, 'checkout', '--quiet', 'main');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.error);
    expect(res.lines.join('\n')).toContain('既定の branch');
  });

  test('origin/main から -b で切った branch（upstream が origin/main）も、同じ名へ push し、upstream を付け直す（review-3 の指摘 1）', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    sh(r.work, 'checkout', '--quiet', 'main');
    sh(r.work, 'checkout', '--quiet', '-b', 't-x/impl', '--track', 'origin/main');
    sh(r.work, 'commit', '--quiet', '--allow-empty', '-m', 'impl');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(res.lines.at(-1)).toContain('→ origin/t-x/impl');
    expect(remoteSha(r, 'refs/heads/t-x/impl')).toBe(sh(r.work, 'rev-parse', 'HEAD'));
    expect(remoteSha(r, 'refs/heads/main')).toBe(sh(r.work, 'rev-parse', 'main'));
    expect(sh(r.work, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/t-x/impl');
  });

  test('別の PR の branch を追う branch も、その PR の branch でなく同じ名へ push する（Dependabot の直しは同じ名の branch を作る）', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    sh(r.work, 'push', '--quiet', 'origin', 'main:refs/heads/dependabot/x');
    sh(r.work, 'fetch', '--quiet', 'origin');
    sh(r.work, 'checkout', '--quiet', '-b', 'fix', '--track', 'origin/dependabot/x');
    sh(r.work, 'commit', '--quiet', '--allow-empty', '-m', 'fix');
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.pushed);
    expect(remoteSha(r, 'refs/heads/fix')).toBe(sh(r.work, 'rev-parse', 'HEAD'));
    expect(remoteSha(r, 'refs/heads/dependabot/x')).toBe(sh(r.work, 'rev-parse', 'main'));
    sh(r.work, 'checkout', '--quiet', '-b', 'dependabot/x', '--track', 'origin/dependabot/x');
    sh(r.work, 'commit', '--quiet', '--allow-empty', '-m', 'fix2');
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.pushed);
    expect(remoteSha(r, 'refs/heads/dependabot/x')).toBe(sh(r.work, 'rev-parse', 'HEAD'));
  });

  test('時間の限りを過ぎた確かめは止めて、落ちた（時間切れ）にする（review-3 の指摘 2）', () => {
    const r = repo([{ name: 'slow', run: ['node', '-e', 'setTimeout(() => {}, 60000)'], timeoutSeconds: 1 }]);
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.failed);
    expect(res.lines.join('\n')).toContain('落ちた: slow（終了コード 124');
    expect(res.lines.join('\n')).toContain('時間切れ');
  });

  test('dir が木に無ければ、命令が無いとは言わず dir が無いと出す（review-3 の指摘 9）', () => {
    const r = repo([{ name: 'gone', dir: 'nope', run: PASS }]);
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.failed);
    expect(res.lines.join('\n')).toContain('dir（nope）が、この木に無い');
  });

  test('package.json があって node_modules が無い dir の確かめが落ちたら、依存を入れる注意を出す（review-3 の指摘 10）', () => {
    const r = repo([{ name: 'deps', dir: 'pkg', run: FAIL }]);
    mkdirSync(join(r.work, 'pkg'));
    writeFileSync(join(r.work, 'pkg', 'package.json'), '{"devDependencies":{"x":"1.0.0"}}');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.lines.join('\n')).toContain('pkg に node_modules が無い');
  });

  test('根で流す確かめが落ち、直下の folder（docs-site）に node_modules が無ければ、その folder を注意に出す（result-2 の残り）', () => {
    const r = repo([{ name: 'site', run: FAIL }]);
    mkdirSync(join(r.work, 'docs-site'));
    writeFileSync(join(r.work, 'docs-site', 'package.json'), '{"devDependencies":{"x":"1.0.0"}}');
    mkdirSync(join(r.work, 'generated'));
    writeFileSync(join(r.work, 'generated', 'package.json'), '{"name":"generated"}');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.failed);
    expect(res.lines.join('\n')).toContain('docs-site に node_modules が無い');
    // 依存を書いていない package.json（生成物の置き場など）は拾わない（review-13）。
    expect(res.lines.join('\n')).not.toContain('generated');
  });

  test('submodule の指す commit がずれていれば、断る訳にその submodule と直し方を出す（result-2 の残り）', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    const dir = mkdtempSync(join(tmpdir(), 'roster-push-sub-'));
    const sub = join(dir, 'sub.git');
    const subWork = join(dir, 'sub');
    sh(dir, 'init', '--quiet', '--bare', '-b', 'main', sub);
    sh(dir, 'clone', '--quiet', sub, subWork);
    sh(subWork, 'commit', '--quiet', '--allow-empty', '-m', 's1');
    sh(subWork, 'push', '--quiet', 'origin', 'HEAD:main');
    sh(r.work, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', sub, 'vendor/sub');
    sh(r.work, 'commit', '--quiet', '-m', 'add sub');
    sh(subWork, 'commit', '--quiet', '--allow-empty', '-m', 's2');
    sh(subWork, 'push', '--quiet', 'origin', 'HEAD:main');
    sh(join(r.work, 'vendor', 'sub'), 'pull', '--quiet', 'origin', 'main');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.error);
    expect(res.lines.join('\n')).toContain('submodule の vendor/sub は、指す commit が checkout とずれている');
    expect(res.lines.join('\n')).toContain('git submodule update --init --recursive');
  });

  test('--no-checks の空の訳と、commit の無い branch は断る（review-3 の指摘 6・8）', () => {
    const none = repo();
    expect(push(none.ctx, { cwd: none.work, noChecks: '  ' }).code).toBe(PUSH_EXIT.error);
    sh(none.work, 'checkout', '--quiet', '--orphan', 'empty');
    sh(none.work, 'rm', '-rq', '--cached', '.');
    const res = push(none.ctx, { cwd: none.work, noChecks: '試し' });
    expect(res.code).toBe(PUSH_EXIT.error);
    expect(res.lines.join('\n')).toContain('commit が無い');
  });

  test('rebase した branch は --force-with-lease の時だけ上書きする', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.pushed);
    sh(r.work, 'commit', '--quiet', '--amend', '-m', 'amended');
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.pushFailed);
    expect(push(r.ctx, { cwd: r.work, forceWithLease: true }).code).toBe(PUSH_EXIT.pushed);
    expect(remoteSha(r, 'refs/heads/b')).toBe(sh(r.work, 'rev-parse', 'HEAD'));
  });

  test('宣言が無ければ断り、--no-checks なら訳を記録して push する。宣言があれば --no-checks は断る', () => {
    const none = repo();
    expect(push(none.ctx, { cwd: none.work }).code).toBe(PUSH_EXIT.error);
    expect(push(none.ctx, { cwd: none.work, noChecks: '試し' }).code).toBe(PUSH_EXIT.pushed);
    expect(none.records().at(-1)).toMatchObject({ result: 'pushed', noChecks: '試し', checks: [] });
    const declared = repo([{ name: 'one', run: PASS }]);
    expect(push(declared.ctx, { cwd: declared.work, noChecks: '外したい' }).code).toBe(PUSH_EXIT.error);
  });

  test('--tag: origin の既定の branch に在る commit の tag だけ push する', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    sh(r.work, 'tag', 'v0.0.1', 'main');
    expect(push(r.ctx, { cwd: r.work, tag: 'v0.0.1' }).code).toBe(PUSH_EXIT.pushed);
    expect(remoteSha(r, 'refs/tags/v0.0.1')).toBe(sh(r.work, 'rev-parse', 'main'));
    sh(r.work, 'tag', 'v0.0.2', 'HEAD');
    expect(push(r.ctx, { cwd: r.work, tag: 'v0.0.2' }).code).toBe(PUSH_EXIT.error);
    expect(remoteSha(r, 'refs/tags/v0.0.2')).toBeUndefined();
    expect(push(r.ctx, { cwd: r.work, tag: 'v9' }).code).toBe(PUSH_EXIT.error);
  });

  test('remote が応えなければ 2（何も push しない）', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    sh(r.work, 'remote', 'set-url', 'origin', join(r.remote, 'missing'));
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.pushFailed);
  });

  test('git の worktree の外では断る', () => {
    const w = world();
    const res = push({ ...w.role('t-x', 'file:swe'), exec }, { cwd: mkdtempSync(join(tmpdir(), 'roster-push-out-')) });
    expect(res.code).toBe(PUSH_EXIT.error);
  });
});

describe('push の欄を読む', () => {
  test('無ければ undefined、形が違えば訳を投げる', () => {
    expect(parsePushChecks('{"tracker":"none"}', 'x')).toBeUndefined();
    expect(parsePushChecks('{"push":{"checks":[{"name":"a","run":["true"]}]}}', 'x')).toEqual([{ name: 'a', run: ['true'] }]);
    expect(() => parsePushChecks('{"push":{"checks":[]}}', 'x')).toThrow('checks');
    expect(() => parsePushChecks('{"push":{"checks":[{"name":"a","run":"true"}]}}', 'x')).toThrow('run');
    expect(() => parsePushChecks('{"push":{"checks":[{"name":"a","run":["t"],"dir":"../x"}]}}', 'x')).toThrow('dir');
    expect(() => parsePushChecks('{"push":{"checks":[{"name":"a","run":["t"]},{"name":"a","run":["t"]}]}}', 'x')).toThrow('2 つ');
  });
});
