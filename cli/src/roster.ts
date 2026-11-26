// 名簿: 課題の Key → 担当（どの役割で・どこで動き・どの依頼書を受けているか）。状態の folder の roles/ に 1 人 1 ファイル。
// 名簿は「Key → 宛先」を覚えるだけで、動いているかは毎回、連携の道具に聞く（名簿だけを信じない）。
import type { Context } from './context.ts';
import { recordGateStop } from './evidence.ts';
import type { RoleName, RoleSettings } from './protocol.ts';
import { TpmError } from './skill-sets.ts';
import { envOf } from './env.ts';

/** 名簿の 1 行（`roles/` の 1 ファイル）。担当 1 人の役割・居場所・受けている依頼書。 */
export interface RoleRecord extends RoleSettings {
  key: string
  /**
   * 親の課題の Key。Staff Engineer 担当の席（名簿の Key は `<課題の Key>.staff`。見ている課題）と、
   * Tech Lead 担当が起こした repo の席（名簿の Key は `<課題の Key>.<名>`。Tech Lead 担当の課題）だけが持つ。ほかの担当は、名簿の Key が課題の Key。
   */
  subject?: string
  role: RoleName
  title: string
  cwd: string
  /** --add-dir で足す skill セットの folder。 */
  addDirs: string[]
  /** いちばん新しい依頼書の URL。 */
  brief?: string
  /** 起こしたときに渡した依頼書の URL（担当は roster hello で受ける）。前の版で起こした担当には、この欄が無い（その担当の最初の依頼書は、済んでいない物に数えない）。 */
  firstBrief?: string
  /** 課題管理の課題の Key（あれば）。 */
  issue?: string
  /** いちばん新しい課題の写しのページの URL（roster assign が置く）。 */
  issuePage?: string
  /** 写しを作らずに振った訳（roster assign --no-issue-copy）。 */
  issueCopySkipped?: string
  /** 居場所の宛先。起こしたときに書く。 */
  address?: string
  /** 担当が名乗った時刻。 */
  helloAt?: string
  /** 起こしの id（castlist を設定した時に、roster assign・roster audit start が起こすたびに作る UUID。roster run-role が $ROSTER_LAUNCH にする）。 */
  launch?: string
  /** 起こした者の、castlist の鍵の付随する id（roster assign は打った TPM 担当の `claude.session:…`、roster audit start は Product Manager）。 */
  launchedBy?: string
  /** 【dismiss】を送ったか。handover は担当の交代（課題は閉じない）。 */
  dismissed?: 'done' | 'handover'
  /** Tech Lead 担当だけ: 起こしてよい repo の席の数の上限（roster assign --role tech-lead --seats。Product Manager が計画で通した数）。 */
  seats?: number
}

