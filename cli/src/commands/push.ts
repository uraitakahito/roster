// roster push: repo に宣言した確かめ（push の前に流す物）をみな流し、みな通った時だけ、確かめた commit を push する（t-fcp8。監査 audit-2 の R15）。
// 確かめの一覧は、push する commit の .claude/roles/config.jsonc の push の欄から読む（t-f73c。一覧を足す PR・新しい repo の初めの PR も、その一覧で確かめて push できる）。
// branch が一覧に加えた変更（消した・変えた・足した）は、main と分かれた所（merge-base）の一覧と比べて毎回出し、記録に残す。消す・変えるのを見るのは PR のレビュー（担当は必ず頼む。t-f73c の confirm-1）。
// push の先は、いつも手元の branch と同じ名（upstream では決めない。origin/main から切った branch は origin/main を追うため。review-3 の指摘 1）。
// path では選ばず、宣言した確かめを毎回みな流す（4 repo の主な CI は、どれも pull_request に paths が無い）。
// 確かめは shell を通さずに語の並びで打つ（; や pipe で終了コードが隠れる形を、設定の中にも作らない）。
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import type { Context } from '../context.ts';
import { envOf } from '../env.ts';
import { parseJsonc } from '../jsonc.ts';

/** 終了コード（roster watch に合わせる）。 */
export const PUSH_EXIT = { pushed: 0, error: 1, pushFailed: 2, failed: 10 } as const;

/** push の記録の file（state の下。roster を動かす機械の外には写さない）。 */
export const PUSH_LOG = 'pushes.jsonl';

/** 宣言した確かめ 1 つ。 */
export interface PushCheck {
  name: string
  /** 打つ命令（語の並び。shell を通さない）。 */
  run: string[]
  /** repo の根からの folder（無ければ根）。 */
  dir?: string
  /** 足す環境変数（値は字）。 */
  env?: Record<string, string>
  /** 時間の限り（秒。無ければ CHECK_TIMEOUT_SECONDS）。過ぎたら止めて「落ちた（時間切れ）」とする。 */
  timeoutSeconds?: number
}

/** roster push の旗と、打った folder。 */
export interface PushOptions {
  /** 命令を打った folder（git の worktree の中）。 */
  cwd: string
  /** release の tag を push する（確かめは流さない。tag の commit が origin の既定の branch に在る時だけ）。 */
  tag?: string
  forceWithLease?: boolean
  /** 宣言の無い repo で、確かめを流さずに push する訳（宣言のある repo では断る）。 */
  noChecks?: string
}

/** 終了コードと、出す行。 */
export interface PushResult {
  code: number
  lines: string[]
}

/** 確かめ 1 つの結果。 */
interface CheckResult {
  name: string
  code: number
  seconds: number
  log: string
}

/** push の記録 1 件（pushes.jsonl）。 */
export interface PushRecord {
  at: string
  key?: string
  role?: string
  repo: string
  /** push した先（branch の名か、tags/<tag>）。 */
  target: string
  sha?: string
  checks: { name: string, code: number, seconds: number }[]
  code: number
  result: 'pushed' | 'failed' | 'refused' | 'push-failed'
  noChecks?: string
  /** 断った・落ちた訳（1 行）。 */
  reason?: string
  /** branch が一覧に加えた変更（差が無ければ無い）。 */
  configDiff?: ConfigDiff
}

/** branch が確かめの一覧に加えた変更（main と分かれた所の一覧と、push する commit の一覧の比べ）。 */
export interface ConfigDiff {
  /** 比べた元: main と分かれた所か、それが取れない時の origin の既定の branch の先。 */
  base: 'merge-base' | 'origin/main'
  /** 消した確かめの名。 */
  removed: string[]
  /** 同じ名で run・dir・env・timeoutSeconds のどれかを変えた確かめの名。 */
  changed: string[]
  /** 足した確かめの名。 */
  added: string[]
  /** push の欄ごと消した。 */
  sectionRemoved?: true
  /** 分かれた後に main に足され、この branch に無い確かめの名（取り込めば流れる。差には数えない）。 */
  mainAdded?: string[]
  /** 比べる元の一覧の形が違い、読めない（差は出していない）。 */
  baseUnreadable?: true
}

