// 見出しの付いたメッセージを送る命令。送る・課題に記録を書く・状態を替える、を 1 度にする（届いたか・見たかは、送る時には見ない。見た時刻は seen.ts の口が引く）。
// 担当が打つ物（ask・report・wait）と、TPM 担当が打つ物（answer・notify・dismiss・show）。brief は命令でなく、assign の中で使う。
// レビューの頼み（roster ask review）と判定（roster report review）は staff.ts にある（課題の担当と Staff Engineer 担当の席の間を、じかに届ける）。
// Auditor は、成果を roster report audit（Product Manager へじかに出した報告の写し）と roster report decided（Product Manager の決定）で出す。
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { appendAudit } from '../audits.ts';
import type { Context } from '../context.ts';
import { recordGateStop, recordWait } from '../evidence.ts';
import { addIncident, foldIntoIncident, incidentLine, incidentType, INCIDENT_TYPES, readIncidents, tagLines } from '../incidents.ts';
import { message, ROLES, TPM_TITLE, WAIT, WAIT_CLOSE, WAIT_NEXT_BRIEF, WAIT_NEXT_BRIEF_LEAD, WAIT_SEAT_CLOSE, type HeadingId, type WaitKind } from '../protocol.ts';
import { isRepoSeat, readRole, repoSeats, requireRole, requireSelf, requireTpm, requireTpmSide, writeRole, type RoleRecord, type TpmRecord } from '../roster.ts';
import { patchReview, readReviews, VERDICTS } from '../reviews.ts';
import { TpmError } from '../skill-sets.ts';
import { MAX_POINTS, type Note, type NoteKind, type NoteLink } from '../tracker/types.ts';
import { isStorePage, pageOwner, replyLine, samePage, waitingByParty, waitingUrls, WAITING_PAGES } from './reply.ts';
import { tidyMail } from './mail.ts';
import { tidyUsage } from './usage.ts';
import { copyMessageRecord } from './message-record.ts';
import { markEscalated } from './review-marks.ts';
import { isPageUrl } from './store.ts';
import { lookMain, namedList, parsePr } from '../watch.ts';
import { returnedIds, seenTimes, type SeenAt } from '../seen.ts';
import { envOf } from '../env.ts';
import { claimNamed, deliveredLines, endedLines, gateFile, markPassed, ownName, passedIds, recipientName, recordDelivered, type Claim, type GateMark } from '../mail.ts';
import { MAILROOM_LIMITS, type Counts, type Recipient, type Stored } from '../mailroom/types.ts';
import { selfParty, TPM_PARTY, type Party } from '../party.ts';

export { selfParty, TPM_PARTY, type Party } from '../party.ts';

/** 記録の 1 行目の一言に使う長さの上限（メッセージの本文から作るとき）。 */
const SUMMARY_LIMIT = 80;

/** 名簿の行の担当。 */
const partyOf = (role: RoleRecord): Party => ({ key: role.key, ...(role.launch === undefined ? {} : { launch: role.launch }) });

/** 送った命令の出力に添える一言。届いたかは送る時には見ない（相手が手を動かしている間は届かず、空いたら届く）。 */
export const SENT_NOTE = '相手の手が空いた時に届く。送り直さない';

/** 送った記録の 1 行（log.jsonl）。 */
export interface Sent {
  at: string
  key: string
  heading: string
  from: string
  to: string
  text: string
  id: string
  /** 前の版の行だけ: 送った後 2 秒の内に届いたのを見たか。今の版は書かない（見た時刻は seen.ts の口が引き、前の行のこの欄も読む）。 */
  delivered?: boolean
  /** 返事の先のメッセージの id。返事を送る命令が、頼みの行から自分で引く（返事の先の節）。【notify】などは旗（--reply-to）でも受ける。 */
  replyTo?: string
  /**
   * 【brief】の行だけ: 送った時に、済んでいない前の依頼書をどう扱ったか（none は扱う物が無かった）。
   * 前の版が書いた行には無いので、本文の「取り消す: 」で読む（openBriefs）。
   */
  settle?: SettleChoice | 'none'
  /** 担当から担当へじかに送った行（レビューの頼みと判定）。前の版が TPM 担当へ送った【ask-review】【review】の行には無い。 */
  peer?: true
  /** 送った担当。前の版の行には無い。 */
  sender?: Party
  /**
   * 届く担当。前の版の行には無い。前の版の、返事の形（--reply-to）の行では、元の行の送り手（cmux が、返事を元のメッセージの送り手の居場所へ届けた）。
   */
  recipient?: Party
  /**
   * 運んだ道。配りの口で送った行は nats。launch は、席を起こす時の依頼書で渡した頼みの行（配りの口には置いていない）。
   * 無い行は、前の版で連携の道具（cmux）が運んだ古い行。
   */
  carrier?: 'nats' | 'launch'
  /**
   * 席を起こす時に渡した頼みの行（新しい席への最初の依頼書・Staff Engineer 担当の席を起こす時のレビューの頼み）。メッセージとしては送っていない。
   * 返事（【done】【review】）の先にするために残す。依頼書の数え（openBriefs）は、この行を積まない（最初の依頼書は名簿の firstBrief で 1 つだけ数え、
   * この行からは id だけを借りる）。まだ見ていない物（unsettled）にも数えない。
   */
  launch?: true
  /** NATS で運んだ行: 配りの受け手の名（受け手の担当の組から作った字）。 */
  box?: Recipient
  /** 置いた直後に送る命令が落ちて書けなかった行を、TPM 担当の側の片付けが、置いた物から足した行（commands/mail.ts の tidyMail）。 */
  recovered?: true
  /** 【notify】の行だけ: 問いへの返事でない知らせ（--no-reply）。この行は、相手のまだ応えていない問いを閉じない（openAsks）。 */
  noReply?: true
  /** 【done】の行だけ: 担当が --briefs で名指して済ませた依頼書の URL（渡された時の字のまま）。無ければ、見ていた依頼書のいちばん古い 1 つを済ませる。 */
  briefs?: string[]
}

/** 置く物に持たせる、送った記録の行（本文と id のほか。JSON の字）の欄の名。 */
export const SENT_LABEL = 'sent';

/** 同じメッセージの 2 度送りとみなす間（秒）。 */
const REPEAT_SECONDS = 30;

/**
 * 同じ差出人が、同じ宛先に、同じ見出し・本文のメッセージを REPEAT_SECONDS 秒の内に送っていたら止まる（返事の先を名指した時は、返事の先も同じ物だけ）。
 * 止まった命令の打ち直しを `;` や `||` で 1 行に続けて書くと、止まらなかった時にも 2 度目が動く（課題の記録も 2 件になる）。
 * 課題に記録を書く命令は、記録の前にもこれを呼ぶ。
 */
// 今は待つ物が無い。形だけ非同期にしておく（呼ぶ側を替えずに、Promise を返す配りの口（mailroom）を待てるように）。
// eslint-disable-next-line @typescript-eslint/require-await
async function assertNotRepeat(ctx: Context, id: HeadingId, from: string, to: string, body: string, replyTo?: string): Promise<void> {
  const text = message(id, body);
  const since = ctx.now().getTime() - REPEAT_SECONDS * 1000;
  // 返事の先を名指さずに呼んだ時（送る前の検査。返事の先は、送る所で命令が引く）は、返事の先を問わずに比べる:
  // 命令が引いた返事の先は、1 度目が頼みを済ませると 2 度目には違う物になるので、比べると 2 度送りを見逃す。
  // 席を起こす時の頼みの行（launch）は、送った物ではないので比べない（起こした直後に、同じ依頼書を【brief】で送り直せる）。
  const same = ctx.state.lines<Sent>('log.jsonl').findLast(l => l.launch !== true && l.from === from && l.to === to && l.text === text && (replyTo === undefined || l.replyTo === replyTo));
  if (same === undefined || Date.parse(same.at) < since) return;
  recordGateStop(ctx, 'repeat', same.id);
  throw new TpmError(`同じ【${id}】を、${same.at} にもう送っています（id ${same.id}）。2 度目は送っていません。\n打ち直しを ; や || で 1 行に続けて書いていないか確かめてください。もう 1 度送る必要があれば、${REPEAT_SECONDS} 秒待つか、中身を変えて打つ。`);
}

/** 担当が TPM 担当へ送る物の 2 度送りを見る（課題に記録を書く前に呼ぶ）。 */
const notRepeatToTpm = async (ctx: Context, self: RoleRecord, id: HeadingId, body: string): Promise<void> => assertNotRepeat(ctx, id, self.title, requireTpm(ctx).address, body);

/**
 * NATS で送れる本文の長さ（字。JavaScript の字の長さ＝UTF-16 で数える。hook が 1 度に渡す字の上限（commands/mail.ts の CONTEXT_MAX）と
 * 同じ数え方にして、絵文字の多い本文が hook の上限を超えないようにする。符号位置で数える置き場の上限（8,000）より、きつい側）。
 */
const NATS_TEXT_MAX = 8000;

/** メッセージキュー（NATS）が応えない時の誤り（queueDown が作る。roster report incident だけが、これを受けて台帳に書いて進む）。 */
export class QueueDownError extends TpmError {}

