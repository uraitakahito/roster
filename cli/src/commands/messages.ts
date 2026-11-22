// 見出しの付いたメッセージを送る命令。送る・届いたかを見る・課題に記録を書く・状態を替える、を 1 度にする。
// 担当が打つ物（ask・report・wait）と、TPM 担当が打つ物（answer・notify・dismiss・show）。brief は命令でなく、assign の中で使う。
// レビューの頼み（tpm ask review）と判定（tpm report review）は staff.ts にある（課題の担当と Staff Engineer 担当の席の間を、じかに届ける）。
// Auditor は、成果を tpm report audit（Product Manager へじかに出した報告の写し）と tpm report decided（Product Manager の決定）で出す。
import { basename } from 'node:path';
import { appendAudit } from '../audits.ts';
import type { Context } from '../context.ts';
import { recordGateStop, recordWait } from '../evidence.ts';
import { addIncident, foldIntoIncident, incidentLine, incidentType, INCIDENT_TYPES, readIncidents, tagLines } from '../incidents.ts';
import { message, ROLES, TPM_TITLE, WAIT, WAIT_CLOSE, WAIT_NEXT_BRIEF, type HeadingId, type WaitKind } from '../protocol.ts';
import { readRole, requireRole, requireSelf, requireTpm, requireTpmSide, writeRole, type RoleRecord, type TpmRecord } from '../roster.ts';
import { patchReview, readReviews, VERDICTS } from '../reviews.ts';
import { TpmError } from '../skill-sets.ts';
import { MAX_POINTS, type Note, type NoteKind, type NoteLink } from '../tracker/types.ts';
import type { Incoming } from '../transport/types.ts';
import { isStorePage, pageOwner, replyLine, samePage, waitingUrls } from './reply.ts';
import { isPageUrl } from './store.ts';
import { readShown, seenTimes, shownFile, type SeenAt } from '../seen.ts';

/** 記録の 1 行目の一言に使う長さの上限（メッセージの本文から作るとき）。 */
const SUMMARY_LIMIT = 80;

interface Sent {
  at: string
  key: string
  heading: string
  from: string
  to: string
  text: string
  id: string
  delivered: boolean
  /** 返事の先のメッセージの id（--reply-to）。 */
  replyTo?: string
  /**
   * 【brief】の行だけ: 送った時に、済んでいない前の依頼書をどう扱ったか（none は扱う物が無かった）。
   * 前の版が書いた行には無いので、本文の「取り消す: 」で読む（openBriefs）。
   */
  settle?: SettleChoice | 'none'
  /** 担当から担当へじかに送った行（レビューの頼みと判定）。前の版が TPM 担当へ送った【ask-review】【review】の行には無い。 */
  peer?: true
}

/** 同じメッセージの 2 度送りとみなす間（秒）。 */
const REPEAT_SECONDS = 30;

/**
 * 同じ差出人が、同じ宛先に、同じ見出し・本文・返事の先のメッセージを REPEAT_SECONDS 秒の内に送っていたら止まる。
 * 止まった命令の打ち直しを `;` や `||` で 1 行に続けて書くと、止まらなかった時にも 2 度目が動く（課題の記録も 2 件になる）。
 * 課題に記録を書く命令は、記録の前にもこれを呼ぶ。
 */
function assertNotRepeat(ctx: Context, id: HeadingId, from: string, to: string, body: string, replyTo?: string): void {
  const text = message(id, body);
  const since = ctx.now().getTime() - REPEAT_SECONDS * 1000;
  const same = ctx.state.lines<Sent>('log.jsonl').findLast(l => l.from === from && l.to === to && l.text === text && l.replyTo === replyTo);
  if (same === undefined || Date.parse(same.at) < since) return;
  recordGateStop(ctx, 'repeat', same.id);
  throw new TpmError(`同じ【${id}】を、${same.at} にもう送っています（id ${same.id}）。2 度目は送っていません。\n打ち直しを ; や || で 1 行に続けて書いていないか確かめてください。もう 1 度送る必要があれば、${REPEAT_SECONDS} 秒待つか、中身を変えて打つ。`);
}

/** 担当が TPM 担当へ送る物の 2 度送りを見る（課題に記録を書く前に呼ぶ）。 */
const notRepeatToTpm = (ctx: Context, self: RoleRecord, id: HeadingId, body: string): void => assertNotRepeat(ctx, id, self.title, requireTpm(ctx).address, body);

/** メッセージを送り、送った記録を log.jsonl に足す。extra は記録の行に足す欄。 */
function deliver(ctx: Context, id: HeadingId, key: string, from: string, to: string, body: string, replyTo?: string, extra: Pick<Sent, 'settle' | 'peer'> = {}): string {
  assertNotRepeat(ctx, id, from, to, body, replyTo);
  const text = message(id, body);
  const d = ctx.transport.send(to, from, text, replyTo);
  ctx.state.append('log.jsonl', { at: ctx.now().toISOString(), key, heading: id, from, to, text, id: d.id, delivered: d.delivered, ...(replyTo === undefined ? {} : { replyTo }), ...extra } satisfies Sent);
  return `送った: 【${id}】→ ${to}（${d.delivered ? '届いた' : '相手が手を動かしているので、まだ届いていない。空いたら届く'}）`;
}

/** 担当から TPM 担当へ。 */
function toTpm(ctx: Context, self: RoleRecord, id: HeadingId, body: string, replyTo?: string): string {
  return deliver(ctx, id, self.key, self.title, requireTpm(ctx).address, body, replyTo);
}

