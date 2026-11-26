// Tech Lead 担当が打つ命令: 自分の課題の repo の席（Software Engineer 担当）を起こす（seatAdd）・閉じる（seatClose）。
// repo の席は、名簿の Key が `<課題の Key>.<名>` で、親の課題（Tech Lead 担当の課題の Key）を持つ。席を起こす・閉じる所は、
// TPM 担当の roster assign・roster close と同じ関数（launch.ts の launch・tpm-side.ts の closeSeat）を通す（hook と箱の片付けを受け継ぐ）。
import { assertSummary } from '../brief.ts';
import { requireUp, sessionRef } from '../castlist.ts';
import type { Context } from '../context.ts';
import { ROLES, type RoleName } from '../protocol.ts';
import { isRepoSeat, noteRepoSeat, readRole, repoSeatKey, repoSeats, requireSelf, type RoleRecord } from '../roster.ts';
import { resolveSettings } from '../settings.ts';
import { skillSetDir, TpmError } from '../skill-sets.ts';
import { launch, roleDefaults } from './launch.ts';
import { assertRead, type Sent } from './messages.ts';
import { closeWithChildren } from './tpm-side.ts';

/** repo の席の役割。 */
const SEAT_ROLE: RoleName = 'software-engineer';

/** 席の名に使える形（英小文字・数字・`-`。名簿の Key と台帳の名に入る）。 */
const SEAT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Tech Lead 担当だけが打つ命令の、自分の名簿の行。ほかの session からは止める。 */
function requireLead(ctx: Context, command: string): RoleRecord {
  const self = requireSelf(ctx);
  if (self.role !== 'tech-lead') throw new TpmError(`${command} は Tech Lead 担当が打ちます（自分の課題の repo の席だけ）。${ROLES[self.role].label} 担当の session（${self.key}）からは打てません`);
  return self;
}

/** 席の名を確かめ、名簿の Key を返す。`staff` は、Staff Engineer 担当の席の Key とぶつかるので断る。 */
function seatKey(self: RoleRecord, name: string): string {
  if (!SEAT_NAME.test(name)) throw new TpmError(`席の名は、英小文字・数字・- だけにしてください（受け持つ repo の名など）: ${name}`);
  if (name === 'staff') throw new TpmError('席の名 staff は使えません（Staff Engineer 担当の席の Key とぶつかる）');
  return repoSeatKey(self.key, name);
}

/** `roster seat add` の旗。 */
export interface SeatAddOptions {
  brief: string
  cwd?: string
  title?: string
  /** 起こした席の roster hello を待つ秒。0 なら待たない。 */
  wait: number
}

/**
 * Tech Lead 担当が、repo の席を起こす: 名簿に `<課題の Key>.<名>` の行（役割は software-engineer・親の課題つき・課題管理の課題は親と同じ）を書き、
 * 居場所を作って、名乗るまで待つ。依頼書は名簿の行で渡す（席は roster hello で受ける）。
 * 断る物: Tech Lead 担当でない者・名の形・もう居る席・上限（TPM 担当が --seats で渡した数。今の名簿に居る repo の席で数え、同じ名の起こし直しは数えない）を超える分。
 */
