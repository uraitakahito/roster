// 担当を起こす model・effort・permissionMode を決める。TPM 担当の起こす 1 行・TPM 担当の状態の表示・担当を起こす所が、どれもここを通る。
import { ROLES, TPM_SETTINGS, type RoleName, type RoleSettings } from './protocol.ts';
import { TpmError } from './skill-sets.ts';
import { type EnvName, envName, envOf } from './env.ts';

/** 人ごとの既定を書く環境変数（すべての担当に効く）。 */
export const SETTINGS_ENV = { model: 'MODEL', effort: 'EFFORT', permissionMode: 'PERMISSION_MODE' } as const satisfies Record<keyof RoleSettings, EnvName>;

/** 1 つの層で決めた値（書かなかった欄は undefined）。 */
export type SettingsLayer = { [K in keyof RoleSettings]?: string | undefined };

/** env に書いてある（空でない）SETTINGS_ENV の新しい名前と値（古い名に書いてあっても新しい名にする）。roster start が 1 行の頭に写し、TPM 担当とその担当に届ける。 */
export function presentSettingsEnv(env: NodeJS.ProcessEnv): [string, string][] {
  return Object.values(SETTINGS_ENV).flatMap((name) => {
    const value = envOf(env, name);
    return value === undefined ? [] : [[envName(name), value] as [string, string]];
  });
}

/**
 * 欄ごとに、旗・config の担当の欄・環境変数（SETTINGS_ENV）・コードの既定 の順に、先に値がある物を使う。
 * role の 'tpm' は TPM 担当（コードの既定は TPM_SETTINGS）。環境変数の空の字は書かなかったものとみなす。
 * model は claude- で始まる id だけを受け、別名なら、どこから来た値かを添えて止める。
 */
export function resolveSettings(role: RoleName | 'tpm', layers: { flags?: SettingsLayer, config?: SettingsLayer | undefined, env: NodeJS.ProcessEnv }): RoleSettings {
  const defaults = role === 'tpm' ? TPM_SETTINGS : ROLES[role].defaults;
  const pick = (field: keyof RoleSettings): string =>
    layers.flags?.[field] ?? layers.config?.[field] ?? envOf(layers.env, SETTINGS_ENV[field]) ?? defaults[field];
  const model = pick('model');
  if (!model.startsWith(MODEL_ID)) {
    const where = layers.flags?.model !== undefined ? '--model' : layers.config?.model !== undefined ? `config.jsonc の ${role}.model` : `$${envName(SETTINGS_ENV.model)}`;
    throw new TpmError(`${where} の model「${model}」は、${MODEL_ID} で始まる id にしてください（opus・sonnet・haiku・opus[1m] などの別名は受けない。起こした model を castlist に残す時、別名では何の model か決まらないため）`);
  }
  return { model, effort: pick('effort'), permissionMode: pick('permissionMode') };
}

/** model の id の頭。別名（opus など）を断るために見る。 */
const MODEL_ID = 'claude-';