/** 担当の居場所が今あるかを見て、宛先を返す。無ければ止まる。 */
function seatOf(ctx: Context, role: RoleRecord): string {
  const address = role.address;
  if (address === undefined || !ctx.transport.seats().some(s => s.address === address)) {
    throw new TpmError(`${role.key} の担当の居場所がありません（tpm roles で名簿を見る）`);
  }
  return address;
}

/** TPM 担当から担当へ。居場所が無ければ止まる。 */
function toRole(ctx: Context, role: RoleRecord, id: HeadingId, body: string, replyTo?: string, extra: Pick<Sent, 'settle'> = {}): string {
  return deliver(ctx, id, role.key, TPM_TITLE, seatOf(ctx, role), body, replyTo, extra);
}

/** 担当の相手（課題の担当から見た Staff Engineer 担当の席・その逆）の宛先。居場所が無ければ止まる（送っていない・記録も書いていない）。 */
function peerSeat(ctx: Context, peer: RoleRecord): string {
  const address = peer.address;
  if (address === undefined || !ctx.transport.seats().some(s => s.address === address)) {
    throw new TpmError(`${peer.key} の居場所がありません。送っていません・記録も書いていません。tpm ask tpm で TPM 担当に知らせてください`);
  }
  return address;
}

/** 担当から担当へ、じかに（レビューの頼みと判定だけ）。送り手の名は名簿の題。相手の居場所が無ければ止まる。 */
export function toPeer(ctx: Context, self: RoleRecord, peer: RoleRecord, id: HeadingId, body: string): string {
  return deliver(ctx, id, self.key, self.title, peerSeat(ctx, peer), body, undefined, { peer: true });
}

/** 担当が担当へじかに送る物の 2 度送りを見る（課題に記録を書く前に呼ぶ。相手の宛先で数える）。 */
export const notRepeatToPeer = (ctx: Context, self: RoleRecord, peer: RoleRecord, id: HeadingId, body: string): void => assertNotRepeat(ctx, id, self.title, peerSeat(ctx, peer), body);

/** 課題に記録を書く。課題が無い・課題管理を使わない project なら書かない。 */
export function record(ctx: Context, role: RoleRecord, note: Note): string[] {
  if (role.issue === undefined || !ctx.tracker.owns(role.issue)) return [];
  if (note.kind !== '確認' && note.points.length > MAX_POINTS) throw new TpmError(`記録の要点は ${MAX_POINTS} つまでにしてください（中身はページに書く）`);
  ctx.tracker.comment(role.issue, note);
  return [`記録を書いた: ${role.issue}【${note.kind}】`];
}

// ---- 入口の検査（送る前に見る。どちらも、課題への記録などを書く前に通す） ----

/** 見せたメッセージの id を覚える数（居場所ごと）。 */
const SHOWN_KEEP = 200;

/** メッセージを「見せた」と、初めて見せた時刻とともに覚える（`tpm inbox`・`tpm hello` と、送る前の検査が呼ぶ）。覚えた物では、送る前の検査は止まらない。 */
export function markShown(ctx: Context, messages: Incoming[]): void {
  const address = ctx.transport.whoami();
  const shown = readShown(ctx, address);
  const known = new Set(shown.map(e => e.id));
  const at = ctx.now().toISOString();
  const added = [...new Set(messages.map(m => m.id))].filter(id => !known.has(id)).map(id => ({ id, at }));
  if (added.length === 0) return;
  ctx.state.write(shownFile(address), [...shown, ...added].slice(-SHOWN_KEEP));
}

/** 未読で止まったときの字（送る命令と、ページを置く命令）。 */
const READ_STOP = {
  send: { not: '送っていません', retry: '同じ命令を打ち直せば送ります（事情が変わっていたら、中身を変えて打つ）' },
  put: { not: 'ページを置いていません', retry: '同じ命令を打ち直せば置きます（事情が変わっていたら、ページを書き直して打つ）' },
} as const;

/**
 * 送る前の検査。自分宛てでまだ届いていないメッセージのうち、まだ見せていない物があれば、それを出して 1 度だけ止まる（行き違いを減らす）。
 * from は相手の題（TPM 担当が担当に送るとき。ほかの担当からのメッセージでは止まらない）。担当が受けるのは TPM 担当と、レビューの相手（課題の担当と Staff Engineer 担当の席）からだけなので、付けずにどれでも止まる。
 * 見せた物は覚えるので、同じ命令を打ち直せば送る。action は止まった時の字（put は tpm page put が置く前に呼ぶとき）。
 * 自分が送った物は数えない: cmux は、自分の受信箱の「まだ届いていない物」に、自分が送ってまだ相手に届いていない物も返す
 * （送った直後の次の命令が、自分のメッセージを未読として出して止まった。台帳 #97・#100）。送った記録（log.jsonl）の、送り手が自分の行の id を除く。
 * 送り手は、担当なら「Key が自分で、TPM 担当の名でない行」、TPM 担当なら「TPM 担当の名の行」で見る（宛先では見ない。返事の形（--reply-to）は、
 * 記録の宛先と本当の受け手がずれることがある。題でも見ない。居場所の題は替わることがある）。
 */