/** メッセージキュー（NATS）が応えない時の誤り。居場所の状態にも出し、gate.jsonl（種類 queue）に残す。not は「送っていません」などの字。 */
export function queueDown(ctx: Context, not: string, e: unknown): QueueDownError {
  // 状態の移りの記録（waits.jsonl）にも残す（roster time が、止まっていた間を、前の状態に数えないように）。
  showWait(ctx, 'メッセージキューが応えません');
  recordGateStop(ctx, 'queue', `down: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
  return new QueueDownError(`メッセージキューが応えません。${not}（${e instanceof Error ? e.message : String(e)}）。${queueDownNext(ctx)}、動いてから同じ命令を打ち直してください`);
}

/**
 * メッセージキューが応えない時に、次にする事の字。担当（$ROSTER_KEY がある）は、TPM 担当にも送れず、Product Manager にじかに聞かない決まりなので、
 * 止まった事を返答に書く（決まりの文の「メッセージキューが応えない時」と同じ）。TPM 担当は、Product Manager に確かめる。
 */
const queueDownNext = (ctx: Pick<Context, 'env'>): string => envOf(ctx.env, 'KEY')
  ? 'TPM 担当にも送れないので、止まった事を返答に書き（メッセージキュー（NATS）が動いているかは、Product Manager が確かめる）'
  : 'メッセージキュー（NATS）が動いているかを Product Manager に確かめ';

/**
 * メッセージを配りの口（NATS）に置き、作った id を返す。長すぎる本文は置かずに誤り。配りの口が誤りなら、置けていないとして止まる（queueDown）。
 * labels は、送った側の記録の欄（deliver の注）。
 */
async function post(ctx: Context, box: Recipient, from: string, text: string, replyTo: string | undefined, labels: Record<string, string>): Promise<string> {
  const length = text.length;
  if (length > NATS_TEXT_MAX) throw new TpmError(`本文が長すぎます（${length} 字。メッセージキューで送れるのは ${NATS_TEXT_MAX} 字まで）。長い本文はページに書いて（roster page put）、URL を送ってください。送っていません`);
  const id = randomUUID();
  try {
    await (await ctx.mailroom()).put({ id, from, to: box, text, ...(replyTo === undefined ? {} : { replyTo }), labels });
  }
  catch (e) {
    throw queueDown(ctx, '送っていません', e);
  }
  return id;
}

/**
 * 課題に記録を書く前に、送れるかを確かめる: 配りの口へ軽い問いを 1 つ打つ。応えなければ「メッセージキューが応えません。送っていません」で止める
 * （記録を書いた後で、置けずに止まらないように）。受け手の名乗りは見ない（メッセージは、いつも配りの口に置く）。
 * 受け手の名が作れない組（長い）も、ここで止める（recipientName の誤り。記録を書いた後に、置く所で止まらないように）。
 */
async function assertReachable(ctx: Context, party: Party): Promise<void> {
  recipientName(party);
  try {
    await (await ctx.mailroom()).lag();
  }
  catch (e) {
    throw queueDown(ctx, '送っていません', e);
  }
}

/**
 * メッセージを送り、送った記録を log.jsonl に足す。recipient は届く担当、extra は記録の行に足す欄。
 * 足した行は、置き場にも写す（message-record.ts。待たない。写せなくても、送った事と log.jsonl は変わらない）。
 * 運ぶ道は、いつも配りの口（NATS）。受け手の名（mail.ts の recipientName）の箱に置く。受け手の名乗りが効いているかは見ない
 * （名乗る前の席宛ても置く。席の hook が後で渡す）。名が作れない組（長い）は、誤りで止まる（送っていない）。
 * 返事の形（replyTo）でも、届く担当は recipient のまま。replyTo は、記録の行と置く物に残す。
 * 置く物には、送った側の記録の欄（Key・見出し・送り手と受け手の Key・送った時刻）を持たせる（commands/mail.ts の sentFrom が読む）。
 * to は、記録の行に残す居場所の宛先（運ぶのには使わない）。
 */
async function deliver(ctx: Context, id: HeadingId, key: string, from: string, to: string, body: string, recipient: Party, replyTo?: string, extra: Pick<Sent, 'settle' | 'peer' | 'briefs' | 'noReply'> = {}): Promise<string> {
  return sentNote(await deliverSent(ctx, id, key, from, to, body, recipient, replyTo, extra));
}

/** 送った命令の結果に出す 1 行。 */
const sentNote = (sent: Sent): string => `送った: 【${sent.heading}】→ ${sent.to}（${SENT_NOTE}）`;

/** {@link deliver} と同じに送り、送った記録の行を返す（送った id を、頼みの記録に書く所が使う）。 */
async function deliverSent(ctx: Context, id: HeadingId, key: string, from: string, to: string, body: string, recipient: Party, replyTo?: string, extra: Pick<Sent, 'settle' | 'peer' | 'briefs' | 'noReply'> = {}): Promise<Sent> {
  await assertNotRepeat(ctx, id, from, to, body, replyTo);
  const text = message(id, body);
  const box = recipientName(recipient);
  // 置く物に、置き場の記録に要る欄を持たせる（受け手の側が、この session の log.jsonl を読まずに、同じ値の記録を書き足せるように。
  // 受け手が待っていると、こちらが log.jsonl に書く前に、受け手の書き足しが置き場に先に着くことがある）。
  const at = ctx.now().toISOString();
  const line: Omit<Sent, 'text' | 'id'> = {
    at,
    key,
    heading: id,
    from,
    to,
    ...(replyTo === undefined ? {} : { replyTo }),
    ...extra,
    sender: selfParty(ctx.env),
    recipient,
    carrier: 'nats',
    box,
  };
  // 送った記録の行（本文と id のほか）も持たせる: 置いた直後にこの命令が落ちて log.jsonl に書けなかった時に、
  // TPM 担当の側の片付け（commands/mail.ts の tidyMail）が、同じ行を足せるように。
  const labels = { key, heading: id, from: selfParty(ctx.env).key, at, to: recipient.key, [SENT_LABEL]: JSON.stringify(line) };
  const sentId = await post(ctx, box, from, text, replyTo, labels);
  const sent: Sent = { ...line, text, id: sentId };
  ctx.state.append('log.jsonl', sent);
  copyMessageRecord(ctx, sent);
  return sent;
}

/**
 * 席を起こす時に渡した頼み（新しい席への最初の依頼書・Staff Engineer 担当の席を起こす時のレビューの頼み）を、送った記録に 1 行残し、作った id を返す。
 * 配りの口には置かない（中身は、起こす時の依頼書で渡してある）。行は印（launch）を持ち、置き場には「ほかの道具で運んだ」（carried）の記録として写る。
 * 返事（最初の【done】・【review】）が、この行を返事の先にする。依頼書の数え・まだ見ていない物には数えない（openBriefs・unsettled）。
 * seat は起こした席の名簿の行（宛先が書いてある物）。key は記録の行の Key（【brief】は受け手の Key、【ask-review】は頼んだ課題の担当の Key。送る時と同じ）。
 * asker は、頼んだ担当（無ければ、命令を打った担当）。TPM 担当が Staff Engineer 担当の席を起こし直す時も、頼みの送り手は課題の担当にする
 * （送り手の名 from と、送り手の担当 sender を食い違わせない）。
 * replyTo は、この行が閉じる前の頼み（返っていない頼みのまま席を起こし直した時の、元の【ask-review】）。
 */
export function recordLaunchAsk(ctx: Context, id: 'brief' | 'ask-review', key: string, from: string, seat: RoleRecord, body: string, asker?: RoleRecord, replyTo?: string): string {
  const sent: Sent = {
    at: ctx.now().toISOString(),
    key,
    heading: id,
    from,
    to: seat.address ?? '',
    ...(replyTo === undefined ? {} : { replyTo }),
    ...(id === 'ask-review' ? { peer: true as const } : {}),
    sender: asker === undefined ? selfParty(ctx.env) : partyOf(asker),
    recipient: partyOf(seat),
    carrier: 'launch',
    launch: true,
    text: message(id, body),
    id: randomUUID(),
  };
  ctx.state.append('log.jsonl', sent);
  copyMessageRecord(ctx, sent);
  return sent.id;
}

/** 担当から TPM 担当へ。 */
async function toTpm(ctx: Context, self: RoleRecord, id: HeadingId, body: string, replyTo?: string, extra: Pick<Sent, 'briefs'> = {}): Promise<string> {
  return deliver(ctx, id, self.key, self.title, requireTpm(ctx).address, body, { key: TPM_PARTY }, replyTo, extra);
}

/**
 * 上へ送る先（自分に仕事を振った者）。repo の席（Tech Lead 担当が起こした席）は親の課題の Tech Lead 担当、ほかの担当は TPM 担当。
 * 成果（【done】）・merge の知らせ（【merged】【doc-fix】）・片付けの終わり（【end】）・問い（【ask-lead】）は、ここへ送る。
 * 思わぬ出来事・共有の環境の頼み・TPM 担当への相談は、どの担当も TPM 担当へ送る（toTpm）。
 * Tech Lead 担当の席が無ければ止まる（送っていない・記録も書いていない）。
 */
interface Boss {
  /** 居場所の宛先（記録の行と、2 度送りの検査に使う）。 */
  address: string
  party: Party
  /** Tech Lead 担当の名簿の行（上が TPM 担当なら無い）。 */
  lead?: RoleRecord
}

function bossOf(ctx: Context, self: RoleRecord): Boss {
  if (!isRepoSeat(self)) return { address: requireTpm(ctx).address, party: { key: TPM_PARTY } };
  const lead = self.subject === undefined ? undefined : readRole(ctx, self.subject);
  const address = lead?.address;
  if (lead === undefined || address === undefined || !ctx.seats.seats().some(s => s.address === address)) {
    throw new TpmError(`${self.subject ?? ''} の Tech Lead 担当の席がありません。送っていません・記録も書いていません。roster ask tpm で TPM 担当に知らせてください`);
  }
  return { address, party: partyOf(lead), lead };
}

/** 担当から、自分に仕事を振った者（bossOf）へ。replyTo は返事の先（【done】【end】）。 */
async function toBoss(ctx: Context, self: RoleRecord, id: HeadingId, body: string, extra: Pick<Sent, 'briefs'> = {}, replyTo?: string): Promise<string> {
  const boss = bossOf(ctx, self);
  return deliver(ctx, id, self.key, self.title, boss.address, body, boss.party, replyTo, extra);
}

/** 担当が、自分に仕事を振った者へ送る物の 2 度送りを見る（課題に記録を書く前に呼ぶ）。Tech Lead 担当へ送る時は、その箱に置けるかも確かめる。 */
async function notRepeatToBoss(ctx: Context, self: RoleRecord, id: HeadingId, body: string): Promise<void> {
  const boss = bossOf(ctx, self);
  await assertNotRepeat(ctx, id, self.title, boss.address, body);
  if (boss.lead !== undefined) await assertReachable(ctx, boss.party);
}

/** 担当の居場所が今あるかを見て、宛先を返す。無ければ止まる。 */
function seatOf(ctx: Context, role: RoleRecord): string {
  const address = role.address;
  if (address === undefined || !ctx.seats.seats().some(s => s.address === address)) {
    throw new TpmError(`${role.key} の担当の居場所がありません（roster roles で名簿を見る）`);
  }
  return address;
}

/**
 * 仕事を振る者（TPM 担当。repo の席には、その Tech Lead 担当）から担当へ。居場所が無ければ止まる。
 * from は送り手の名（TPM 担当の題か、Tech Lead 担当の名簿の題）。記録の行の Key は、どちらも受け手の Key（依頼書の数えが、受け手の Key の行を読む）。
 */
async function toRole(ctx: Context, role: RoleRecord, id: HeadingId, body: string, replyTo?: string, extra: Pick<Sent, 'settle' | 'noReply'> = {}, from: string = TPM_TITLE): Promise<string> {
  // 渡せない物・期限切れを記録し、命令の結果に 1 通につき 1 度だけ出す（TPM 担当の session だけ。担当の session では何もしない）。
  const ended = await tidyMail(ctx, { sweep: false });
  if (ended.length > 0) ctx.print(ended);
  // まだ送っていない席のトークンの数を、castlist へ取り込む（1 時間に 1 度。TPM 担当の session だけ。誤りでも止めない）。
  await tidyUsage(ctx);
  return deliver(ctx, id, role.key, from, seatOf(ctx, role), body, partyOf(role), replyTo, extra);
}

/** 担当の相手（課題の担当から見た Staff Engineer 担当の席・その逆）の宛先。居場所が無ければ止まる（送っていない・記録も書いていない）。 */
function peerSeat(ctx: Context, peer: RoleRecord): string {
  const address = peer.address;
  if (address === undefined || !ctx.seats.seats().some(s => s.address === address)) {
    throw new TpmError(`${peer.key} の居場所がありません。送っていません・記録も書いていません。roster ask tpm で TPM 担当に知らせてください`);
  }
  return address;
}

/**
 * 担当から担当へ、じかに（レビューの頼みと判定だけ）。送り手の名は名簿の題。相手の居場所が無ければ止まる。
 * replyTo は返事の先（【review】の、頼みの id）。返すのは、結果に出す 1 行と、送った id（【ask-review】の id を、頼みの記録に書く）。
 */
export async function toPeer(ctx: Context, self: RoleRecord, peer: RoleRecord, id: HeadingId, body: string, replyTo?: string): Promise<{ note: string, id: string }> {
  const sent = await deliverSent(ctx, id, self.key, self.title, peerSeat(ctx, peer), body, partyOf(peer), replyTo, { peer: true });
  return { note: sentNote(sent), id: sent.id };
}

/** 担当が担当へじかに送る物の 2 度送りを見る（課題に記録を書く前に呼ぶ。相手の宛先で数える）。配りの口に置けるかも確かめる。 */
export async function notRepeatToPeer(ctx: Context, self: RoleRecord, peer: RoleRecord, id: HeadingId, body: string): Promise<void> {
  await assertNotRepeat(ctx, id, self.title, peerSeat(ctx, peer), body);
  await assertReachable(ctx, partyOf(peer));
}

/**
 * 課題の記録の 1 行目に書く担当の名。repo の席（Tech Lead 担当が起こした席）は、同じ課題に同じ役割の席がいくつも書くので、
 * 席の名を添える（`Software Engineer（pagetray）`）。ほかの担当は、役割の名だけ（今までどおり）。
 */
export const noteRole = (role: RoleRecord): string => isRepoSeat(role) && role.subject !== undefined
  ? `${ROLES[role.role].label}（${role.key.slice(role.subject.length + 1)}）`
  : ROLES[role.role].label;

/** 課題に記録を書く。課題が無い・課題管理を使わない project なら書かない。 */
export function record(ctx: Context, role: RoleRecord, note: Note): string[] {
  if (role.issue === undefined || !ctx.tracker.owns(role.issue)) return [];
  if (note.kind !== '確認' && note.points.length > MAX_POINTS) throw new TpmError(`記録の要点は ${MAX_POINTS} つまでにしてください（中身はページに書く）`);
  ctx.tracker.comment(role.issue, note);
  return [`記録を書いた: ${role.issue}【${note.kind}】`];
}

// ---- 入口の検査（送る前に見る。どちらも、課題への記録などを書く前に通す） ----

/** 未読で止まったときの字（送る命令と、ページを置く命令）。 */
const READ_STOP = {
  send: { not: '送っていません', retry: '同じ命令を打ち直せば送ります（事情が変わっていたら、中身を変えて打つ）' },
  put: { not: 'ページを置いていません', retry: '同じ命令を打ち直せば置きます（事情が変わっていたら、ページを書き直して打つ）' },
} as const;

/**
 * 送る前の検査。自分宛てで、配りの口（NATS）にまだ残っている物（まだ渡っていない物）があれば、1 度だけ止まる（行き違いを減らす）。
 * from は相手の題（TPM 担当が担当に送るとき。ほかの担当からのメッセージでは止まらない）。担当が受けるのは TPM 担当と、レビューの相手（課題の担当と Staff Engineer 担当の席）からだけなので、付けずにどれでも止まる。
 * action は止まった時の字（put は roster page put が置く前に呼ぶとき）。
 * 自分の受け手の名が作れなければ（長い組）、検査を通す。
 * - 自分（この session）の名乗りが効いている時: 本文は出さず、すぐ後の hook に渡させる（assertHandedOver）。
 * - 名乗りが効いていない時（渡す hook を持たない session）: 本文を命令の結果に出して止まる（assertUnclaimed）。
 *   これは、roster の席の session だけ（seated）。席でない session（$ROSTER_KEY が無く、TPM 担当の居場所でもない）では、検査をしない（印を付けない）。
 */
export async function assertRead(ctx: Context, who: string, from?: string, action: keyof typeof READ_STOP = 'send'): Promise<void> {
  const name = ownName(ctx);
  if (name === undefined) return;
  const claim = claimNamed(ctx, name);
  if (claim !== undefined) await assertHandedOver(ctx, claim, who, from, action);
  else if (seated(ctx)) await assertUnclaimed(ctx, name, who, from, action);
}

/**
 * この session が、roster の席か: 担当（$ROSTER_KEY がある。roster が起こした席）か、TPM 担当が名乗った居場所（tpm.jsonc の宛先が自分）。
 * 名乗りが効いていない時に「見せた」の印を付けてよいのは、席の session だけ。$ROSTER_KEY の無い session は、みな TPM 担当の受け手の名になるので、
 * 席でない session（人の terminal など）が印を付けると、TPM 担当が読まないまま、その物が「見せた」になる。
 */
export function seated(ctx: Context): boolean {
  if (envOf(ctx.env, 'KEY')) return true;
  const address = ctx.state.read<TpmRecord>('tpm.jsonc')?.address;
  try {
    return address !== undefined && ctx.seats.whoami() === address;
  }
  catch {
    return false;
  }
}

/**
 * 名乗りが効いていない session に見せた物を覚え、出す行（送り手・id・本文）を返す: 「検査では止めない」の印を付け（次の検査では止まらない）、
 * 渡した記録に output と残す（届いたには数えないが、見た時刻の口（seen.ts）は「見せた」と読む）。箱の物は消さない（期限で消える）。
 */
function shownLines(ctx: Context, name: Recipient, unread: Stored[]): string[] {
  const ids = unread.map(m => m.id);
  markPassed(ctx, name, ids);
  for (const id of ids) recordDelivered(ctx, id, name, 'output');
  return unread.flatMap(m => [`--- ${m.from}（id ${m.id}）`, m.text]);
}

/**
 * roster inbox の、名乗りが効いていない session の分: 配りの口に残っている自分宛てのうち、まだ見せていない物（印の無い物）を出す行を返す。無ければ空。
 * 見せた物は覚える（shownLines）ので、ここで見せた物では、送る前の検査は止まらない。
 */
export async function showUnread(ctx: Context, name: Recipient): Promise<string[]> {
  const passed = passedIds(ctx, name);
  const unread = (await (await ctx.mailroom()).peek(name)).filter(m => !passed.has(m.id));
  return unread.length === 0 ? [] : shownLines(ctx, name, unread);
}

/**
 * 送る前の検査の、名乗りが効いていない session の形（渡す hook を持たない: Claude Code の pid が分からなかった session・試験）。
 * 配りの口の自分宛てのうち、「検査では止めない」の印の無い物があれば、本文を出して 1 度止まる。見せた物は覚える（shownLines）ので、打ち直しは通る。
 * 写しの遅れと、配りの口が応えない時の扱いは、名乗っている時（assertHandedOver）と同じ。from で絞る決まりも同じ。
 */
async function assertUnclaimed(ctx: Context, name: Recipient, who: string, from: string | undefined, action: keyof typeof READ_STOP): Promise<void> {
  const not = READ_STOP[action].not;
  const asked = await askQueue(ctx, name).catch((e: unknown) => {
    throw queueDown(ctx, not, e);
  });
  assertNoLag(ctx, asked.lag, not);
  const passed = passedIds(ctx, name);
  const unread = asked.letters.filter(m => (from === undefined || m.from === from) && !passed.has(m.id));
  if (unread.length === 0) return;
  const lines = shownLines(ctx, name, unread);
  recordGateStop(ctx, 'unread', unread.map(m => m.id).join(' '));
  throw new TpmError([
    `${who}から、まだ読んでいないメッセージが ${unread.length} 件あります。${not}。`,
    ...lines,
    '--- ここまで',
    `読んだうえで、${READ_STOP[action].retry}。`,
  ].join('\n'));
}

/** 写しの遅れ（N4）が、待っても残っていれば止める。居場所の状態にも出す。 */
function assertNoLag(ctx: Context, lag: number, not: string): void {
  if (lag === 0) return;
  showWait(ctx, 'メッセージキューの写しが遅れています');
  recordGateStop(ctx, 'queue', `lag: ${lag}`);
  throw new TpmError(`メッセージキューの写しが遅れています（まだ写されていない物が ${lag} 通）。${not}。少し待って、同じ命令を打ち直してください`);
}

/** T8 の (a)「渡している途中」と見る間に足す、取り置きの長さの後の少しの間（ミリ秒）。 */
const HANDING_GRACE_MS = 5000;

/** 写しの遅れ（N4）が無くなるのを待つ回数と、1 回の間（合わせて長くて 2 秒）。 */
const LAG_TRIES = 20;
const LAG_PAUSE_MS = 100;

/**
 * hook がメッセージを渡してから、この間（ミリ秒）の内に来た送りは、渡す前に書かれた命令と見なして 1 度止める。
 * 担当（model）が、渡された本文を受け取って次の命令を書くには、少なくとも 1 回の往復が要る。それより早く来た送りは、
 * 1 度の返答で並べて書かれた物（前の命令が検査で止まり、hook が本文を渡した直後に、後ろの命令が動いた）。外れても、打ち直しが 1 度増えるだけ。
 * 会話の記録を見る guard の守り（commands/mail.ts の mailGuard）は、Claude Code 2.1.332 では働かない
 * （PreToolUse の時に、その返答の行がまだ会話の記録に書かれていない）ので、並べた送りは、ここで時刻で止める。
 */
const FRESH_MS = 2000;

/**
 * hook が、この session の自分宛てを渡した直後（FRESH_MS の内）なら、送らずに 1 度止める。本文は出さない（もう文脈に渡っている）。
 * 見るのは、手元の渡した記録のうち、自分の受け手の名・今の session（どちらかの id が分からない行は、同じと見る）・hook が渡した行（output は除く）。
 * 止めた印（mail.ts の GateMark）は書かない（hook に渡させる物が無い）。gate.jsonl には fresh と残す。
 */
function assertNotFresh(ctx: Context, claim: Claim, not: string): void {
  const now = ctx.now().getTime();
  const fresh = deliveredLines(ctx).filter(l => l.to === claim.name && l.when !== 'output'
    && (l.session === undefined || claim.session === undefined || l.session === claim.session)
    && now - Date.parse(l.at) >= 0 && now - Date.parse(l.at) < FRESH_MS);
  if (fresh.length === 0) return;
  recordGateStop(ctx, 'fresh', fresh.map(l => l.id).join(' '));
  throw new TpmError(`直前に、hook がメッセージを渡しました（${fresh.length} 件）。渡された物を読んでから、同じ命令を打ち直してください（${not}）`);
}

/** メッセージの本文の頭の見出し（`【brief】…` の brief）。無ければ空。 */
const headingOf = (text: string): string => /^【([^】]+)】/.exec(text)?.[1] ?? '';

/** 配りの口に聞いた、自分宛ての様子: 写しの遅れ・残っている物（古い順）・箱の数。 */
async function askQueue(ctx: Context, name: Recipient): Promise<{ lag: number, letters: Stored[], counts: Counts }> {
  const room = await ctx.mailroom();
  let lag = await room.lag();
  for (let i = 0; lag > 0 && i < LAG_TRIES; i++) {
    await ctx.sleep(LAG_PAUSE_MS);
    lag = await room.lag();
  }
  if (lag > 0) return { lag, letters: [], counts: { waiting: 0, held: 0 } };
  const letters = await room.peek(name);
  return { lag, letters, counts: letters.length === 0 ? { waiting: 0, held: 0 } : await room.counts(name) };
}

/**
 * 送る前の検査の、自分の名乗りが効いている時の形（claim は自分の名乗り）。
 * 先に、hook が自分宛てを渡した直後でないかを見る（assertNotFresh。配りの口には聞かない）。
 * 自分宛てで、配りの口にまだ残っている物（まだ渡っていない物）があれば止める。**本文は出さない**: 止めた事を印（mail.ts の GateMark）に書き、
 * すぐ後の hook（roster mail gate）が本文を渡す。渡された後の打ち直しは通る。
 * - 写しの遅れ（N4）が、長くて 2 秒待っても残れば止める。配りの口が応えなければ止める。どちらも、居場所の状態に出す。
 * - 「検査では止めない」の印の付いた id と、渡し直しの上限を超えた物しか残っていない時（箱の数が 0）は、止めない。
 * - 前の印が残っていて（hook が渡していない）、同じ id がまだ残っている時（T8）:
 *   (a) 印を書いてから、取り置きの長さ（30 秒）＋ HANDING_GRACE_MS の内で、取り置き中の物があれば、渡している途中と見て、もう 1 度止める。
 *   (b) そうでなければ（取り置き中が無い・その間を過ぎた）、hook が働いていないと見て、本文を命令の結果に出して通す。出した id には「検査では止めない」の印を付ける。
 *       届いたとは記録せず（渡した記録に output と残す）、配りの口にも残す（hook が後で渡せる）。
 * from（相手の題）で絞る決まりは、今までと同じ（TPM 担当が担当に送る時は、その担当からの物だけで止まる）。
 */
async function assertHandedOver(ctx: Context, claim: Claim, who: string, from: string | undefined, action: keyof typeof READ_STOP): Promise<void> {
  const name = claim.name;
  const not = READ_STOP[action].not;
  assertNotFresh(ctx, claim, not);
  const asked = await askQueue(ctx, name).catch((e: unknown) => {
    throw queueDown(ctx, not, e);
  });
  assertNoLag(ctx, asked.lag, not);
  const mark = ctx.state.read<GateMark>(gateFile(name));
  // 印の物が、もう 1 つも残っていなければ（hook のほかの道で渡った）、印を消す。
  if (mark !== undefined && !asked.letters.some(m => mark.ids.includes(m.id))) ctx.state.remove(gateFile(name));
  const passed = passedIds(ctx, name);
  const unread = asked.letters.filter(m => (from === undefined || m.from === from) && !passed.has(m.id));
  // 残っていても箱の数が 0 なのは、渡し直しの上限を超えた物（片付けるのは TPM 担当の命令）。
  if (unread.length === 0 || asked.counts.waiting + asked.counts.held === 0) return;
  const ids = unread.map(m => m.id);
  const again = mark !== undefined && unread.some(m => mark.ids.includes(m.id));
  // 渡している途中と見るのは、印を書いてから、取り置きの長さ＋少しの間の内だけ。箱の取り置き中の数は、止めた物と違う物の取り置きでも
  // 増えるので、数だけで見ると、(b) に行かないまま渡し直しの上限に届く道がある。
  const handing = mark !== undefined && ctx.now().getTime() - Date.parse(mark.at) < MAILROOM_LIMITS.holdMs + HANDING_GRACE_MS;
  if (again && handing && asked.counts.held > 0) {
    recordGateStop(ctx, 'unread', ids.join(' '));
    throw new TpmError(`${who}からのメッセージ ${unread.length} 件を、渡している途中です。${not}。長くて 30 秒待って、同じ命令を打ち直してください`);
  }
  if (again) {
    ctx.print([
      `${who}から、まだ渡っていないメッセージが ${unread.length} 件あります。渡す hook が働いていないようなので、ここに出します（届いたとは記録しません）。読んだうえで進めてください。`,
      ...unread.flatMap(m => [`--- ${m.from}（id ${m.id}）`, m.text]),
      '--- ここまで',
    ]);
    markPassed(ctx, name, ids);
    for (const id of ids) recordDelivered(ctx, id, name, 'output');
    ctx.state.remove(gateFile(name));
    return;
  }
  const reason = `送る前の検査が止めた: ${who}から、まだ渡っていないメッセージが ${unread.length} 件あった（${not}）`;
  ctx.state.write(gateFile(name), { at: ctx.now().toISOString(), ids, reason } satisfies GateMark);
  recordGateStop(ctx, 'unread', ids.join(' '));
  throw new TpmError([
    `${who}から、まだ渡っていないメッセージが ${unread.length} 件あります（${unread.map(m => `【${headingOf(m.text)}】${m.from}`).join('・')}）。${not}。`,
    `この後すぐ、hook が本文を渡します。渡された物を読んでから、${READ_STOP[action].retry}。`,
  ].join('\n'));
}

/**
 * メッセージを送る担当の、自分の名簿の行。送る前の検査（assertRead）を通し、配りの口に置けるかを確かめる
 * （課題に記録を書く前に止めるため。assertReachable）。
 */
export async function sender(ctx: Context): Promise<RoleRecord> {
  const self = requireSelf(ctx);
  await assertRead(ctx, '相手');
  await assertReachable(ctx, { key: TPM_PARTY });
  return self;
}

/**
 * 成果を PR や【done】で出さない担当が、打たない命令を止める。
 * Auditor は Product Manager へじかに報告する。Staff Engineer 担当はレビューのページで返す（【end】を打てると、レビューが済んだだけで課題が済みになる）。
 */
export function notAuditor(self: RoleRecord, command: string): void {
  if (self.role === 'auditor') {
    throw new TpmError(`Auditor は ${command} を打ちません。監査の報告は roster report audit、Product Manager の決定は roster report decided で出してください（PR は出さず、Product Manager とは Audit の席でじかに話す）`);
  }
  if (self.role === 'staff-engineer') {
    throw new TpmError(`Staff Engineer 担当は ${command} を打ちません。レビューの結果は roster report review で返してください（PR は出さず、直さない。Product Manager に決めてほしいことは、roster ask tpm で TPM 担当に送る）`);
  }
}

/** Auditor だけが打つ命令の、自分の名簿の行。送る前の検査（assertRead）を通す。 */
async function auditor(ctx: Context, command: string): Promise<RoleRecord> {
  const self = await sender(ctx);
  if (self.role !== 'auditor') throw new TpmError(`${command} は Auditor（Audit の席）が打ちます`);
  return self;
}

/**
 * TPM 担当の居場所が今あれば、その宛先。TPM 担当が名乗っていない・居場所が無ければ undefined。
 * 居場所が状態を出しているかで見る（TPM 担当は roster が起こした居場所ではないので、居場所の一覧に載らない連携がある）。
 */
function tpmSeat(ctx: Context): string | undefined {
  const address = ctx.state.read<TpmRecord>('tpm.jsonc')?.address;
  return address !== undefined && ctx.seats.status(address) !== undefined ? address : undefined;
}

/** TPM 担当がメッセージを送る先の、名簿の行。送る前の検査（assertRead）を通し、配りの口に置けるかを確かめる（assertReachable）。 */
export async function receiver(ctx: Context, key: string): Promise<RoleRecord> {
  const role = requireRole(ctx, key);
  await assertRead(ctx, `${role.key} の担当`, role.title);
  await assertReachable(ctx, partyOf(role));
  return role;
}

/** 済んでいない物を、どう扱って送るか（--supersede は取り消す、--after は済ませてから。after は続きの assign だけ）。 */
export type SettleChoice = 'supersede' | 'after';

/** 依頼書の URL から、見せる名（brief-4 など）。 */
const briefName = (url: string): string => url.replace(/[?#].*$/, '').split('/').at(-1)?.replace(/\.html$/, '') || url;

/** 【done】が返っていない依頼書 1 つ。seen は担当がそれを見た時刻（まだ見ていなければ undefined）。id は【brief】で送った物だけ。 */
interface OpenBrief {
  url: string
  id?: string
  seen?: string
}

/**
 * その担当（今の居場所）に渡し、【done】が返っていない依頼書（古い順）。log.jsonl の順に、次のとおり数える。
 * - 起こしたときに渡した依頼書（firstBrief）は、名乗った時刻に見た物とする。
 * - 【brief】は積む（--after で送った物も、旗を付けずに送った物も）。--supersede で送った物は、それより前を取り消してから積む。【dismiss】は全部を取り消す。
 * - Staff Engineer 担当の席には、課題の担当がじかに送った【ask-review】（頭が依頼書の URL）も積む。
 * - 【done】は、その時刻までに担当が見ていた依頼書のうち、いちばん古い物を 1 つ済ませる（担当は積まれた順にこなす）。まだ見ていない依頼書の分には数えない（行き違いで出た、前の依頼書の分）。【end】は全部を済ませる。
 * - 担当が --briefs で名指した【done】は、名指した依頼書をみな済ませる（見た時刻は問わない。名指したことが見た証し。1 通で依頼書いくつかを済ませた時。台帳 #110）。
 * 見た時刻は、見た時刻の口（seen.ts の seenTimes）が決める: hook が渡した時刻と、roster inbox・送る前の検査が見せた時刻の早い方。
 * 担当は hook が渡す前に roster inbox で読んで済ませることがあるので、届いた時刻だけでは【done】が依頼書より前に見える（台帳 #36）。
 * 前の版が時刻を書かずに覚えた物（shown/ の id だけの項目）は、送った時刻に見せた物とする。見せたのは確かで、担当の送る命令は未読をすべて見せてからでないと送れないので、
 * その後の【done】は見た後に出た物（時刻を使わないと、画面に届くのが【done】より後なら済まないまま残る。台帳 #58）。
 */
function openBriefs(role: RoleRecord, address: string, log: Sent[], seenAt: SeenAt): OpenBrief[] {
  const seen = (l: Sent): string | undefined => seenAt(l)?.at;
  const assigned = fromAssigner(role);
  // 前の版で起こした担当（名簿に firstBrief の欄が無い）の最初の依頼書は数えない（止めすぎるより、見逃す側に倒す）。
  const first = role.firstBrief;
  // 起こす時の頼みの行（launch）が在れば、その id を最初の依頼書に借りる（【done】の返事の先になる）。行そのものは、下で積まない（2 つに数えない）。
  // 宛先も見る（担当の交代で、同じ依頼書の URL のまま起こし直した時に、前の席の行から借りない）。
  const launched = first === undefined ? undefined : log.findLast(l => l.launch === true && l.heading === 'brief' && l.key === role.key && l.to === address && briefUrl(l) === first)?.id;
  let open: OpenBrief[] = first === undefined ? [] : [{ url: first, ...(launched === undefined ? {} : { id: launched }), ...(role.helloAt === undefined ? {} : { seen: role.helloAt }) }];
  // 送った時刻の順に読む（同じ時刻は、file の順のまま）。後から足した行（置いた直後に落ちた送る命令の行。commands/mail.ts の tidyMail）は
  // file の末尾に入るので、file の順に読むと、足した【dismiss】・【brief】が、時刻と違う所で効く。
  for (const l of [...log].sort((a, b) => a.at.localeCompare(b.at))) {
    // 起こす時の頼みの行は積まない（最初の依頼書は、上の firstBrief で数えてある）。
    if (l.launch === true) continue;
    // 課題の担当がじかに送ったレビューの頼み（【ask-review】。記録の Key は送った課題の担当）も、Staff Engineer 担当の席の依頼書に積む。
    // Tech Lead 担当に届く repo の席の頼みは、依頼書に積まない（Tech Lead 担当の【done】は、TPM 担当の依頼書だけを済ませる。頼みは reviews.ts の記録で数える）。
    if (l.peer === true && l.heading === 'ask-review' && l.to === address && role.role === 'staff-engineer') {
      const at = seen(l);
      open.push({ url: l.text.slice('【ask-review】'.length).split(' ')[0] ?? '', id: l.id, ...(at === undefined ? {} : { seen: at }) });
      continue;
    }
    if (l.key !== role.key) continue;
    if (assigned(l)) {
      if (l.to !== address) continue;
      if (l.heading === 'dismiss') open = [];
      if (l.heading !== 'brief') continue;
      if ((l.settle ?? (l.text.includes(' 取り消す: ') ? 'supersede' : 'none')) === 'supersede') open = [];
      const at = seen(l);
      open.push({ url: briefUrl(l), id: l.id, ...(at === undefined ? {} : { seen: at }) });
    }
    else if (role.helloAt !== undefined && l.at >= role.helloAt) {
      // 前の居場所（担当の交代の前）が出した物は数えない。
      if (l.heading === 'end') open = [];
      // Staff Engineer 担当は、依頼書 1 つの成果を【review】で返す（【done】は送らない）。
      if (l.heading !== 'done' && !(l.heading === 'review' && role.role === 'staff-engineer')) continue;
      if (l.heading === 'done' && l.briefs !== undefined) {
        const named = l.briefs;
        open = open.filter(b => !named.includes(b.url));
        continue;
      }
      const i = open.findIndex(b => b.seen !== undefined && b.seen <= l.at);
      if (i >= 0) open.splice(i, 1);
    }
  }
  return open;
}

/** 【brief】の行の、依頼書の URL（本文の頭）。 */
const briefUrl = (l: Pick<Sent, 'text'>): string => l.text.slice('【brief】'.length).split(' ')[0] ?? '';

/**
 * 記録の行が、その担当に仕事を振る者（TPM 担当。repo の席には、その Tech Lead 担当）の送った物か、を見る関数。
 * repo の席は、行の送り手の担当の Key（Sent の sender）が親の課題の Key かで見る（Tech Lead 担当の題は替わりうるので、題の字では見ない）。
 * ほかの担当は、今までどおり送り手の題が TPM 担当の題か。
 */
const fromAssigner = (role: RoleRecord): (l: Sent) => boolean => isRepoSeat(role)
  ? l => l.sender?.key === role.subject
  : l => l.from === TPM_TITLE;

/**
 * 仕事を振る者（TPM 担当か Tech Lead 担当）がその担当に送り、まだ済んでいない物。
 * unseen は、送って担当がまだ見ていないメッセージ（届いておらず、roster も見せていない。headings があれば、その見出しだけ）。briefs は、【done】が返っていない依頼書（openBriefs）。
 * どちらも、見たかを見た時刻の口で決める（配られていなくても、送る前の検査や roster inbox で見せた物は見た。台帳 #110）。
 */
function unsettled(ctx: Context, role: RoleRecord, address: string, headings?: HeadingId[]): { unseen: Sent[], briefs: OpenBrief[] } {
  const log = ctx.state.lines<Sent>('log.jsonl');
  const seenAt = seenTimes(ctx, { live: true });
  const assigned = fromAssigner(role);
  // 起こす時の頼みの行（launch）は、送った物ではないので数えない（起きたかは、名乗りで見る）。
  const unseen = log.filter(l => l.launch !== true && l.key === role.key && assigned(l) && l.to === address && (headings === undefined || headings.includes(l.heading as HeadingId)) && seenAt(l) === undefined);
  return { unseen, briefs: openBriefs(role, address, log, seenAt) };
}

/**
 * 送る前の検査（TPM 担当の dismiss と続きの assign）。その担当に、送って済んでいない物があれば、出して止まる（自分の送った物どうしの行き違いを減らす）。
 * choice があれば止まらず、本文に足す一言を返す（取り消す物・済ませてから進む物）。済んでいない物が無いのに choice を付けたら止まる（うその一言を送らない）。
 */
export function assertSettled(ctx: Context, role: RoleRecord, command: 'dismiss' | 'assign', choice?: SettleChoice, by: 'tpm' | 'lead' = 'tpm'): string | undefined {
  const { unseen, briefs } = unsettled(ctx, role, seatOf(ctx, role), command === 'assign' ? ['brief'] : undefined);
  // 届け違いで返した物は、配られて既読になっているので「まだ見ていない」と字を分ける（TPM 担当が【returned】で扱った後なら --supersede で外す）。
  // 届かないまま終わった物は、TPM 担当の片付け（commands/mail.ts の tidyMail）が記録する。Tech Lead 担当が送った物に、その字が出るのは、TPM 担当の片付けの後。
  const returned = returnedIds(ctx);
  // NATS で運んで、届かないまま終わった物（渡せない・期限切れ・席を閉じた）も、宛先の担当は見ていない。
  const lost = new Set(endedLines(ctx).map(e => e.id));
  const what = (l: Sent): string => returned.has(l.id) ? '届け違いで返した' : lost.has(l.id) ? '届かないまま終わった' : 'まだ見ていない';
  // 済んでいない依頼書として挙げる【brief】は、まだ見ていない物として 2 度挙げない。
  const late = unseen.filter(l => !briefs.some(b => b.id === l.id));
  const names = [...briefs.map(b => `${briefName(b.url)}（${b.url}）`), ...late.map(l => `${what(l)}【${l.heading}】（${l.at} に送った。id ${l.id}）`)];
  if (choice !== undefined) {
    if (names.length === 0) throw new TpmError(`${role.key} の担当に、済んでいない物はありません。--${choice} を付けずに打ってください`);
    return choice === 'supersede' ? `取り消す: ${names.join('・')}` : `${names.join('・')}を済ませてから、これをする`;
  }
  if (unseen.length === 0 && briefs.length === 0) return undefined;
  recordGateStop(ctx, 'unsettled', [`${role.key}:`, ...unseen.map(l => l.id), ...briefs.map(b => b.url)].join(' '));
  const how = command === 'dismiss'
    ? `${by === 'tpm' ? 'この依頼書・メッセージをどうするかを Product Manager に確かめてください。' : 'この依頼書・メッセージを、済ませてもらうか取り消すかを決めてください。'}取り消すなら --supersede を付けて打ち直す（本文に「取り消す: …」と載る）。`
    : 'させてから進むなら --after、取り消すなら --supersede を付けて打ち直す（本文に一言が載る）。';
  throw new TpmError([
    `${role.key} の担当に、まだ済んでいない物があります。送っていません。`,
    ...unseen.flatMap(l => [returned.has(l.id)
      ? `--- 届け違いで返した（${l.at} に送った。id ${l.id}。roster returned show ${l.id}。送り直したか、要らないと決めたなら --supersede）`
      : lost.has(l.id)
        ? `--- 届かないまま終わった（渡せない・期限切れ。${l.at} に送った。id ${l.id}。送り直したか、要らないと決めたなら --supersede）`
        : `--- まだ見ていない（届いておらず、roster も見せていない。${l.at} に送った。id ${l.id}）`, l.text]),
    ...(briefs.length === 0 ? [] : [`--- 【done】が返っていない依頼書: ${briefs.map(b => `${briefName(b.url)}（${b.url}）`).join('・')}`]),
    '--- ここまで',
    how,
  ].join('\n'));
}

/** `gh pr view` の JSON（読む欄だけ）。 */
interface PrView {
  state?: string
}

/**
 * PR が merge 済みかを見る（`gh pr view <URL> --json state`）。MERGED でなければ止まる（merge が断られたのに【merged】を送らない）。
 * unchecked（確かめない訳）があれば見ずに通し、メッセージに添える字を返す。確かめたときは空の字。
 * what は、確かめなかった物の名（【merged】【doc-fix】は、main の workflow も見ないので UNCHECKED_BOTH を渡す）。
 */
export function assertMerged(ctx: Context, prs: string[], unchecked?: string, what = 'merge'): string {
  if (unchecked !== undefined) {
    if (unchecked.trim() === '') throw new TpmError('--unchecked には、merge を確かめない訳を書いてください');
    return `（${what} は確かめていない: ${unchecked}）`;
  }
  for (const pr of prs) {
    const r = ctx.exec('gh', ['pr', 'view', pr, '--json', 'state']);
    if (r.status !== 0) {
      recordGateStop(ctx, 'pr-unreadable', pr);
      throw new TpmError(`PR の状態を読めません（gh pr view が失敗）: ${pr}\n${(r.stderr || r.stdout).trim()}\n送っていません。gh で読めない PR なら、merge を自分で確かめてから --unchecked "<確かめた方法>" を付けて打ち直してください。`);
    }
    const state = (JSON.parse(r.stdout) as PrView).state;
    if (state !== 'MERGED') {
      recordGateStop(ctx, 'not-merged', `${pr} ${state ?? '不明'}`);
      throw new TpmError(`PR はまだ merge されていません（state: ${state ?? '不明'}）: ${pr}\n送っていません。merge を確かめてから打ち直してください。`);
    }
  }
  return '';
}

/** --unchecked の時に、【merged】【doc-fix】が確かめなかった物（1 つの旗が、merge の確かめと main の workflow の確かめを、両方とも外す）。 */
const UNCHECKED_BOTH = 'merge と main の workflow';

/**
 * merge した PR の、merge の commit で main に動いた workflow を見て、知らせの本文に足す字を返す（【merged】と【doc-fix】だけ。【end】は見ない）。
 * 担当が `gh run list` を打って読む回を、命令が受け持つ。判じ方は roster watch main と同じ（workflow ごとに、いちばん新しい回）。
 * - まだ動いている・merge の直後（2 分の内。回が、まだ作られきっていないことがある）: 送らずに止まる（roster watch main で待ってから打ち直す）。
 *   落ちた回がもう在っても同じ（みな終わってから送る。送った本文が、後から変わらないように）。
 * - みな終わった: 結果を返す。落ちていても止めない（落ちたことを書いて送る決まり）。取り消された回（concurrency で取り消された docs など）は、落ちたと書かず、取り消しの数を足す。
 * - --pr が PR の URL の形でない: repo が分からないので、読めない時と同じく止まる。
 * - 読めない: 送らずに止まり、--unchecked を求める（PR の状態を読めない時と同じ）。待てば直る物（GitHub が応えない）と、待っても直らない物（認証・権限）で、勧める手を分ける。
 * - unchecked（確かめない訳）があれば、見ずに空の字を返す（訳は assertMerged が本文に足す）。
 */
export function mainWorkflows(ctx: Context, pr: string, unchecked?: string): string {
  if (unchecked !== undefined) return '';
  const ref = parsePr(pr);
  if (ref === undefined) {
    // PR の URL の形でない --pr（番号だけ、など）は、repo が分からず main の workflow を見られない。読めない PR と同じく止める。
    recordGateStop(ctx, 'main-unreadable', pr);
    throw new TpmError(`main の workflow を見られません（--pr が PR の URL の形でない）: ${pr}\n送っていません。--pr に PR の URL（https://github.com/<owner>/<repo>/pull/<番号>）を書いて打ち直してください。GitHub の PR でないなら、main の workflow を自分で確かめてから --unchecked "<確かめた方法>" を付けて打ち直してください。`);
  }
  const look = lookMain(ctx.exec, ref, ctx.now());
  switch (look.state) {
    case 'passed':
      return `／main: workflow ${look.total} つ通った${look.cancelled === undefined ? '' : `・取り消し ${look.cancelled} つ（後の回が済ませたかは見ていない）`}`;
    case 'failed':
      if (look.pending > 0 || look.fresh === true) {
        recordGateStop(ctx, 'main-running', ref.url);
        throw new TpmError(`main の workflow に落ちた物（${namedList(look.failed)}）がありますが、${look.pending > 0 ? `まだ ${look.pending} つが動いています` : 'merge から 2 分の内で、回が作られきっていないかもしれません'}: ${ref.url}\n送っていません。みな終わってから送ります。roster watch main ${ref.url} を裏で起こして待ち（みな終わるまで待つ）、終わってから打ち直してください。`);
      }
      return `／main: 落ちた ${namedList(look.failed)}（ほか: 通った ${look.passed}）`;
    case 'none':
      return '／main: この merge で動いた workflow は無い';
    case 'pending':
      recordGateStop(ctx, 'main-running', ref.url);
      throw new TpmError(`main の workflow が、まだ終わっていません（${look.total === 0 ? 'merge の直後で、回がまだ作られていない' : look.done === look.total ? `merge から 2 分の内。在る ${look.total} つは終わっているが、回が作られきるのを待つ` : `${look.total} つのうち ${look.total - look.done} つが動いている`}）: ${ref.url}\n送っていません。roster watch main ${ref.url} を裏で起こして待ち、終わってから打ち直してください。`);
    case 'unreachable':
      recordGateStop(ctx, 'main-unreadable', ref.url);
      throw new TpmError(`main の workflow を読めません（GitHub が応えない）: ${ref.url}\n${look.message}\n送っていません。roster watch github --repo ${ref.repo} を裏で起こして待ち、戻ってから打ち直してください。待てない時は、merge と main の workflow を自分で確かめてから --unchecked "<確かめた方法>" を付けて打ち直してください（--unchecked は、merge の確かめも外す）。`);
    case 'invalid':
      recordGateStop(ctx, 'main-unreadable', ref.url);
      throw new TpmError(`main の workflow を読めません（待っても直らない誤り）: ${ref.url}\n${look.message}\n送っていません。gh auth status で認証と権限を確かめてください。gh で読めない PR なら、merge と main の workflow を自分で確かめてから --unchecked "<確かめた方法>" を付けて打ち直してください（--unchecked は、merge の確かめも外す）。`);
  }
}

