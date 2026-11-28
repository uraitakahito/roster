// レビューの席の自分の場所（t-n4j9 の段 2。監査 audit-2 の R14）。
// 課題ごとの folder（project の folder の外）に、PR の head を持つ clone を作る。席はこの folder で起き、/code-review の手伝いも
// この folder で起きるので、PR の head を探して課題の担当の worktree へ行く訳が無くなる（段 0 の 1 で確かめた）。
// clone の git の folder は作業の木の外（<場所>/.git-<repo>/）に分け、手元の git はいつも git の folder を名指して打つ。
// 作業の木の .git の file や入れ子の .git を、container の中のコード（段 3）が書き替えても、手元の git が自前の config を読まないため（review-4 の指摘 1・段 0 の 6）。
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Context } from './context.ts';
import { envOf } from './env.ts';
import { TpmError } from './skill-sets.ts';

/** 手元の git にいつも付ける守り（hook・fsmonitor・外の diff・pager を動かさない）。 */
export const SAFE_GIT_CONFIG = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.pager=cat'];

/** roster review git が通す、読むだけの git の命令。 */
export const REVIEW_GIT_READS = new Set(['show', 'diff', 'log', 'status', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'grep', 'cat-file', 'merge-base']);
/** roster review git が断る旗（外の道具・file を開く道具・書き出し・取り寄せの命令を動かす）。 */
const REVIEW_GIT_BAD_FLAG = /^(?:--ext-diff|--textconv|-O.*|--open-files-in-pager(?:=.*)?|--output(?:=.*)?|--upload-pack(?:=.*)?|--exec(?:=.*)?)$/;

/** PR の URL を読んだ物。 */
export interface PullRef {
  owner: string
  repo: string
  number: number
}

/** PR の URL（`https://<host>/<owner>/<repo>/pull/<番号>`）を読む。読めなければ undefined。 */
export function parsePull(url: string): PullRef | undefined {
  const m = /^https:\/\/[^\s/]+\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/.exec(url);
  return m === null ? undefined : { owner: m[1] ?? '', repo: m[2] ?? '', number: Number(m[3]) };
}

/** レビューの場所の根（`${XDG_CACHE_HOME:-~/.cache}/roster/review`。$ROSTER_REVIEW_DIR で替えられる）。 */
export function reviewRoot(env: NodeJS.ProcessEnv): string {
  return envOf(env, 'REVIEW_DIR') || join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'roster', 'review');
}

/** project ごとの folder（project の path の字を - でつないだ名）。 */
export const projectReviewDir = (ctx: Context): string => join(reviewRoot(ctx.env), ctx.project.replace(/[^A-Za-z0-9._]+/g, '-'));

/** 課題ごとの場所（席の起きる folder。repo でない folder）。 */
export const placeDir = (ctx: Context, key: string): string => join(projectReviewDir(ctx), key);

/** 場所の中の、repo ごとの作業の木と git の folder。 */
export const workTree = (ctx: Context, key: string, repo: string): string => join(placeDir(ctx, key), repo);
export const gitDir = (ctx: Context, key: string, repo: string): string => join(placeDir(ctx, key), `.git-${repo}`);

/** GitHub の repo の URL（試験では $ROSTER_REVIEW_REMOTE で、手元の bare repo の置き場に替える）。 */
const remoteUrl = (ctx: Context, pull: PullRef): string => {
  const base = envOf(ctx.env, 'REVIEW_REMOTE');
  return base ? join(base, pull.owner, `${pull.repo}.git`) : `https://github.com/${pull.owner}/${pull.repo}.git`;
};

/** 名指した git の folder と作業の木で、守りを付けて git を打つ形。 */
export const safeGitArgs = (git: string, tree: string, args: string[]): string[] => [`--git-dir=${git}`, `--work-tree=${tree}`, ...SAFE_GIT_CONFIG, ...args];

