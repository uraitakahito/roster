// tpm banner …: Mac のバナー（cmux の通知の desktop）を、居場所の役割 × きっかけで出すか消すか。
// hook は cmux の通知の hook（~/.config/cmux/cmux.json の notifications.hooks）から通知ごとに呼ばれる。
// cmux は hook が失敗・時間切れ・JSON の誤りになると、いつものバナーに加えて「Notification Hook Failed」を出すので、hook はどんな時も正しい JSON を返して 0 で終わる。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { BANNER_ROLES, bannerConfigFile, CATEGORY_TRIGGER, choiceOf, decide, toBannerConfig, TRIGGERS, type BannerConfig } from '../banner.ts';
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
export const HOOK_ID = 'tpm-banner';
/** cmux が hook を待つ秒（既定の 20 は長い。tpm が決めるのは 0.3 秒ほど）。 */
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

/** 設定を読む。無ければ既定。 */
export function readBannerConfig(env: NodeJS.ProcessEnv): BannerConfig {
  const file = bannerConfigFile(env);
  return toBannerConfig(existsSync(file) ? parseJsonc(readFileSync(file, 'utf8')) : undefined);
}

/**
 * cmux の通知 1 件の JSON を読み、cmux に返す JSON の字を返す。替えない時は `{}`（cmux はそのまま出す）。
 * 名簿に無い居場所（tpm の外の Claude Code）と、知らない category は替えない。
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

/** cmux の app に入っている cmux の CLI の folder（PATH に cmux が無い時に使う）。 */
const CMUX_APP_BIN = '/Applications/cmux.app/Contents/Resources/bin';

/** hook の命令の PATH に書く物: 今の Node の folder と、cmux の CLI の folder。 */
export interface HookPaths {
  node: string
  cmux: string
}

/** 今の Node と、PATH で最初に見つかる cmux の folder（無ければ cmux の app の中）。 */
export function currentPaths(env: NodeJS.ProcessEnv = process.env): HookPaths {
  const cmux = (env.PATH ?? '').split(':').find(d => d !== '' && existsSync(join(d, 'cmux'))) ?? CMUX_APP_BIN;
  return { node: dirname(process.execPath), cmux };
}

/**
 * cmux.json に足す hook の命令。cmux の app から動くので shell の PATH を受け継がない（node も cmux も見つからない）。
 * そのため、今の Node と cmux の folder を PATH の頭に書く。
 */
export function hookCommand(root: string, paths: HookPaths): string {
  const path = [...new Set([paths.node, paths.cmux])].map(shellQuote).join(':');
  return `PATH=${path}:/usr/bin:/bin ${shellQuote(join(root, 'cli', 'bin', 'tpm'))} banner hook`;
}

/** cmux.json の hook の欄 1 つ。 */
export function hookEntry(root: string, paths: HookPaths): { id: string, command: string, timeoutSeconds: number } {
  return { id: HOOK_ID, command: hookCommand(root, paths), timeoutSeconds: HOOK_TIMEOUT_SECONDS };
}

/** cmux の設定の file。 */
export const cmuxConfigFile = (): string => join(homedir(), '.config', 'cmux', 'cmux.json');

/** cmux.json に tpm の hook があるか。読めなければ undefined。 */
export function findHook(file: string = cmuxConfigFile()): { command: string, enabled: boolean } | undefined {
  if (!existsSync(file)) return undefined;
  const config = parseJsonc(readFileSync(file, 'utf8')) as { notifications?: { hooks?: { id?: string, command?: string, enabled?: boolean }[] } };
  const hook = config.notifications?.hooks?.find(h => h.id === HOOK_ID || h.command?.includes('banner hook'));
  return hook?.command === undefined ? undefined : { command: hook.command, enabled: hook.enabled !== false };
}

/** `tpm banner setup`: cmux.json に足す字と手順を出す（cmux.json は利用者の設定なので、tpm は書き替えない）。 */
export function bannerSetup(root: string, env: NodeJS.ProcessEnv): string[] {
  const entry = JSON.stringify(hookEntry(root, currentPaths(env)));
  return [
    `${cmuxConfigFile()} の "notifications" の "hooks" に、次の 1 行を足してください（"notifications" が無ければ、下の形で足す）。`,
    '',
    '  "notifications": {',
    '    "hooks": [',
    `      ${entry}`,
    '    ]',
    '  }',
    '',
    `何を出すかは ${bannerConfigFile(env)} で選ぶ（無ければ既定: TPM 担当が Product Manager を待つ回と、どこでも許可/質問だけ出す。消す時は音も消す）。`,
    '足した後に tpm banner check で確かめる。Node を上げたら、これを打ち直して命令を替える（PATH に今の Node と cmux の folder を書いているため）。',
  ];
}

/** `tpm banner check`: 設定と cmux.json の hook を確かめる。ok が false なら直す物がある。 */
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
  let hook: ReturnType<typeof findHook>;
  try {
    hook = findHook(cmuxFile);
  }
  catch (e) {
    ok = false;
    lines.push(`cmux.json を読めません: ${cmuxFile}: ${(e as Error).message}`);
    return { ok, lines };
  }
  const want = hookCommand(root, currentPaths(env));
  if (hook === undefined) {
    ok = false;
    lines.push(`cmux.json に hook がありません（tpm banner setup の字を ${cmuxFile} に足す）`);
  }
  else if (!hook.enabled) {
    ok = false;
    lines.push('cmux.json の hook が enabled: false です');
  }
  else if (hook.command !== want) {
    ok = false;
    lines.push(`cmux.json の hook の命令が今の tpm・Node・cmux と違います（Node を上げた・repo を移した）。tpm banner setup の字に替える: ${hook.command}`);
  }
  else {
    lines.push(`cmux.json の hook: あり（${cmuxFile}）`);
  }
  return { ok, lines };
}

/** `tpm banner log`: この project の hook の記録を新しい順に出す。 */
export function bannerLog(ctx: Context, limit: number): string[] {
  const all = ctx.state.lines<BannerLog>('banner.jsonl');
  if (all.length === 0) return ['記録なし（hook がまだ動いていないか、この project の居場所の通知が無い）'];
  return all.slice(-limit).reverse().map(l => `${l.at}  ${l.workspace}  ${l.role}  ${l.category}  ${l.show ? '出す' : '消す'}  ${l.reason}`);
}
