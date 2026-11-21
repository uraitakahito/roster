// 起こす folder の .claude/roles/config.jsonc から、層 1 の道具の選び方（課題管理・連携・インフラ）と、担当ごとの model などの既定を読む。
// 起こす folder の直下の folder にも設定があれば、集めて 1 つに合わせる（composeRolesConfig。上の folder から、下のいくつもの repo を触る課題のため）。
// skill-sets の欄は skill-sets.ts が読む。旗・既定と合わせて決めるのは担当を起こす所（commands/tpm-side.ts）。
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RoleName, RoleSettings } from './protocol.ts';
import { shellQuote } from './shell.ts';
import { readConfig, readSkillSets, TpmError } from './skill-sets.ts';

/** 課題管理の道具。none は「記録を書かない」。 */
export const TRACKERS = ['jira', 'github', 'none'] as const;
/** 課題管理の道具の名前。 */
export type Tracker = typeof TRACKERS[number];

/** 担当どうしの連携の道具。file は試験用（ファイルにメッセージを書くだけ）。 */
export const TRANSPORTS = ['cmux', 'file'] as const;
/** 連携の道具の名前。 */
export type Transport = typeof TRANSPORTS[number];

/**
 * 環境の手続き（変える前に要ること）。触ると誰が困るかで決める。
 * free: 自分だけ（どの担当も断りなく）／tpm: 並べて動く担当（DevOps Engineer 担当だけ・TPM に相談）／
 * pm: ほかの人（DevOps Engineer 担当だけ・Product Manager の承認が要る）。
 */
export const GUARDS = ['free', 'tpm', 'pm'] as const;
/** 環境の手続きの名前。 */
export type Guard = typeof GUARDS[number];

/** インフラの環境 1 つ。match のどれかを含む命令が、この環境に触る命令。 */
export interface InfraEnv {
  guard: Guard
  match: string[]
  /** 宣言した設定の呼び名（合わせた設定でだけ付く。sourceLabel の字）。 */
  from?: string[]
}

/** 設定の file 1 つ（`.claude/roles/` の config）を読んだ物。書かない欄は既定で埋める。 */
export interface FileConfig {
  tracker: Tracker
  transport: Transport
  infra: Record<string, InfraEnv>
  /** 起こす担当ごとの model・effort・permissionMode（書いた欄だけ。無い欄は既定）。 */
  roles: Partial<Record<RoleName, Partial<RoleSettings>>>
}

/** 集めた設定の file 1 つ。 */
export interface ConfigSource {
  /** project の folder からの path。project の folder 自身は ''。 */
  name: string
  /** 設定の file がある folder（`<dir>/.claude/roles/config.jsonc`）。 */
  dir: string
  file: string
  /** file が在ったか（無いのは project の folder 自身だけ）。 */
  exists: boolean
  /** file に書いてあった欄の名前。 */
  written: string[]
  config: FileConfig
}

/** 記録を書く課題管理の道具（none は書かないので入らない）。 */
export type RecordingTracker = Exclude<Tracker, 'none'>;

/**
 * project の folder とその直下の folder の設定を合わせた物。TPM 担当も、起こした担当も、guard もこれを使う。
 * 課題管理は道具ごとに宣言した設定を持ち（記録の先は課題の Key の形で選ぶ。tracker/routed.ts）、infra は環境の名前ごとに合わせ、
 * 連携と担当の既定は project の folder の設定だけを使う。
 */
export interface RolesConfig {
  transport: Transport
  /** 道具ごとの、宣言した設定（集めた順）。 */
  trackers: Record<RecordingTracker, ConfigSource[]>
  infra: Record<string, InfraEnv>
  /** 起こす担当ごとの model・effort・permissionMode（project の folder の設定に書いた欄だけ）。 */
  roles: Partial<Record<RoleName, Partial<RoleSettings>>>
  /** 集めた設定（project の folder 自身が先頭、次に直下の folder を名前の順）。 */
  sources: ConfigSource[]
}

/** config.jsonc で既定を替えられる担当。 */
const CONFIGURABLE_ROLES = ['software-engineer', 'devops-engineer'] as const;
const ROLE_FIELDS = ['model', 'effort', 'permissionMode'] as const;

const ENV_NAME = /^[a-z0-9-]+$/;

