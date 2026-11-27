// Archify（図を JSON から描く道具。https://github.com/tt-a1i/archify）を、版を固定して取って置き、呼ぶ。
// 取るのは roster figure setup だけ。ほかの命令は取りに行かず、置いていなければ止まる（Haiku の skill の中からネットに出ないように）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';

/** Archify の repo。 */
export const ARCHIFY_REPO = 'https://github.com/tt-a1i/archify.git';

/** 版の印（repo の .archify-version の `<tag>@<commit>`）。 */
export interface ArchifyVersion {
  tag: string
  commit: string
}

/** repo の .archify-version を読む。 */
export function archifyVersion(root: string): ArchifyVersion {
  const text = readFileSync(join(root, '.archify-version'), 'utf8').trim();
  const m = /^(v[0-9][^@\s]*)@([0-9a-f]{40})$/.exec(text);
  if (!m) throw new TpmError(`.archify-version の形が違います（<tag>@<40 字の commit>）: ${text}`);
  return { tag: m[1] ?? '', commit: m[2] ?? '' };
}

/** 取った Archify を置く folder（$XDG_DATA_HOME、無ければ ~/.local/share の roster/tools/archify/<commit>）。 */
export function archifyHome(env: NodeJS.ProcessEnv, version: ArchifyVersion): string {
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'roster', 'tools', 'archify', version.commit);
}

/** Archify の CLI の入口。 */
export function archifyBin(env: NodeJS.ProcessEnv, version: ArchifyVersion): string {
  return join(archifyHome(env, version), 'archify', 'bin', 'archify.mjs');
}

/**
 * 版を固定して Archify を取って置く（roster figure setup）。tag を浅く取り、`archify/` だけを取り出し、
 * 取った HEAD が .archify-version の commit と同じかを git で見てから、一時の folder から rename で置く
 * （いくつもの席が同時に取っても、置いた物は壊れない）。置いてあれば何もしない。
 */
export function setupArchify(ctx: Context): string[] {
  const version = archifyVersion(ctx.root);
  const home = archifyHome(ctx.env, version);
  if (existsSync(join(home, 'archify', 'bin', 'archify.mjs'))) return [`置いてある: Archify ${version.tag}（${home}）`];
  const parent = join(home, '..');
  mkdirSync(parent, { recursive: true });
  const tmp = mkdtempSync(join(parent, '.tmp-'));
  try {
    const repo = join(tmp, 'repo');
    const git = (args: string[]): string => {
      const r = ctx.exec('git', args);
      if (r.status !== 0) throw new TpmError(`git ${args[0] ?? ''} が落ちました: ${r.stderr.trim() || r.stdout.trim()}`);
      return r.stdout.trim();
    };
    git(['clone', '--quiet', '--depth', '1', '--branch', version.tag, '--filter=blob:none', '--sparse', ARCHIFY_REPO, repo]);
    git(['-C', repo, 'sparse-checkout', 'set', 'archify']);
    const head = git(['-C', repo, 'rev-parse', 'HEAD']);
    if (head !== version.commit) throw new TpmError(`取った Archify ${version.tag} の commit が .archify-version と違います（取った ${head}・印 ${version.commit}）。置いていません`);
    try {
      renameSync(repo, home);
    }
    catch (e) {
      // 同じ時にほかの席が置いた時は、その物を使う。
      if (!existsSync(join(home, 'archify', 'bin', 'archify.mjs'))) throw e;
    }
  }
  finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return [`置いた: Archify ${version.tag}（commit ${version.commit.slice(0, 8)}・${home}）`];
}

/** Archify の CLI を打つ（版を見に行く外への問い合わせは止める）。置いていなければ、roster figure setup を打つよう言って止まる。 */
export function runArchify(ctx: Context, args: string[]): { status: number, stdout: string, stderr: string } {
  const version = archifyVersion(ctx.root);
  const bin = archifyBin(ctx.env, version);
  if (!existsSync(bin)) throw new TpmError(`Archify ${version.tag} が置かれていません。roster figure setup を打ってから、打ち直してください`);
  return ctx.exec('env', ['ARCHIFY_UPDATE_CHECK_DISABLED=1', process.execPath, bin, ...args]);
}
