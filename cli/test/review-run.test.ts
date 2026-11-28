import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { Context } from '../src/context.ts';
import type { ExecResult } from '../src/exec.ts';
import { gitDir, placeDir, workTree } from '../src/review-place.ts';
import { imageFor, imageName, REVIEW_NETWORK, reviewRun, reviewServe, reviewStop, runArgs } from '../src/review-run.ts';

/** roster の repo の一番上（review/images の Containerfile を読む）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 偽の container の命令（打った引数を覚え、答えを返す）。 */
function setup(answer: (args: string[]) => ExecResult = () => ({ status: 0, stdout: '', stderr: '' })): { ctx: Context, calls: string[][] } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'roster-review-run-')));
  const project = join(base, 'project');
  mkdirSync(project);
  const calls: string[][] = [];
  const ctx = {
    env: { ROSTER_REVIEW_DIR: join(base, 'review') },
    project,
    root: ROOT,
    exec: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return answer(args);
    },
    now: () => new Date('2026-11-28T06:00:00.000Z'),
  } as unknown as Context;
  // clone の形（作業の木と、外の git の folder）を作る。
  mkdirSync(workTree(ctx, 'AI-8', 'castlist'), { recursive: true });
  mkdirSync(gitDir(ctx, 'AI-8', 'castlist'), { recursive: true });
  writeFileSync(join(workTree(ctx, 'AI-8', 'castlist'), 'Cargo.toml'), '[package]\n');
  return { ctx, calls };
}