export function assertRead(ctx: Context, who: string, from?: string, action: keyof typeof READ_STOP = 'send'): void {
  const incoming = ctx.transport.pending().filter(m => from === undefined || m.from === from);
  if (incoming.length === 0) return;
  const self = ctx.transport.whoami();
  const key = ctx.env.TPM_KEY;
  const mine = (l: Sent): boolean => key ? l.key === key && l.from !== TPM_TITLE : l.from === TPM_TITLE;
  const sent = new Set(ctx.state.lines<Sent>('log.jsonl').filter(mine).map(l => l.id));
  const pending = incoming.filter(m => !sent.has(m.id));
  if (pending.length === 0) return;
  const shown = new Set(readShown(ctx, self).map(e => e.id));
  const unread = pending.filter(m => !shown.has(m.id));
  if (unread.length === 0) return;
  markShown(ctx, unread);
  recordGateStop(ctx, 'unread', unread.map(m => m.id).join(' '));
  throw new TpmError([
    `${who}から、まだ読んでいないメッセージが ${unread.length} 件あります。${READ_STOP[action].not}。`,
    ...unread.flatMap(m => [`--- ${m.from}（id ${m.id}）`, m.text]),
    '--- ここまで',
    `読んだうえで、${READ_STOP[action].retry}。`,
  ].join('\n'));
}

/** メッセージを送る担当の、自分の名簿の行。送る前の検査（assertRead）を通す。 */
export function sender(ctx: Context): RoleRecord {
  const self = requireSelf(ctx);
  assertRead(ctx, '相手');
  return self;
}

/**
 * 成果を PR や【done】で出さない担当が、打たない命令を止める。
 * Auditor は Product Manager へじかに報告する。Staff Engineer 担当はレビューのページで返す（【end】を打てると、レビューが済んだだけで課題が済みになる）。
 */
export function notAuditor(self: RoleRecord, command: string): void {
  if (self.role === 'auditor') {
    throw new TpmError(`Auditor は ${command} を打ちません。監査の報告は tpm report audit、Product Manager の決定は tpm report decided で出してください（PR は出さず、Product Manager とは Audit の席でじかに話す）`);
  }
  if (self.role === 'staff-engineer') {
    throw new TpmError(`Staff Engineer 担当は ${command} を打ちません。レビューの結果は tpm report review で返してください（PR は出さず、直さない。Product Manager に決めてほしいことは、tpm ask tpm で TPM 担当に送る）`);
  }
}

/** Auditor だけが打つ命令の、自分の名簿の行。送る前の検査（assertRead）を通す。 */
function auditor(ctx: Context, command: string): RoleRecord {
  const self = sender(ctx);
  if (self.role !== 'auditor') throw new TpmError(`${command} は Auditor（Audit の席）が打ちます`);
  return self;
}

/**
 * TPM 担当の居場所が今あれば、その宛先。TPM 担当が名乗っていない・居場所が無ければ undefined。
 * 居場所が状態を出しているかで見る（TPM 担当は tpm が起こした居場所ではないので、居場所の一覧に載らない連携がある）。
 */
function tpmSeat(ctx: Context): string | undefined {
  const address = ctx.state.read<TpmRecord>('tpm.jsonc')?.address;
  return address !== undefined && ctx.transport.status(address) !== undefined ? address : undefined;
}