const required = (value: string | undefined, name: string): string => {
  if (value === undefined || value.trim() === '') throw new TpmError(`${name} を書いてください（無ければ「なし」）`);
  return value;
};

/** 記録の 1 行目の一言: 本文の 1 行目を、SUMMARY_LIMIT 字までに切る。 */
export const oneLine = (text: string): string => {
  const first = text.split('\n')[0] ?? '';
  return first.length > SUMMARY_LIMIT ? `${first.slice(0, SUMMARY_LIMIT)}…` : first;
};

// ---- 担当が打つ ----

/** `roster wait` が状態の folder の `waits/<宛先>.jsonc` に書く記録。通知のバナーの hook が「この回に wait pm を打ったか」を見る。 */
export interface WaitRecord {
  kind: WaitKind
  text: string
  at: string
  /** `roster wait pm --hand` の回だけ: 頼んだ手を数えた台帳の件の番号（打ち直しを同じ件に寄せるため）。 */
  hand?: number
}

/** `waits/` の file の名（宛先の : などを替える）。 */
export const waitFile = (address: string): string => `waits/${address.replaceAll(/[^A-Za-z0-9._-]/g, '-')}.jsonc`;

/** Product Manager に頼んだ手の操作の tag（`roster wait pm --hand`）。 */
export const PM_HAND = 'pm-hand';

