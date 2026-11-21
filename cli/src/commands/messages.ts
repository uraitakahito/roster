// 見出しの付いたメッセージを送る命令。送る・届いたかを見る・課題に記録を書く・状態を替える、を 1 度にする。
// 担当が打つ物（ask・report・wait）と、TPM 担当が打つ物（answer・notify・dismiss・show）。brief は命令でなく、assign の中で使う。
import type { Context } from '../context.ts';
import { recordGateStop, recordWait } from '../evidence.ts';
import { message, ROLES, TPM_TITLE, WAIT, WAIT_CLOSE, WAIT_NEXT_BRIEF, type HeadingId, type WaitKind } from '../protocol.ts';
import { requireRole, requireSelf, requireTpm, writeRole, type RoleRecord } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { MAX_POINTS, type Note, type NoteKind, type NoteLink } from '../tracker/types.ts';
import type { Incoming } from '../transport/types.ts';

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

/** メッセージを送り、送った記録を log.jsonl に足す。 */
function deliver(ctx: Context, id: HeadingId, key: string, from: string, to: string, body: string, replyTo?: string): string {
  assertNotRepeat(ctx, id, from, to, body, replyTo);
  const text = message(id, body);
  const d = ctx.transport.send(to, from, text, replyTo);
  ctx.state.append('log.jsonl', { at: ctx.now().toISOString(), key, heading: id, from, to, text, id: d.id, delivered: d.delivered, ...(replyTo === undefined ? {} : { replyTo }) } satisfies Sent);
  return `送った: 【${id}】→ ${to}（${d.delivered ? '届いた' : '相手が手を動かしているので、まだ届いていない。空いたら届く'}）`;
}

/** 担当から TPM 担当へ。 */
function toTpm(ctx: Context, self: RoleRecord, id: HeadingId, body: string, replyTo?: string): string {
  return deliver(ctx, id, self.key, self.title, requireTpm(ctx).address, body, replyTo);
}

/** TPM 担当から担当へ。居場所が無ければ止まる。 */
function toRole(ctx: Context, role: RoleRecord, id: HeadingId, body: string, replyTo?: string): string {
  if (role.address === undefined || !ctx.transport.seats().some(s => s.address === role.address)) {
    throw new TpmError(`${role.key} の担当の居場所がありません（tpm roles で名簿を見る）`);
  }
  return deliver(ctx, id, role.key, TPM_TITLE, role.address, body, replyTo);
}

/** 課題に記録を書く。課題が無い・課題管理を使わない project なら書かない。 */
function record(ctx: Context, role: RoleRecord, note: Note): string[] {
  if (role.issue === undefined || !ctx.tracker.owns(role.issue)) return [];
  if (note.kind !== '確認' && note.points.length > MAX_POINTS) throw new TpmError(`記録の要点は ${MAX_POINTS} つまでにしてください（中身はページに書く）`);
  ctx.tracker.comment(role.issue, note);
  return [`記録を書いた: ${role.issue}【${note.kind}】`];
}

// ---- 入口の検査（送る前に見る。どちらも、課題への記録などを書く前に通す） ----

/** 見せたメッセージの id を覚える数（居場所ごと）。 */
const SHOWN_KEEP = 200;

/** 見せたメッセージの id を覚える file（`shown/<宛先>.jsonc`）。 */
const shownFile = (address: string): string => `shown/${address.replaceAll(/[^A-Za-z0-9._-]/g, '-')}.jsonc`;

/** メッセージを「見せた」と覚える（`tpm inbox` と、送る前の検査が呼ぶ）。覚えた物では、送る前の検査は止まらない。 */
export function markShown(ctx: Context, messages: Incoming[]): void {
  if (messages.length === 0) return;
  const file = shownFile(ctx.transport.whoami());
  const ids = [...(ctx.state.read<string[]>(file) ?? []), ...messages.map(m => m.id)];
  ctx.state.write(file, [...new Set(ids)].slice(-SHOWN_KEEP));
}

/**
 * 送る前の検査。自分宛てでまだ届いていないメッセージのうち、まだ見せていない物があれば、それを出して 1 度だけ止まる（行き違いを減らす）。
 * from は相手の題（TPM 担当が担当に送るとき。ほかの担当からのメッセージでは止まらない）。担当は TPM 担当からしか受けないので、付けない。
 * 見せた物は覚えるので、同じ命令を打ち直せば送る。
 */
