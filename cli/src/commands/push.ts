// roster push: repo に宣言した確かめ（push の前に流す物）をみな流し、みな通った時だけ、確かめた commit を push する（t-fcp8。監査 audit-2 の R15）。
// 確かめの一覧は、push する branch でなく origin の既定の branch の .claude/roles/config.jsonc の push の欄から読む（branch の中で一覧を減らしても、merge まで効かない）。
// path では選ばず、宣言した確かめを毎回みな流す（4 repo の主な CI は、どれも pull_request に paths が無い）。
// 確かめは shell を通さずに語の並びで打つ（; や pipe で終了コードが隠れる形を、設定の中にも作らない）。
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
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
}

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
    return check;
  });
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

/** origin の既定の branch の名（origin/HEAD が無ければ main）。 */
function defaultBranch(ctx: Context, root: string): string {
  const head = gitLine(ctx, root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  return head?.replace(/^refs\/remotes\/origin\//, '') || 'main';
}

/** 追われている file の、commit していない変更（無ければ空）。 */
function trackedChanges(ctx: Context, root: string): string {
  return git(ctx, root, ['status', '--porcelain', '--untracked-files=no']).stdout.trim();
}

/** 秒の字。 */
const secs = (s: number): string => `${s} 秒`;

/** 確かめを 1 つ流す。出力は log の file に書く。 */
function runCheck(root: string, logDir: string, check: PushCheck, now: () => Date): CheckResult {
  const log = join(logDir, `${check.name}.log`);
  const fd = openSync(log, 'w');
  const start = now().getTime();
  try {
    const r = spawnSync(check.run[0] as string, check.run.slice(1), {
      cwd: join(root, check.dir ?? '.'),
      env: { ...process.env, ...check.env },
      stdio: ['ignore', fd, fd],
    });
    if (r.error !== undefined) appendFileSync(log, `起こせなかった: ${r.error.message}\n`);
    const code = r.error === undefined ? (r.status ?? 1) : 127;
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
  const refuse = (target: string, reason: string, sha?: string): PushResult =>
    finish({ repo, target, ...(sha === undefined ? {} : { sha }), checks: [], code: PUSH_EXIT.error, result: 'refused', reason }, [`断った: ${reason}`]);
  const main = defaultBranch(ctx, root);
  const fetched = git(ctx, root, ['fetch', '--quiet', 'origin', main]);
  if (fetched.status !== 0) {
    return finish({ repo, target: options.tag === undefined ? '' : `tags/${options.tag}`, checks: [], code: PUSH_EXIT.pushFailed, result: 'push-failed', reason: 'fetch が落ちた' }, [`git fetch origin ${main} が落ちた（push していない）: ${fetched.stderr.trim()}`, 'GitHub が応えないなら、roster watch github を裏で起こして待ち、戻ってから打ち直す']);
  }

  if (options.tag !== undefined) return pushTag(ctx, root, main, options.tag, refuse, finish, repo);

  const branch = gitLine(ctx, root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch === undefined) return refuse('', 'HEAD が branch でない（detached）。branch を作ってから打つ');
  const upstream = gitLine(ctx, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const target = upstream?.startsWith('origin/') === true ? upstream.slice('origin/'.length) : branch;
  if (target === main) return refuse(target, `既定の branch（${main}）へは push しない。main から branch を切り、PR で入れる`);
  if (trackedChanges(ctx, root) !== '') return refuse(target, '追われている file に commit していない変更がある。commit してから打つ（確かめた木と push する commit を合わせるため）');
  const sha = gitLine(ctx, root, ['rev-parse', 'HEAD']) as string;

  const shown = git(ctx, root, ['show', `origin/${main}:.claude/roles/config.jsonc`]);
  let checks: PushCheck[] | undefined;
  try {
    checks = shown.status === 0 ? parsePushChecks(shown.stdout, `origin/${main} の .claude/roles/config.jsonc`) : undefined;
  }
  catch (e) {
    return refuse(target, (e as Error).message, sha);
  }
  if (checks === undefined && options.noChecks === undefined) {
    return refuse(target, `この repo（${repo}）の origin/${main} の設定に、push の前に流す確かめ（push の欄）が無い。宣言を足すか、--no-checks "<訳>" を付けて打つ（担当は、自分で付けずに roster ask tpm で聞く）`, sha);
  }
  if (checks !== undefined && options.noChecks !== undefined) {
    return refuse(target, 'この repo には確かめの宣言があるので、--no-checks は受けない（確かめを外す道にしない）', sha);
  }

  const lines: string[] = [];
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
      lines.push('', `push していない: 確かめ ${failed.length} つが落ちた（${failed.map(r => r.name).join('・')}）。直して commit し、もう 1 度 roster push`);
      return finish({ repo, target, sha, checks: results.map(({ name, code, seconds }) => ({ name, code, seconds })), code: PUSH_EXIT.failed, result: 'failed' }, lines);
    }
  }

  // 確かめを裏で流す間に、担当が commit を足しうる。確かめた commit と木のままかを、もう 1 度見る。
  if (gitLine(ctx, root, ['rev-parse', 'HEAD']) !== sha || trackedChanges(ctx, root) !== '') {
    return finish({ repo, target, sha, checks: results.map(({ name, code, seconds }) => ({ name, code, seconds })), code: PUSH_EXIT.error, result: 'refused', reason: '確かめの間に HEAD か追われた file が動いた' }, [...lines, '断った: 確かめを流す間に HEAD か追われている file が動いた（確かめた物と push する物が食い違う）。もう 1 度 roster push']);
  }
  const untracked = git(ctx, root, ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(f => f !== '');
  if (untracked.length > 0) {
    const names = untracked.slice(0, UNTRACKED_SHOWN).join('・') + (untracked.length > UNTRACKED_SHOWN ? ` ほか ${untracked.length - UNTRACKED_SHOWN} つ` : '');
    lines.push(`注意: git に入っていない file がある（確かめの木には在るが、push する commit には無い。git add の忘れなら CI で落ちる）: ${names}`);
  }
  const args = ['push', ...(options.forceWithLease === true ? [`--force-with-lease=refs/heads/${target}`] : []), 'origin', `${sha}:refs/heads/${target}`];
  const pushed = git(ctx, root, args);
  const record = { repo, target, sha, checks: results.map(({ name, code, seconds }) => ({ name, code, seconds })), ...(options.noChecks === undefined ? {} : { noChecks: options.noChecks }) };
  if (pushed.status !== 0) {
    return finish({ ...record, code: PUSH_EXIT.pushFailed, result: 'push-failed', reason: pushed.stderr.trim().split('\n').pop() ?? '' }, [...lines, `git push が落ちた（確かめは通った）: ${pushed.stderr.trim()}`, 'GitHub が応えない（5xx・繋がらない）なら、roster watch github を裏で起こして待ち、戻ってから打ち直す']);
  }
  if (upstream === undefined) git(ctx, root, ['branch', `--set-upstream-to=origin/${target}`, branch]);
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