/**
 * 状態 wait を替え、打った時刻を記録する。hand は、Product Manager に手の操作を頼んで待つ回（wait pm だけ）。
 * 頼んだ手を台帳に数える（権限が足りず人の手が要った回数を、後から数で言えるように）。
 * 前の wait がまだ同じ頼み（--hand で数えた未決の件）のままなら、打ち直しとしてその件に寄せる（同じ頼みを 2 件に数えない）。
 */
export function wait(ctx: Context, kind: WaitKind, what: string, options: { hand?: boolean } = {}): string[] {
  if (options.hand === true && kind !== 'pm') throw new TpmError('--hand は roster wait pm だけに付ける（Product Manager に手の操作を頼んだ回）');
  const text = WAIT[kind](what);
  const address = showWait(ctx, text);
  const before = ctx.state.read<WaitRecord>(waitFile(address));
  const record: WaitRecord = { kind, text, at: ctx.now().toISOString() };
  if (options.hand !== true) {
    ctx.state.write(waitFile(address), record);
    return [`状態: ${text}`];
  }
  const asked = before?.kind === 'pm' && before.hand !== undefined
    ? readIncidents(ctx).find(i => i.n === before.hand && i.source === 'pm-hand' && i.status === 'open')
    : undefined;
  if (asked !== undefined) {
    const folded = foldIntoIncident(ctx, asked, `打ち直し: ${what}`, what);
    ctx.state.write(waitFile(address), { ...record, hand: folded.n });
    return [`状態: ${text}`, `台帳の件に寄せた（打ち直し。新しい件にしない）: ${incidentLine(folded)}`];
  }
  const incident = addIncident(ctx, { key: envOf(ctx.env, 'KEY') || 'tpm', source: 'pm-hand', text: what, tags: [PM_HAND] });
  ctx.state.write(waitFile(address), { ...record, hand: incident.n });
  return [`状態: ${text}`, `台帳に入れた: ${incidentLine(incident)}`, ...tagLines(ctx, incident)];
}