export function assertRead(ctx: Context, who: string, from?: string): void {
  const pending = ctx.transport.pending().filter(m => from === undefined || m.from === from);
  if (pending.length === 0) return;
  const shown = new Set(ctx.state.read<string[]>(shownFile(ctx.transport.whoami())) ?? []);
  const unread = pending.filter(m => !shown.has(m.id));
  if (unread.length === 0) return;
  markShown(ctx, unread);
  recordGateStop(ctx, 'unread', unread.map(m => m.id).join(' '));
  throw new TpmError([
    `${who}から、まだ読んでいないメッセージが ${unread.length} 件あります。送っていません。`,
    ...unread.flatMap(m => [`--- ${m.from}（id ${m.id}）`, m.text]),
    '--- ここまで',
    '読んだうえで、同じ命令を打ち直せば送ります（事情が変わっていたら、中身を変えて打つ）。',
  ].join('\n'));
}

/** メッセージを送る担当の、自分の名簿の行。送る前の検査（assertRead）を通す。 */
function sender(ctx: Context): RoleRecord {
  const self = requireSelf(ctx);
  assertRead(ctx, 'TPM 担当');
  return self;
}

/** TPM 担当がメッセージを送る先の、名簿の行。送る前の検査（assertRead）を通す。 */
function receiver(ctx: Context, key: string): RoleRecord {
  const role = requireRole(ctx, key);
  assertRead(ctx, `${role.key} の担当`, role.title);
  return role;
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

const oneLine = (text: string): string => {
  const first = text.split('\n')[0] ?? '';
  return first.length > SUMMARY_LIMIT ? `${first.slice(0, SUMMARY_LIMIT)}…` : first;
};

// ---- 担当が打つ ----

/** `tpm wait` が状態の folder の `waits/<宛先>.jsonc` に書く記録。Mac のバナーの hook が「この回に wait pm を打ったか」を見る。 */
export interface WaitRecord {
  kind: WaitKind
  text: string
  at: string
}

/** `waits/` の file の名（宛先の : などを替える）。 */
export const waitFile = (address: string): string => `waits/${address.replaceAll(/[^A-Za-z0-9._-]/g, '-')}.jsonc`;

/** 状態 wait を替え、打った時刻を記録する。 */
export function wait(ctx: Context, kind: WaitKind, what: string): string[] {
  const text = WAIT[kind](what);
  const address = showWait(ctx, text);
  ctx.state.write(waitFile(address), { kind, text, at: ctx.now().toISOString() } satisfies WaitRecord);
  return [`状態: ${text}`];
}

/** 状態 wait の字を出し、移りを waits.jsonl に残す。自分の宛先を返す。 */
function showWait(ctx: Context, text: string): string {
  const address = ctx.transport.whoami();
  ctx.transport.setStatus('wait', text);
  recordWait(ctx, address, text);
  return address;
}

/** TPM 担当に決めてほしいことを送り（【ask-tpm】）、状態を回答待ちにする。 */
export function askTpm(ctx: Context, options: { text: string, waitingFor: string, replyTo?: string }): string[] {
  const self = sender(ctx);
  return [toTpm(ctx, self, 'ask-tpm', options.text, options.replyTo), ...wait(ctx, 'tpm', options.waitingFor)];
}

/** Product Manager に決めてほしいことを書いた確認のページを、TPM 担当に送る。ページは開かない（Product Manager は置き場の一覧の UI で見る）。 */
export function askPm(ctx: Context, options: { url: string, items: string[], waitingFor: string }): string[] {
  const self = sender(ctx);
  if (options.items.length === 0) throw new TpmError('--item で、決めてほしい項目の題を 1 つ以上書いてください');
  const body = `${options.url} 項目: ${options.items.map((item, i) => `(${i + 1}) ${item}`).join(' ')}`;
  notRepeatToTpm(ctx, self, 'ask-pm', body);
  const recorded = record(ctx, self, {
    kind: '確認',
    role: ROLES[self.role].label,
    summary: `Product Manager に確かめる（${options.items.length} 項）`,
    links: [{ label: '確認', url: options.url }],
    points: options.items,
  });
  return [...recorded, toTpm(ctx, self, 'ask-pm', body), ...wait(ctx, 'pm', options.waitingFor)];
}

/** 共有の環境で DevOps Engineer 担当の手が要ることを、TPM 担当に送る（【ask-devops】）。 */
export function askDevops(ctx: Context, options: { what: string, why: string, urgent: boolean }): string[] {
  const self = sender(ctx);
  return [toTpm(ctx, self, 'ask-devops', `何を: ${options.what}／なぜ: ${options.why}／急ぎ: ${options.urgent ? 'はい' : 'いいえ'}`)];
}

/** 自分の PR を 1 本 merge したと知らせる（【merged】）。 */
export function reportMerged(ctx: Context, options: { pr: string, note: string, unchecked?: string }): string[] {
  const self = sender(ctx);
  const checked = assertMerged(ctx, [options.pr], options.unchecked);
  return [toTpm(ctx, self, 'merged', `${options.pr} ${options.note}${checked}`)];
}

/** 文書やコメントの食い違いを直した PR を merge したと知らせ、課題があれば記録を書く（【doc-fix】）。 */
export function reportDocFix(ctx: Context, options: { pr: string, note: string, unchecked?: string }): string[] {
  const self = sender(ctx);
  const checked = assertMerged(ctx, [options.pr], options.unchecked);
  const body = `${options.pr}（merge 済み）${options.note}${checked}`;
  notRepeatToTpm(ctx, self, 'doc-fix', body);
  const recorded = record(ctx, self, { kind: '文書の修正', role: ROLES[self.role].label, summary: options.note, links: [{ label: 'PR（merge 済み）', url: options.pr }], points: [] });
  return [...recorded, toTpm(ctx, self, 'doc-fix', body)];
}

/** `tpm report done --kind` の値（`tpm page put --kind` と同じ語）と、課題に書く記録の種類。 */
export const DONE_KINDS = { proposal: '提案', plan: '計画', result: '結果' } as const satisfies Record<string, NoteKind>;
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
  return [...recorded, sent, `状態: ${WAIT_NEXT_BRIEF}（次の【brief】か【dismiss】を待つ。自分から【end】を送らない）`];
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
  out.push(toTpm(ctx, self, 'end', body));
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

// ---- TPM 担当が打つ ----

/** 動いている担当に、新しい依頼書を送る。 */
export function brief(ctx: Context, role: RoleRecord, url: string, note?: string): string[] {
  assertRead(ctx, `${role.key} の担当`, role.title);
  const body = [url, issueCopyLine(role), note].filter(v => v !== undefined).join(' ');
  const sent = toRole(ctx, role, 'brief', body);
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

/** Product Manager の答えを返す。課題があれば、返す前に「決定」の記録を書く。 */
export function answer(ctx: Context, key: string, options: { text: string, replyTo?: string }): string[] {
  const role = receiver(ctx, key);
  if (role.address !== undefined) assertNotRepeat(ctx, 'answer', TPM_TITLE, role.address, options.text, options.replyTo);
  const recorded = record(ctx, role, { kind: '決定', role: 'TPM', summary: oneLine(options.text), links: [], points: [] });
  return [...recorded, toRole(ctx, role, 'answer', options.text, options.replyTo)];
}

/** 担当に、返事の要らないメッセージを送る（【notify】）。 */
export function notify(ctx: Context, key: string, options: { text: string, replyTo?: string }): string[] {
  return [toRole(ctx, receiver(ctx, key), 'notify', options.text, options.replyTo)];
}

/** この課題に続きは無い、と知らせる。handover は担当の交代（課題は続くので、担当は課題を閉じない）。 */
export function dismiss(ctx: Context, key: string, options: { handover: boolean }): string[] {
  const role = receiver(ctx, key);
  const body = options.handover
    ? '担当の交代のため（課題は続くので、課題は閉じない）。worktree を片付けて【end】を返す。'
    : 'この課題に続きは無い。worktree と課題を片付けて【end】を返す。';
  const sent = toRole(ctx, role, 'dismiss', body);
  role.dismissed = options.handover ? 'handover' : 'done';
  writeRole(ctx, role);
  return [sent];
}

/** URL を自分の居場所で開いて、人に見せる。 */
export function show(ctx: Context, url: string): string[] {
  ctx.transport.show(url);
  return [`開いた: ${url}`];
}
