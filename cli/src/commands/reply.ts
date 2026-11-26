// 置き場のページの、返事の状態（返事待ち・答えた）を書く・読む。
// roster ask pm が確認のページを返事待ちにし、roster answer が答えたにする。Product Manager は、置き場の一覧の UI の印と件数で、返事が要るページを見分ける。
// 待ちの相手: レビューの依頼書はレビューの席を、上げたレビューは TPM 担当を待つ（review-marks.ts）。Product Manager の数には入らない。
// 状態を書けない時（置き場が止まっている）でも、メッセージを送る命令は止めない（印は付かないだけ）。
import { basename } from 'node:path';
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';
import type { PageRecord } from './page.ts';
import { inStore, pagesRequest, pagesUrl, reason } from './store.ts';

/** 返事の状態。置き場の API の `state`・`reply` の値と同じ名。 */
export type ReplyState = 'waiting' | 'answered';

/** 待ちの相手。置き場の API の `on` の値と同じ名。pm は Product Manager（書かない時と同じ）。 */
export type Party = 'pm' | 'review' | 'tpm';
/** 待ちの相手の名を読む。違えば undefined。 */
export const party = (value: string): Party | undefined => (['pm', 'review', 'tpm'] as const).find(p => p === value);

/** 状態の、人が読む名（待ちの相手ごと。置き場の一覧の UI の印と同じ字）。 */
export const REPLY_LABELS: Record<Party, Record<ReplyState, string>> = {
  pm: { waiting: '返事待ち', answered: '答えた' },
  review: { waiting: 'レビュー待ち', answered: 'レビュー済み' },
  tpm: { waiting: '上げた', answered: '決まった' },
};
/** Product Manager の返事の状態の、人が読む名。 */
export const REPLY_LABEL = REPLY_LABELS.pm;

/** 置き場の中のページの path（`<project>/<Key>/<種類>-<番号>.html`）の形。 */
const PAGE_PATH = /^([^/]+)\/([^/]+)\/([a-z][a-z0-9-]{0,31})-([1-9]\d*)\.html$/;

/** URL が、置き場のページ（file や一覧でなく）を指しているか。 */
export const isStorePage = (ctx: Context, url: string): boolean => PAGE_PATH.test(inStore(ctx.env, url) ?? '');

/** 置き場のページの URL の、project と Key。置き場のページでなければ undefined。 */
export function pageOwner(ctx: Context, url: string): { project: string, key: string } | undefined {
  const at = PAGE_PATH.exec(inStore(ctx.env, url) ?? '');
  return at === null ? undefined : { project: at[1] ?? '', key: at[2] ?? '' };
}

/** 置き場の中の同じページか（前の置き場の URL で書かれていても、同じ path なら同じ）。 */
export const samePage = (ctx: Context, a: string, b: string): boolean => {
  const pa = inStore(ctx.env, a);
  return pa !== undefined && pa === inStore(ctx.env, b);
};

/**
 * 状態を書いた結果。done は書けた。down は置き場が応えない。
 * missing はそのページが無い（消した物も）。conflict は、そのページが on の相手を待っていない（置き場は何も替えていない）。
 * foreign は置き場のページの URL でない（何もしていない）。
 */
export type ReplyResult = 'done' | 'down' | 'missing' | 'conflict' | 'foreign';

/** 置き場のページの URL を、project・Key・種類・番号に分ける。置き場のページでなければ undefined。 */
export function pageParts(ctx: Context, url: string): { project: string, key: string, kind: string, n: string } | undefined {
  const at = PAGE_PATH.exec(inStore(ctx.env, url) ?? '');
  if (at === null) return undefined;
  const [, project = '', key = '', kind = '', n = ''] = at;
  return { project, key, kind, n };
}

/** ページ 1 枚の返事の状態を書く（SetReplyState。待ちの相手が Product Manager なら on を書かない）。書けない訳は、止まらずに返す。 */
export async function setReply(ctx: Context, url: string, state: ReplyState, on: Party = 'pm'): Promise<ReplyResult> {
  const parts = pageParts(ctx, url);
  if (parts === undefined) return 'foreign';
  const query = new URLSearchParams({ ...parts, state, ...(on === 'pm' ? {} : { on }) });
  const r = await pagesRequest(ctx, { op: 'SetReplyState', query });
  if (r.code === '000') return 'down';
  if (r.code === '200') return 'done';
  if (r.code === '409') return 'conflict';
  // 消したページも無いページも、置き場は 404 で返す。
  if (r.code === '404') return 'missing';
  throw new TpmError(`置き場が返事の状態を書きませんでした（${r.code}）: ${reason(r.body)}`);
}

