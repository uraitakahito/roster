// 起こす folder の .claude/roles/config.jsonc から、層 1 の道具の選び方（課題管理・連携・インフラ）と、担当ごとの model などの既定を読む。
// skill-sets の欄は skill-sets.ts が読む。旗・既定と合わせて決めるのは担当を起こす所（commands/tpm-side.ts）。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RoleName, RoleSettings } from './protocol.ts';
import { shellQuote } from './shell.ts';
import { readConfig, TpmError } from './skill-sets.ts';

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
}

/** project の設定（`.claude/roles/` の config）を読んだ物。書かない欄は既定で埋める。 */
export interface RolesConfig {
  tracker: Tracker
  transport: Transport
  infra: Record<string, InfraEnv>
  /** 起こす担当ごとの model・effort・permissionMode（書いた欄だけ。無い欄は既定）。 */
  roles: Partial<Record<RoleName, Partial<RoleSettings>>>
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

/** config.jsonc を読む。ファイルや欄が無ければ既定（課題管理なし・cmux・環境の宣言なし）。誤りなら TpmError。 */
export function readRolesConfig(configFile: string): RolesConfig {
  const raw = readConfig(configFile);
  const config: Record<string, unknown> = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
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