/**
 * project の設定のファイル（<project>/.claude/roles/config.jsonc）。在るかは見ない。
 * 古い名前の config.json があれば、読まずに止める（両方は読まない）。config.jsonc が無ければ名前を替える mv を、両方あれば config.json を消すよう言う。
 */
export function rolesConfigFile(project: string): string {
  const dir = join(project, '.claude', 'roles');
  const legacy = join(dir, 'config.json');
  const file = join(dir, 'config.jsonc');
  if (existsSync(legacy)) {
    // 両方あるときに mv を出すと、写して打った人の config.jsonc を上書きしてしまう。
    if (existsSync(file)) throw new TpmError(`${legacy} と config.jsonc が両方あります。config.json を消してください（要る中身は先に config.jsonc へ移す）`);
    throw new TpmError(`${legacy} は読みません。config.jsonc に名前を替えてください（中身はそのままで読めます）: mv ${shellQuote(legacy)} ${shellQuote(file)}`);
  }
  return file;
}

/** config.jsonc の中身（欄の名前 → 値）。ファイルが無い・object でなければ空。 */
function rawConfig(configFile: string): Record<string, unknown> {
  const raw = readConfig(configFile);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

/** config.jsonc を読む。ファイルや欄が無ければ既定（課題管理なし・cmux・環境の宣言なし）。誤りなら TpmError。 */
export function readRolesConfig(configFile: string): FileConfig {
  return fileConfig(rawConfig(configFile), configFile);
}

function fileConfig(config: Record<string, unknown>, configFile: string): FileConfig {
  return {
    tracker: oneOf(config.tracker, TRACKERS, 'none', 'tracker', configFile),
    transport: oneOf(config.transport, TRANSPORTS, 'cmux', 'transport', configFile),
    infra: infraField(config.infra, configFile),
    roles: rolesField(config, configFile),
  };
}

function rolesField(config: Record<string, unknown>, configFile: string): RolesConfig['roles'] {
  const roles: RolesConfig['roles'] = {};
  for (const role of CONFIGURABLE_ROLES) {
    const value = config[role];
    if (value === undefined) continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TpmError(`${configFile} の ${role} は { "model": …, "effort": …, "permissionMode": … } の形にしてください`);
    const settings: Partial<RoleSettings> = {};
    for (const field of ROLE_FIELDS) {
      const v = (value as Record<string, unknown>)[field];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v === '') throw new TpmError(`${configFile} の ${role}.${field} は空でない文字列にしてください`);
      settings[field] = v;
    }
    roles[role] = settings;
  }
  return roles;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], fallback: T, field: string, configFile: string): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (choices as readonly string[]).includes(value)) return value as T;
  throw new TpmError(`${configFile} の ${field} は ${choices.join('・')} のどれかにしてください`);
}

function infraField(value: unknown, configFile: string): Record<string, InfraEnv> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TpmError(`${configFile} の infra は { "<環境の名前>": { "guard": …, "match": […] } } の形にしてください`);
  }
  const infra: Record<string, InfraEnv> = {};
  for (const [name, env] of Object.entries(value as Record<string, unknown>)) {
    if (!ENV_NAME.test(name)) throw new TpmError(`${configFile} の infra の環境の名前は英小文字・数字・- にしてください: ${name}`);
    const e: Record<string, unknown> = typeof env === 'object' && env !== null ? env as Record<string, unknown> : {};
    const match = e.match;
    if (!Array.isArray(match) || match.length === 0 || !match.every(m => typeof m === 'string' && m.trim() !== '')) {
      throw new TpmError(`${configFile} の infra.${name}.match は、空でない文字列の配列にしてください`);
    }
    if (e.guard === undefined) throw new TpmError(`${configFile} の infra.${name}.guard がありません（${GUARDS.join('・')}）`);
    infra[name] = { guard: oneOf(e.guard, GUARDS, 'free', `infra.${name}.guard`, configFile), match: match as string[] };
  }
  return infra;
}

/** project の folder 自身の設定の呼び名。 */
export const OWN_LABEL = 'この folder';
/** 設定の呼び名（出力に書く字）。project の folder 自身は「この folder」、直下の folder はその path。 */
export const sourceLabel = (source: Pick<ConfigSource, 'name'>): string => source.name === '' ? OWN_LABEL : source.name;

/** 直下の folder を探すときに見ない名前。 */
const SKIP_FOLDERS = new Set(['node_modules']);

