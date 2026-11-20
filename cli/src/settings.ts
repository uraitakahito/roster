// 担当を起こす model・effort・permissionMode を決める。TPM 担当の起こす 1 行・TPM 担当の状態の表示・担当を起こす所が、どれもここを通る。
import { ROLES, TPM_SETTINGS, type RoleName, type RoleSettings } from './protocol.ts';

/** 人ごとの既定を書く環境変数（すべての担当に効く）。 */
export const SETTINGS_ENV = { model: 'TPM_MODEL', effort: 'TPM_EFFORT', permissionMode: 'TPM_PERMISSION_MODE' } as const satisfies Record<keyof RoleSettings, string>;

/** 1 つの層で決めた値（書かなかった欄は undefined）。 */
export type SettingsLayer = { [K in keyof RoleSettings]?: string | undefined };

/**
 * 欄ごとに、旗・config の担当の欄・環境変数（SETTINGS_ENV）・コードの既定 の順に、先に値がある物を使う。
 * role の 'tpm' は TPM 担当（コードの既定は TPM_SETTINGS）。環境変数の空の字は書かなかったものとみなす。
 */
export function resolveSettings(role: RoleName | 'tpm', layers: { flags?: SettingsLayer, config?: SettingsLayer | undefined, env: NodeJS.ProcessEnv }): RoleSettings {
  const defaults = role === 'tpm' ? TPM_SETTINGS : ROLES[role].defaults;
  const pick = (field: keyof RoleSettings): string =>
    layers.flags?.[field] ?? layers.config?.[field] ?? (layers.env[SETTINGS_ENV[field]] || undefined) ?? defaults[field];
  return { model: pick('model'), effort: pick('effort'), permissionMode: pick('permissionMode') };
}