/** 確かめ 1 つの時間の限りの既定（秒）。止まったまま返らない確かめで、roster push が返らなくならないため（review-3 の指摘 2）。 */
export const CHECK_TIMEOUT_SECONDS = 600;
/** 時間切れの確かめの終了コード（timeout(1) に合わせる）。 */
const TIMED_OUT = 124;

/** 落ちた確かめの log から出す終わりの行の数。 */
const TAIL_LINES = 40;
/** 注意に名を出す untracked の file の数。 */
const UNTRACKED_SHOWN = 10;

/** 設定の push の欄を読む。無ければ undefined。形が違えば訳を投げる。 */
export function parsePushChecks(text: string, where: string): PushCheck[] | undefined {
  const raw = parseJsonc(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const push = (raw as Record<string, unknown>).push;
  if (push === undefined) return undefined;
  const bad = (what: string): never => {
    throw new Error(`${where} の push の欄の形が違います（${what}）。書き方は docs の「設定」の push の欄`);
  };
  if (typeof push !== 'object' || push === null || Array.isArray(push)) bad('object でない');
  const checks = (push as Record<string, unknown>).checks;
  if (!Array.isArray(checks) || checks.length === 0) bad('checks が 1 つ以上の並びでない');
  const names = new Set<string>();
  return (checks as unknown[]).map((c, i) => {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return bad(`checks[${i}] が object でない`);
    const o = c as Record<string, unknown>;
    if (typeof o.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(o.name)) bad(`checks[${i}].name は英数字と _ . - の字`);
    const name = o.name as string;
    if (names.has(name)) bad(`name ${name} が 2 つある`);
    names.add(name);
    if (!Array.isArray(o.run) || o.run.length === 0 || !o.run.every(w => typeof w === 'string') || o.run[0] === '') bad(`${name} の run は字の並び（頭の命令の名は空でない）`);
    const check: PushCheck = { name, run: o.run as string[] };
    if (o.dir !== undefined) {
      if (typeof o.dir !== 'string' || isAbsolute(o.dir) || normalize(o.dir).split(/[\\/]/).includes('..')) bad(`${name} の dir は repo の中の相対の path`);
      check.dir = o.dir as string;
    }
    if (o.env !== undefined) {
      if (typeof o.env !== 'object' || o.env === null || Array.isArray(o.env) || !Object.values(o.env).every(v => typeof v === 'string')) bad(`${name} の env は 名 → 字`);
      check.env = o.env as Record<string, string>;
    }
    if (o.timeoutSeconds !== undefined) {
      if (typeof o.timeoutSeconds !== 'number' || !Number.isInteger(o.timeoutSeconds) || o.timeoutSeconds <= 0) bad(`${name} の timeoutSeconds は 1 以上の整数`);
      check.timeoutSeconds = o.timeoutSeconds as number;
    }
    return check;
  });
}

/** 設定の file の、repo の根からの path。 */
const CONFIG_PATH = '.claude/roles/config.jsonc';

/** 一覧を読んだ結果: 在る・無い（file か欄が無い）・形が違う。 */
type ReadChecks = { kind: 'some', checks: PushCheck[] } | { kind: 'none' } | { kind: 'bad', message: string };

/** commit（rev）の設定の push の欄を読む。 */
function readChecks(ctx: Context, root: string, rev: string, where: string): ReadChecks {
  const shown = git(ctx, root, ['show', `${rev}:${CONFIG_PATH}`]);
  if (shown.status !== 0) return { kind: 'none' };
  try {
    const checks = parsePushChecks(shown.stdout, where);
    return checks === undefined ? { kind: 'none' } : { kind: 'some', checks };
  }
  catch (e) {
    return { kind: 'bad', message: (e as Error).message };
  }
}

/** 確かめ 1 つの、変えた欄の名。 */
function changedFields(a: PushCheck, b: PushCheck): string[] {
  const same = (x: unknown, y: unknown): boolean => JSON.stringify(x) === JSON.stringify(y);
  const sorted = (env?: Record<string, string>) => env === undefined ? undefined : Object.fromEntries(Object.entries(env).sort(([k], [l]) => k.localeCompare(l)));
  return [
    ...(same(a.run, b.run) ? [] : ['run']),
    ...((a.dir ?? '.') === (b.dir ?? '.') ? [] : ['dir']),
    ...(same(sorted(a.env), sorted(b.env)) ? [] : ['env']),
    ...(a.timeoutSeconds === b.timeoutSeconds ? [] : ['timeoutSeconds']),
  ];
}

/**
 * branch が一覧に加えた変更を、比べる元（main と分かれた所）の一覧と比べて出す。差も注意も無ければ undefined。
 * main の先と比べないのは、取り込んでいない branch で、main に後から足された確かめを「消した」と読まないため（t-f73c の plan-2）。
 */
export function diffChecks(baseRef: ConfigDiff['base'], base: ReadChecks, head: PushCheck[] | undefined, main: ReadChecks): { diff: ConfigDiff, changedDetail: string[] } | undefined {
  if (base.kind === 'bad') return { diff: { base: baseRef, removed: [], changed: [], added: [], baseUnreadable: true }, changedDetail: [] };
  const before = base.kind === 'some' ? base.checks : [];
  const after = head ?? [];
  const byName = new Map(before.map(c => [c.name, c]));
  const afterNames = new Set(after.map(c => c.name));
  const removed = before.filter(c => !afterNames.has(c.name)).map(c => c.name);
  const added = after.filter(c => !byName.has(c.name)).map(c => c.name);
  const changedDetail: string[] = [];
  const changed: string[] = [];
  for (const c of after) {
    const old = byName.get(c.name);
    if (old === undefined) continue;
    const fields = changedFields(old, c);
    if (fields.length === 0) continue;
    changed.push(c.name);
    changedDetail.push(`${c.name}（${fields.join('・')}）`);
  }
  const beforeNames = new Set(before.map(c => c.name));
  const mainAdded = baseRef === 'merge-base' && main.kind === 'some' ? main.checks.map(c => c.name).filter(n => !beforeNames.has(n) && !afterNames.has(n)) : [];
  const sectionRemoved = before.length > 0 && head === undefined;
  if (removed.length + changed.length + added.length + mainAdded.length === 0) return undefined;
  return {
    diff: { base: baseRef, removed, changed, added, ...(sectionRemoved ? { sectionRemoved: true as const } : {}), ...(mainAdded.length > 0 ? { mainAdded } : {}) },
    changedDetail,
  };
}

/** 差を出す行。消した・変えたがあれば、PR の本文に訳を書き、レビューを必ず頼む案内も出す。 */
function diffLines(d: { diff: ConfigDiff, changedDetail: string[] }): string[] {
  const { diff } = d;
  const from = diff.base === 'merge-base' ? 'main と分かれた所と比べて' : 'main と分かれた所が取れないので、origin の既定の branch の先と比べて';
  if (diff.baseUnreadable === true) return [`注意: 確かめの一覧の差は出していない（${from}、その一覧の形が違い、読めない）`];
  const parts = [
    ...(diff.sectionRemoved === true ? [`push の欄ごと消した（あった確かめ: ${diff.removed.join('・')}）`] : diff.removed.length > 0 ? [`消した: ${diff.removed.join('・')}`] : []),
    ...(d.changedDetail.length > 0 ? [`変えた: ${d.changedDetail.join('・')}`] : []),
    ...(diff.added.length > 0 ? [`足した: ${diff.added.join('・')}`] : []),
  ];
  const lines = parts.length > 0 ? [`確かめの一覧の差（${from}）: ${parts.join('／')}`] : [];
  if (diff.removed.length + diff.changed.length > 0) lines.push('  → PR の本文に差と訳を書き、依頼書に無くてもレビューを必ず頼む（--focus に「push の一覧の変更」）。判定が届くまで merge しない');
  if (diff.mainAdded !== undefined) lines.push(`注意: main に後から足された確かめが、この branch に無い（流していない。origin の既定の branch を取り込めば流れる）: ${diff.mainAdded.join('・')}`);
  return lines;
}

/** git を打つ（cwd で）。 */
function git(ctx: Context, cwd: string, args: string[]) {
  return ctx.exec('git', args, { cwd });
}

/** git の答えの 1 行目（落ちたら undefined）。 */
function gitLine(ctx: Context, cwd: string, args: string[]): string | undefined {
  const r = git(ctx, cwd, args);
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** origin の既定の branch の名（手元の origin/HEAD、無ければ remote に聞き、それも読めなければ main）。 */
function defaultBranch(ctx: Context, root: string): string {
  const head = gitLine(ctx, root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (head !== undefined && head !== '') return head.replace(/^refs\/remotes\/origin\//, '');
  const remote = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(git(ctx, root, ['ls-remote', '--symref', 'origin', 'HEAD']).stdout);
  return remote?.[1] ?? 'main';
}

/** 追われている file の、commit していない変更（無ければ空）。git status が落ちたら undefined（読めない物を「変更が無い」と読まない。review-3 の指摘 7）。 */
function trackedChanges(ctx: Context, root: string): string | undefined {
  const r = git(ctx, root, ['status', '--porcelain', '--untracked-files=no']);
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** 指す commit が checkout とずれた submodule の path（`git submodule status` の行の頭が +）。submodule が無ければ空。 */
function driftedSubmodules(ctx: Context, root: string): string[] {
  return git(ctx, root, ['submodule', 'status', '--recursive']).stdout.split('\n')
    .filter(l => l.startsWith('+'))
    .map(l => l.slice(1).trim().split(/\s+/)[1] ?? '')
    .filter(p => p !== '');
}

/**
 * 追われている file の変更で断る時の訳。submodule の指す commit のずれは、branch を替えた後に submodule を合わせ忘れた時に出るので、
 * そう言って直し方を出す（t-fcp8 の result-2。capture-ledger の試しで、訳が submodule を言わず戸惑った）。
 */
function changesReason(ctx: Context, root: string): string {
  const drifted = driftedSubmodules(ctx, root);
  const base = '追われている file に commit していない変更がある。commit してから打つ（確かめた木と push する commit を合わせるため）';
  if (drifted.length === 0) return base;
  return `${base}。うち submodule の ${drifted.join('・')} は、指す commit が checkout とずれている（branch を替えた後なら git submodule update --init --recursive で合わせる。submodule を進めたなら、その commit を git add して commit する）`;
}

/** package.json が依存を書いているか（dependencies などに 1 つでも在るか）。読めなければ書いていないとみなす（依存の無い package.json を拾わない。review-13）。 */
function declaresDeps(file: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'optionalDependencies'].some(k => typeof pkg[k] === 'object' && pkg[k] !== null && Object.keys(pkg[k]).length > 0);
  }
  catch {
    return false;
  }
}

/** 依存の入っていない folder（dir と、その直下の folder の package.json のうち、依存を書いていて、隣に node_modules が無い物）。dir は repo の根からの path。 */
function bareDeps(root: string, dir: string): string[] {
  const base = join(root, dir);
  const candidates = [dir, ...(existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')).map(e => dir === '.' ? e.name : join(dir, e.name)) : [])];
  return candidates.filter(d => existsSync(join(root, d, 'package.json')) && declaresDeps(join(root, d, 'package.json')) && !existsSync(join(root, d, 'node_modules')));
}

/** 秒の字。 */
const secs = (s: number): string => `${s} 秒`;

/** 確かめを 1 つ流す。出力は log の file に書く。 */
function runCheck(root: string, logDir: string, check: PushCheck, now: () => Date): CheckResult {
  const log = join(logDir, `${check.name}.log`);
  const fd = openSync(log, 'w');
  const start = now().getTime();
  const cwd = join(root, check.dir ?? '.');
  const limit = check.timeoutSeconds ?? CHECK_TIMEOUT_SECONDS;
  try {
    if (!existsSync(cwd)) {
      appendFileSync(log, `dir（${check.dir ?? '.'}）が、この木に無い（一覧の dir と木の folder が合っていない）\n`);
      return { name: check.name, code: 127, seconds: 0, log };
    }
    const r = spawnSync(check.run[0] as string, check.run.slice(1), {
      cwd,
      env: { ...process.env, ...check.env },
      stdio: ['ignore', fd, fd],
      timeout: limit * 1000,
      killSignal: 'SIGKILL',
    });
    const timedOut = r.error !== undefined && 'code' in r.error && r.error.code === 'ETIMEDOUT';
    if (timedOut) appendFileSync(log, `\n時間切れ: ${limit} 秒を過ぎたので止めた（設定の timeoutSeconds で替えられる）\n`);
    else if (r.error !== undefined) appendFileSync(log, `起こせなかった: ${r.error.message}\n`);
    const code = timedOut ? TIMED_OUT : r.error === undefined ? (r.status ?? 1) : 127;
    return { name: check.name, code, seconds: Math.round((now().getTime() - start) / 1000), log };
  }
  finally {
    closeSync(fd);
  }
}

/** log の終わりの行。 */
function tail(log: string): string[] {
  try {
    const lines = readFileSync(log, 'utf8').replace(/\n$/, '').split('\n');
    return lines.slice(-TAIL_LINES);
  }
  catch {
    return [];
  }
}

/** origin の URL から owner/repo（読めなければ repo の folder の名）。 */
function repoName(ctx: Context, root: string): string {
  const url = gitLine(ctx, root, ['remote', 'get-url', 'origin']) ?? '';
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m?.[1] ?? root.split('/').pop() ?? root;
}

/** roster push の本体。 */
export function push(ctx: Context, options: PushOptions): PushResult {
  const at = ctx.now();
  const key = envOf(ctx.env, 'KEY');
  const role = envOf(ctx.env, 'ROLE');
  const root = gitLine(ctx, options.cwd, ['rev-parse', '--show-toplevel']);
  const base = { at: at.toISOString(), ...(key === undefined ? {} : { key }), ...(role === undefined ? {} : { role }) };
  const finish = (record: Omit<PushRecord, 'at' | 'key' | 'role'>, lines: string[]): PushResult => {
    ctx.state.append(PUSH_LOG, { ...base, ...record });
    return { code: record.code, lines };
  };
  if (root === undefined) return { code: PUSH_EXIT.error, lines: [`断った: ${options.cwd} は git の worktree の中でない`] };
  const repo = repoName(ctx, root);
  const refuse = (target: string, reason: string, sha?: string, diff?: { diff: ConfigDiff, changedDetail: string[] }): PushResult =>
    finish({ repo, target, ...(sha === undefined ? {} : { sha }), checks: [], code: PUSH_EXIT.error, result: 'refused', reason, ...(diff === undefined ? {} : { configDiff: diff.diff }) }, [...(diff === undefined ? [] : diffLines(diff)), `断った: ${reason}`]);
  const main = defaultBranch(ctx, root);
  const fetched = git(ctx, root, ['fetch', '--quiet', 'origin', main]);
  if (fetched.status !== 0) {
    return finish({ repo, target: options.tag === undefined ? '' : `tags/${options.tag}`, checks: [], code: PUSH_EXIT.pushFailed, result: 'push-failed', reason: 'fetch が落ちた' }, [`git fetch origin ${main} が落ちた（確かめは流していない・push していない）: ${fetched.stderr.trim().split('\n').pop() ?? ''}`, '網の誤り（5xx・繋がらない）なら、roster watch github を裏で起こして待ち、戻ってから打ち直す']);
  }

  if (options.tag !== undefined) return pushTag(ctx, root, main, options.tag, refuse, finish, repo);

  const branch = gitLine(ctx, root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch === undefined) return refuse('', 'HEAD が branch でない（detached）。branch を作ってから打つ');
  const target = branch;
  if (target === main) return refuse(target, `既定の branch（${main}）の上にいる。main から branch を切り（git switch -c <名>）、その branch で打つ`);
  if (options.noChecks?.trim() === '') return refuse(target, '--no-checks には訳を書く（空は受けない）');
  const changes = trackedChanges(ctx, root);
  if (changes === undefined) return refuse(target, 'git status が読めない（index.lock など）。git status を見てから打ち直す');
  if (changes !== '') return refuse(target, changesReason(ctx, root));
  const sha = gitLine(ctx, root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (sha === undefined) return refuse(target, 'HEAD に commit が無い');

  const head = readChecks(ctx, root, sha, `push する commit（${sha.slice(0, 7)}）の ${CONFIG_PATH}`);
  if (head.kind === 'bad') return refuse(target, head.message, sha);
  const checks = head.kind === 'some' ? head.checks : undefined;
  const mergeBase = gitLine(ctx, root, ['merge-base', sha, `origin/${main}`]);
  const mainChecks = readChecks(ctx, root, `origin/${main}`, `origin/${main} の ${CONFIG_PATH}`);
  const diff = mergeBase === undefined
    ? diffChecks('origin/main', mainChecks, checks, mainChecks)
    : diffChecks('merge-base', readChecks(ctx, root, mergeBase, `main と分かれた所（${mergeBase.slice(0, 7)}）の ${CONFIG_PATH}`), checks, mainChecks);
  if (checks === undefined && options.noChecks === undefined) {
    const untracked = existsSync(join(root, CONFIG_PATH)) && git(ctx, root, ['ls-files', '--error-unmatch', CONFIG_PATH]).status !== 0;
    return refuse(target, `この repo（${repo}）の push する commit（${sha.slice(0, 7)}）の設定に、push の前に流す確かめ（push の欄）が無い。${untracked ? `${CONFIG_PATH} は作業の木に在るが git に入っていない（git add して commit してから打つ）。` : ''}宣言を足すか、--no-checks "<訳>" を付けて打つ（担当は、自分で付けずに roster ask tpm で聞く）`, sha, diff);
  }
  if (checks !== undefined && options.noChecks !== undefined) {
    return refuse(target, 'この repo には確かめの宣言があるので、--no-checks は受けない（確かめを外す道にしない）', sha, diff);
  }

  const lines: string[] = diff === undefined ? [] : diffLines(diff);
  const configDiff = diff === undefined ? {} : { configDiff: diff.diff };
  const results: CheckResult[] = [];
  if (checks !== undefined) {
    const logDir = join(ctx.state.dir, 'push', `${at.toISOString().replace(/[:.]/g, '-')}-${key ?? 'tpm'}`);
    mkdirSync(logDir, { recursive: true });
    for (const check of checks) {
      const r = runCheck(root, logDir, check, ctx.now);
      results.push(r);
      lines.push(`${r.code === 0 ? '通った' : '落ちた'}: ${r.name}（終了コード ${r.code}・${secs(r.seconds)}）`);
    }
    const failed = results.filter(r => r.code !== 0);
    if (failed.length > 0) {
      for (const r of failed) lines.push('', `--- ${r.name} の出力の終わり（全部は ${r.log}）`, ...tail(r.log));
      // 根で流す確かめ（site:check が docs-site の依存を使う、など）も拾うため、dir の直下の folder も見る（t-fcp8 の result-2）。
      const bare = [...new Set(checks.filter(c => failed.some(f => f.name === c.name)).flatMap(c => bareDeps(root, c.dir ?? '.')))];
      if (bare.length > 0) lines.push('', `注意: ${bare.join('・')} に node_modules が無い（作ったばかりの worktree なら、依存を入れてから打ち直す。入れ方は repo の設定の push の欄の注）`);
      lines.push('', `push していない: 確かめ ${failed.length} つが落ちた（${failed.map(r => r.name).join('・')}）。直して commit し、もう 1 度 roster push`);
      return finish({ repo, target, sha, checks: results.map(({ name, code, seconds }) => ({ name, code, seconds })), code: PUSH_EXIT.failed, result: 'failed', ...configDiff }, lines);
    }
  }

  // 確かめを裏で流す間に、担当が commit を足しうる。確かめた commit と木のままかを、もう 1 度見る。
  if (gitLine(ctx, root, ['rev-parse', 'HEAD']) !== sha || trackedChanges(ctx, root) !== '') {
    return finish({ repo, target, sha, checks: results.map(({ name, code, seconds }) => ({ name, code, seconds })), code: PUSH_EXIT.error, result: 'refused', reason: '確かめの間に HEAD か追われた file が動いた', ...configDiff }, [...lines, '断った: 確かめを流す間に HEAD か追われている file が動いた（確かめた物と push する物が食い違う）。もう 1 度 roster push']);
  }
  const untracked = git(ctx, root, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(f => f !== '');
  if (untracked.length > 0) {
    const names = untracked.slice(0, UNTRACKED_SHOWN).join('・') + (untracked.length > UNTRACKED_SHOWN ? ` ほか ${untracked.length - UNTRACKED_SHOWN} つ` : '');
    lines.push(`注意: git に入っていない file がある（確かめの木には在るが、push する commit には無い。git add の忘れなら CI で落ちる）: ${names}`);
  }
  const args = ['push', ...(options.forceWithLease === true ? [`--force-with-lease=refs/heads/${target}`] : []), 'origin', `${sha}:refs/heads/${target}`];
  const pushed = git(ctx, root, args);
  const record = { repo, target, sha, checks: results.map(({ name, code, seconds }) => ({ name, code, seconds })), ...(options.noChecks === undefined ? {} : { noChecks: options.noChecks }), ...configDiff };
  if (pushed.status !== 0) {
    return finish({ ...record, code: PUSH_EXIT.pushFailed, result: 'push-failed', reason: pushed.stderr.trim().split('\n').pop() ?? '' }, [...lines, `git push が落ちた（確かめは通った）: ${pushed.stderr.trim().split('\n').pop() ?? ''}`, '網の誤り（5xx・繋がらない）なら、roster watch github を裏で起こして待ち、戻ってから打ち直す。remote が先に進んでいる（rejected）なら、取り込んでから打ち直す']);
  }
  // origin/main から切った branch は origin/main を追っているので、push した branch を追うように付け直す。
  if (gitLine(ctx, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) !== `origin/${target}`) git(ctx, root, ['branch', `--set-upstream-to=origin/${target}`, branch]);
  return finish({ ...record, code: PUSH_EXIT.pushed, result: 'pushed' }, [...lines, `push した: ${sha.slice(0, 7)} → origin/${target}${options.noChecks === undefined ? `（確かめ ${results.length} つが通った）` : `（確かめ無し: ${options.noChecks}）`}`]);
}

/** release の tag を push する。tag の commit が origin の既定の branch に在る（main で CI を通った）時だけ。 */
function pushTag(ctx: Context, root: string, main: string, tag: string, refuse: (target: string, reason: string, sha?: string) => PushResult, finish: (record: Omit<PushRecord, 'at' | 'key' | 'role'>, lines: string[]) => PushResult, repo: string): PushResult {
  const target = `tags/${tag}`;
  const sha = gitLine(ctx, root, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]);
  if (sha === undefined) return refuse(target, `tag ${tag} が手元に無い`);
  if (git(ctx, root, ['merge-base', '--is-ancestor', sha, `origin/${main}`]).status !== 0) {
    return refuse(target, `tag ${tag} の commit（${sha.slice(0, 7)}）が origin/${main} に無い。release の tag は、main に merge した commit に打つ`, sha);
  }
  const pushed = git(ctx, root, ['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]);
  if (pushed.status !== 0) {
    return finish({ repo, target, sha, checks: [], code: PUSH_EXIT.pushFailed, result: 'push-failed', reason: pushed.stderr.trim().split('\n').pop() ?? '' }, [`git push が落ちた: ${pushed.stderr.trim()}`, 'GitHub が応えないなら、roster watch github を裏で起こして待ち、戻ってから打ち直す']);
  }
  return finish({ repo, target, sha, checks: [], code: PUSH_EXIT.pushed, result: 'pushed' }, [`push した: tag ${tag}（${sha.slice(0, 7)}）→ origin`]);
}
