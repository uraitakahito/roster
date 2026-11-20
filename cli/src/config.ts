// 起こす folder の .claude/roles/config.json から、層 1 の道具の選び方（課題管理・連携・インフラ）を読む。
// skill-sets の欄は skill-sets.ts、担当ごとの model などは担当を起こす所が読む。
import { readConfig, TpmError } from './skill-sets.ts';

/** 課題管理の道具。none は「記録を書かない」。 */
export const TRACKERS = ['jira', 'github', 'none'] as const;
export type Tracker = typeof TRACKERS[number];

/** 担当どうしの連携の道具。file は試験用（ファイルに知らせを書くだけ）。 */
export const TRANSPORTS = ['cmux', 'file'] as const;
export type Transport = typeof TRANSPORTS[number];

/**
 * 環境の級。触ると誰に響くかで決める。
 * free: 自分だけ（どの担当も断りなく）／tpm: 並べて動く担当（DevOps Engineer 担当だけ・TPM に相談）／
 * pm: ほかの人（DevOps Engineer 担当だけ・Product Manager の承認が要る）。
 */
export const GUARDS = ['free', 'tpm', 'pm'] as const;
export type Guard = typeof GUARDS[number];

/** インフラの環境 1 つ。match のどれかを含む命令が、この環境に触る命令。 */
export interface InfraEnv {
  guard: Guard
  match: string[]
}

export interface RolesConfig {
  tracker: Tracker
  transport: Transport
  infra: Record<string, InfraEnv>
}

const ENV_NAME = /^[a-z0-9-]+$/;

/** config.json を読む。ファイルや欄が無ければ既定（課題管理なし・cmux・環境の宣言なし）。誤りなら TpmError。 */
export function readRolesConfig(configFile: string): RolesConfig {
  const raw = readConfig(configFile);
  const config: Record<string, unknown> = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return {
    tracker: oneOf(config.tracker, TRACKERS, 'none', 'tracker', configFile),
    transport: oneOf(config.transport, TRANSPORTS, 'cmux', 'transport', configFile),
    infra: infraField(config.infra, configFile),
  };
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