/**
 * 「残り」「残っている物」が「なし」でなければ、台帳に入れる（振るか捨てるかを決めるまで、見直しに出続ける）。入れた行を返す。
 * 【end】の「残っている物」は、同じ Key の未決の【done】の「残り」があれば、そのいちばん新しい件に寄せる（中身が重なることが多いため）。
 */
function keepRemaining(ctx: Context, self: RoleRecord, heading: 'done' | 'end', text: string): string[] {
  if (/^(なし|無し)/.test(text.trim())) return [];
  const done = heading === 'end'
    ? readIncidents(ctx).filter(i => i.source === 'remaining' && i.status === 'open' && i.key === self.key && i.text.startsWith('【done】')).at(-1)
    : undefined;
  if (done !== undefined) {
    foldIntoIncident(ctx, done, `【end】の残り: ${text}`, text);
    return [`台帳の #${done.n}（【done】の残り）に寄せた（TPM 担当が、振るか捨てるかを決める）`];
  }
  const incident = addIncident(ctx, { key: self.key, source: 'remaining', text: `【${heading}】の残り: ${text}` });
  return [`台帳に入れた（TPM 担当が、振るか捨てるかを決める）: #${incident.n}`];
}

/** `roster report incident` の旗。 */
export interface IncidentOptions {
  text: string
  type: string
  tags: string[]
  severe: boolean
}

/** メッセージキューが応えない時に、roster report incident が台帳に書いた後で出す行。 */
const INCIDENT_NOT_SENT = 'メッセージキューが応えないので、TPM 担当には送っていない（台帳には書いた。打ち直さない。TPM 担当にも送れないので、止まった事を返答に書く）';

/** f を動かす。メッセージキューが応えない誤り（QueueDownError）だけを受けて返し、ほかの誤りは投げる。 */
async function unlessQueueDown<T>(f: () => Promise<T>): Promise<T | QueueDownError> {
  try {
    return await f();
  }
  catch (e) {
    if (e instanceof QueueDownError) return e;
    throw e;
  }
}

/** 台帳に書いた後の送りの結果の行。送れなかった時（どの訳でも）は、誤りにせず、送っていない事と訳を出す（誤りで終わると、打ち直しで台帳に 2 件書かれる）。 */
async function sentOrNot(send: () => Promise<string>): Promise<string> {
  try {
    return await send();
  }
  catch (e) {
    if (e instanceof QueueDownError) return INCIDENT_NOT_SENT;
    if (e instanceof TpmError) return `TPM 担当には送っていない（台帳には書いた。打ち直さない）: ${e.message}`;
    throw e;
  }
}

/**
 * 担当が、気づいた出来事（起きた事実）を台帳に書き、TPM 担当に知らせる（【incident】）。課題管理には書かない。
 * 順は、送る前の検査 → 台帳に書く → TPM 担当に送る。まだ渡っていない物があって検査が止めた時は、台帳にも書かない（打ち直しで書く）。
 * メッセージキュー（NATS）が応えない時（検査の問い・置く所のどちらでも）は、止めずに台帳に書き、送っていない事を結果に出して、誤りにせず終わる
 * （誤りで終わると、打ち直しで台帳に 2 件書かれる。応えない事は、queueDown が居場所の状態と gate.jsonl に残してある）。
 * メッセージキューが止まった事を、メッセージキューに頼らずに台帳に残すための、この命令だけの扱い。
 */
export async function reportIncident(ctx: Context, options: IncidentOptions): Promise<string[]> {
  const type = incidentType(options.type);
  const checked = await unlessQueueDown(() => sender(ctx));
  const self = checked instanceof QueueDownError ? requireSelf(ctx) : checked;
  const incident = addIncident(ctx, { key: self.key, source: 'report', text: options.text, type, tags: options.tags, severe: options.severe });
  const tags = incident.tags.length === 0 ? '' : `（tag: ${incident.tags.join('・')}）`;
  const body = `#${incident.n}${incident.severe ? ' [重い]' : ''} ${INCIDENT_TYPES[type]}: ${options.text}${tags}`;
  const sent = checked instanceof QueueDownError ? INCIDENT_NOT_SENT : await sentOrNot(() => toTpm(ctx, self, 'incident', body));
  return [`台帳に書いた: ${incidentLine(incident)}`, ...tagLines(ctx, incident), sent];
}

/** 状態 wait の字を出し、移りを waits.jsonl に残す。自分の宛先を返す。 */
export function showWait(ctx: Context, text: string): string {
  const address = ctx.seats.whoami();
  ctx.seats.setStatus('wait', text);
  recordWait(ctx, address, text);
  return address;
}

