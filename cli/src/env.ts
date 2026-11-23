// roster が読み書きする環境変数。名は `ROSTER_<名>`。
// 道具の名を替える前の古い名 `TPM_<名>` は読まない（t-6ydg で替え、t-cmf2 で読むのをやめた）。
// 残っていれば: 担当の居場所の名（SEAT_ENV）は止める（assertNoLegacySeat）。そのほかは TPM 担当の roster hello が知らせる（legacyEnvNotice）。
import { TpmError } from './skill-sets.ts';

/** roster の環境変数の名（頭の `ROSTER_` を除いた所）。 */
export const ENV_NAMES = [
  'PROJECT',
  'STATE',
  'KEY',
  'ROLE',
  'LAUNCH',
  'LAUNCHED_BY',
  'LAUNCH_MODEL',
  'LAUNCH_EFFORT',
  'LAUNCH_FRESH',
  'MODEL',
  'EFFORT',
  'PERMISSION_MODE',
  'PAGES_URL',
  'PAGES_DIR',
  'CASTLIST_URL',
  'ADDRESS',
] as const;

/** roster の環境変数の名の 1 つ（頭の ROSTER_ を除いた所）。 */
export type EnvName = typeof ENV_NAMES[number];

/** 環境変数の名（`ROSTER_KEY` など）。 */
export const envName = (name: EnvName): string => `ROSTER_${name}`;

/** 環境変数の値。空の字は書かなかったものとみなし、undefined を返す。 */
export function envOf(env: NodeJS.ProcessEnv, name: EnvName): string | undefined {
  return env[envName(name)] || undefined;
}

/** env を写し、値を書いた物。undefined の値は消す。 */
export function withEnv(env: NodeJS.ProcessEnv, values: Partial<Record<EnvName, string | undefined>>): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const [name, value] of Object.entries(values) as [EnvName, string | undefined][]) {
    if (value === undefined) delete out[envName(name)];
    else out[envName(name)] = value;
  }
  return out;
}

/** 古い名（`TPM_KEY` など）。 */
const legacyName = (name: EnvName): string => `TPM_${name}`;

/** roster が担当の居場所に渡す名（どの project の・どの状態の folder の・どの担当か）。 */
const SEAT_ENV = ['PROJECT', 'STATE', 'KEY', 'ROLE'] as const satisfies readonly EnvName[];

/** 利用者が書く名（profile・1 回だけの前置き）。 */
const USER_ENV = ['MODEL', 'EFFORT', 'PERMISSION_MODE', 'PAGES_URL', 'PAGES_DIR', 'CASTLIST_URL', 'ADDRESS'] as const satisfies readonly EnvName[];

/** 起こしの印の環境変数（castlist の hook が読む。roster start の 1 行と roster run-role が渡す）。 */
export const LAUNCH_ENV = ['LAUNCH', 'LAUNCHED_BY', 'LAUNCH_MODEL', 'LAUNCH_EFFORT', 'LAUNCH_FRESH'] as const satisfies readonly EnvName[];

/** 古い名だけが在る名（新しい名の同じ物が無い）。 */
const legacyOnly = (env: NodeJS.ProcessEnv, names: readonly EnvName[]): EnvName[] =>
  names.filter(name => env[legacyName(name)] !== undefined && env[envName(name)] === undefined);

/**
 * 道具の名を替える前に起きた担当の居場所（担当の名を古い名だけで持つ）なら止める。
 * 読まずに進むと、Key の無い者、つまり TPM 担当として動き、担当の守り（guard など）が外れ、TPM 担当の宛先を書き替えるため。
 */
export function assertNoLegacySeat(env: NodeJS.ProcessEnv): void {
  const names = legacyOnly(env, SEAT_ENV);
  if (names.length === 0) return;
  throw new TpmError(`道具の名を替える前に起きた居場所です（環境変数 ${names.map(legacyName).join('・')}。roster は古い名を読みません）。この居場所を閉じ、TPM 担当が起こし直してください（命令の頭に手で付けたなら、${names.map(envName).join('・')} に替える）`);
}

/**
 * 古い名が env に残っていれば、知らせる行（0〜2 行）。TPM 担当の roster hello が出す（t-6ydg の confirm-1 の決定: 読まずに知らせる）。
 * 利用者が書く名は、新しい名に替える。起こしの印は、古い roster start の 1 行で起きた TPM 担当の物なので、起こし直す。
 */
export function legacyEnvNotice(env: NodeJS.ProcessEnv): string[] {
  const user = legacyOnly(env, USER_ENV);
  const launch = legacyOnly(env, LAUNCH_ENV);
  return [
    ...(user.length === 0 ? [] : [`環境変数の古い名は読みません。新しい名に替えてください: ${user.map(name => `${legacyName(name)} → ${envName(name)}`).join('・')}`]),
    ...(launch.length === 0 ? [] : [`この TPM 担当は、道具の名を替える前の roster start の 1 行で起きています（${launch.map(legacyName).join('・')}）。roster start の 1 行で起こし直してください`]),
  ];
}

/** env から roster の環境変数をみな抜いた物（試験が起こす roster に、試験を流す担当の居場所の物を渡さないため）。 */
export const withoutRosterEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => withEnv(env, Object.fromEntries(ENV_NAMES.map(name => [name, undefined])));