/** 場所を作る（席を起こす前に。空の folder でよい）。 */
export function ensurePlace(ctx: Context, key: string): string {
  const dir = placeDir(ctx, key);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** git を打ち、しくじれば訳（git の stderr）を出して止まる。 */
function run(ctx: Context, args: string[], what: string): string {
  const r = ctx.exec('git', args);
  if (r.status !== 0) throw new TpmError(`${what}に失敗しました: ${r.stderr.trim()}`);
  return r.stdout;
}

/** 本体（project の folder の直下の、repo の名の git の checkout）。物を借りて clone を速くする。無ければ undefined。 */
function mainCheckout(ctx: Context, repo: string): string | undefined {
  const dir = join(ctx.project, repo);
  return existsSync(join(dir, '.git')) ? dir : undefined;
}

/**
 * PR の head を、課題の場所に出す。clone が無ければ作り（GitHub の URL から。本体があれば物を借りて --dissociate で切る）、
 * refs/pull/番号/head を fetch して detach で出す。push の先は無い先にする。見直しでは、同じ clone へ新しい head を出し直す
 * （build の物は残す）。出した head の commit と作業の木の path を返す。
 */
export function checkoutPull(ctx: Context, key: string, url: string): { tree: string, head: string } {
  const pull = parsePull(url);
  if (pull === undefined) throw new TpmError(`PR の URL ではありません: ${url}`);
  ensurePlace(ctx, key);
  const tree = workTree(ctx, key, pull.repo);
  const git = gitDir(ctx, key, pull.repo);
  if (!existsSync(git)) {
    const main = mainCheckout(ctx, pull.repo);
    run(ctx, ['clone', '--quiet', '--no-checkout', ...(main === undefined ? [] : ['--reference', main, '--dissociate']), `--separate-git-dir=${git}`, remoteUrl(ctx, pull), tree], 'clone');
    run(ctx, safeGitArgs(git, tree, ['remote', 'set-url', '--push', 'origin', 'no-push']), 'push の先を外すの');
  }
  run(ctx, safeGitArgs(git, tree, ['fetch', '--quiet', 'origin', `+refs/pull/${pull.number}/head:refs/remotes/pull/${pull.number}`]), 'PR の head の fetch');
  run(ctx, safeGitArgs(git, tree, ['checkout', '--quiet', '--force', '--detach', `refs/remotes/pull/${pull.number}`]), 'head を出すの');
  const head = run(ctx, safeGitArgs(git, tree, ['rev-parse', 'HEAD']), 'head を読むの').trim();
  return { tree, head };
}

/**
 * clone（か、--main なら project の本体）を、読むだけの git で読む。git の folder を名指して打つので、作業の木の .git の file を読まない。
 * 通すのは REVIEW_GIT_READS の命令だけで、外の道具を動かす旗は断る。
 */
export function reviewGit(ctx: Context, key: string, options: { repo?: string, main?: string }, args: string[]): { status: number, stdout: string, stderr: string } {
  const [sub, ...rest] = args;
  if (sub === undefined || !REVIEW_GIT_READS.has(sub)) throw new TpmError(`roster review git が通すのは、読むだけの命令だけです（${[...REVIEW_GIT_READS].join('・')}）: ${sub ?? '（無し）'}`);
  const bad = rest.find(a => REVIEW_GIT_BAD_FLAG.test(a));
  if (bad !== undefined) throw new TpmError(`roster review git は、外の道具を動かす・書き出す旗を通しません: ${bad}`);
  if (options.main !== undefined) {
    const main = mainCheckout(ctx, options.main);
    if (main === undefined) throw new TpmError(`project の folder に ${options.main} の本体がありません`);
    return ctx.exec('git', safeGitArgs(join(main, '.git'), main, [sub, ...rest]));
  }
  const repos = clonedRepos(ctx, key);
  const repo = options.repo ?? (repos.length === 1 ? repos[0] : undefined);
  if (repo === undefined) throw new TpmError(repos.length === 0 ? 'この課題の場所に clone がありません（roster review checkout <PR の URL> で作る）' : `clone が ${repos.length} つあります。--repo <名> で選んでください: ${repos.join('・')}`);
  if (!repos.includes(repo)) throw new TpmError(`この課題の場所に ${repo} の clone がありません: ${repos.join('・') || '（無し）'}`);
  return ctx.exec('git', safeGitArgs(gitDir(ctx, key, repo), workTree(ctx, key, repo), [sub, ...rest]));
}

/** 課題の場所にある clone の repo の名。 */
export function clonedRepos(ctx: Context, key: string): string[] {
  const dir = placeDir(ctx, key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => n.startsWith('.git-')).map(n => n.slice('.git-'.length)).sort();
}

/** 課題の場所を消す（席を閉じる時）。無ければ何もしない。消したら、その path。 */
export function removePlace(ctx: Context, key: string): string | undefined {
  const dir = placeDir(ctx, key);
  if (!existsSync(dir)) return undefined;
  rmSync(dir, { recursive: true, force: true });
  return dir;
}

/** 消さずに残す時間（作ったばかりで、名簿に書く前の場所を消さない。review-3 の指摘 11）。 */
export const PRUNE_AFTER_MS = 60 * 60 * 1000;

/** 名簿に居ない Key の場所のうち、PRUNE_AFTER_MS より古い物を消す。消した path。 */
export function prunePlaces(ctx: Context, alive: (key: string) => boolean): string[] {
  const dir = projectReviewDir(ctx);
  if (!existsSync(dir)) return [];
  const now = ctx.now().getTime();
  const removed: string[] = [];
  for (const key of readdirSync(dir)) {
    const path = join(dir, key);
    if (alive(key)) continue;
    if (now - statSync(path).mtimeMs < PRUNE_AFTER_MS) continue;
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  return removed;
}