/** TPM 担当に決めてほしいことを送り（【ask-tpm】）、状態を回答待ちにする。 */
export async function askTpm(ctx: Context, options: { text: string, waitingFor: string, replyTo?: string, review?: number }): Promise<string[]> {
  const self = await sender(ctx);
  if (options.review === undefined) return [await toTpm(ctx, self, 'ask-tpm', options.text, options.replyTo), ...wait(ctx, 'tpm', options.waitingFor)];
  // レビューの判定を受けずに上げる: TPM 担当は判定を受け取っていないので、レビューのページの URL を本文に足し、上げたことを頼みの記録に残す。
  const review = readReviews(ctx).find(r => r.n === options.review);
  if (review === undefined || review.key !== self.key) throw new TpmError(`--review は、自分の課題（${self.key}）のレビューの頼みの番号にしてください（roster review list --key ${self.key} で見る）`);
  if (review.verdict === undefined || review.page === undefined) throw new TpmError(`レビュー #${review.n} は、まだ判定が返っていません。送っていません`);
  // 上げるのは「直すべき」を受けない時だけ（ほかの判定は、受けるか・直すかを課題の担当が決めて進む）。
  if (review.verdict !== 'reject') throw new TpmError(`レビュー #${review.n} の判定は「${VERDICTS[review.verdict]}」です。--review で上げるのは「${VERDICTS.reject}」を受けない時だけです（ほかの判定は、指摘ごとに自分で決めて進む）。送っていません`);
  const sent = await toTpm(ctx, self, 'ask-tpm', `レビュー #${review.n}（判定: ${VERDICTS[review.verdict]}。${review.page}）を受けない: ${options.text}`, options.replyTo);
  // 2 度目に上げても、最初に上げた時刻を残す。
  if (review.escalatedAt === undefined) patchReview(ctx, review.n, { escalatedAt: ctx.now().toISOString() });
  // 置き場のレビューのページを「上げた」にする（TPM 担当が決めたら roster page reply --answered --on tpm で外す）。
  return [sent, ...await markEscalated(ctx, review.page), ...wait(ctx, 'tpm', options.waitingFor)];
}

/**
 * repo の席が、Tech Lead 担当に問いを送り（【ask-lead】）、状態を回答待ち(Lead) にする。答えは【notify】で来る。
 * Tech Lead 担当の席が無い時（落ちた・応えない）は、送らずに止まる（TPM 担当への相談は roster ask tpm）。
 */
export async function askLead(ctx: Context, options: { text: string, waitingFor: string }): Promise<string[]> {
  const self = await sender(ctx);
  if (!isRepoSeat(self)) throw new TpmError('roster ask lead は、Tech Lead 担当が起こした repo の席が打ちます。ほかの担当は roster ask tpm で TPM 担当に送ってください');
  return [await toBoss(ctx, self, 'ask-lead', options.text), ...wait(ctx, 'lead', options.waitingFor)];
}

/**
 * --supersede で名指した古い確認を、送る前に確かめる。受けるのは、自分の Key の、今返事待ちの確認だけ。
 * 置き場に聞けない時（止まっている）は、返事待ちかを確かめずに通す（送った後に印を外せず、直し方の行が出る）。
 */
async function assertSupersede(ctx: Context, self: RoleRecord, url: string, supersede: string[]): Promise<void> {
  for (const old of supersede) {
    const owner = pageOwner(ctx, old);
    if (owner === undefined) throw new TpmError(`--supersede は、置き場の確認のページの URL にしてください: ${old}`);
    if (owner.project !== basename(ctx.state.dir) || owner.key !== self.key) {
      throw new TpmError(`--supersede: ${self.key} の確認だけを置き換えられます（別の project・Key のページ）: ${old}`);
    }
    if (samePage(ctx, old, url)) throw new TpmError(`--supersede に、送る確認そのものは書けません: ${old}`);
  }
  if (supersede.length === 0) return;
  const waiting = await waitingUrls(ctx, self.key);
  if (waiting === undefined) return;
  const notWaiting = supersede.filter(old => !waiting.some(w => samePage(ctx, w, old)));
  if (notWaiting.length > 0) {
    throw new TpmError([
      `--supersede: 返事待ちではありません（答え済みか、roster ask pm で送っていない）。何も送っていません:`,
      ...notWaiting,
      `今の ${self.key} の返事待ち: ${waiting.length === 0 ? '無し' : waiting.join(' ')}`,
    ].join('\n'));
  }
}

/**
 * Product Manager に決めてほしいことを書いた確認のページを、TPM 担当に送る。ページは開かない（Product Manager は callboard のページの一覧で見る）。
 * supersede は、この確認で置き換える古い確認。送った後、その返事待ちの印を外す（答える要が無くなったため）。
 */
export async function askPm(ctx: Context, options: { url: string, items: string[], waitingFor: string, supersede?: string[] }): Promise<string[]> {
  const self = await sender(ctx);
  notAuditor(self, 'roster ask pm');
  // repo の席の確認は、Tech Lead 担当がまとめて送る（Product Manager への確認が、席ごとにばらばらに届かないように）。
  if (isRepoSeat(self)) throw new TpmError(`repo の席（${self.key}）は roster ask pm を打ちません。Product Manager に決めてほしいことは、roster ask lead で Tech Lead 担当（${self.subject ?? ''}）に送ってください（Tech Lead 担当が、まとめて確認にする）。送っていません`);
  if (options.items.length === 0) throw new TpmError('--item で、決めてほしい項目の題を 1 つ以上書いてください');
  const supersede = options.supersede ?? [];
  const body = [
    `${options.url} 項目: ${options.items.map((item, i) => `(${i + 1}) ${item}`).join(' ')}`,
    ...(supersede.length === 0 ? [] : [`置き換える確認: ${supersede.join(' ')}`]),
  ].join(' ');
  await notRepeatToTpm(ctx, self, 'ask-pm', body);
  await assertSupersede(ctx, self, options.url, supersede);
  const recorded = record(ctx, self, {
    kind: '確認',
    role: noteRole(self),
    summary: `Product Manager に確かめる（${options.items.length} 項）`,
    links: [{ label: '確認', url: options.url }, ...supersede.map(url => ({ label: '置き換えた確認', url }))],
    points: options.items,
  });
  // 前の確認を置き換える時は、置き換えた【ask-pm】を返事の先にする（頼みが、前の頼みを閉じる）。
  const sent = await toTpm(ctx, self, 'ask-pm', body, askedPm(ctx, self.key, supersede));
  // 置き場の確認のページを返事待ちにする（Product Manager が、callboard のページの一覧の印と件数で気づく）。書けなくても、送った事は変わらない。
  // 置き換えた古い確認は、返事待ちから外す（残すと、答える要の無いページが「返事待ち」に出続ける）。
  const marks = await replyLine(ctx, options.url, 'waiting');
  for (const old of supersede) marks.push(...await replyLine(ctx, old, 'answered', '置き換えたので返事待ちを外した'));
  return [...recorded, sent, ...marks, ...wait(ctx, 'pm', options.waitingFor)];
}

/** 共有の環境で DevOps Engineer 担当の手が要ることを、TPM 担当に送る（【ask-devops】）。 */
export async function askDevops(ctx: Context, options: { what: string, why: string, urgent: boolean }): Promise<string[]> {
  const self = await sender(ctx);
  return [await toTpm(ctx, self, 'ask-devops', `何を: ${options.what}／なぜ: ${options.why}／急ぎ: ${options.urgent ? 'はい' : 'いいえ'}`)];
}

/** 自分の PR を 1 本 merge したと知らせる（【merged】）。 */
export async function reportMerged(ctx: Context, options: { pr: string, note: string, unchecked?: string }): Promise<string[]> {
  const self = await sender(ctx);
  notAuditor(self, 'roster report merged');
  const checked = assertMerged(ctx, [options.pr], options.unchecked, UNCHECKED_BOTH);
  const main = mainWorkflows(ctx, options.pr, options.unchecked);
  return [await toBoss(ctx, self, 'merged', `${options.pr} ${options.note}${main}${checked}`)];
}

/** 文書やコメントの食い違いを直した PR を merge したと知らせ、課題があれば記録を書く（【doc-fix】）。 */
export async function reportDocFix(ctx: Context, options: { pr: string, note: string, unchecked?: string }): Promise<string[]> {
  const self = await sender(ctx);
  notAuditor(self, 'roster report doc-fix');
  const checked = assertMerged(ctx, [options.pr], options.unchecked, UNCHECKED_BOTH);
  const main = mainWorkflows(ctx, options.pr, options.unchecked);
  const body = `${options.pr}（merge 済み）${options.note}${main}${checked}`;
  await notRepeatToBoss(ctx, self, 'doc-fix', body);
  const recorded = record(ctx, self, { kind: '文書の修正', role: noteRole(self), summary: options.note, links: [{ label: 'PR（merge 済み）', url: options.pr }], points: [] });
  return [...recorded, await toBoss(ctx, self, 'doc-fix', body)];
}

/** `roster report done --kind` の値（`roster page put --kind` と同じ語）と、課題に書く記録の種類。 */
export const DONE_KINDS = { proposal: '提案', plan: '計画', result: '結果', audit: '監査' } as const satisfies Record<string, NoteKind>;
/** `roster report done --kind` に書ける値。 */
export type DoneKind = keyof typeof DONE_KINDS;

/** `--kind` の値を読む。前の値（提案・計画・結果）は誤りにし、替わりの値を案内する。 */
export function doneKind(value: string): DoneKind {
  if (Object.hasOwn(DONE_KINDS, value)) return value as DoneKind;
  const renamed = Object.entries(DONE_KINDS).find(([, note]) => note === value)?.[0];
  if (renamed !== undefined) throw new TpmError(`--kind ${value} は ${renamed} に替わりました（--kind ${renamed}）`);
  throw new TpmError(`--kind は ${Object.keys(DONE_KINDS).join('・')} のどれかにしてください`);
}

/** `roster report done` の旗。 */
export interface DoneOptions {
  url?: string
  /** 成果の種類。課題の記録は DONE_KINDS の日本語の種類で書く。 */
  kind: DoneKind
  summary: string
  /** 依頼の外で直すとよい物・やらなかった物・merge していない PR。無ければ「なし」。 */
  remaining?: string
  /** 【ask-pm】で送った項目の題。無ければ「なし」。 */
  decisions?: string
  points: string[]
  /** 1 通で済ませた依頼書（名か URL）。無ければ、見ていた依頼書のいちばん古い 1 つを済ませる。 */
  briefs?: string[]
}

/** 誤りで止まったら undefined を返す（止めずに済ませる物のため）。 */
function quietly<T>(f: () => T): T | undefined {
  try {
    return f();
  }
  catch (e) {
    if (e instanceof TpmError) return undefined;
    throw e;
  }
}

/** 担当（自分）に渡されていて、【done】が返っていない依頼書。見たかは、TPM 担当の検査（unsettled）と同じ見た時刻の口で決める。 */
function ownOpenBriefs(ctx: Context, self: RoleRecord): OpenBrief[] {
  const address = self.address ?? ctx.seats.whoami();
  return openBriefs(self, address, ctx.state.lines<Sent>('log.jsonl'), seenTimes(ctx, { live: true }));
}

/**
 * --briefs に名指した依頼書を、済んでいない依頼書の URL に引き当てる。URL は置き場の同じページか（前の置き場の URL も）で、名（brief-2）は当たるのが 1 つの時だけ受ける。
 * 当たらない・2 つ当たる時は、送らずに止まる（うその「済ませた」を送らない）。
 */