/**
 * project の folder の設定に書いた folders（集める folder を、project の folder からの path で名指す）。欄が無ければ undefined（直下を探す）。
 * 重なりと project の folder 自身は除く。
 */
function foldersField(value: unknown, configFile: string, project: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(f => typeof f === 'string' && f.trim() !== '')) {
    throw new TpmError(`${configFile} の folders は、集める folder（この folder からの path）の配列にしてください`);
  }
  return [...new Set(value as string[])].filter(f => resolve(project, f) !== project);
}

/** project の直下の folder のうち、設定（古い名前の config.json を含む）がある物を名前の順に返す。`.` で始まる物と node_modules は見ない。 */
function foldersWithConfig(project: string): string[] {
  return readdirSync(project, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_FOLDERS.has(e.name))
    .map(e => e.name)
    .filter(name => ['config.jsonc', 'config.json'].some(f => existsSync(join(project, name, '.claude', 'roles', f))))
    .sort();
}

/**
 * 集める設定を読む: project の folder 自身と、その直下の folder のうち設定がある物（1 段だけ）。
 * project の folder の設定に folders があれば、探さずに書いた folder だけを集める（設定の無い folder を書いたら誤り）。
 * 直下の folder の設定に書いた folders は読まない。
 */
export function readConfigSources(project: string): ConfigSource[] {
  const source = (name: string): ConfigSource => {
    const dir = resolve(project, name);
    const file = rolesConfigFile(dir);
    const raw = rawConfig(file);
    return { name, dir, file, exists: existsSync(file), written: Object.keys(raw), config: fileConfig(raw, file) };
  };
  const own = source('');
  const named = foldersField(rawConfig(own.file).folders, own.file, project);
  const folders = (named ?? foldersWithConfig(project)).map(source);
  const missing = folders.find(s => !s.exists);
  if (missing !== undefined) throw new TpmError(`${own.file} の folders に書いた ${missing.name} に、設定がありません: ${missing.file}`);
  return [own, ...folders];
}

/** 手続きの厳しさ（後ろほど厳しい）。同じ名前の環境がいくつもの設定にあれば、厳しい方にする。 */
const strictest = (a: Guard, b: Guard): Guard => GUARDS.indexOf(a) >= GUARDS.indexOf(b) ? a : b;

/**
 * project の folder とその直下の folder の設定を合わせる。
 * 課題管理: 道具ごとに、宣言した設定を覚える（none は足さない）。infra: 環境の名前ごとに合わせ、同じ名前は match を足して厳しい方の手続きにする。
 * 連携・担当の既定: project の folder の設定だけ（直下の folder の値は読まない）。
 */
export function composeRolesConfig(project: string): RolesConfig {
  const sources = readConfigSources(project);
  const [own] = sources;
  if (own === undefined) throw new TpmError(`設定を読めません: ${project}`);
  const infra: Record<string, InfraEnv> = {};
  for (const s of sources) {
    for (const [name, env] of Object.entries(s.config.infra)) {
      const had = infra[name];
      infra[name] = had === undefined
        ? { ...env, from: [sourceLabel(s)] }
        : { guard: strictest(had.guard, env.guard), match: [...new Set([...had.match, ...env.match])], from: [...had.from ?? [], sourceLabel(s)] };
    }
  }
  const declared = (tool: RecordingTracker): ConfigSource[] => sources.filter(s => s.config.tracker === tool);
  return { transport: own.config.transport, trackers: { jira: declared('jira'), github: declared('github') }, infra, roles: own.config.roles, sources };
}

/** 読んだ設定と、それぞれの課題管理を 1 行に並べる（「この folder＝無い・skills＝jira」）。止まるときの文に添える。 */
export function describeTrackers(sources: ConfigSource[]): string {
  return sources.map(s => `${sourceLabel(s)}＝${s.exists ? s.config.tracker : '無い'}`).join('・');
}

/** 集めた設定の skill-sets を足す（集めた順。重なりは除く）。 */
export function composeSkillSets(sources: ConfigSource[], root: string): string[] {
  return [...new Set(sources.flatMap(s => readSkillSets(s.file, root)))];
}

/** 環境の呼び名: project の folder 自身の宣言だけなら名前、直下の folder の宣言があれば「名前（skills の設定）」。 */
export function envLabel(name: string, env: InfraEnv): string {
  const from = env.from ?? [];
  return from.some(f => f !== OWN_LABEL) ? `${name}（${from.join('・')} の設定）` : name;
}
