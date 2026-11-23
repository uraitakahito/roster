// roster banner …: 通知のバナー（cmux の通知の desktop）を、居場所の役割 × きっかけで出すか消すか。
// hook は cmux の通知の hook（~/.config/cmux/cmux.json の notifications.hooks）から通知ごとに呼ばれる。
// cmux は hook が失敗・時間切れ・JSON の誤りになると、いつものバナーに加えて「Notification Hook Failed」を出すので、hook はどんな時も正しい JSON を返して 0 で終わる。
// cmux.json の命令は、roster の入口が無い機械（dotfiles で同じ cmux.json を配った機械）では、入口を呼ばずに `{}` を返して 0 で終わる。
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { BANNER_ROLES, bannerConfigFile, CATEGORY_TRIGGER, choiceOf, decide, oldBannerConfigFile, toBannerConfig, TRIGGERS, type BannerConfig } from '../banner.ts';
import type { Context } from '../context.ts';
import type { Exec } from '../exec.ts';
import { parseJsonc } from '../jsonc.ts';
import { TPM_TITLE } from '../protocol.ts';
import type { RoleRecord, TpmRecord } from '../roster.ts';
import { shellQuote } from '../shell.ts';
import { projectStateDirs, State } from '../state.ts';
import { CmuxTransport } from '../transport/cmux.ts';
import { waitFile, type WaitRecord } from './messages.ts';

/** hook の記録を残す日数。 */
const LOG_DAYS = 7;
/** cmux.json の hook の id。 */
export const HOOK_ID = 'roster-banner';
/** 前の hook の id（t-6ydg で替えた）。cmux.json に残っていれば roster banner check が知らせる。 */
export const LEGACY_HOOK_ID = 'tpm-banner';
/** cmux が hook を待つ秒（既定の 20 は長い。roster が決めるのは 0.3 秒ほど）。 */
const HOOK_TIMEOUT_SECONDS = 5;

/** cmux が hook の標準入力に渡す JSON のうち、使う所。 */
interface HookInput {
  notification?: { workspaceId?: string }
  agent?: { category?: string }
}

/** hook が書く記録 1 行（project の状態の folder の banner.jsonl）。 */
export interface BannerLog {
  at: string
  workspace: string
  role: string
  category: string
  show: boolean
  reason: string
}

/** 居場所の前の「答え終わった」の記録。 */
interface LastTurn {
  at: string
}

const lastTurnFile = (address: string): string => `banner/last-turn/${address.replaceAll(/[^A-Za-z0-9._-]/g, '-')}.jsonc`;

/** 宛先と題が名簿と合う居場所を、すべての project の状態から探す。題も見るのは、名簿に残った古い宛先を取り違えないため。 */
function findSeat(env: NodeJS.ProcessEnv, address: string, title: string): { state: State, role: string } | undefined {
  for (const dir of projectStateDirs(env)) {
    const state = new State(dir);
    if (state.read<TpmRecord>('tpm.jsonc')?.address === address && title === TPM_TITLE) return { state, role: 'tpm' };
    for (const name of state.list('roles')) {
      const r = state.read<RoleRecord>(`roles/${name}.jsonc`);
      if (r?.address === address && r.title === title) return { state, role: r.role };
    }
  }
  return undefined;
}