export async function seatAdd(ctx: Context, name: string, options: SeatAddOptions): Promise<string[]> {
  const self = requireLead(ctx, 'roster seat add');
  if (!Number.isFinite(options.wait) || options.wait < 0) throw new TpmError('--wait は 0 以上の数にしてください（0 なら待たない）');
  const key = seatKey(self, name);
  const existing = readRole(ctx, key);
  if (existing !== undefined && !isRepoSeat(existing)) throw new TpmError(`${key} は、名簿で別の担当の Key です（${existing.title}）。別の名にしてください`);
  const alive = existing?.address !== undefined && ctx.seats.seats().some(s => s.address === existing.address);
  if (existing !== undefined && alive) throw new TpmError(`${key} の席は、もう居ます（${existing.address}）。起こしていません`);
  if (self.seats === undefined) throw new TpmError(`repo の席の数の上限が、まだ渡されていません。起こしていません。roster ask tpm で、計画の席の数を伝えて頼んでください（TPM 担当が roster assign ${self.key} --role tech-lead --seats <数> で渡す）`);
  const others = repoSeats(ctx, self.key).filter(r => r.key !== key);
  if (others.length >= self.seats) throw new TpmError(`repo の席は ${self.seats} つまでです（今: ${others.map(r => r.key).join('・')}）。起こしていません。数を増やすなら、roster ask tpm で頼んでください`);
  // まだ渡っていない自分宛てがあれば、1 度止まる（席を起こす前に読む）。
  await assertRead(ctx, '相手');
  await assertSummary(ctx, self.key, options.brief);
  const cwd = options.cwd ?? self.cwd;
  const settings = resolveSettings(SEAT_ROLE, { config: roleDefaults(ctx, SEAT_ROLE, cwd), env: ctx.env });
  // castlist を設定していれば、起きているかを、写しを置く前に見る（止まっていれば、席を起こさずに止まる）。
  const skew = await requireUp(ctx, '席は起こしていません。', ['この 1 行は自分で打たない。roster ask tpm で、castlist が止まっていることを TPM 担当に知らせ、起きた後にもう 1 度 roster seat add を打ってください。']);
  // 課題の写しは、Tech Lead 担当が受けた物（か、作らなかった訳）をそのまま渡す。席ごとに写し直さない
  // （課題を読めない時にも席を起こせる。親の folder に、同じ写しが席の数だけ増えない）。
  const copy: Pick<RoleRecord, 'issuePage' | 'issueCopySkipped'> = {
    ...(self.issuePage === undefined ? {} : { issuePage: self.issuePage }),
    ...(self.issueCopySkipped === undefined ? {} : { issueCopySkipped: self.issueCopySkipped }),
  };
  const record: RoleRecord = {
    key,
    subject: self.key,
    role: SEAT_ROLE,
    title: ROLES[SEAT_ROLE].title(`${self.key} ${name}`, options.title ?? '課題'),
    cwd,
    addDirs: ['core', ...ctx.skillSets].map(s => skillSetDir(ctx.root, s)),
    ...settings,
    brief: options.brief,
    firstBrief: options.brief,
    ...(self.issue === undefined ? {} : { issue: self.issue }),
    ...copy,
  };
  const sid = ctx.env.CLAUDE_CODE_SESSION_ID;
  noteRepoSeat(ctx, self.key, key);
  return await launch(ctx, record, existing !== undefined, options.wait, [`名簿の Key: ${key}`, ...skew], sid ? sessionRef(sid) : undefined);
}

/**
 * その席（今の居場所）が、片付けの終わり（【end】）を送ったか。名乗っていない席（起こし直したばかり）は、まだ送っていないとする
 * （同じ Key の前の席の【end】を、今の席の物に数えない）。
 */
const hasEnded = (ctx: Context, seat: RoleRecord): boolean => {
  const since = seat.helloAt;
  return since !== undefined && ctx.state.lines<Sent>('log.jsonl').some(l => l.key === seat.key && l.heading === 'end' && l.at >= since);
};

/**
 * Tech Lead 担当が、自分の課題の repo の席を閉じ、名簿から消す。閉じられるのは、居場所の無い席（落ちた・名乗らなかった）か、
 * 片付けの終わり（【end】）を送った席だけ（片付けの前に閉じると、worktree や開いた PR が残る）。
 * その席の Staff Engineer 担当の席が残っていれば、一緒に閉じる（roster close と同じ）。
 */
export async function seatClose(ctx: Context, name: string): Promise<string[]> {
  const self = requireLead(ctx, 'roster seat close');
  const key = seatKey(self, name);
  const seat = readRole(ctx, key);
  if (seat === undefined || !isRepoSeat(seat) || seat.subject !== self.key) throw new TpmError(`${key} の席が名簿にいません（自分の課題の repo の席だけを閉じられる）`);
  const alive = seat.address !== undefined && ctx.seats.seats().some(s => s.address === seat.address);
  if (alive && !hasEnded(ctx, seat)) throw new TpmError(`${key} の席は、まだ片付けの終わり（【end】）を送っていません。閉じていません。片付けの指示を送り、【end】を受けてから閉じてください`);
  return await closeWithChildren(ctx, seat);
}
