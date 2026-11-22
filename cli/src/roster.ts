// 名簿: 課題の Key → 担当（どの役割で・どこで動き・どの依頼書を受けているか）。状態の folder の roles/ に 1 人 1 ファイル。
// 名簿は「Key → 宛先」を覚えるだけで、動いているかは毎回、連携の道具に聞く（名簿だけを信じない）。
import type { Context } from './context.ts';
import { recordGateStop } from './evidence.ts';
import type { RoleName, RoleSettings } from './protocol.ts';
import { TpmError } from './skill-sets.ts';

/** 名簿の 1 行（`roles/` の 1 ファイル）。担当 1 人の役割・居場所・受けている依頼書。 */
export interface RoleRecord extends RoleSettings {
  key: string
  /** 見ている課題の Key（Staff Engineer 担当の席だけ。名簿の Key は `<課題の Key>.staff`）。ほかの担当は、名簿の Key が課題の Key。 */
  subject?: string
  role: RoleName
  title: string
  cwd: string
  /** --add-dir で足す skill セットの folder。 */
  addDirs: string[]
  /** いちばん新しい依頼書の URL。 */
  brief?: string
  /** 起こしたときに渡した依頼書の URL（担当は tpm hello で受ける）。前の版で起こした担当には、この欄が無い（その担当の最初の依頼書は、済んでいない物に数えない）。 */
  firstBrief?: string
  /** 課題管理の課題の Key（あれば）。 */
  issue?: string
  /** いちばん新しい課題の写しのページの URL（tpm assign が置く）。 */
  issuePage?: string
  /** 写しを作らずに振った訳（tpm assign --no-issue-copy）。 */
  issueCopySkipped?: string
  /** 居場所の宛先。起こしたときに書く。 */
  address?: string
  /** 担当が名乗った時刻。 */
  helloAt?: string
  /** 起こしの id（castlist を設定した時に、tpm assign・tpm audit start が起こすたびに作る UUID。tpm run-role が $TPM_LAUNCH にする）。 */
  launch?: string
  /** 起こした者の、castlist の鍵の付随する id（tpm assign は打った TPM 担当の `claude.session:…`、tpm audit start は Product Manager）。 */
  launchedBy?: string
  /** 【dismiss】を送ったか。handover は担当の交代（課題は閉じない）。 */
  dismissed?: 'done' | 'handover'
}

/** TPM 担当の宛先（tpm.jsonc）。担当はメッセージを送るたびにここを読むので、TPM 担当を起こし直しても知らせ直さなくてよい。 */
export interface TpmRecord {
  address: string
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9#._/-]*$/;

/** Key をファイルの名にする（<repo>#<PR> の # と / を替える）。 */
const fileOf = (key: string): string => `roles/${key.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.jsonc`;

/** 課題管理の課題が無いときの Key の形（`t-` と英小文字・数字 4 文字。tpm key が作る）。 */
export const LOCAL_KEY = /^t-[a-z0-9]{4}$/;

/** Staff Engineer 担当の席の、名簿の Key の終わり。 */
const STAFF_SUFFIX = '.staff';

/** 課題の Key から、その課題の Staff Engineer 担当の席の名簿の Key（名簿は Key 1 つに 1 行なので、課題の担当と並べるために別の Key にする）。 */
export const staffKey = (subject: string): string => `${subject}${STAFF_SUFFIX}`;

/** 名簿の Key が、Staff Engineer 担当の席の形か。 */
export const isStaffKey = (key: string): boolean => key.endsWith(STAFF_SUFFIX);

/** 名簿の行の、課題の Key（Staff Engineer 担当の席は見ている課題、ほかは名簿の Key）。ページの folder と、名乗りに出す Key に使う。 */
export const subjectOf = (record: Pick<RoleRecord, 'key' | 'subject'>): string => record.subject ?? record.key;

/** 課題の Key が、使ってよい字（英数字と # . _ / -）だけかを見る。違えば止める。 */
export function assertKey(key: string): void {
  if (!KEY.test(key)) throw new TpmError(`課題の Key は英数字と # . _ / - だけにしてください: ${key}`);
}

/** Key の担当を名簿から読む。いなければ undefined。 */
export const readRole = (ctx: Context, key: string): RoleRecord | undefined => ctx.state.read<RoleRecord>(fileOf(key));

/** Key の担当を名簿から読む。いなければ止める。 */
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

/**
 * TPM 担当だけが打つ命令（担当に送る・担当を起こす・閉じる）を、担当の session（$TPM_KEY がある）から打ったら止める。
 * 送り手の名は命令が付けるので、担当が打つと TPM 担当の名で相手に届いてしまう（台帳 #117）。止めた回は入口の検査の記録に残す。
 * message は、命令ごとの断りの字（無ければ、tpm ask tpm で頼むよう言う字）。
 */
export function requireTpmSide(ctx: Context, command: string, message?: string): void {
  const key = ctx.env.TPM_KEY;
  if (!key) return;
  recordGateStop(ctx, 'tpm-only', command);
  throw new TpmError(message ?? `${command} は TPM 担当の命令です。担当の session（${key}）からは打てません。TPM 担当に頼むことは、tpm ask tpm で送ってください`);
}

/** 自分の名簿の行。担当は起こされるときに $TPM_KEY を渡される。 */
export function requireSelf(ctx: Context): RoleRecord {
  const key = ctx.env.TPM_KEY;
  if (!key) throw new TpmError('$TPM_KEY がありません（この命令は、tpm assign で起こされた担当が打つ）');
  return requireRole(ctx, key);
}