/** 記録を 1 行足し、LOG_DAYS より古い行を消す。 */
function appendLog(state: State, entry: BannerLog, now: Date): void {
  state.append('banner.jsonl', entry);
  const file = join(state.dir, 'banner.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(l => l !== '');
  const since = now.getTime() - LOG_DAYS * 24 * 60 * 60 * 1000;
  const first = lines[0] === undefined ? undefined : (JSON.parse(lines[0]) as BannerLog).at;
  if (first === undefined || Date.parse(first) >= since) return;
  writeFileSync(file, lines.filter(l => Date.parse((JSON.parse(l) as BannerLog).at) >= since).map(l => `${l}\n`).join(''));
}

/** 古い在り処に設定の file があれば、移す手を書いた 1 行。無ければ undefined。古い在り処は読まない。 */
export function oldBannerConfigNotice(env: NodeJS.ProcessEnv): string | undefined {
  const old = oldBannerConfigFile(env);
  if (!existsSync(old)) return undefined;
  const file = bannerConfigFile(env);
  return existsSync(file)
    ? `古い在り処の設定は読みません（${file} を読む）。古い方は消してよい: rm ${shellQuote(old)}`
    : `設定が古い在り処にあり、読みません（既定で動く）。移す: mkdir -p ${shellQuote(dirname(file))} && mv ${shellQuote(old)} ${shellQuote(file)}`;
}

/** 設定を読む。無ければ既定。 */
export function readBannerConfig(env: NodeJS.ProcessEnv): BannerConfig {
  const file = bannerConfigFile(env);
  return toBannerConfig(existsSync(file) ? parseJsonc(readFileSync(file, 'utf8')) : undefined);
}

/**
 * cmux の通知 1 件の JSON を読み、cmux に返す JSON の字を返す。替えない時は `{}`（cmux はそのまま出す）。
 * 名簿に無い居場所（roster の外の Claude Code）と、知らない category は替えない。
 */
export function bannerHook(input: string, deps: { env: NodeJS.ProcessEnv, exec: Exec, now: Date }): string {
  const unchanged = '{}';
  const hook = JSON.parse(input) as HookInput;
  const category = hook.agent?.category ?? '';
  const trigger = CATEGORY_TRIGGER[category];
  const id = hook.notification?.workspaceId;
  if (trigger === undefined || id === undefined) return unchanged;
  const seat = new CmuxTransport(deps.exec).seatsById().get(id);
  if (seat === undefined) return unchanged;
  const found = findSeat(deps.env, seat.address, seat.title);
  if (found === undefined) return unchanged;
  const { state, role } = found;
  const at = deps.now.toISOString();
  let config: BannerConfig;
  try {
    config = readBannerConfig(deps.env);
  }
  catch (e) {
    appendLog(state, { at, workspace: seat.address, role, category, show: true, reason: `設定を読めないので出す: ${(e as Error).message}` }, deps.now);
    return unchanged;
  }
  const lastWait = state.read<WaitRecord>(waitFile(seat.address));
  const lastTurn = state.read<LastTurn>(lastTurnFile(seat.address))?.at;
  const decision = decide(config, { role, trigger, ...(lastWait === undefined ? {} : { lastWait }), ...(lastTurn === undefined ? {} : { lastTurn }) });
  if (trigger === 'turn') state.write(lastTurnFile(seat.address), { at } satisfies LastTurn);
  appendLog(state, { at, workspace: seat.address, role, category, show: decision.show, reason: decision.reason }, deps.now);
  if (decision.show) return unchanged;
  const effects: Record<string, boolean> = { desktop: false };
  for (const w of config.withBanner) effects[w] = false;
  return JSON.stringify({ effects });
}

/** 本当の在り処。無ければ undefined。 */
function realpathOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  }
  catch {
    return undefined;
  }
}

/**
 * hook の命令に書く入口（cli/bin/roster）の字。~/.local/bin/roster がこの repo を指していればそれ、home の下なら "$HOME/…"、ほかは絶対 path で書く。
 * "$HOME/…" は二重引用符の中で $HOME だけを展開させるので、残りの path が二重引用符の中で意味を持つ字を含む時は絶対 path にする。
 */
function hookEntryPath(root: string, env: NodeJS.ProcessEnv): string {
  const entry = join(root, 'cli', 'bin', 'roster');
  const home = env.HOME === undefined || env.HOME === '' ? undefined : realpathOrUndefined(env.HOME);
  if (home !== undefined) {
    const real = realpathOrUndefined(entry) ?? entry;
    if (realpathOrUndefined(join(home, '.local', 'bin', 'roster')) === real) return '"$HOME/.local/bin/roster"';
    const rest = relative(home, entry);
    if (rest !== '' && !rest.startsWith('..') && !isAbsolute(rest) && /^[A-Za-z0-9._/-]+$/.test(rest)) return `"$HOME/${rest}"`;
  }
  return shellQuote(entry);
}

/**
 * cmux.json に足す hook の命令。hook は cmux の app から PATH が既定だけで動くが、node と cmux は入口（cli/bin/roster）が自分で見つけるので、
 * 命令は入口を呼ぶだけにして Node・cmux の path を書かない（Node を上げても替えなくてよい）。
 * 入口が無ければ（roster を入れていない機械）`{}`（何も替えない）を返して 0 で終わる。入口が有って落ちる時は、exec の後なので失敗が cmux に見える。
 */
export function hookCommand(root: string, env: NodeJS.ProcessEnv): string {
  const entry = hookEntryPath(root, env);
  return `[ -x ${entry} ] || { echo '{}'; exit 0; }; exec ${entry} banner hook`;
}

/** cmux.json の hook の欄 1 つ。 */
export function hookEntry(root: string, env: NodeJS.ProcessEnv): { id: string, command: string, timeoutSeconds: number } {
  return { id: HOOK_ID, command: hookCommand(root, env), timeoutSeconds: HOOK_TIMEOUT_SECONDS };
}

/** cmux.json の hook の命令が、今 roster banner setup が出す字と違う訳。同じなら undefined。 */
export function staleHook(command: string, root: string, env: NodeJS.ProcessEnv): string | undefined {
  if (command === hookCommand(root, env)) return undefined;
  if (command.startsWith('PATH=')) return '古い形です（Node と cmux の path を書いた形）';
  if (command === `${hookEntryPath(root, env)} banner hook`) return '古い形です（roster の無い機械で通知のたびに失敗する形）';
  return '今の roster の在り処と違います（repo を移した）';
}

