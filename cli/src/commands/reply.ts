// 置き場（pagetray 0.5.0 から）のページの、返事の状態（返事待ち・答えた）を書く・読む。
// tpm ask pm が確認のページを返事待ちにし、tpm answer が答えたにする。Product Manager は、置き場の一覧の UI の印と件数で、返事が要るページを見分ける。
// 状態を書けない置き場（0.5.0 より前・止まっている）でも、メッセージを送る命令は止めない（印は付かないだけ）。
import { basename } from 'node:path';
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';
import type { PageRecord } from './page.ts';
import { call, inStore, pagesUrl, reason } from './store.ts';

/** 返事の状態。置き場の API の `state`・`reply` の値と同じ名。 */
export type ReplyState = 'waiting' | 'answered';

/** 状態の、人が読む名。 */
export const REPLY_LABEL: Record<ReplyState, string> = { waiting: '返事待ち', answered: '答えた' };

/** 置き場の中のページの path（`<project>/<Key>/<種類>-<番号>.html`）の形。 */
const PAGE_PATH = /^([^/]+)\/([^/]+)\/([a-z][a-z0-9-]{0,31})-([1-9]\d*)\.html$/;

/** URL が、置き場のページ（file や一覧でなく）を指しているか。 */
export const isStorePage = (ctx: Context, url: string): boolean => PAGE_PATH.test(inStore(ctx.env, url) ?? '');

/**
 * 状態を書いた結果。done は書けた。old は置き場の版が古く（0.5.0 より前）その道が無い。down は置き場が応えない。
 * missing はそのページが無い（消した物も）。foreign は置き場のページの URL でない（何もしていない）。
 */
export type ReplyResult = 'done' | 'old' | 'down' | 'missing' | 'foreign';

/** ページ 1 枚の返事の状態を書く（POST /api/pages/reply）。書けない訳は、止まらずに返す。 */
export function setReply(ctx: Context, url: string, state: ReplyState): ReplyResult {
  const at = PAGE_PATH.exec(inStore(ctx.env, url) ?? '');
  if (at === null) return 'foreign';
  const [, project = '', key = '', kind = '', n = ''] = at;
  const r = call(ctx, ['-X', 'POST', `${pagesUrl(ctx.env)}/api/pages/reply?${new URLSearchParams({ project, key, kind, n, state }).toString()}`]);
  if (r.code === '000') return 'down';
  if (r.code === '200') return 'done';
  // 0.5.0 より前の置き場は、この path をページの本文の道（GET だけ）として読み、405 を返す。
  if (r.code === '405') return 'old';
  // 消したページ（410）と無いページ（404）。0.5.0 からの置き場は、どちらも 404 で返す。
  if (r.code === '404' || r.code === '410') return 'missing';
  throw new TpmError(`置き場が返事の状態を書きませんでした（${r.code}）: ${reason(r.body)}`);
}

/** 記録が、その状態か。返事を求めていないページは、どちらでもない。 */
export function inState(page: PageRecord, state: ReplyState): boolean {
  return state === 'answered' ? page.answered_at !== undefined : page.asked_at !== undefined && page.answered_at === undefined;
}

/**
 * 今の project の、その Key の返事待ちのページの URL（古い順）。置き場に聞けなければ undefined。
 * 0.5.0 より前の置き場は `reply` の絞りを読まずにみな返すので、記録の欄でも絞る（前の置き場では、いつも空になる）。
 */
export function waitingUrls(ctx: Context, key: string): string[] | undefined {
  const query = new URLSearchParams({ project: basename(ctx.state.dir), key, reply: 'waiting', sort: 'created_at', limit: '1000' });
  const r = call(ctx, [`${pagesUrl(ctx.env)}/api/pages?${query.toString()}`]);
  if (r.code !== '200') return undefined;
  return (JSON.parse(r.body) as { pages: PageRecord[] }).pages.filter(p => inState(p, 'waiting')).map(p => `${pagesUrl(ctx.env)}${p.path}`);
}

/** メッセージを送る命令（ask pm・answer）が、状態を書いた結果を 1 行で出す。書けなくても止まらない。 */
export function replyLine(ctx: Context, url: string, state: ReplyState): string[] {
  const label = REPLY_LABEL[state];
  switch (setReply(ctx, url, state)) {
    case 'done': return [`置き場の印: ${label}にした ${url}`];
    case 'old': return [`置き場の印: 付けていない（置き場の版が古く、返事の状態を持てない。メッセージは送った。置き場の版を上げるのは tpm ask devops）`];
    case 'down': return [`置き場の印: 付けていない（置き場が応えない。メッセージは送った。後で TPM 担当が tpm page reply ${url} --${state} で直せる）`];
    case 'missing': return [`置き場の印: 付けていない（そのページは置き場に無い: ${url}）`];
    case 'foreign': return [];
  }
}