/** TPM 担当の宛先（tpm.jsonc）。担当はメッセージを送るたびにここを読むので、TPM 担当を起こし直しても知らせ直さなくてよい。 */
export interface TpmRecord {
  address: string
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9#._/-]*$/;

/** Key をファイルの名にする（<repo>#<PR> の # と / を替える）。 */
const fileOf = (key: string): string => `roles/${key.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.jsonc`;

/** 課題管理の課題が無いときの Key の形（`t-` と英小文字・数字 4 文字。roster key が作る）。 */
export const LOCAL_KEY = /^t-[a-z0-9]{4}$/;

/** Staff Engineer 担当の席の、名簿の Key の終わり。 */
const STAFF_SUFFIX = '.staff';

/** 課題の Key から、その課題の Staff Engineer 担当の席の名簿の Key（名簿は Key 1 つに 1 行なので、課題の担当と並べるために別の Key にする）。 */
export const staffKey = (subject: string): string => `${subject}${STAFF_SUFFIX}`;

/** 名簿の Key が、Staff Engineer 担当の席の形か。 */
export const isStaffKey = (key: string): boolean => key.endsWith(STAFF_SUFFIX);

/** Staff Engineer 担当の席の名簿の Key から、見ている課題の Key（staffKey の逆）。 */
export const subjectOfStaffKey = (key: string): string => key.slice(0, -STAFF_SUFFIX.length);

/** Tech Lead 担当の課題の Key と席の名から、repo の席の名簿の Key（`AI-36.pagetray`）。 */
export const repoSeatKey = (lead: string, name: string): string => `${lead}.${name}`;

/** 名簿の行が、Tech Lead 担当の起こした repo の席か（親の課題を持つ席のうち、Staff Engineer 担当の席でない物。Key の形では見ない）。 */
export const isRepoSeat = (record: Pick<RoleRecord, 'subject' | 'role'>): boolean => record.subject !== undefined && record.role !== 'staff-engineer';

/** 名簿の行の、課題の Key（Staff Engineer 担当の席と repo の席は親の課題、ほかは名簿の Key）。ページの folder と、名乗りに出す Key に使う。 */
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
  if (record === undefined) throw new TpmError(`名簿に担当がいません: ${key}（roster roles で名簿を見る）`);
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

/** その課題の Tech Lead 担当が起こした repo の席（名簿に居る物）。 */
export const repoSeats = (ctx: Context, lead: string): RoleRecord[] => allRoles(ctx).filter(r => r.subject === lead && isRepoSeat(r));

/** 起こした repo の席の控えの 1 行（状態の folder の `repo-seats.jsonl`。roster seat add が足し、席を閉じても消さない）。 */
interface RepoSeatLine {
  at: string
  /** Tech Lead 担当の課題の Key。 */
  lead: string
  /** repo の席の名簿の Key。 */
  key: string
}

/** repo の席を起こしたことを控える（閉じた後も、その席の記録を親の課題にまとめて読めるように）。 */
export const noteRepoSeat = (ctx: Context, lead: string, key: string): void => ctx.state.append('repo-seats.jsonl', { at: ctx.now().toISOString(), lead, key } satisfies RepoSeatLine);

/** その課題の Tech Lead 担当が起こした repo の席の Key（閉じた席も。控えと、今の名簿から）。Key の形では見ない（点を含む別の課題の Key と取り違えない）。 */
export const repoSeatKeys = (ctx: Context, lead: string): string[] =>
  [...new Set([...ctx.state.lines<RepoSeatLine>('repo-seats.jsonl').filter(l => l.lead === lead).map(l => l.key), ...repoSeats(ctx, lead).map(r => r.key)])];

/** TPM 担当の宛先を読む。`roster hello` の前なら止める。 */
export function requireTpm(ctx: Context): TpmRecord {
  const tpm = ctx.state.read<TpmRecord>('tpm.jsonc');
  if (tpm === undefined) throw new TpmError('TPM 担当の宛先がありません（TPM 担当が roster hello を打つ）');
  return tpm;
}

/**
 * TPM 担当だけが打つ命令（担当に送る・担当を起こす・閉じる）を、担当の session（$ROSTER_KEY がある）から打ったら止める。
 * 送り手の名は命令が付けるので、担当が打つと TPM 担当の名で相手に届いてしまう（台帳 #117）。止めた回は入口の検査の記録に残す。
 * message は、命令ごとの断りの字（無ければ、roster ask tpm で頼むよう言う字）。
 */
export function requireTpmSide(ctx: Context, command: string, message?: string): void {
  const key = envOf(ctx.env, 'KEY');
  if (!key) return;
  recordGateStop(ctx, 'tpm-only', command);
  throw new TpmError(message ?? `${command} は TPM 担当の命令です。担当の session（${key}）からは打てません。TPM 担当に頼むことは、roster ask tpm で送ってください`);
}

/** 自分の名簿の行。担当は起こされるときに $ROSTER_KEY を渡される。 */
export function requireSelf(ctx: Context): RoleRecord {
  const key = envOf(ctx.env, 'KEY');
  if (!key) throw new TpmError('$ROSTER_KEY がありません（この命令は、roster assign で起こされた担当が打つ）');
  return requireRole(ctx, key);
}