describe('レビューの container（t-n4j9 の段 3）', () => {
  test('mount は作業の木と課題の cache だけで、git の folder を含まない。専用の network・メモリ・名の頭', () => {
    const { ctx } = setup();
    const args = runArgs(ctx, 'AI-8', workTree(ctx, 'AI-8', 'castlist'), 'roster-review-rust:x', { name: 'roster-review-ai-8-run-1', memory: '4G', detach: false, command: ['cargo', 'test', '--locked'] });
    const volumes = args.flatMap((a, i) => a === '--volume' ? [args[i + 1] ?? ''] : []);
    const cache = join(placeDir(ctx, 'AI-8'), 'cache');
    expect(volumes).toEqual([
      `${workTree(ctx, 'AI-8', 'castlist')}:/work`,
      `${cache}:/cache`,
      `${join(cache, 'cargo', 'cache')}:/usr/local/cargo/registry/cache`,
      `${join(cache, 'cargo', 'index')}:/usr/local/cargo/registry/index`,
    ]);
    expect(volumes.some(v => v.includes('.git-'))).toBe(false);
    expect(args.slice(0, 2)).toEqual(['run', '--rm']);
    expect(args[args.indexOf('--network') + 1]).toBe(REVIEW_NETWORK);
    expect(args[args.indexOf('--memory') + 1]).toBe('4G');
    expect(args[args.indexOf('--name') + 1]).toMatch(/^roster-review-/);
    expect(args).not.toContain('--cpus');
    expect(args.slice(-3)).toEqual(['sh', '-c', 'cargo test --locked']);
  });

  test('引数が 1 つなら shell の字のまま、いくつもなら引用してつなぐ', () => {
    const { ctx } = setup();
    const tree = workTree(ctx, 'AI-8', 'castlist');
    expect(runArgs(ctx, 'AI-8', tree, 'i', { name: 'n', memory: '4G', detach: false, command: ['pnpm install && pnpm test'] }).at(-1)).toBe('pnpm install && pnpm test');
    expect(runArgs(ctx, 'AI-8', tree, 'i', { name: 'n', memory: '4G', detach: false, command: ['echo', 'a b'] }).at(-1)).toBe('echo \'a b\'');
  });

  test('image の種類は作業の木の file で決め、名は Containerfile の中身の hash で版を持つ', () => {
    const { ctx } = setup();
    expect(imageFor(workTree(ctx, 'AI-8', 'castlist'))).toBe('rust');
    // 一番上に無ければ 1 つ下を見る（roster の cli/）。
    const roster = workTree(ctx, 'AI-8', 'roster');
    mkdirSync(join(roster, 'cli'), { recursive: true });
    writeFileSync(join(roster, 'cli', 'package.json'), '{}');
    expect(imageFor(roster)).toBe('node');
    expect(imageName(ctx, 'rust')).toMatch(/^roster-review-rust:[0-9a-f]{12}$/);
    expect(imageName(ctx, 'node')).toMatch(/^roster-review-node:[0-9a-f]{12}$/);
    expect(existsSync(join(ROOT, 'review', 'images', 'node.Containerfile'))).toBe(true);
  });

  test('run: network と image が無ければ作り、流して、出力を場所の logs/ に置き、終了コードを返す', () => {
    const { ctx, calls } = setup((args) => {
      if (args[0] === 'network' && args[1] === 'inspect') return { status: 1, stdout: '', stderr: 'not found' };
      if (args[0] === 'image' && args[1] === 'inspect') return { status: 1, stdout: '', stderr: 'not found' };
      if (args[0] === 'run') return { status: 101, stdout: '[1/6] Fetching image\ntest result: FAILED\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });
    const r = reviewRun(ctx, 'AI-8', {}, ['cargo', 'test']);
    expect(r.status).toBe(101);
    expect(calls.map(c => c.slice(1, 3).join(' '))).toEqual(['network inspect', 'network create', 'image inspect', 'build --tag', 'run --rm']);
    expect(calls[1]).toEqual(['container', 'network', 'create', '--label', 'roster=review', REVIEW_NETWORK]);
    // build に -c・-m などの builder を作り直す旗を付けない。
    expect(calls[3]?.some(a => /^-(?:c|m)$|^--(?:cpus|memory|ssh|dns)/.test(a))).toBe(false);
    expect(r.lines).toContain('test result: FAILED');
    expect(r.lines).not.toContain('[1/6] Fetching image');
    const log = /全部の出力: (.+)$/.exec(r.lines.at(-1) ?? '')?.[1] ?? '';
    expect(readFileSync(log, 'utf8')).toContain('test result: FAILED');
    // lock は終わったら外れる（続けて打てる）。
    expect(reviewRun(ctx, 'AI-8', {}, ['true']).status).toBe(101);
  });

  test('同じ課題の中で 2 つを同時に流さない（cache の lock は VM をまたいで効かない）', () => {
    const { ctx } = setup();
    mkdirSync(join(placeDir(ctx, 'AI-8'), 'run.lock'));
    expect(() => reviewRun(ctx, 'AI-8', {}, ['true'])).toThrow(/もう流れています/);
  });

  test('clone が無い・言語が分からない・命令が無い時は止まる', () => {
    const { ctx } = setup();
    expect(() => reviewRun(ctx, 'AI-9', {}, ['true'])).toThrow(/clone がありません/);
    expect(() => reviewRun(ctx, 'AI-8', {}, [])).toThrow(/命令を書いて/);
    writeFileSync(join(workTree(ctx, 'AI-8', 'castlist'), 'Cargo.toml'), '');
    mkdirSync(workTree(ctx, 'AI-8', 'other'), { recursive: true });
    mkdirSync(gitDir(ctx, 'AI-8', 'other'), { recursive: true });
    expect(() => reviewRun(ctx, 'AI-8', {}, ['true'])).toThrow(/--repo/);
    expect(() => reviewRun(ctx, 'AI-8', { repo: 'other' }, ['true'])).toThrow(/言語が分かりません/);
  });

  test('serve は起こしたままにして IP を出し、stop はその課題の container だけを止める', () => {
    const ls = 'ID IMAGE OS ARCH STATE ADDR\nroster-review-ai-8-serve-x  roster-review-rust:x  linux  arm64  running  192.168.67.5/24\nroster-review-ai-9-run-y  i  linux  arm64  running  192.168.67.6/24\npagetray.box  p  linux  arm64  running  192.168.64.52/24\n';
    const { ctx, calls } = setup(args => args[0] === 'ls' ? { status: 0, stdout: ls, stderr: '' } : { status: 0, stdout: '', stderr: '' });
    const out = reviewServe(ctx, 'AI-8', {}, ['cargo run']);
    expect(calls.some(c => c[1] === 'run' && c.includes('--detach'))).toBe(true);
    expect(out.at(-1)).toMatch(/^起こした: roster-review-ai-8-serve-.+（IP: /);
    expect(reviewStop(ctx, 'AI-8', undefined)).toEqual(['roster-review-ai-8-serve-x']);
    expect(calls.at(-1)).toEqual(['container', 'stop', 'roster-review-ai-8-serve-x']);
    expect(() => reviewStop(ctx, 'AI-8', 'pagetray.box')).toThrow(/この課題の container ではありません/);
  });
});
