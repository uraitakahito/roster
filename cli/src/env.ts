// roster が読み書きする環境変数。名は `ROSTER_<名>`。
// 古い名 `TPM_<名>` も読む: 道具の名を替える前に起きた担当は古い名を持っているため（t-6ydg の段 3）。
// 古い名を読むのはここだけにし、後始末（t-6ydg の段 5）でここから外す。書くのは新しい名だけ。

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

/** 古い名（`TPM_KEY` など）。 */
export const legacyEnvName = (name: EnvName): string => `TPM_${name}`;

/**
 * 環境変数の値。新しい名が無ければ古い名。空の字は書かなかったものとみなし、undefined を返す。
 * 新しい名を空の字で書いた時は、古い名を読まない（受け継いだ古い名を空の字で消す書き方が効くように）。
 */
export function envOf(env: NodeJS.ProcessEnv, name: EnvName): string | undefined {
  const value = env[envName(name)];
  return (value === undefined ? env[legacyEnvName(name)] : value) || undefined;
}

/**
 * env を写し、値を新しい名で書いた物。undefined の値は消す。どちらも古い名を消す
 * （新しい名だけを書き替えると、受け継いだ古い名を envOf が拾ってしまうため）。
 */
export function withEnv(env: NodeJS.ProcessEnv, values: Partial<Record<EnvName, string | undefined>>): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const [name, value] of Object.entries(values) as [EnvName, string | undefined][]) {
    delete out[legacyEnvName(name)];
    if (value === undefined) delete out[envName(name)];
    else out[envName(name)] = value;
  }
  return out;
}