/** TPM 担当がメッセージを送る先の、名簿の行。送る前の検査（assertRead）を通す。 */
function receiver(ctx: Context, key: string): RoleRecord {
  const role = requireRole(ctx, key);
  assertRead(ctx, `${role.key} の担当`, role.title);
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
 * 見た時刻は、見た時刻の口（seen.ts の seenTimes）が決める: 画面に届いた時刻と、tpm inbox・tpm hello・送る前の検査が見せた時刻（shown/）の早い方。
 * 担当は画面に届く前に tpm inbox で読んで済ませることがあるので、届いた時刻だけでは【done】が依頼書より前に見える（台帳 #36）。
 * 前の版が時刻を書かずに覚えた物（shown/ の id だけの項目）は、送った時刻に見せた物とする。見せたのは確かで、担当の送る命令は未読をすべて見せてからでないと送れないので、
 * その後の【done】は見た後に出た物（時刻を使わないと、画面に届くのが【done】より後なら済まないまま残る。台帳 #58）。
 */
function openBriefs(role: RoleRecord, address: string, log: Sent[], seenAt: SeenAt): OpenBrief[] {
  const seen = (l: Sent): string | undefined => seenAt(l)?.at;
  // 前の版で起こした担当（名簿に firstBrief の欄が無い）の最初の依頼書は数えない（止めすぎるより、見逃す側に倒す）。
  const first = role.firstBrief;
  let open: OpenBrief[] = first === undefined ? [] : [{ url: first, ...(role.helloAt === undefined ? {} : { seen: role.helloAt }) }];
  for (const l of log) {
    // 課題の担当がじかに送ったレビューの頼み（【ask-review】。記録の Key は送った課題の担当）も、Staff Engineer 担当の席の依頼書に積む。
    if (l.peer === true && l.heading === 'ask-review' && l.to === address) {
      const at = seen(l);
      open.push({ url: l.text.slice('【ask-review】'.length).split(' ')[0] ?? '', id: l.id, ...(at === undefined ? {} : { seen: at }) });
      continue;
    }
    if (l.key !== role.key) continue;
    if (l.from === TPM_TITLE) {
      if (l.to !== address) continue;
      if (l.heading === 'dismiss') open = [];
      if (l.heading !== 'brief') continue;
      if ((l.settle ?? (l.text.includes(' 取り消す: ') ? 'supersede' : 'none')) === 'supersede') open = [];
      const at = seen(l);
      open.push({ url: l.text.slice('【brief】'.length).split(' ')[0] ?? '', id: l.id, ...(at === undefined ? {} : { seen: at }) });
    }
    else if (role.helloAt !== undefined && l.at >= role.helloAt) {
      // 前の居場所（担当の交代の前）が出した物は数えない。
      if (l.heading === 'end') open = [];
      // Staff Engineer 担当は、依頼書 1 つの成果を【review】で返す（【done】は送らない）。
      if (l.heading !== 'done' && l.heading !== 'review') continue;
      const i = open.findIndex(b => b.seen !== undefined && b.seen <= l.at);
      if (i >= 0) open.splice(i, 1);
    }
  }
  return open;
}

/**
 * TPM 担当がその担当に送り、まだ済んでいない物。
 * unseen は、送って担当がまだ見ていないメッセージ（届いておらず、tpm も見せていない。headings があれば、その見出しだけ）。briefs は、【done】が返っていない依頼書（openBriefs）。
 * どちらも、見たかを見た時刻の口で決める（配られていなくても、送る前の検査や tpm inbox で見せた物は見た。台帳 #110）。
 */
function unsettled(ctx: Context, role: RoleRecord, address: string, headings?: HeadingId[]): { unseen: Sent[], briefs: OpenBrief[] } {
  const log = ctx.state.lines<Sent>('log.jsonl');
  const seenAt = seenTimes(ctx, { live: true });
  const unseen = log.filter(l => l.key === role.key && l.from === TPM_TITLE && l.to === address && (headings === undefined || headings.includes(l.heading as HeadingId)) && seenAt(l) === undefined);
  return { unseen, briefs: openBriefs(role, address, log, seenAt) };
}

/**
 * 送る前の検査（TPM 担当の dismiss と続きの assign）。その担当に、送って済んでいない物があれば、出して止まる（自分の送った物どうしの行き違いを減らす）。
 * choice があれば止まらず、本文に足す一言を返す（取り消す物・済ませてから進む物）。済んでいない物が無いのに choice を付けたら止まる（うその一言を送らない）。
 */
export function assertSettled(ctx: Context, role: RoleRecord, command: 'dismiss' | 'assign', choice?: SettleChoice): string | undefined {
  const { unseen, briefs } = unsettled(ctx, role, seatOf(ctx, role), command === 'assign' ? ['brief'] : undefined);
  // 済んでいない依頼書として挙げる【brief】は、まだ見ていない物として 2 度挙げない。
  const late = unseen.filter(l => !briefs.some(b => b.id === l.id));
  const names = [...briefs.map(b => `${briefName(b.url)}（${b.url}）`), ...late.map(l => `まだ見ていない【${l.heading}】（${l.at} に送った。id ${l.id}）`)];
  if (choice !== undefined) {
    if (names.length === 0) throw new TpmError(`${role.key} の担当に、済んでいない物はありません。--${choice} を付けずに打ってください`);
    return choice === 'supersede' ? `取り消す: ${names.join('・')}` : `${names.join('・')}を済ませてから、これをする`;
  }
  if (unseen.length === 0 && briefs.length === 0) return undefined;
  recordGateStop(ctx, 'unsettled', [`${role.key}:`, ...unseen.map(l => l.id), ...briefs.map(b => b.url)].join(' '));
  const how = command === 'dismiss'
    ? 'この依頼書・メッセージをどうするかを Product Manager に確かめてください。取り消すなら --supersede を付けて打ち直す（本文に「取り消す: …」と載る）。'
    : 'させてから進むなら --after、取り消すなら --supersede を付けて打ち直す（本文に一言が載る）。';
  throw new TpmError([
    `${role.key} の担当に、まだ済んでいない物があります。送っていません。`,
    ...unseen.flatMap(l => [`--- まだ見ていない（届いておらず、tpm も見せていない。${l.at} に送った。id ${l.id}）`, l.text]),
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
 */
export function assertMerged(ctx: Context, prs: string[], unchecked?: string): string {
  if (unchecked !== undefined) {
    if (unchecked.trim() === '') throw new TpmError('--unchecked には、merge を確かめない訳を書いてください');
    return `（merge は確かめていない: ${unchecked}）`;
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

/** `tpm wait` が状態の folder の `waits/<宛先>.jsonc` に書く記録。通知のバナーの hook が「この回に wait pm を打ったか」を見る。 */
export interface WaitRecord {
  kind: WaitKind
  text: string
  at: string
  /** `tpm wait pm --hand` の回だけ: 頼んだ手を数えた台帳の件の番号（打ち直しを同じ件に寄せるため）。 */
  hand?: number
}

/** `waits/` の file の名（宛先の : などを替える）。 */
export const waitFile = (address: string): string => `waits/${address.replaceAll(/[^A-Za-z0-9._-]/g, '-')}.jsonc`;

/** Product Manager に頼んだ手の操作の tag（`tpm wait pm --hand`）。 */
export const PM_HAND = 'pm-hand';

/**
 * 状態 wait を替え、打った時刻を記録する。hand は、Product Manager に手の操作を頼んで待つ回（wait pm だけ）。
 * 頼んだ手を台帳に数える（権限が足りず人の手が要った回数を、後から数で言えるように）。
 * 前の wait がまだ同じ頼み（--hand で数えた未決の件）のままなら、打ち直しとしてその件に寄せる（同じ頼みを 2 件に数えない）。
 */
export function wait(ctx: Context, kind: WaitKind, what: string, options: { hand?: boolean } = {}): string[] {
  if (options.hand === true && kind !== 'pm') throw new TpmError('--hand は tpm wait pm だけに付ける（Product Manager に手の操作を頼んだ回）');
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
  const incident = addIncident(ctx, { key: ctx.env.TPM_KEY || 'tpm', source: 'pm-hand', text: what, tags: [PM_HAND] });
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

/** `tpm report incident` の旗。 */
export interface IncidentOptions {
  text: string
  type: string
  tags: string[]
  severe: boolean
}

/** 担当が、気づいた出来事（起きた事実）を台帳に書き、TPM 担当に知らせる（【incident】）。課題管理には書かない。 */
export function reportIncident(ctx: Context, options: IncidentOptions): string[] {
  const type = incidentType(options.type);
  const self = sender(ctx);
  const incident = addIncident(ctx, { key: self.key, source: 'report', text: options.text, type, tags: options.tags, severe: options.severe });
  const tags = incident.tags.length === 0 ? '' : `（tag: ${incident.tags.join('・')}）`;
  const body = `#${incident.n}${incident.severe ? ' [重い]' : ''} ${INCIDENT_TYPES[type]}: ${options.text}${tags}`;
  return [`台帳に書いた: ${incidentLine(incident)}`, ...tagLines(ctx, incident), toTpm(ctx, self, 'incident', body)];
}

/** 状態 wait の字を出し、移りを waits.jsonl に残す。自分の宛先を返す。 */
export function showWait(ctx: Context, text: string): string {
  const address = ctx.transport.whoami();
  ctx.transport.setStatus('wait', text);
  recordWait(ctx, address, text);
  return address;
}

/** TPM 担当に決めてほしいことを送り（【ask-tpm】）、状態を回答待ちにする。 */
export function askTpm(ctx: Context, options: { text: string, waitingFor: string, replyTo?: string, review?: number }): string[] {
  const self = sender(ctx);
  if (options.review === undefined) return [toTpm(ctx, self, 'ask-tpm', options.text, options.replyTo), ...wait(ctx, 'tpm', options.waitingFor)];
  // レビューの判定を受けずに上げる: TPM 担当は判定を受け取っていないので、レビューのページの URL を本文に足し、上げたことを頼みの記録に残す。
  const review = readReviews(ctx).find(r => r.n === options.review);
  if (review === undefined || review.key !== self.key) throw new TpmError(`--review は、自分の課題（${self.key}）のレビューの頼みの番号にしてください（tpm review list --key ${self.key} で見る）`);
  if (review.verdict === undefined || review.page === undefined) throw new TpmError(`レビュー #${review.n} は、まだ判定が返っていません。送っていません`);
  // 上げるのは「直すべき」を受けない時だけ（ほかの判定は、受けるか・直すかを課題の担当が決めて進む）。
  if (review.verdict !== 'reject') throw new TpmError(`レビュー #${review.n} の判定は「${VERDICTS[review.verdict]}」です。--review で上げるのは「${VERDICTS.reject}」を受けない時だけです（ほかの判定は、指摘ごとに自分で決めて進む）。送っていません`);
  const sent = toTpm(ctx, self, 'ask-tpm', `レビュー #${review.n}（判定: ${VERDICTS[review.verdict]}。${review.page}）を受けない: ${options.text}`, options.replyTo);
  // 2 度目に上げても、最初に上げた時刻を残す。
  if (review.escalatedAt === undefined) patchReview(ctx, review.n, { escalatedAt: ctx.now().toISOString() });
  return [sent, ...wait(ctx, 'tpm', options.waitingFor)];
}

/**
 * --supersede で名指した古い確認を、送る前に確かめる。受けるのは、自分の Key の、今返事待ちの確認だけ。
 * 置き場に聞けない時（止まっている）は、返事待ちかを確かめずに通す（送った後に印を外せず、直し方の行が出る）。
 */
function assertSupersede(ctx: Context, self: RoleRecord, url: string, supersede: string[]): void {
  for (const old of supersede) {
    const owner = pageOwner(ctx, old);
    if (owner === undefined) throw new TpmError(`--supersede は、置き場の確認のページの URL にしてください: ${old}`);
    if (owner.project !== basename(ctx.state.dir) || owner.key !== self.key) {
      throw new TpmError(`--supersede: ${self.key} の確認だけを置き換えられます（別の project・Key のページ）: ${old}`);
    }
    if (samePage(ctx, old, url)) throw new TpmError(`--supersede に、送る確認そのものは書けません: ${old}`);
  }
  if (supersede.length === 0) return;
  const waiting = waitingUrls(ctx, self.key);
  if (waiting === undefined) return;
  const notWaiting = supersede.filter(old => !waiting.some(w => samePage(ctx, w, old)));
  if (notWaiting.length > 0) {
    throw new TpmError([
      `--supersede: 返事待ちではありません（答え済みか、tpm ask pm で送っていない）。何も送っていません:`,
      ...notWaiting,
      `今の ${self.key} の返事待ち: ${waiting.length === 0 ? '無し' : waiting.join(' ')}`,
    ].join('\n'));
  }
}

/**
 * Product Manager に決めてほしいことを書いた確認のページを、TPM 担当に送る。ページは開かない（Product Manager は置き場の一覧の UI で見る）。
 * supersede は、この確認で置き換える古い確認。送った後、その返事待ちの印を外す（答える要が無くなったため）。
 */
export function askPm(ctx: Context, options: { url: string, items: string[], waitingFor: string, supersede?: string[] }): string[] {
  const self = sender(ctx);
  notAuditor(self, 'tpm ask pm');
  if (options.items.length === 0) throw new TpmError('--item で、決めてほしい項目の題を 1 つ以上書いてください');
  const supersede = options.supersede ?? [];
  const body = [
    `${options.url} 項目: ${options.items.map((item, i) => `(${i + 1}) ${item}`).join(' ')}`,
    ...(supersede.length === 0 ? [] : [`置き換える確認: ${supersede.join(' ')}`]),
  ].join(' ');
  notRepeatToTpm(ctx, self, 'ask-pm', body);
  assertSupersede(ctx, self, options.url, supersede);
  const recorded = record(ctx, self, {
    kind: '確認',
    role: ROLES[self.role].label,
    summary: `Product Manager に確かめる（${options.items.length} 項）`,
    links: [{ label: '確認', url: options.url }, ...supersede.map(url => ({ label: '置き換えた確認', url }))],
    points: options.items,
  });
  const sent = toTpm(ctx, self, 'ask-pm', body);
  // 置き場の確認のページを返事待ちにする（Product Manager が、一覧の UI の印と件数で気づく）。書けなくても、送った事は変わらない。
  // 置き換えた古い確認は、返事待ちから外す（残すと、答える要の無いページが「返事待ち」に出続ける）。
  return [
    ...recorded,
    sent,
    ...replyLine(ctx, options.url, 'waiting'),
    ...supersede.flatMap(old => replyLine(ctx, old, 'answered', '置き換えたので返事待ちを外した')),
    ...wait(ctx, 'pm', options.waitingFor),
  ];
}

/** 共有の環境で DevOps Engineer 担当の手が要ることを、TPM 担当に送る（【ask-devops】）。 */
export function askDevops(ctx: Context, options: { what: string, why: string, urgent: boolean }): string[] {
  const self = sender(ctx);
  return [toTpm(ctx, self, 'ask-devops', `何を: ${options.what}／なぜ: ${options.why}／急ぎ: ${options.urgent ? 'はい' : 'いいえ'}`)];
}

/** 自分の PR を 1 本 merge したと知らせる（【merged】）。 */
export function reportMerged(ctx: Context, options: { pr: string, note: string, unchecked?: string }): string[] {
  const self = sender(ctx);
  notAuditor(self, 'tpm report merged');
  const checked = assertMerged(ctx, [options.pr], options.unchecked);
  return [toTpm(ctx, self, 'merged', `${options.pr} ${options.note}${checked}`)];
}

/** 文書やコメントの食い違いを直した PR を merge したと知らせ、課題があれば記録を書く（【doc-fix】）。 */
export function reportDocFix(ctx: Context, options: { pr: string, note: string, unchecked?: string }): string[] {
  const self = sender(ctx);
  notAuditor(self, 'tpm report doc-fix');
  const checked = assertMerged(ctx, [options.pr], options.unchecked);
  const body = `${options.pr}（merge 済み）${options.note}${checked}`;
  notRepeatToTpm(ctx, self, 'doc-fix', body);
  const recorded = record(ctx, self, { kind: '文書の修正', role: ROLES[self.role].label, summary: options.note, links: [{ label: 'PR（merge 済み）', url: options.pr }], points: [] });
  return [...recorded, toTpm(ctx, self, 'doc-fix', body)];
}

/** `tpm report done --kind` の値（`tpm page put --kind` と同じ語）と、課題に書く記録の種類。 */
export const DONE_KINDS = { proposal: '提案', plan: '計画', result: '結果', audit: '監査' } as const satisfies Record<string, NoteKind>;
/** `tpm report done --kind` に書ける値。 */
export type DoneKind = keyof typeof DONE_KINDS;

/** `--kind` の値を読む。前の値（提案・計画・結果）は誤りにし、替わりの値を案内する。 */
export function doneKind(value: string): DoneKind {
  if (Object.hasOwn(DONE_KINDS, value)) return value as DoneKind;
  const renamed = Object.entries(DONE_KINDS).find(([, note]) => note === value)?.[0];
  if (renamed !== undefined) throw new TpmError(`--kind ${value} は ${renamed} に替わりました（--kind ${renamed}）`);
  throw new TpmError(`--kind は ${Object.keys(DONE_KINDS).join('・')} のどれかにしてください`);
}

/** `tpm report done` の旗。 */
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
}

/** 依頼書 1 つの成果を出した。TPM 担当は「残り」と「決めてほしいこと」で【dismiss】を送るかを決めるので、どちらも必ず書く。 */
export function reportDone(ctx: Context, options: DoneOptions): string[] {
  const self = sender(ctx);
  notAuditor(self, 'tpm report done');
  const remaining = required(options.remaining, '--remaining（残り）');
  const decisions = required(options.decisions, '--decisions（決めてほしいこと）');
  const kind = DONE_KINDS[options.kind];
  const body = `${options.url === undefined ? '' : `${options.url} `}要点: ${options.summary}／残り: ${remaining}／決めてほしいこと: ${decisions}`;
  notRepeatToTpm(ctx, self, 'done', body);
  const recorded = record(ctx, self, {
    kind,
    role: ROLES[self.role].label,
    summary: oneLine(options.summary),
    links: options.url === undefined ? [] : [{ label: kind, url: options.url }],
    points: options.points,
  });
  const sent = toTpm(ctx, self, 'done', body);
  showWait(ctx, WAIT_NEXT_BRIEF);
  return [...recorded, sent, ...keepRemaining(ctx, self, 'done', remaining), `状態: ${WAIT_NEXT_BRIEF}（次の【brief】か【dismiss】を待つ。自分から【end】を送らない）`];
}

/** `tpm report end` の旗。 */
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
export function reportEnd(ctx: Context, options: EndOptions): string[] {
  const self = sender(ctx);
  notAuditor(self, 'tpm report end');
  if (self.dismissed === undefined && !ROLES[self.role].endsWithoutDismiss) {
    throw new TpmError('【dismiss】がまだ来ていません。【done】の後は次の【brief】か【dismiss】を待ち、自分から【end】を送らない');
  }
  const left = required(options.left, '--left（残っている物）');
  const checked = assertMerged(ctx, options.prs, options.prs.length === 0 ? undefined : options.unchecked);
  const body = `成果: ${options.url ?? 'なし'}／merge した PR: ${options.prs.join(' ') || 'なし'}／消した worktree: ${options.removed.join(' ') || 'なし'}／残っている物: ${left}${checked}`;
  notRepeatToTpm(ctx, self, 'end', body);
  const links: NoteLink[] = [
    ...(options.url === undefined ? [] : [{ label: '成果', url: options.url }]),
    ...options.prs.map(pr => ({ label: 'PR（merge 済み）', url: pr })),
  ];
  const out = record(ctx, self, { kind: '結果', role: ROLES[self.role].label, summary: `片付けた（残っている物: ${oneLine(left)}）`, links, points: [] });
  if (self.issue !== undefined && ctx.tracker.owns(self.issue)) {
    if (self.dismissed === 'handover') {
      out.push(`課題は閉じない: ${self.issue}（担当の交代。次の担当が引き継ぐ）`);
    }
    else {
      ctx.tracker.close(self.issue);
      out.push(`課題を閉じた: ${self.issue}`);
    }
  }
  out.push(toTpm(ctx, self, 'end', body), ...keepRemaining(ctx, self, 'end', left));
  showWait(ctx, WAIT_CLOSE);
  out.push(`状態: ${WAIT_CLOSE}（居場所は自分で閉じない）`);
  return out;
}

/** Dependabot の PR だけで使う見出し。recreated は、新しい番号の題に替える。 */
export function reportDependabot(ctx: Context, id: 'merge-request' | 'not-yet' | 'recreated', options: { text: string, title?: string }): string[] {
  const self = sender(ctx);
  const out: string[] = [];
  if (id === 'recreated' && options.title !== undefined) {
    ctx.transport.setTitle(options.title);
    self.title = options.title;
    writeRole(ctx, self);
    out.push(`題を替えた: ${options.title}`);
  }
  out.push(toTpm(ctx, self, id, options.text));
  if (id === 'merge-request') out.push(...wait(ctx, 'tpm', 'merge'));
  return out;
}

// ---- Auditor が打つ ----

/** `tpm report audit` の旗。 */
export interface AuditOptions {
  /** 監査のページ（tpm page put --kind audit で置いた URL）。 */
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
export function reportAudit(ctx: Context, options: AuditOptions): string[] {
  const self = auditor(ctx, 'tpm report audit');
  if (!isPageUrl(ctx.env, options.url)) throw new TpmError(`--url は、tpm page put --kind audit で置いた監査のページの URL にしてください: ${options.url}`);
  const decisions = options.items.length === 0 ? 'なし' : options.items.map((item, i) => `(${i + 1}) ${item}`).join(' ');
  const body = `${options.url} 要点: ${options.summary}／決めてほしいこと: ${decisions}（写し。Product Manager には Audit の席でじかに報告した。伝え直さなくてよい）`;
  const copied = tpmSeat(ctx) !== undefined;
  const sent = copied ? toTpm(ctx, self, 'audit', body) : 'TPM 担当が起きていないので、写しは送っていない（報告は、この席とページで Product Manager に出す）';
  appendAudit(ctx, { kind: 'report', url: options.url, summary: options.summary, items: options.items, copied });
  return [sent, ...wait(ctx, 'pm', '監査の報告'), 'この席に、要点と決めてほしいことを書いて、Product Manager の答えを待つ'];
}

/** `tpm report decided` の旗。どれも、監査のページの勧告の題。 */
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
export function reportDecided(ctx: Context, options: DecidedOptions): string[] {
  const self = auditor(ctx, 'tpm report decided');
  if (options.adopted.length + options.accepted.length + options.later.length === 0) throw new TpmError('--do・--accept・--later のどれかで、勧告の題を 1 つ以上書いてください');
  if (tpmSeat(ctx) === undefined) throw new TpmError('TPM 担当が起きていません。決定は送っていません・記録していません。Product Manager にそう伝え、TPM 担当が起きた後に、同じ命令を打ち直してください');
  const part = (label: string, titles: string[]): string[] => titles.length === 0 ? [] : [`${label}: ${titles.join('・')}`];
  const body = `${options.url} ${[...part('する', options.adopted), ...part('受け入れる', options.accepted), ...part('見送る', options.later)].join('／')}`;
  const sent = toTpm(ctx, self, 'decided', body);
  appendAudit(ctx, { kind: 'decided', url: options.url, adopted: options.adopted, accepted: options.accepted, later: options.later });
  // Product Manager は今この席で答えたところなので、バナーは出さない（wait の記録は書かず、状態の字だけ替える）。
  const text = WAIT.pm('次の /audit');
  showWait(ctx, text);
  return [sent, `状態: ${text}`];
}

// ---- TPM 担当が打つ ----

/** 動いている担当に、新しい依頼書を送る。 */
export function brief(ctx: Context, role: RoleRecord, url: string, note?: string, settled?: { text: string, choice: SettleChoice }): string[] {
  assertRead(ctx, `${role.key} の担当`, role.title);
  const body = [url, issueCopyLine(role), note, settled?.text].filter(v => v !== undefined).join(' ');
  const sent = toRole(ctx, role, 'brief', body, undefined, { settle: settled?.choice ?? 'none' });
  role.brief = url;
  delete role.dismissed;
  writeRole(ctx, role);
  return [sent];
}

/** 課題の写しの一言（【brief】と担当の tpm hello）。写しも、作らなかった訳も無ければ undefined。 */
export function issueCopyLine(role: RoleRecord): string | undefined {
  if (role.issuePage !== undefined) return `課題の写し: ${role.issuePage}`;
  if (role.issueCopySkipped !== undefined) return `課題の写し: 無し（${role.issueCopySkipped}）`;
  return undefined;
}

/** `tpm answer` の旗。 */
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
function answeredPages(ctx: Context, key: string, options: AnswerOptions): string[] {
  const urls = options.urls ?? [];
  const foreign = urls.find(url => !isStorePage(ctx, url));
  if (foreign !== undefined) throw new TpmError(`--url は、置き場の確認のページの URL にしてください: ${foreign}`);
  if (urls.length > 0) return urls;
  const waiting = waitingUrls(ctx, key) ?? [];
  if (waiting.length > 1 && options.all !== true) {
    throw new TpmError([
      `${key} に、返事待ちのページが ${waiting.length} 枚あります。答えは送っていません・記録も書いていません。`,
      ...waiting,
      'どのページへの答えかを --url <URL>（何度でも）で書くか、みなへの答えなら --all を付けて、打ち直してください',
    ].join('\n'));
  }
  return waiting;
}

/** Product Manager の答えを返す。課題があれば、返す前に「決定」の記録を書く。返した後、置き場の返事待ちのページを答えたにする。 */
export function answer(ctx: Context, key: string, options: AnswerOptions): string[] {
  requireTpmSide(ctx, 'tpm answer');
  const role = receiver(ctx, key);
  if (role.address !== undefined) assertNotRepeat(ctx, 'answer', TPM_TITLE, role.address, options.text, options.replyTo);
  const pages = answeredPages(ctx, key, options);
  const recorded = record(ctx, role, { kind: '決定', role: 'TPM', summary: oneLine(options.text), links: [], points: [] });
  const sent = toRole(ctx, role, 'answer', options.text, options.replyTo);
  return [...recorded, sent, ...pages.flatMap(url => replyLine(ctx, url, 'answered'))];
}

/** 担当に、返事の要らないメッセージを送る（【notify】）。 */
export function notify(ctx: Context, key: string, options: { text: string, replyTo?: string }): string[] {
  requireTpmSide(ctx, 'tpm notify');
  return [toRole(ctx, receiver(ctx, key), 'notify', options.text, options.replyTo)];
}

/** この課題に続きは無い、と知らせる。handover は担当の交代（課題は続くので、担当は課題を閉じない）。 */
export function dismiss(ctx: Context, key: string, options: { handover: boolean, supersede?: boolean }): string[] {
  requireTpmSide(ctx, 'tpm dismiss');
  if (readRole(ctx, key)?.role === 'auditor') throw new TpmError('Auditor の席に【dismiss】は送れません（Auditor の席は、Product Manager が起こし、閉じる）');
  // Staff Engineer 担当は worktree も PR も持たないので、片付けのやりとり（【dismiss】と【end】）は要らない。
  if (readRole(ctx, key)?.role === 'staff-engineer') throw new TpmError(`Staff Engineer 担当の席に【dismiss】は送りません。tpm close ${key} で閉じます（課題の席を tpm close で閉じる時にも、一緒に閉じる）`);
  const role = receiver(ctx, key);
  const settled = assertSettled(ctx, role, 'dismiss', options.supersede === true ? 'supersede' : undefined);
  const body = [options.handover
    ? '担当の交代のため（課題は続くので、課題は閉じない）。worktree を片付けて【end】を返す。'
    : 'この課題に続きは無い。worktree と課題を片付けて【end】を返す。', settled].filter(v => v !== undefined).join('');
  const sent = toRole(ctx, role, 'dismiss', body);
  role.dismissed = options.handover ? 'handover' : 'done';
  writeRole(ctx, role);
  // 答えが要らなくなった確認が、置き場で返事待ちのまま残らないように知らせる（止めない）。
  const waiting = waitingUrls(ctx, key) ?? [];
  const left = waiting.length === 0
    ? []
    : [`置き場に、${key} の返事待ちのページが ${waiting.length} 枚残っています:`, ...waiting, 'もう答えが要らなければ、tpm page reply <URL>… --answered で印を外す'];
  return [sent, ...left];
}

/** URL を自分の居場所で開いて、人に見せる。 */
export function show(ctx: Context, url: string): string[] {
  ctx.transport.show(url);
  return [`開いた: ${url}`];
}