/** 記録が、その相手の、その状態か。返事を求めていないページは、どちらでもない。 */
export function inState(page: PageRecord, state: ReplyState, on: Party = 'pm'): boolean {
  if ((page.waits_on ?? 'pm') !== on) return false;
  return state === 'answered' ? page.answered_at !== undefined : page.asked_at !== undefined && page.answered_at === undefined;
}

/**
 * 今の project の、その Key の、Product Manager の返事待ちのページの URL（古い順）。置き場に聞けなければ undefined。
 * 置き場は、`on` の無い `reply` に Product Manager の分だけを返す（レビュー待ち・上げた件は入らない）。記録の欄でも絞る。
 */
export async function waitingUrls(ctx: Context, key: string): Promise<string[] | undefined> {
  const query = new URLSearchParams({ project: basename(ctx.state.dir), key, reply: 'waiting', sort: 'created_at', limit: '1000' });
  const r = await pagesRequest(ctx, { op: 'ListPages', query });
  if (r.code !== '200') return undefined;
  return (JSON.parse(r.body) as { pages: PageRecord[] }).pages.filter(p => inState(p, 'waiting')).map(p => `${pagesUrl(ctx.env)}${p.path}`);
}

/**
 * 今の project の、その Key の返事待ちのページの URL を、待ちの相手ごとに（古い順）。置き場に聞けなければ undefined。
 * 相手ごとに、置き場が返事待ちに絞った物を聞く（Key のページが多くても落とさない）。
 */
export async function waitingByParty(ctx: Context, key: string): Promise<Record<Party, string[]> | undefined> {
  const of = async (on: Party): Promise<string[] | undefined> => {
    const query = new URLSearchParams({ project: basename(ctx.state.dir), key, reply: 'waiting', ...(on === 'pm' ? {} : { on }), sort: 'created_at', limit: '1000' });
    const r = await pagesRequest(ctx, { op: 'ListPages', query });
    if (r.code !== '200') return undefined;
    return (JSON.parse(r.body) as { pages: PageRecord[] }).pages.filter(p => inState(p, 'waiting', on)).map(p => `${pagesUrl(ctx.env)}${p.path}`);
  };
  const pm = await of('pm');
  if (pm === undefined) return undefined;
  return { pm, review: await of('review') ?? [], tpm: await of('tpm') ?? [] };
}

/** 返事待ちのページの、相手ごとの言い方（roster dismiss が並べる時の字）。 */
export const WAITING_PAGES: Record<Party, string> = {
  pm: '返事待ちのページ',
  review: 'レビュー待ちの依頼書',
  tpm: '上げた（TPM 担当が決めていない）レビューのページ',
};

/**
 * メッセージを送る命令（ask pm・answer・ask review・report review・ask tpm --review）が、状態を書いた結果を 1 行で出す。書けなくても止まらない。
 * done は、書けた時の行（既定は「（状態の名）にした」）。on は待ちの相手。
 */
export async function replyLine(ctx: Context, url: string, state: ReplyState, done?: string, on: Party = 'pm'): Promise<string[]> {
  const result = await setReply(ctx, url, state, on);
  if (result === 'done') return [`置き場の印: ${done ?? `${REPLY_LABELS[on][state]}にした`} ${url}`];
  return markFailure(url, result, `roster page reply ${url} --${state}${on === 'pm' ? '' : ` --on ${on}`}`);
}

/**
 * 置き場の印を付けられなかった訳の 1 行（メッセージを送る命令は止めない）。fix は、置き場が応えない時に TPM 担当が後で直す命令。
 * done と foreign は何も出さない。
 */
export function markFailure(url: string, result: ReplyResult, fix: string): string[] {
  switch (result) {
    case 'done': return [];
    case 'down': return [`置き場の印: 付けていない（置き場が応えない。メッセージは送った。後で TPM 担当が ${fix} で直せる）`];
    case 'missing': return [`置き場の印: 付けていない（そのページは置き場に無い: ${url}）`];
    case 'conflict': return [`置き場の印: 付けていない（${url} は、その相手の返事を待っていなかった。置き場は何も替えていない）`];
    case 'foreign': return [];
  }
}
