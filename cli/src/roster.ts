// 名簿: 課題の鍵 → 担当（どの役割で・どこで動き・どの依頼書を受けているか）。状態の folder の roles/ に 1 人 1 ファイル。
// 名簿は「鍵 → 宛先」を覚えるだけで、動いているかは毎回、連携の道具に聞く（名簿だけを信じない）。
import type { Context } from './context.ts';
import type { RoleName, RoleSettings } from './protocol.ts';
import { TpmError } from './skill-sets.ts';

/** 名簿の 1 行（`roles/` の 1 ファイル）。担当 1 人の役割・居場所・受けている依頼書。 */
export interface RoleRecord extends RoleSettings {
  key: string
  role: RoleName
  title: string
  cwd: string
  /** --add-dir で足す skill セットの folder。 */
  addDirs: string[]
  /** いちばん新しい依頼書の URL。 */
  brief?: string
  /** 課題管理の課題の鍵（あれば）。 */
  issue?: string
  /** 居場所の宛先。起こしたときに書く。 */
  address?: string
  /** 担当が名乗った時刻。 */
  helloAt?: string
  /** 【dismiss】を送ったか。handover は担当の交代（課題は閉じない）。 */
  dismissed?: 'done' | 'handover'
}

/** TPM 担当の宛先（tpm.jsonc）。担当はメッセージを送るたびにここを読むので、TPM 担当を起こし直しても知らせ直さなくてよい。 */
export interface TpmRecord {
  address: string
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9#._/-]*$/;

/** 鍵をファイルの名にする（<repo>#<PR> の # と / を替える）。 */
const fileOf = (key: string): string => `roles/${key.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.jsonc`;

/** 課題管理の課題が無いときの鍵の形（`t-` と英小文字・数字 4 文字。tpm key が作る）。 */
export const LOCAL_KEY = /^t-[a-z0-9]{4}$/;

/** 課題の鍵が、使ってよい字（英数字と # . _ / -）だけかを見る。違えば止める。 */
export function assertKey(key: string): void {
  if (!KEY.test(key)) throw new TpmError(`課題の鍵は英数字と # . _ / - だけにしてください: ${key}`);
}

/** 鍵の担当を名簿から読む。いなければ undefined。 */
export const readRole = (ctx: Context, key: string): RoleRecord | undefined => ctx.state.read<RoleRecord>(fileOf(key));

/** 鍵の担当を名簿から読む。いなければ止める。 */
export function requireRole(ctx: Context, key: string): RoleRecord {
  const record = readRole(ctx, key);
  if (record === undefined) throw new TpmError(`名簿に担当がいません: ${key}（tpm roles で名簿を見る）`);
  return record;
}

/** 名簿の行を書く（あれば上書き）。 */
export const writeRole = (ctx: Context, record: RoleRecord): void => ctx.state.write(fileOf(record.key), record);
/** 名簿の行を消す。 */
export const removeRole = (ctx: Context, key: string): void => ctx.state.remove(fileOf(key));

/** 名簿の全員。 */
export function allRoles(ctx: Context): RoleRecord[] {
  return ctx.state.list('roles').map(name => ctx.state.read<RoleRecord>(`roles/${name}.jsonc`)).filter(r => r !== undefined);
}

/** TPM 担当の宛先を読む。`tpm hello` の前なら止める。 */
export function requireTpm(ctx: Context): TpmRecord {
  const tpm = ctx.state.read<TpmRecord>('tpm.jsonc');
  if (tpm === undefined) throw new TpmError('TPM 担当の宛先がありません（TPM 担当が tpm hello を打つ）');
  return tpm;
}

/** 自分の名簿の行。担当は起こされるときに $TPM_KEY を渡される。 */
export function requireSelf(ctx: Context): RoleRecord {
  const key = ctx.env.TPM_KEY;
  if (!key) throw new TpmError('$TPM_KEY がありません（この命令は、tpm assign で起こされた担当が打つ）');
  return requireRole(ctx, key);
}
