// roster が読み書きする環境変数。名は `ROSTER_<名>`。
// 道具の名を替える前の古い名 `TPM_<名>` は読まない（t-6ydg で替え、t-cmf2 で読むのをやめた）。残っていれば、TPM 担当の roster hello が知らせる（legacyEnvNotice）。

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

/**
 * 古い名（`TPM_MODEL` など）が env に残っていれば、読まないことと替える名を書いた 1 行。無ければ undefined。
 * 利用者が profile に書いた古い名は黙って効かなくなるので、TPM 担当の roster hello で知らせる（t-6ydg の confirm-1 の決定）。
 */
export function legacyEnvNotice(env: NodeJS.ProcessEnv): string | undefined {
  const names = ENV_NAMES.filter(name => env[`TPM_${name}`] !== undefined);
  if (names.length === 0) return undefined;
  return `環境変数の古い名は読みません。新しい名に替えてください: ${names.map(name => `TPM_${name} → ${envName(name)}`).join('・')}`;
}

/** env から roster の環境変数をみな抜いた物（試験が起こす roster に、試験を流す担当の居場所の物を渡さないため）。 */
export const withoutRosterEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => withEnv(env, Object.fromEntries(ENV_NAMES.map(name => [name, undefined])));
