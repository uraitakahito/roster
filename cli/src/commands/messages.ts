// 見出しの付いたメッセージを送る命令。送る・届いたかを見る・課題に記録を書く・状態を替える、を 1 度にする。
// 担当が打つ物（ask・report・wait）と、TPM 担当が打つ物（answer・notify・dismiss・show）。brief は命令でなく、assign の中で使う。
import type { Context } from '../context.ts';
import { message, ROLES, TPM_TITLE, WAIT, WAIT_CLOSE, WAIT_NEXT_BRIEF, type HeadingId, type WaitKind } from '../protocol.ts';
import { requireRole, requireSelf, requireTpm, writeRole, type RoleRecord } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { MAX_POINTS, type Note, type NoteKind, type NoteLink } from '../tracker/types.ts';

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
}

/** メッセージを送り、送った記録を log.jsonl に足す。 */
function deliver(ctx: Context, id: HeadingId, key: string, from: string, to: string, body: string, replyTo?: string): string {
  const text = message(id, body);
  const d = ctx.transport.send(to, from, text, replyTo);
  ctx.state.append('log.jsonl', { at: ctx.now().toISOString(), key, heading: id, from, to, text, id: d.id, delivered: d.delivered } satisfies Sent);
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

const required = (value: string | undefined, name: string): string => {
  if (value === undefined || value.trim() === '') throw new TpmError(`${name} を書いてください（無ければ「なし」）`);
  return value;
};

const oneLine = (text: string): string => {
  const first = text.split('\n')[0] ?? '';
  return first.length > SUMMARY_LIMIT ? `${first.slice(0, SUMMARY_LIMIT)}…` : first;
};

// ---- 担当が打つ ----

/** 状態 wait を替える。 */
export function wait(ctx: Context, kind: WaitKind, what: string): string[] {
  const text = WAIT[kind](what);
  ctx.transport.setStatus('wait', text);
  return [`状態: ${text}`];
}

/** TPM 担当に決めてほしいことを送り（【ask-tpm】）、状態を回答待ちにする。 */
export function askTpm(ctx: Context, options: { text: string, waitingFor: string, replyTo?: string }): string[] {
  const self = requireSelf(ctx);
  return [toTpm(ctx, self, 'ask-tpm', options.text, options.replyTo), ...wait(ctx, 'tpm', options.waitingFor)];
}

/** Product Manager に決めてほしいことを書いた確認のページを、TPM 担当に送る。 */
export function askPm(ctx: Context, options: { url: string, items: string[], waitingFor: string }): string[] {
  const self = requireSelf(ctx);
  if (options.items.length === 0) throw new TpmError('--item で、決めてほしい項目の題を 1 つ以上書いてください');
  const recorded = record(ctx, self, {
    kind: '確認',
    role: ROLES[self.role].label,
    summary: `Product Manager に確かめる（${options.items.length} 項）`,
    links: [{ label: '確認', url: options.url }],
    points: options.items,
  });
  ctx.transport.show(options.url);
  const body = `${options.url} 項目: ${options.items.map((item, i) => `(${i + 1}) ${item}`).join(' ')}`;
  return [...recorded, toTpm(ctx, self, 'ask-pm', body), ...wait(ctx, 'pm', options.waitingFor)];
}

/** 共有の環境で DevOps Engineer 担当の手が要ることを、TPM 担当に送る（【ask-devops】）。 */
export function askDevops(ctx: Context, options: { what: string, why: string, urgent: boolean }): string[] {
  const self = requireSelf(ctx);
  return [toTpm(ctx, self, 'ask-devops', `何を: ${options.what}／なぜ: ${options.why}／急ぎ: ${options.urgent ? 'はい' : 'いいえ'}`)];
}

/** 自分の PR を 1 本 merge したと知らせる（【merged】）。 */
export function reportMerged(ctx: Context, options: { pr: string, note: string }): string[] {
  return [toTpm(ctx, requireSelf(ctx), 'merged', `${options.pr} ${options.note}`)];
}

/** 文書やコメントの食い違いを直した PR を merge したと知らせ、課題があれば記録を書く（【doc-fix】）。 */
export function reportDocFix(ctx: Context, options: { pr: string, note: string }): string[] {
  const self = requireSelf(ctx);
  const recorded = record(ctx, self, { kind: '文書の修正', role: ROLES[self.role].label, summary: options.note, links: [{ label: 'PR（merge 済み）', url: options.pr }], points: [] });
  return [...recorded, toTpm(ctx, self, 'doc-fix', `${options.pr}（merge 済み）${options.note}`)];
}

/** `tpm report done` の旗。 */
export interface DoneOptions {
  url?: string
  /** 課題に書く記録の種類（提案・計画・結果）。 */
  kind: NoteKind
  summary: string
  /** 依頼の外で直すとよい物・やらなかった物・merge していない PR。無ければ「なし」。 */
  remaining?: string
  /** 【ask-pm】で送った項目の題。無ければ「なし」。 */
  decisions?: string
  points: string[]
}

/** 依頼書 1 つの成果を出した。TPM 担当は「残り」と「決めてほしいこと」で【dismiss】を送るかを決めるので、どちらも必ず書く。 */
export function reportDone(ctx: Context, options: DoneOptions): string[] {
  const self = requireSelf(ctx);
  const remaining = required(options.remaining, '--remaining（残り）');
  const decisions = required(options.decisions, '--decisions（決めてほしいこと）');
  const recorded = record(ctx, self, {
    kind: options.kind,
    role: ROLES[self.role].label,
    summary: oneLine(options.summary),
    links: options.url === undefined ? [] : [{ label: options.kind, url: options.url }],
    points: options.points,
  });
  if (options.url !== undefined) ctx.transport.show(options.url);
  const body = `${options.url === undefined ? '' : `${options.url} `}要点: ${options.summary}／残り: ${remaining}／決めてほしいこと: ${decisions}`;
  const sent = toTpm(ctx, self, 'done', body);
  ctx.transport.setStatus('wait', WAIT_NEXT_BRIEF);
  return [...recorded, sent, `状態: ${WAIT_NEXT_BRIEF}（次の【brief】か【dismiss】を待つ。自分から【end】を送らない）`];
}

/** `tpm report end` の旗。 */
export interface EndOptions {
  url?: string
  prs: string[]
  removed: string[]
  /** 残っている物。無ければ「なし」。 */
  left?: string
}

/** 【dismiss】を受けて片付けた。課題に結果を書き、課題を閉じる（担当の交代なら閉じない）。 */
export function reportEnd(ctx: Context, options: EndOptions): string[] {
  const self = requireSelf(ctx);
  if (self.dismissed === undefined && !ROLES[self.role].endsWithoutDismiss) {
    throw new TpmError('【dismiss】がまだ来ていません。【done】の後は次の【brief】か【dismiss】を待ち、自分から【end】を送らない');
  }
  const left = required(options.left, '--left（残っている物）');
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
  const body = `成果: ${options.url ?? 'なし'}／merge した PR: ${options.prs.join(' ') || 'なし'}／消した worktree: ${options.removed.join(' ') || 'なし'}／残っている物: ${left}`;
  out.push(toTpm(ctx, self, 'end', body));
  ctx.transport.setStatus('wait', WAIT_CLOSE);
  out.push(`状態: ${WAIT_CLOSE}（居場所は自分で閉じない）`);
  return out;
}

/** Dependabot の PR だけで使う見出し。recreated は、新しい番号の題に替える。 */
export function reportDependabot(ctx: Context, id: 'merge-request' | 'not-yet' | 'recreated', options: { text: string, title?: string }): string[] {
  const self = requireSelf(ctx);
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
  const sent = toRole(ctx, role, 'brief', note === undefined ? url : `${url} ${note}`);
  role.brief = url;
  delete role.dismissed;
  writeRole(ctx, role);
  return [sent];
}

/** Product Manager の答えを返す。課題があれば、返す前に「決定」の記録を書く。 */
export function answer(ctx: Context, key: string, options: { text: string, replyTo?: string }): string[] {
  const role = requireRole(ctx, key);
  const recorded = record(ctx, role, { kind: '決定', role: 'TPM', summary: oneLine(options.text), links: [], points: [] });
  return [...recorded, toRole(ctx, role, 'answer', options.text, options.replyTo)];
}

/** 担当に、返事の要らないメッセージを送る（【notify】）。 */
export function notify(ctx: Context, key: string, options: { text: string, replyTo?: string }): string[] {
  return [toRole(ctx, requireRole(ctx, key), 'notify', options.text, options.replyTo)];
}

/** この課題に続きは無い、と知らせる。handover は担当の交代（課題は続くので、担当は課題を閉じない）。 */
export function dismiss(ctx: Context, key: string, options: { handover: boolean }): string[] {
  const role = requireRole(ctx, key);
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
