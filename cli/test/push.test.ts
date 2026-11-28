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
    // 一覧を変えていなければ、差の行も記録の欄も無い。
    expect(rec?.configDiff).toBeUndefined();
    expect(res.lines.join('\n')).not.toContain('確かめの一覧の差');
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

  /** 手元の branch の config.jsonc を書き替えて commit する。 */
  const commitConfig = (r: Repo, text: string, message = 'config'): void => {
    writeFileSync(join(r.work, '.claude', 'roles', 'config.jsonc'), text);
    sh(r.work, 'commit', '--quiet', '-am', message);
  };

  test('一覧は push する commit から読む。branch で消した確かめは流さず、差に出して記録に残し、レビューを頼む案内を出す（t-f73c）', () => {
    const r = repo([{ name: 'bad', run: FAIL }, { name: 'keep', run: PASS }]);
    commitConfig(r, configText([{ name: 'keep', run: PASS }]), 'weaken');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    const out = res.lines.join('\n');
    expect(out).toContain('確かめの一覧の差（main と分かれた所と比べて）: 消した: bad');
    expect(out).toContain('レビューを必ず頼む');
    expect(out).not.toContain('落ちた: bad');
    expect(r.records().at(-1)?.configDiff).toEqual({ base: 'merge-base', removed: ['bad'], changed: [], added: [] });
  });

  test('main に一覧が無くても、branch で足した一覧で確かめて push する（一覧を足す PR・新しい repo の初めの PR）', () => {
    const r = repo();
    commitConfig(r, configText([{ name: 'x', run: FAIL }]));
    const failed = push(r.ctx, { cwd: r.work });
    expect(failed.code).toBe(PUSH_EXIT.failed);
    expect(failed.lines.join('\n')).toContain('足した: x');
    commitConfig(r, configText([{ name: 'x', run: PASS }]));
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(res.lines.join('\n')).not.toContain('レビューを必ず頼む');
    expect(r.records().at(-1)?.configDiff).toEqual({ base: 'merge-base', removed: [], changed: [], added: ['x'] });
  });

  test('同じ名の確かめの欄を変えたら、変えた欄の名を出す', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    commitConfig(r, configText([{ name: 'one', run: FAIL, timeoutSeconds: 30 }]));
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.failed);
    expect(res.lines.join('\n')).toContain('変えた: one（run・timeoutSeconds）');
    expect(r.records().at(-1)?.configDiff).toMatchObject({ changed: ['one'], removed: [] });
  });

  test('main に後から足された確かめは「消した」と読まず、取り込めば流れると出す', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    sh(r.work, 'checkout', '--quiet', 'main');
    commitConfig(r, configText([{ name: 'one', run: PASS }, { name: 'late', run: FAIL }]), 'add late');
    sh(r.work, 'push', '--quiet', 'origin', 'main');
    sh(r.work, 'checkout', '--quiet', 'b');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    const out = res.lines.join('\n');
    expect(out).toContain('main に後から足された確かめ・変えられた確かめが、この branch に無いか古いまま');
    expect(out).toContain('足された: late');
    expect(out).not.toContain('消した');
    expect(r.records().at(-1)?.configDiff).toEqual({ base: 'merge-base', removed: [], changed: [], added: [], mainAdded: ['late'] });
  });

  test('push の欄ごと消した branch は、宣言の無い repo と同じに断り、--no-checks なら push する。どちらも差に出す（confirm-1 の項目 2）', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    commitConfig(r, configText());
    const refused = push(r.ctx, { cwd: r.work });
    expect(refused.code).toBe(PUSH_EXIT.error);
    expect(refused.lines.join('\n')).toContain('push の欄ごと消した（あった確かめ: one）');
    expect(r.records().at(-1)).toMatchObject({ result: 'refused', configDiff: { sectionRemoved: true, removed: ['one'] } });
    const res = push(r.ctx, { cwd: r.work, noChecks: '欄を外す' });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(r.records().at(-1)).toMatchObject({ result: 'pushed', noChecks: '欄を外す', configDiff: { sectionRemoved: true } });
  });

  test('config.jsonc が作業の木に在って git に入っていなければ、そう言って断る', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    sh(r.work, 'rm', '--quiet', '--cached', '.claude/roles/config.jsonc');
    sh(r.work, 'commit', '--quiet', '-m', 'untrack');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.error);
    expect(res.lines.join('\n')).toContain('作業の木に在るが git に入っていない');
  });

  test('push する commit の一覧の形が違えば断る。比べる元の一覧の形が違うだけなら断らず、差は出さない', () => {
    const bad = repo([{ name: 'one', run: PASS }]);
    commitConfig(bad, JSON.stringify({ push: { checks: [] } }));
    const refused = push(bad.ctx, { cwd: bad.work });
    expect(refused.code).toBe(PUSH_EXIT.error);
    expect(refused.lines.join('\n')).toContain('push する commit');
    const r = repo([]);
    commitConfig(r, configText([{ name: 'one', run: PASS }]));
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(res.lines.join('\n')).toContain('その一覧が読めない');
    expect(r.records().at(-1)?.configDiff).toMatchObject({ baseUnreadable: true });
  });

  test('main と分かれた所が取れなければ、origin の既定の branch の先と比べ、そう出す（review-1 の指摘 3）', () => {
    const r = repo([{ name: 'one', run: PASS }, { name: 'two', run: PASS }]);
    sh(r.work, 'checkout', '--quiet', '--orphan', 'o');
    commitConfig(r, configText([{ name: 'one', run: PASS }]), 'orphan');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(res.lines.join('\n')).toContain('main と分かれた所が取れないので');
    expect(r.records().at(-1)?.configDiff).toEqual({ base: 'default-branch', removed: ['two'], changed: [], added: [] });
  });

  /** main で config.jsonc を書き替えて push し、branch b に戻る。 */
  const advanceMain = (r: Repo, text: string): void => {
    sh(r.work, 'checkout', '--quiet', 'main');
    commitConfig(r, text, 'main config');
    sh(r.work, 'push', '--quiet', 'origin', 'main');
    sh(r.work, 'checkout', '--quiet', 'b');
  };

  test('分かれた後に main が確かめの中身を変えたら、取り込んでいない branch では古いままと出す（review-2 の指摘 1）', () => {
    const r = repo([{ name: 'one', run: PASS }]);
    advanceMain(r, configText([{ name: 'one', run: FAIL }]));
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(res.lines.join('\n')).toContain('変えられた: one（run）');
    expect(r.records().at(-1)?.configDiff).toEqual({ base: 'merge-base', removed: [], changed: [], added: [], mainChanged: ['one'] });
  });

  test('main が宣言を足す前に切った branch は、--no-checks でも断り、取り込むよう言う（review-2 の指摘 2）', () => {
    const r = repo();
    advanceMain(r, configText([{ name: 'one', run: PASS }]));
    const refused = push(r.ctx, { cwd: r.work, noChecks: '古い branch' });
    expect(refused.code).toBe(PUSH_EXIT.error);
    expect(refused.lines.join('\n')).toContain('取り込んでから打つ（--no-checks は受けない）');
    expect(remoteSha(r, 'refs/heads/b')).toBeUndefined();
  });

  test('分かれた所の一覧が読めなければ、origin の既定の branch の先と比べる（review-2 の指摘 3）', () => {
    const r = repo([]);
    advanceMain(r, configText([{ name: 'one', run: PASS }]));
    commitConfig(r, configText([{ name: 'one', run: PASS }, { name: 'two', run: PASS }]));
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(res.lines.join('\n')).toContain('main と分かれた所が読めないので、origin/main の先と比べて');
    expect(r.records().at(-1)?.configDiff).toEqual({ base: 'default-branch', removed: [], changed: [], added: ['two'] });
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

  /** 空の remote（main がまだ無い）と、main に初めの commit を作った clone（台帳 #531 の空の repo の初めの push）。 */
  function emptyRepo(checks?: unknown[]): Repo {
    const dir = mkdtempSync(join(tmpdir(), 'roster-push-empty-'));
    const remote = join(dir, 'remote.git');
    const work = join(dir, 'work');
    sh(dir, 'init', '--quiet', '--bare', '-b', 'main', remote);
    sh(dir, 'clone', '--quiet', remote, work);
    sh(work, 'checkout', '--quiet', '-b', 'main');
    mkdirSync(join(work, '.claude', 'roles'), { recursive: true });
    writeFileSync(join(work, '.claude', 'roles', 'config.jsonc'), configText(checks));
    sh(work, 'add', '.claude/roles/config.jsonc');
    sh(work, 'commit', '--quiet', '-m', 'init');
    const w = world();
    const ctx: Context = { ...w.role('t-x', 'file:swe'), exec };
    return { remote, work, ctx, records: () => ctx.state.lines<PushRecord>(PUSH_LOG) };
  }

  test('origin に main がまだ無い空の repo では、main の上から、push する commit の一覧で確かめて初めの push をする', () => {
    const r = emptyRepo([{ name: 'one', run: PASS }]);
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.pushed);
    expect(remoteSha(r, 'refs/heads/main')).toBe(sh(r.work, 'rev-parse', 'HEAD'));
    expect(res.lines.join('\n')).toContain('確かめの一覧の差（origin に main がまだ無い（初めの push）ので、空の一覧と比べて）: 足した: one');
    expect(r.records().at(-1)?.configDiff).toEqual({ base: 'none', removed: [], changed: [], added: ['one'] });
  });

  test('空の repo で宣言が無ければ断り、--no-checks なら初めの push をする', () => {
    const r = emptyRepo();
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.error);
    expect(push(r.ctx, { cwd: r.work, noChecks: '初めの push' }).code).toBe(PUSH_EXIT.pushed);
    expect(remoteSha(r, 'refs/heads/main')).toBe(sh(r.work, 'rev-parse', 'HEAD'));
  });

  test('空の repo でも確かめが落ちれば push しない。tag は断る', () => {
    const r = emptyRepo([{ name: 'bad', run: FAIL }]);
    expect(push(r.ctx, { cwd: r.work }).code).toBe(PUSH_EXIT.failed);
    expect(remoteSha(r, 'refs/heads/main')).toBeUndefined();
    sh(r.work, 'tag', 'v0.0.1');
    expect(push(r.ctx, { cwd: r.work, tag: 'v0.0.1' }).code).toBe(PUSH_EXIT.error);
  });

  test('空の repo の初めの push を main でない branch から打てば断る（その branch が既定の branch になるため。review-5 の指摘 2）', () => {
    const r = emptyRepo([{ name: 'one', run: PASS }]);
    sh(r.work, 'checkout', '--quiet', '-b', 't-x/impl');
    const res = push(r.ctx, { cwd: r.work });
    expect(res.code).toBe(PUSH_EXIT.error);
    expect(res.lines.join('\n')).toContain('初めの push は main の上から打つ');
    expect(remoteSha(r, 'refs/heads/t-x/impl')).toBeUndefined();
  });

  test('中身の在る remote で main だけが無い（手元の origin/HEAD が古い）時は、初めの push とみなさず 2（review-5 の指摘 1）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'roster-push-trunk-'));
    const remote = join(dir, 'remote.git');
    const work = join(dir, 'work');
    sh(dir, 'init', '--quiet', '--bare', '-b', 'trunk', remote);
    sh(dir, 'clone', '--quiet', remote, work);
    sh(work, 'checkout', '--quiet', '-b', 'trunk');
    writeFileSync(join(work, 'a.txt'), 'a\n');
    sh(work, 'add', 'a.txt');
    sh(work, 'commit', '--quiet', '-m', 'init');
    sh(work, 'push', '--quiet', '-u', 'origin', 'trunk');
    // 既定の branch の名を替える前の clone の形: 手元の origin/HEAD が、もう無い origin/main を指す。
    sh(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    sh(work, 'checkout', '--quiet', '-b', 'main');
    const w = world();
    const ctx: Context = { ...w.role('t-x', 'file:swe'), exec };
    expect(push(ctx, { cwd: work, noChecks: '試し' }).code).toBe(PUSH_EXIT.pushFailed);
    expect(exec('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { cwd: remote }).status).not.toBe(0);
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