/** cmux の設定の file。 */
export const cmuxConfigFile = (): string => join(homedir(), '.config', 'cmux', 'cmux.json');

/** cmux.json に roster の hook があるか。読めなければ undefined。 */
export function findHook(file: string = cmuxConfigFile()): { id: string | undefined, command: string, enabled: boolean } | undefined {
  if (!existsSync(file)) return undefined;
  const config = parseJsonc(readFileSync(file, 'utf8')) as { notifications?: { hooks?: { id?: string, command?: string, enabled?: boolean }[] } };
  const hook = config.notifications?.hooks?.find(h => h.id === HOOK_ID || h.command?.includes('banner hook'));
  return hook?.command === undefined ? undefined : { id: hook.id, command: hook.command, enabled: hook.enabled !== false };
}

/** `roster banner setup`: cmux.json に足す字と手順を出す（cmux.json は利用者の設定なので、roster は書き替えない）。 */
export function bannerSetup(root: string, env: NodeJS.ProcessEnv): string[] {
  const entry = JSON.stringify(hookEntry(root, env));
  return [
    `${cmuxConfigFile()} の "notifications" の "hooks" に、次の 1 行を足してください（"notifications" が無ければ、下の形で足す）。`,
    '',
    '  "notifications": {',
    '    "hooks": [',
    `      ${entry}`,
    '    ]',
    '  }',
    '',
    `何を出すかは ${bannerConfigFile(env)} で選ぶ（無ければ既定: TPM 担当と Auditor が Product Manager を待つ回と、どこでも許可/質問だけ出す。消す時は音も消す）。`,
    '足した後に cmux の設定を読み直し（Cmd+Shift+, か cmux reload-config）、roster banner check で確かめる。node と cmux は入口（cli/bin/roster）が自分で見つけるので、Node を上げても命令は替えなくてよい。roster を入れていない機械では、命令は何もしない（同じ cmux.json を配ってよい）。repo を移したら、これを打ち直して命令を替える。',
  ];
}

/** `roster banner check`: 設定と cmux.json の hook を確かめる。ok が false なら直す物がある。 */
export function bannerCheck(root: string, env: NodeJS.ProcessEnv, cmuxFile: string = cmuxConfigFile()): { ok: boolean, lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const file = bannerConfigFile(env);
  try {
    const config = readBannerConfig(env);
    lines.push(`設定: ${file}${existsSync(file) ? '' : '（無いので既定）'}`);
    for (const role of BANNER_ROLES.filter(r => r === '*' || r === 'tpm' || config.banner[r] !== undefined)) {
      lines.push(`  ${role}: ${TRIGGERS.map(t => `${t}=${choiceOf(config, role, t)}`).join(' ')}`);
    }
    lines.push(`  バナーを消す時に一緒に消す物: ${config.withBanner.join('・') || 'なし'}`);
  }
  catch (e) {
    ok = false;
    lines.push(`設定を読めません（hook は読めない間、バナーを消さない）: ${file}: ${(e as Error).message}`);
  }
  const old = oldBannerConfigNotice(env);
  if (old !== undefined) {
    ok = false;
    lines.push(old);
  }
  let hook: ReturnType<typeof findHook>;
  try {
    hook = findHook(cmuxFile);
  }
  catch (e) {
    ok = false;
    lines.push(`cmux.json を読めません: ${cmuxFile}: ${(e as Error).message}`);
    return { ok, lines };
  }
  const stale = hook === undefined ? undefined : staleHook(hook.command, root, env);
  if (hook === undefined) {
    ok = false;
    lines.push(`cmux.json に hook がありません（roster banner setup の字を ${cmuxFile} に足す）`);
  }
  else if (!hook.enabled) {
    ok = false;
    lines.push('cmux.json の hook が enabled: false です');
  }
  else if (stale !== undefined) {
    ok = false;
    lines.push(`cmux.json の hook の命令が${stale}。roster banner setup の字に替える: ${hook.command}`);
  }
  else {
    lines.push(`cmux.json の hook: あり（${cmuxFile}）`);
    // id は cmux が見分けに使うだけで、roster は命令でも hook を見つけるので、ok は落とさない。
    if (hook.id === LEGACY_HOOK_ID) lines.push(`cmux.json の hook の id が前の名（${LEGACY_HOOK_ID}）です。${HOOK_ID} に替えてください（動きは変わらない）`);
  }
  return { ok, lines };
}

/** `roster banner log`: この project の hook の記録を新しい順に出す。 */
export function bannerLog(ctx: Context, limit: number): string[] {
  const all = ctx.state.lines<BannerLog>('banner.jsonl');
  if (all.length === 0) return ['記録なし（hook がまだ動いていないか、この project の居場所の通知が無い）'];
  return all.slice(-limit).reverse().map(l => `${l.at}  ${l.workspace}  ${l.role}  ${l.category}  ${l.show ? '出す' : '消す'}  ${l.reason}`);
}
