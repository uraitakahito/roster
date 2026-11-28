// レビューの席の自分の場所（t-n4j9 の段 2。監査 audit-2 の R14）。
// 課題ごとの folder（project の folder の外）に、PR の head を持つ clone を作る。席はこの folder で起き、/code-review の手伝いも
// この folder で起きるので、PR の head を探して課題の担当の worktree へ行く訳が無くなる（段 0 の 1 で確かめた）。
// clone の git の folder は作業の木の外（<場所>/.git-<repo>/）に分け、手元の git はいつも git の folder を名指して打つ。
// 作業の木の .git の file や入れ子の .git を、container の中のコード（段 3）が書き替えても、手元の git が自前の config を読まないため（review-4 の指摘 1・段 0 の 6）。
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Context } from './context.ts';
import { envOf } from './env.ts';
import { TpmError } from './skill-sets.ts';

/**
 * 手元の git にいつも付ける守り（hook・fsmonitor・外の diff・pager を動かさない）。submodule に降りない（gitlink の path に container が置いた .git で、
 * 子の git が起き、その config の filter を動かすため。review-8 の指摘 3）。
 */
export const SAFE_GIT_CONFIG = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'diff.ignoreSubmodules=all', '-c', 'submodule.recurse=false', '-c', 'status.submoduleSummary=false'];

/** roster review git が通す、読むだけの git の命令。 */
export const REVIEW_GIT_READS = new Set(['show', 'diff', 'log', 'status', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'grep', 'cat-file', 'merge-base']);
/** roster review git が断る長い旗（外の道具・file を開く道具・書き出し・取り寄せの命令を動かす・submodule に降りる）。 */
const REVIEW_GIT_BAD_LONG = ['--ext-diff', '--textconv', '--open-files-in-pager', '--output', '--output-directory', '--upload-pack', '--exec', '--recurse-submodules', '--submodule', '--ignore-submodules'];

/**
 * 断る旗か。git は長い旗の紛れない略し（`--outp`・`--open-files`）を受けるので、断る名の 2 字以上の頭に当たれば断る（review-8 の指摘 4）。
 * 短い旗は `-O`（file を開く道具）。
 */
function badGitFlag(arg: string): boolean {
  // まとめた短い旗（`-nOsh`）の中の O も当たる（review-9）。
  if (/^-[A-Za-z]*O/.test(arg)) return true;
  if (!arg.startsWith('--') || arg === '--') return false;
  const name = arg.split('=')[0] ?? '';
  return name.length >= 4 && !GIT_OK_LONG.has(name) && REVIEW_GIT_BAD_LONG.some(bad => bad.startsWith(name));
}

/** 断る名の頭に当たるが、それ自体が git の旗の名（略しでない）物（`--text` は `--textconv` の頭。review-9）。 */
const GIT_OK_LONG = new Set(['--text']);

/** 名（repo・Key）が、1 つの folder の名で、path を外へ出ない字か（英数字で始まり、英数字と . _ # - だけ）。 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._#-]*$/;

/** 名を確かめる。合わなければ止まる（`''`・`.`・`..`・`/` を含む名で、場所の外を指さない。review-8 の指摘 1・2）。 */
function assertName(name: string, what: string): void {
  if (!SAFE_NAME.test(name) || name.includes('..')) throw new TpmError(`${what}は、英数字で始まり、英数字と . _ # - だけの名にしてください: ${JSON.stringify(name)}`);
}

/** PR の URL を読んだ物。 */
export interface PullRef {
  owner: string
  repo: string
  number: number
}

/** PR の URL（`https://<host>/<owner>/<repo>/pull/<番号>`）を読む。読めなければ undefined。 */
export function parsePull(url: string): PullRef | undefined {
  const m = /^https:\/\/[^\s/]+\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/.exec(url);
  if (m === null) return undefined;
  const [owner, repo] = [m[1] ?? '', m[2] ?? ''];
  return SAFE_NAME.test(owner) && SAFE_NAME.test(repo) && !owner.includes('..') && !repo.includes('..') ? { owner, repo, number: Number(m[3]) } : undefined;
}

/** レビューの場所の根（`${XDG_CACHE_HOME:-~/.cache}/roster/review`。$ROSTER_REVIEW_DIR で替えられる）。 */
export function reviewRoot(env: NodeJS.ProcessEnv): string {
  return envOf(env, 'REVIEW_DIR') || join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'roster', 'review');
}