function namedBriefs(ctx: Context, open: OpenBrief[], specs: string[]): string[] {
  const list = open.length === 0 ? '無し' : open.map(b => `${briefName(b.url)}（${b.url}）`).join('・');
  const urls = specs.map((spec) => {
    // 同じ URL の依頼書が 2 つ積まれていても（送り直した時）、同じ依頼書なので 1 つに数える。
    const hits = [...new Set(open.filter(b => /^https?:\/\//.test(spec) ? b.url === spec || samePage(ctx, b.url, spec) : briefName(b.url) === spec).map(b => b.url))];
    if (hits.length > 1) throw new TpmError(`--briefs の ${spec} に当たる依頼書が ${hits.length} つあります。URL で名指してください。送っていません。\n済んでいない依頼書: ${list}`);
    const [hit] = hits;
    if (hit === undefined) throw new TpmError(`--briefs の ${spec} は、渡されていて済んでいない依頼書にありません。送っていません。\n済んでいない依頼書: ${list}`);
    return hit;
  });
  // 名と URL で同じ依頼書を 2 度名指しても、1 つにまとめる。
  return [...new Set(urls)];
}

/** 本文で依頼書を見せる字。名が済んでいない依頼書の中で 2 つ以上に当たる時だけ、URL を添える（TPM 担当がどれか分かるように）。 */
const briefLabel = (open: OpenBrief[], url: string): string => {
  const name = briefName(url);
  return new Set(open.filter(b => briefName(b.url) === name).map(b => b.url)).size > 1 ? `${name}（${url}）` : name;
};

/** 依頼書 1 つの成果を出した。TPM 担当は「残り」と「決めてほしいこと」で【dismiss】を送るかを決めるので、どちらも必ず書く。 */
export async function reportDone(ctx: Context, options: DoneOptions): Promise<string[]> {
  const self = await sender(ctx);
  notAuditor(self, 'roster report done');
  const remaining = required(options.remaining, '--remaining（残り）');
  const decisions = required(options.decisions, '--decisions（決めてほしいこと）');
  const kind = DONE_KINDS[options.kind];
  const naming = options.briefs !== undefined && options.briefs.length > 0;
  // 名指した時は、引き当てが誤りで止まれば送らない。名指さない時の数えは案内のためだけなので、連携の道具が誤りで止まっても送る（今までどおり）。
  const open = naming ? ownOpenBriefs(ctx, self) : quietly(() => ownOpenBriefs(ctx, self)) ?? [];
  const named = naming ? namedBriefs(ctx, open, options.briefs ?? []) : undefined;
  const body = `${options.url === undefined ? '' : `${options.url} `}要点: ${options.summary}／残り: ${remaining}／決めてほしいこと: ${decisions}${named === undefined ? '' : `／済ませた依頼書: ${named.map(u => briefLabel(open, u)).join('・')}`}`;
  await notRepeatToBoss(ctx, self, 'done', body);
  const recorded = record(ctx, self, {
    kind,
    role: noteRole(self),
    summary: oneLine(options.summary),
    links: options.url === undefined ? [] : [{ label: kind, url: options.url }],
    points: options.points,
  });
  // 返事の先は、この【done】が済ませる依頼書（名指した物、無ければ見ていたいちばん古い 1 つ。openBriefs と同じ決め方）のうち、送った id の分かるいちばん古い物。
  const at = ctx.now().toISOString();
  const settles = named === undefined ? open.filter(b => b.seen !== undefined && b.seen <= at).slice(0, 1) : open.filter(b => named.includes(b.url));
  const sent = await toBoss(ctx, self, 'done', body, named === undefined ? {} : { briefs: named }, settles.find(b => b.id !== undefined)?.id);
  // repo の席は、次の依頼書を Tech Lead 担当から受ける。
  const next = isRepoSeat(self) ? WAIT_NEXT_BRIEF_LEAD : WAIT_NEXT_BRIEF;
  showWait(ctx, next);
  // 名指さず、見ていて済んでいない依頼書がいくつもあれば、済んだのは古い 1 つだけと知らせる（止めない。1 通で済ませた時の名指し忘れ）。
  const seenOpen = named === undefined ? open.filter(b => b.seen !== undefined) : [];
  const hint = seenOpen.length < 2 ? [] : [`済ませた依頼書がいくつもあれば --briefs で名指す（今は ${briefName(seenOpen[0]?.url ?? '')} だけを済ませた。済んでいない: ${seenOpen.slice(1).map(b => briefName(b.url)).join('・')}）`];
  return [...recorded, sent, ...keepRemaining(ctx, self, 'done', remaining), ...hint, `状態: ${next}（次の【brief】か【dismiss】を待つ。自分から【end】を送らない）`];
}

/** `roster report end` の旗。 */
export interface EndOptions {
  url?: string
  prs: string[]
  removed: string[]
  /** 残っている物。無ければ「なし」。 */
  left?: string
  /** --pr の merge を確かめない訳（gh で読めない PR）。 */
  unchecked?: string
}

/** 【dismiss】を受けて片付けた。課題に結果を書き、課題を閉じる（担当の交代なら閉じない）。 */
export async function reportEnd(ctx: Context, options: EndOptions): Promise<string[]> {
  const self = await sender(ctx);
  notAuditor(self, 'roster report end');
  if (self.dismissed === undefined && !ROLES[self.role].endsWithoutDismiss) {
    throw new TpmError('【dismiss】がまだ来ていません。【done】の後は次の【brief】か【dismiss】を待ち、自分から【end】を送らない');
  }
  // Tech Lead 担当は、起こした repo の席を片付けてから終える（閉じ忘れの席を残さない）。
  const seats = self.role === 'tech-lead' ? repoSeats(ctx, self.key) : [];
  if (seats.length > 0) throw new TpmError(`repo の席が名簿に残っています（${seats.map(r => r.key).join('・')}）。【end】は送っていません。席ごとに roster seat dismiss <名> で片付けの指示を送り、【end】を受けて roster seat close <名> で閉じてから、打ち直してください（居場所の無い席は、そのまま roster seat close <名> で閉じる）`);
  const left = required(options.left, '--left（残っている物）');
  const checked = assertMerged(ctx, options.prs, options.prs.length === 0 ? undefined : options.unchecked);
  const body = `成果: ${options.url ?? 'なし'}／merge した PR: ${options.prs.join(' ') || 'なし'}／消した worktree: ${options.removed.join(' ') || 'なし'}／残っている物: ${left}${checked}`;
  await notRepeatToBoss(ctx, self, 'end', body);
  const links: NoteLink[] = [
    ...(options.url === undefined ? [] : [{ label: '成果', url: options.url }]),
    ...options.prs.map(pr => ({ label: 'PR（merge 済み）', url: pr })),
  ];
  const out = record(ctx, self, { kind: '結果', role: noteRole(self), summary: `片付けた（残っている物: ${oneLine(left)}）`, links, points: [] });
  if (self.issue !== undefined && ctx.tracker.owns(self.issue)) {
    if (self.dismissed === 'handover') {
      out.push(`課題は閉じない: ${self.issue}（担当の交代。次の担当が引き継ぐ）`);
    }
    else if (isRepoSeat(self)) {
      // 分けた課題は、repo の席が先に片付けを終える。課題を済みにするのは、Tech Lead 担当の片付けの時。
      out.push(`課題は閉じない: ${self.issue}（repo の席。課題を済みにするのは、Tech Lead 担当の片付けの時）`);
    }
    else {
      ctx.tracker.close(self.issue);
      out.push(`課題を閉じた: ${self.issue}`);
    }
  }
  out.push(await toBoss(ctx, self, 'end', body, {}, lastDismiss(ctx, self)), ...keepRemaining(ctx, self, 'end', left));
  // repo の席を閉じるのは、Tech Lead 担当（roster seat close）。
  const closing = isRepoSeat(self) ? WAIT_SEAT_CLOSE : WAIT_CLOSE;
  showWait(ctx, closing);
  out.push(`状態: ${closing}（居場所は自分で閉じない）`);
  return out;
}

/** その担当（今の居場所）が受けた、いちばん新しい【dismiss】の id（【end】の返事の先）。無ければ undefined（【dismiss】を待たずに終える役割など）。 */
function lastDismiss(ctx: Context, self: RoleRecord): string | undefined {
  // 【dismiss】を受けていない席（【dismiss】を待たずに終える役割・【dismiss】の後に【brief】で戻された席）は、前の【dismiss】を先にしない。
  if (self.dismissed === undefined) return undefined;
  const assigned = fromAssigner(self);
  return byTime(ctx.state.lines<Sent>('log.jsonl')).findLast(l => l.heading === 'dismiss' && l.key === self.key && assigned(l) && (self.address === undefined || l.to === self.address))?.id;
}

/** 送った時刻の順（同じ時刻は file の順のまま）。後から足した行（commands/mail.ts の tidyMail）は file の末尾に入るので、file の順では引かない。 */
const byTime = (log: Sent[]): Sent[] => [...log].sort((a, b) => a.at.localeCompare(b.at));

/** Dependabot の PR だけで使う見出し。recreated は、新しい番号の題に替える。 */
export async function reportDependabot(ctx: Context, id: 'merge-request' | 'not-yet' | 'recreated', options: { text: string, title?: string }): Promise<string[]> {
  const self = await sender(ctx);
  const out: string[] = [];
  if (id === 'recreated' && options.title !== undefined) {
    ctx.seats.setTitle(options.title);
    self.title = options.title;
    writeRole(ctx, self);
    out.push(`題を替えた: ${options.title}`);
  }
  out.push(await toTpm(ctx, self, id, options.text));
  if (id === 'merge-request') out.push(...wait(ctx, 'tpm', 'merge'));
  return out;
}

// ---- Auditor が打つ ----

/** `roster report audit` の旗。 */
export interface AuditOptions {
  /** 監査のページ（roster page put --kind audit で置いた URL）。 */
  url: string
  summary: string
  /** Product Manager に決めてほしい項目の題（無ければ空）。 */
  items: string[]
}

/**
 * Auditor が、監査のページを Product Manager へじかに報告した（報告は Audit の席とページに出ている）。
 * 記録を残し、TPM 担当に写しを送り（【audit】。TPM 担当は伝え直さない）、状態を回答待ち(PM) にする（その回の終わりに通知のバナーが出る）。
 * TPM 担当が起きていなくても報告はできる（写しは送らず、その事を出す）。
 */
export async function reportAudit(ctx: Context, options: AuditOptions): Promise<string[]> {
  const self = await auditor(ctx, 'roster report audit');
  if (!isPageUrl(ctx.env, options.url)) throw new TpmError(`--url は、roster page put --kind audit で置いた監査のページの URL にしてください: ${options.url}`);
  const decisions = options.items.length === 0 ? 'なし' : options.items.map((item, i) => `(${i + 1}) ${item}`).join(' ');
  const body = `${options.url} 要点: ${options.summary}／決めてほしいこと: ${decisions}（写し。Product Manager には Audit の席でじかに報告した。伝え直さなくてよい）`;
  const copied = tpmSeat(ctx) !== undefined;
  const sent = copied ? await toTpm(ctx, self, 'audit', body) : 'TPM 担当が起きていないので、写しは送っていない（報告は、この席とページで Product Manager に出す）';
  appendAudit(ctx, { kind: 'report', url: options.url, summary: options.summary, items: options.items, copied });
  return [sent, ...wait(ctx, 'pm', '監査の報告'), 'この席に、要点と決めてほしいことを書いて、Product Manager の答えを待つ'];
}

/** `roster report decided` の旗。どれも、監査のページの勧告の題。 */
export interface DecidedOptions {
  url: string
  /** する（TPM 担当が課題にして振る）。 */
  adopted: string[]
  /** 受け入れる（直さない）。 */
  accepted: string[]
  /** 見送る（今は決めない）。 */
  later: string[]
}

/**
 * Auditor が、Product Manager の決定を TPM 担当に渡す（【decided】）。TPM 担当は「する」の勧告を課題にして振る。
 * TPM 担当が起きていなければ、送らず・記録せずに止まる（起きた後に打ち直す）。
 */
export async function reportDecided(ctx: Context, options: DecidedOptions): Promise<string[]> {
  const self = await auditor(ctx, 'roster report decided');
  if (options.adopted.length + options.accepted.length + options.later.length === 0) throw new TpmError('--do・--accept・--later のどれかで、勧告の題を 1 つ以上書いてください');
  if (tpmSeat(ctx) === undefined) throw new TpmError('TPM 担当が起きていません。決定は送っていません・記録していません。Product Manager にそう伝え、TPM 担当が起きた後に、同じ命令を打ち直してください');
  const part = (label: string, titles: string[]): string[] => titles.length === 0 ? [] : [`${label}: ${titles.join('・')}`];
  const body = `${options.url} ${[...part('する', options.adopted), ...part('受け入れる', options.accepted), ...part('見送る', options.later)].join('／')}`;
  const sent = await toTpm(ctx, self, 'decided', body);
  appendAudit(ctx, { kind: 'decided', url: options.url, adopted: options.adopted, accepted: options.accepted, later: options.later });
  // Product Manager は今この席で答えたところなので、バナーは出さない（wait の記録は書かず、状態の字だけ替える）。
  const text = WAIT.pm('次の /audit');
  showWait(ctx, text);
  return [sent, `状態: ${text}`];
}

// ---- TPM 担当が打つ ----

/** 動いている担当に、新しい依頼書を送る。 */
export async function brief(ctx: Context, role: RoleRecord, url: string, note?: string, settled?: { text: string, choice: SettleChoice }, from: string = TPM_TITLE): Promise<string[]> {
  await assertRead(ctx, `${role.key} の担当`, role.title);
  const body = [url, issueCopyLine(role), note, settled?.text].filter(v => v !== undefined).join(' ');
  // 前の依頼書を取り消す時は、取り消した依頼書（送った id の分かるいちばん古い物）を返事の先にする（頼みが、前の頼みを閉じる）。
  const superseded = settled?.choice === 'supersede' ? unsettled(ctx, role, seatOf(ctx, role)).briefs.find(b => b.id !== undefined)?.id : undefined;
  // 取り消す依頼書が無ければ、その席のまだ応えていない問いが 1 つの時、それを返事の先にする（仕事を振る者は、問いに次の依頼書で応えることがある）。
  const asked: AskReply = superseded === undefined ? askReply(ctx, role, from === TPM_TITLE ? 'tpm' : 'lead', false) : { lines: [] };
  const sent = await toRole(ctx, role, 'brief', body, superseded ?? asked.replyTo, { settle: settled?.choice ?? 'none' }, from);
  role.brief = url;
  delete role.dismissed;
  writeRole(ctx, role);
  // 問いを返事の先にした時は、【notify】と同じに、付けたことを出す（黙って付けない）。
  return [sent, ...asked.lines];
}

/** 課題の写しの一言（【brief】と担当の roster hello）。写しも、作らなかった訳も無ければ undefined。 */
export function issueCopyLine(role: RoleRecord): string | undefined {
  if (role.issuePage !== undefined) return `課題の写し: ${role.issuePage}`;
  if (role.issueCopySkipped !== undefined) return `課題の写し: 無し（${role.issueCopySkipped}）`;
  return undefined;
}

/** `roster answer` の旗。 */
export interface AnswerOptions {
  text: string
  replyTo?: string
  /** 答えた確認のページの URL。無ければ、その Key の返事待ちのページ（1 枚の時だけ）。 */
  urls?: string[]
  /** その Key の返事待ちのページの、みなへの答え。 */
  all?: boolean
}

/**
 * 答えたにする、置き場のページの URL。--url があればそれ。無ければ、その Key の返事待ちのページ。
 * 返事待ちが 2 枚以上あって、どれへの答えかが書かれていなければ、送る前に止まる（別の確認まで「答えた」にしないため）。
 * 置き場に聞けない時（止まっている）と、返事の状態を持てない前の置き場では空（印は付けないが、答えは返す）。
 */
async function answeredPages(ctx: Context, key: string, options: AnswerOptions): Promise<string[]> {
  const urls = options.urls ?? [];
  const foreign = urls.find(url => !isStorePage(ctx, url));
  if (foreign !== undefined) throw new TpmError(`--url は、置き場の確認のページの URL にしてください: ${foreign}`);
  if (urls.length > 0) return urls;
  const waiting = await waitingUrls(ctx, key) ?? [];
  if (waiting.length > 1 && options.all !== true) {
    throw new TpmError([
      `${key} に、返事待ちのページが ${waiting.length} 枚あります。答えは送っていません・記録も書いていません。`,
      ...waiting,
      'どのページへの答えかを --url <URL>（何度でも）で書くか、みなへの答えなら --all を付けて、打ち直してください',
    ].join('\n'));
  }
  return waiting;
}

/** 【ask-pm】の行の、確認のページの URL（本文の頭）。 */
const askPmUrl = (l: Pick<Sent, 'text'>): string => l.text.slice('【ask-pm】'.length).split(' ')[0] ?? '';

/**
 * その Key の担当が、urls の確認のページを送った【ask-pm】の id（【answer】と、置き換える【ask-pm】の返事の先）。無ければ undefined。
 * 同じページを 2 度送っていれば新しい方（古い方は、答え済みかもしれない）。ページがいくつもあれば、そのうちいちばん古い物。
 */
function askedPm(ctx: Context, key: string, urls: string[]): string | undefined {
  if (urls.length === 0) return undefined;
  const asked = byTime(ctx.state.lines<Sent>('log.jsonl')).filter(l => l.heading === 'ask-pm' && l.key === key);
  const latest = urls.flatMap(u => asked.findLast(l => samePage(ctx, askPmUrl(l), u)) ?? []);
  return byTime(latest)[0]?.id;
}

/** Product Manager の答えを返す。課題があれば、返す前に「決定」の記録を書く。返した後、置き場の返事待ちのページを答えたにする。 */
export async function answer(ctx: Context, key: string, options: AnswerOptions): Promise<string[]> {
  requireTpmSide(ctx, 'roster answer');
  const role = await receiver(ctx, key);
  if (role.address !== undefined) await assertNotRepeat(ctx, 'answer', TPM_TITLE, role.address, options.text, options.replyTo);
  const pages = await answeredPages(ctx, key, options);
  const recorded = record(ctx, role, { kind: '決定', role: 'TPM', summary: oneLine(options.text), links: [], points: [] });
  // 返事の先は、旗が無ければ、答えた確認を送った【ask-pm】（いくつもあれば、いちばん古い物）。
  const sent = await toRole(ctx, role, 'answer', options.text, options.replyTo ?? askedPm(ctx, key, pages));
  const marks: string[] = [];
  for (const url of pages) marks.push(...await replyLine(ctx, url, 'answered'));
  return [...recorded, sent, ...marks];
}

/** 問いに応える者（仕事を振る者）: TPM 担当か、repo の席の Tech Lead 担当。 */
type Answerer = 'tpm' | 'lead';

/** 応える者ごとの、問いの見出し（TPM 担当の【notify】は【ask-tpm】【ask-devops】の、Tech Lead 担当の【notify】は【ask-lead】の返事になる）。 */
const ASKS: Record<Answerer, HeadingId[]> = { tpm: ['ask-tpm', 'ask-devops'], lead: ['ask-lead'] };

/**
 * その席（今の居場所）が送り、まだ応えていない問い（古い順）: 返事の先に指されておらず、応える者が「広く応えうる送り」をその席へ最後に送った時より後の物。
 * 広く応えうる送りは、返事の先を持たない【notify】【brief】【dismiss】【answer】（前の版の、旗を打たなかった返事も、ここに入る）。
 * 返事の先を名指した送りは、指した問いだけを閉じる（ほかの問いは残る）。--no-reply の知らせ（行の印 noReply）は、問いへの返事でないので、どの問いも閉じない。
 * 返事の先を付ける前の問いや、先無しで応え済みの問いを、溜めない。
 */
function openAsks(ctx: Context, role: RoleRecord, by: Answerer): Sent[] {
  const log = byTime(ctx.state.lines<Sent>('log.jsonl'));
  // Tech Lead 担当の送りは、送り手の担当で見る（fromAssigner）。TPM 担当の送りは、送り手の題で見る（repo の席の【ask-tpm】にも、TPM 担当が答える）。
  const answerer: (l: Sent) => boolean = by === 'lead' ? fromAssigner(role) : l => l.from === TPM_TITLE;
  const last = log.findLast(l => l.launch !== true && l.replyTo === undefined && l.noReply !== true && l.key === role.key && answerer(l) && (role.address === undefined || l.to === role.address))?.at ?? '';
  const replied = new Set(log.flatMap(l => l.replyTo ?? []));
  return log.filter(l => l.key === role.key && ASKS[by].includes(l.heading as HeadingId) && l.sender?.key === role.key
    && l.at > last && (role.helloAt === undefined || l.at >= role.helloAt) && !replied.has(l.id));
}

/** 仕事を振る者が、その席へ送る物の、返事の先の決め（{@link askReply}）。 */
interface AskReply {
  replyTo?: string
  /** 命令が返事の先を付けた時に、結果に出す行。 */
  lines: string[]
}

/**
 * 仕事を振る者が席へ送る物（【notify】【brief】【dismiss】）の返事の先を、その席のまだ応えていない問いから決める。
 * 問いが 1 つなら、それを返事の先にし、付けたことを結果に出す行を返す。無ければ付けない。2 つ以上の時、【notify】（strict）は、どの問いへの返事かを
 * 取り違えないよう、送らずに止まって問いを並べる（--reply-to か --no-reply で打ち直す）。【brief】【dismiss】は、付けずに送る（止めない）。
 */
function askReply(ctx: Context, role: RoleRecord, by: Answerer, strict: boolean): AskReply {
  const open = openAsks(ctx, role, by);
  const [only] = open;
  if (only === undefined) return { lines: [] };
  if (open.length === 1) return { replyTo: only.id, lines: [`返事の先: 【${only.heading}】${oneLine(only.text.slice(only.heading.length + 2))}（id ${only.id}）を付けた`] };
  if (!strict) return { lines: [] };
  recordGateStop(ctx, 'asks', [`${role.key}:`, ...open.map(l => l.id)].join(' '));
  throw new TpmError([
    `${role.key} の担当の、まだ応えていない問いが ${open.length} つあります。送っていません。`,
    ...open.map(l => `--- ${l.at} 【${l.heading}】${oneLine(l.text.slice(l.heading.length + 2))}（id ${l.id}）`),
    '--- ここまで',
    'どの問いへの返事かを --reply-to <id> で名指すか、問いへの返事でなければ --no-reply を付けて、打ち直してください（名指して答えた後も、残りの問いは数えたまま）',
  ].join('\n'));
}

/** `roster notify`・`roster seat notify` の旗。 */
export interface NotifyOptions {
  text: string
  /** 返事の先を名指す。 */
  replyTo?: string
  /** 問いへの返事でない（返事の先を付けない）。 */
  noReply?: boolean
}

/**
 * 【notify】を送る: 返事の先は、旗で名指した物。--no-reply なら付けず、行に印を残す（問いを閉じない）。どちらも無ければ、その席のまだ応えていない問い
 * （{@link askReply}）。旗で名指していない時は、返事の先を引く前に、同じ本文の 2 度送りを見る（命令が引いた返事の先は、1 度目と 2 度目で違いうる）。
 */
async function sendNotify(ctx: Context, role: RoleRecord, options: NotifyOptions, by: Answerer, from: string): Promise<string[]> {
  if (options.replyTo !== undefined && options.noReply === true) throw new TpmError('--reply-to と --no-reply は、どちらか 1 つにしてください。送っていません');
  if (options.replyTo === undefined && role.address !== undefined) await assertNotRepeat(ctx, 'notify', from, role.address, options.text);
  const reply: AskReply = options.replyTo !== undefined
    ? { replyTo: options.replyTo, lines: [] }
    : options.noReply === true ? { lines: [] } : askReply(ctx, role, by, true);
  return [await toRole(ctx, role, 'notify', options.text, reply.replyTo, options.noReply === true ? { noReply: true } : {}, from), ...reply.lines];
}

/**
 * 担当に、返事の要らないメッセージを送る（【notify】）。その席にまだ応えていない問い（【ask-tpm】【ask-devops】）が 1 つあれば、
 * それを返事の先にする（命令が付ける。問いへの返事でなければ --no-reply）。
 */
export async function notify(ctx: Context, key: string, options: NotifyOptions): Promise<string[]> {
  requireTpmSide(ctx, 'roster notify');
  return sendNotify(ctx, await receiver(ctx, key), options, 'tpm', TPM_TITLE);
}

/**
 * Tech Lead 担当が、自分の repo の席に、返事の要らないメッセージ（知らせ・問いへの答え）を送る（【notify】。seat.ts の seatNotify）。
 * その席にまだ応えていない【ask-lead】が 1 つあれば、それを返事の先にする。
 */
export async function notifySeat(ctx: Context, lead: RoleRecord, seat: RoleRecord, options: NotifyOptions): Promise<string[]> {
  return sendNotify(ctx, await receiver(ctx, seat.key), options, 'lead', lead.title);
}

/** この課題に続きは無い、と知らせる。handover は担当の交代（課題は続くので、担当は課題を閉じない）。 */
export async function dismiss(ctx: Context, key: string, options: { handover: boolean, supersede?: boolean }): Promise<string[]> {
  requireTpmSide(ctx, 'roster dismiss');
  if (readRole(ctx, key)?.role === 'auditor') throw new TpmError('Auditor の席に【dismiss】は送れません（Auditor の席は、Product Manager が起こし、閉じる）');
  // Staff Engineer 担当は worktree も PR も持たないので、片付けのやりとり（【dismiss】と【end】）は要らない。
  if (readRole(ctx, key)?.role === 'staff-engineer') throw new TpmError(`Staff Engineer 担当の席に【dismiss】は送りません。roster close ${key} で閉じます（課題の席を roster close で閉じる時にも、一緒に閉じる）`);
  const seat = readRole(ctx, key);
  if (seat !== undefined && isRepoSeat(seat)) throw new TpmError(`${key} は、${seat.subject ?? ''} の Tech Lead 担当が起こした repo の席です。片付けの指示は Tech Lead 担当が送ります。残った席は、roster close ${seat.subject ?? ''} が一緒に閉じます`);
  const role = await receiver(ctx, key);
  const settled = assertSettled(ctx, role, 'dismiss', options.supersede === true ? 'supersede' : undefined);
  const body = [options.handover
    ? '担当の交代のため（課題は続くので、課題は閉じない）。worktree を片付けて【end】を返す。'
    : 'この課題に続きは無い。worktree と課題を片付けて【end】を返す。', settled].filter(v => v !== undefined).join('');
  // その席のまだ応えていない問いが 1 つなら、それを返事の先にする（問いに、片付けの指示で応えた）。
  const asked = askReply(ctx, role, 'tpm', false);
  const sent = await toRole(ctx, role, 'dismiss', body, asked.replyTo);
  role.dismissed = options.handover ? 'handover' : 'done';
  writeRole(ctx, role);
  // 答えが要らなくなった確認が、置き場で返事待ちのまま残らないように知らせる（止めない）。
  const all = await waitingByParty(ctx, key);
  const left = (['pm', 'review', 'tpm'] as const).flatMap((on) => {
    const waiting = all?.[on] ?? [];
    return waiting.length === 0
      ? []
      : [`置き場に、${key} の${WAITING_PAGES[on]}が ${waiting.length} 枚残っています:`, ...waiting, `もう答えが要らなければ、roster page reply <URL>… --answered${on === 'pm' ? '' : ` --on ${on}`} で印を外す`];
  });
  return [sent, ...asked.lines, ...left];
}

/**
 * Tech Lead 担当が、自分の repo の席に、片付けの指示を送る（【dismiss】。seat.ts の seatDismiss）。席は worktree を片付けて【end】を Tech Lead 担当へ返す
 * （repo の席の【end】は、課題を済みにしない）。済んでいない依頼書・まだ見ていない物があれば止まる（--supersede で取り消す）。
 * 置き場の返事待ちのページは出さない（TPM 担当の dismiss は出す）: repo の席のページは親の課題の Key で置かれ、席ごとには引けない。
 * 親の課題の返事待ちは、TPM 担当が Tech Lead 担当に送る TPM 担当の命令（課題の Key を名指した roster dismiss）が、まとめて出す。
 */
export async function dismissSeat(ctx: Context, lead: RoleRecord, seat: RoleRecord, options: { supersede?: boolean }): Promise<string[]> {
  const role = await receiver(ctx, seat.key);
  const settled = assertSettled(ctx, role, 'dismiss', options.supersede === true ? 'supersede' : undefined, 'lead');
  const body = ['この席の仕事に続きは無い。worktree を片付けて【end】を返す（課題は済みにならない。済みにするのは Tech Lead 担当の片付けの時）。', settled].filter(v => v !== undefined).join('');
  const asked = askReply(ctx, role, 'lead', false);
  const sent = await toRole(ctx, role, 'dismiss', body, asked.replyTo, {}, lead.title);
  role.dismissed = 'done';
  writeRole(ctx, role);
  return [sent, ...asked.lines];
}

/** URL を自分の居場所で開いて、人に見せる。 */
export function show(ctx: Context, url: string): string[] {
  ctx.seats.show(url);
  return [`開いた: ${url}`];
}