/** project ごとの folder（project の path の字を - でつないだ名）。 */
export const projectReviewDir = (ctx: Context): string => join(reviewRoot(ctx.env), ctx.project.replace(/[^A-Za-z0-9._]+/g, '-'));

/** 課題ごとの場所（席の起きる folder。repo でない folder）。Key を確かめ、project の場所の 1 つ下であることも確かめる。 */
export function placeDir(ctx: Context, key: string): string {
  assertName(key, 'レビューの場所の Key ');
  const base = projectReviewDir(ctx);
  const dir = resolve(base, key);
  if (dirname(dir) !== resolve(base)) throw new TpmError(`レビューの場所が、project の場所の外を指します: ${key}`);
  return dir;
}

/** 場所の中の、repo ごとの作業の木（container に見せるのはここだけ）。 */
export const workTree = (ctx: Context, key: string, repo: string): string => join(placeDir(ctx, key), repo);
/** 場所の中の、repo ごとの git の folder（作業の木の外。container に見せない）。 */
export const gitDir = (ctx: Context, key: string, repo: string): string => join(placeDir(ctx, key), `.git-${repo}`);

/** GitHub の repo の URL（試験では $ROSTER_REVIEW_REMOTE で、手元の bare repo の置き場に替える）。 */
const remoteUrl = (ctx: Context, pull: { owner: string, repo: string }): string => {
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

/**
 * 本体（project の folder の直下の、repo の名の git の checkout）。clone の物を借りて速くするだけに使う（--dissociate で切るので、
 * 読む中身は GitHub から取った物。本体が古くても、project の外に在っても、読む物は変わらない）。無ければ undefined。
 */
function mainCheckout(ctx: Context, repo: string): string | undefined {
  assertName(repo, 'repo の名');
  const dir = join(ctx.project, repo);
  // .git が folder の物だけ（gitdir を指す file は、場所の作業の木の .git の形なので取らない。review-8 の指摘 2）。
  try {
    return lstatSync(join(dir, '.git')).isDirectory() ? dir : undefined;
  }
  catch {
    return undefined;
  }
}

/** 取り直した既定の branch（ふつう main）を置く ref。PR の clone でも同じ名にし、`diff origin/main...HEAD` で比べられるようにする。 */
const ORIGIN_MAIN = 'refs/remotes/origin/main';

/** repo の lock を待つ長さ（これを過ぎたら止まる）と、見直す間。 */
export const REPO_LOCK_WAIT_MS = 120_000;
const REPO_LOCK_STEP_MS = 200;
/** pid の書かれていない lock を、取った直後とみなす長さ。 */
const FRESH_REPO_LOCK_MS = 60_000;

/** pid の process が居るか。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  }
  catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 課題の場所の、repo ごとの lock（`.lock-<repo>/`）を持って body を打つ。checkout と --main（取り直しから、読む命令が終わるまで）を
 * 1 つずつにする（並べて打つと、同じ git の folder の index.lock・ref の lock でぶつかり、読んだ commit の字もずれる。review-1 の指摘 1・2）。
 * ほかが持っていれば待つ。取った roster が居なければ（切られた）、古い lock とみなして取り直す。
 */
export function withRepoLock<T>(ctx: Context, key: string, repo: string, body: () => T): T {
  assertName(repo, 'repo の名');
  const lock = join(ensurePlace(ctx, key), `.lock-${repo}`);
  const note = join(lock, 'pid');
  const until = Date.now() + REPO_LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let stale: boolean;
    try {
      const pid = Number(readFileSync(note, 'utf8'));
      stale = Number.isInteger(pid) && pid > 0 ? !alive(pid) : Date.now() - statSync(lock).mtimeMs > FRESH_REPO_LOCK_MS;
    }
    catch {
      // pid がまだ書かれていない（取った直後）か、lock が今消えた。
      stale = existsSync(lock) && Date.now() - statSync(lock).mtimeMs > FRESH_REPO_LOCK_MS;
    }
    if (stale) {
      rmSync(lock, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > until) throw new TpmError(`ほかの roster review が ${repo} の lock を長く持っています（${lock}）。終わってから打ち直してください`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REPO_LOCK_STEP_MS);
  }
  writeFileSync(note, String(process.pid));
  try {
    return body();
  }
  finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * PR の head を、課題の場所に出す。clone が無ければ作り（GitHub の URL から。本体があれば物を借りて --dissociate で切る）、
 * refs/pull/番号/head を fetch して detach で出す。push の先は無い先にする。見直しでは、同じ clone へ新しい head を出し直す
 * （build の物は残す）。出した head の commit と作業の木の path を返す。
 */
export function checkoutPull(ctx: Context, key: string, url: string): { tree: string, head: string } {
  const pull = parsePull(url);
  if (pull === undefined) throw new TpmError(`PR の URL ではありません: ${url}`);
  return withRepoLock(ctx, key, pull.repo, () => checkoutLocked(ctx, key, pull));
}

/** checkoutPull の中身（repo の lock を持って打つ）。 */
function checkoutLocked(ctx: Context, key: string, pull: PullRef): { tree: string, head: string } {
  const tree = workTree(ctx, key, pull.repo);
  const git = gitDir(ctx, key, pull.repo);
  if (!existsSync(git)) {
    const main = mainCheckout(ctx, pull.repo);
    run(ctx, ['clone', '--quiet', '--no-checkout', ...(main === undefined ? [] : ['--reference', main, '--dissociate']), `--separate-git-dir=${git}`, remoteUrl(ctx, pull), tree], 'clone');
    run(ctx, safeGitArgs(git, tree, ['remote', 'set-url', '--push', 'origin', 'no-push']), 'push の先を外すの');
  }
  // origin/main も一緒に取り直す（PR の head と今の main を、この clone の 1 つの git で比べるため。review-1 の指摘 3）。
  run(ctx, safeGitArgs(git, tree, ['fetch', '--quiet', '--no-recurse-submodules', 'origin', `+refs/pull/${pull.number}/head:refs/remotes/pull/${pull.number}`, `+HEAD:${ORIGIN_MAIN}`]), 'PR の head の fetch');
  run(ctx, safeGitArgs(git, tree, ['checkout', '--quiet', '--force', '--detach', `refs/remotes/pull/${pull.number}`]), 'head を出すの');
  const head = run(ctx, safeGitArgs(git, tree, ['rev-parse', 'HEAD']), 'head を読むの').trim();
  return { tree, head };
}

/** --main の作業の木（場所の .main の下。PR の clone と分け、clonedRepos にも、container にも入らない）。 */
export const mainTree = (ctx: Context, key: string, repo: string): string => join(placeDir(ctx, key), '.main', repo);
/** --main の git の folder（作業の木の外）。 */
export const mainGitDir = (ctx: Context, key: string, repo: string): string => join(placeDir(ctx, key), '.main', `.git-${repo}`);

/** git の folder の origin の URL。 */
const originUrl = (ctx: Context, git: string): string => run(ctx, [`--git-dir=${git}`, ...SAFE_GIT_CONFIG, 'remote', 'get-url', 'origin'], 'origin の URL を読むの').trim();

/**
 * --main の名（`<repo>` か `<owner>/<repo>`）を、repo の名と GitHub の URL にする。`<repo>` だけなら、場所の clone（PR の clone、
 * 無ければ前に取った main の clone）の origin から引く。どちらも無ければ止まって、`<owner>/<repo>` を求める。
 */
function mainRemote(ctx: Context, key: string, name: string): { repo: string, url: string } {
  const parts = name.split('/');
  if (parts.length === 2) {
    const [owner, repo] = [parts[0] ?? '', parts[1] ?? ''];
    assertName(owner, 'owner の名');
    assertName(repo, 'repo の名');
    return { repo, url: remoteUrl(ctx, { owner, repo }) };
  }
  assertName(name, 'repo の名');
  const known = [gitDir(ctx, key, name), mainGitDir(ctx, key, name)].find(g => existsSync(g));
  if (known === undefined) throw new TpmError(`この課題の場所に ${name} の clone がありません。--main <owner>/${name} で名指してください（GitHub から main を取ります）`);
  return { repo: name, url: originUrl(ctx, known) };
}

/** --main で取り直して出した main。 */
export interface FetchedMain {
  repo: string
  tree: string
  git: string
  head: string
}

/**
 * GitHub から既定の branch（ふつう main）を取り直し、--main の作業の木に detach で出して、read を打つ（project の folder の本体は読まない。t-rgd2）。
 * 取り直しから read が終わるまで、repo の lock を持つ（並べて打っても、読んだ commit と字が合う）。clone が無ければ作る（PR の clone か
 * project の本体があれば物を借り、--dissociate で切る）。PR の clone があれば、その origin/main も同じ commit に合わせる。
 * 取り直せなければ止まる（古い main は読まない）。
 */
export function fetchMain<T>(ctx: Context, key: string, name: string, read: (main: FetchedMain) => T): T {
  const { repo, url } = mainRemote(ctx, key, name);
  return withRepoLock(ctx, key, repo, () => read(fetchMainLocked(ctx, key, repo, url)));
}

/** fetchMain の中身（repo の lock を持って打つ）。 */
function fetchMainLocked(ctx: Context, key: string, repo: string, url: string): FetchedMain {
  const tree = mainTree(ctx, key, repo);
  const git = mainGitDir(ctx, key, repo);
  const pr = gitDir(ctx, key, repo);
  if (!existsSync(git)) {
    const borrow = existsSync(pr) ? pr : mainCheckout(ctx, repo);
    mkdirSync(dirname(tree), { recursive: true });
    run(ctx, ['clone', '--quiet', '--no-checkout', ...(borrow === undefined ? [] : ['--reference', borrow, '--dissociate']), `--separate-git-dir=${git}`, url, tree], 'main の clone');
    run(ctx, safeGitArgs(git, tree, ['remote', 'set-url', '--push', 'origin', 'no-push']), 'push の先を外すの');
  }
  else if (originUrl(ctx, git) !== url) run(ctx, safeGitArgs(git, tree, ['remote', 'set-url', 'origin', url]), 'origin の URL を替えるの');
  const fetched = ctx.exec('git', safeGitArgs(git, tree, ['fetch', '--quiet', '--no-recurse-submodules', 'origin', `+HEAD:${ORIGIN_MAIN}`]));
  if (fetched.status !== 0) {
    const why = /\.lock\b/.test(fetched.stderr)
      ? 'git の lock の file が残っています（前の roster review が途中で切られた見込み）'
      : 'GitHub が応えないなら roster watch github で待ってから打ち直す';
    throw new TpmError(`${repo} の origin の main を取り直せませんでした（前に取った古い main は読みません。${why}）: ${fetched.stderr.trim()}`);
  }
  run(ctx, safeGitArgs(git, tree, ['checkout', '--quiet', '--force', '--detach', ORIGIN_MAIN]), 'main を出すの');
  const head = run(ctx, safeGitArgs(git, tree, ['rev-parse', 'HEAD']), 'main を読むの').trim();
  // PR の clone の origin/main も、取り直した commit に合わせる（手元の git の folder から。PR の head と今の main を比べるため。review-1 の指摘 3）。
  if (existsSync(pr)) run(ctx, safeGitArgs(pr, workTree(ctx, key, repo), ['fetch', '--quiet', '--no-recurse-submodules', git, `+${ORIGIN_MAIN}:${ORIGIN_MAIN}`]), 'PR の clone の origin/main を合わせるの');
  return { repo, tree, git, head };
}

/**
 * clone（か、--main なら GitHub から取り直した main）を、読むだけの git で読む。git の folder を名指して打つので、作業の木の .git の file を読まない。
 * 通すのは REVIEW_GIT_READS の命令だけで、外の道具を動かす旗は断る。
 */
export function reviewGit(ctx: Context, key: string, options: { repo?: string, main?: string }, args: string[]): { status: number, stdout: string, stderr: string } {
  const [sub, ...rest] = args;
  if (sub === undefined || !REVIEW_GIT_READS.has(sub)) throw new TpmError(`roster review git が通すのは、読むだけの命令だけです（${[...REVIEW_GIT_READS].join('・')}）: ${sub ?? '（無し）'}`);
  const bad = rest.find(badGitFlag);
  if (bad !== undefined) throw new TpmError(`roster review git は、外の道具を動かす・書き出す旗を通しません: ${bad}`);
  if (options.main !== undefined) {
    return fetchMain(ctx, key, options.main, (main) => {
      const r = ctx.exec('git', safeGitArgs(main.git, main.tree, [sub, ...rest]));
      return { ...r, stderr: `${main.repo} の origin/main を GitHub から取り直して読む（${main.head.slice(0, 7)}・${main.tree}）\n${r.stderr}` };
    });
  }
  const repos = clonedRepos(ctx, key);
  const repo = options.repo ?? (repos.length === 1 ? repos[0] : undefined);
  if (repo === undefined) throw new TpmError(repos.length === 0 ? 'この課題の場所に clone がありません（roster review checkout <PR の URL> で作る）' : `clone が ${repos.length} つあります。--repo <名> で選んでください: ${repos.join('・')}`);
  assertName(repo, 'repo の名');
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
