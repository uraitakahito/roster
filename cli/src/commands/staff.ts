// Staff Engineer 担当の席に渡す物を作る: 起こす前の確かめ・レビューの頼みから作る依頼書・渡した印・席の題と説明の付け替え。
// tpm assign <課題の Key> --role staff-engineer（tpm-side.ts）が使う。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '../context.ts';
import { ROLES, type RoleName } from '../protocol.ts';
import { patchReview, reviewLabel, type Review } from '../reviews.ts';
import { readRole, writeRole, type RoleRecord } from '../roster.ts';
import { skillSetDir, TpmError } from '../skill-sets.ts';
import { putPage } from './page.ts';

/** Staff Engineer 担当の役割の名。 */
export const STAFF: RoleName = 'staff-engineer';

/**
 * Staff Engineer 担当を起こす前の確かめ。課題の担当が名簿に居ること（Staff は、その隣に起こす）と、skill が在ること
 * （無いまま起こすと、最初の入力が Unknown command になる）。課題の担当の名簿の行を返す。
 */
export function staffSubject(ctx: Context, key: string): RoleRecord {
  const subject = readRole(ctx, key);
  if (subject === undefined) throw new TpmError(`${key} の担当が名簿にいません。Staff Engineer 担当は、課題の担当の隣に起こします（tpm roles で名簿を見る）`);
  const skill = join(skillSetDir(ctx.root, 'core'), '.claude', 'skills', 'staff-engineer', 'SKILL.md');
  if (!existsSync(skill)) throw new TpmError(`skill /staff-engineer がまだありません（${skill}）。roster の repo を新しくしてから打ってください`);
  return subject;
}

/** HTML に入れる字の escape。 */
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] ?? c);

/** Staff Engineer 担当への依頼書（レビューの頼みから作る）。課題の概要の節を持つ。 */
function staffBriefPage(subject: RoleRecord, asks: Review[]): string {
  const e = escapeHtml;
  const link = (url: string): string => `<a href="${e(url)}">${e(url)}</a>`;
  return [
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${e(subject.key)} レビューの依頼書</title></head><body>`,
    `<h1>${e(subject.key)}: レビューの依頼書</h1>`,
    '<section id="summary"><h2>課題の概要</h2>',
    `<p>課題 ${e(subject.key)} の担当（${e(subject.title)}）が、下の物のレビューを頼んだ。見る物を読み、課題の担当の依頼書と照らして、レビューのページを置き、tpm report review で返す。直さない・決めない（レビューは助言）。</p>`,
    `<ul><li>課題の担当の依頼書: ${subject.brief === undefined ? '無し' : link(subject.brief)}</li></ul>`,
    '</section>',
    '<h2>見る物</h2>',
    '<ul>',
    ...asks.map(r => `<li>頼み #${r.n}: ${link(r.url)}${r.focus === undefined ? '' : `（見てほしい所: ${e(r.focus)}）`}</li>`),
    '</ul>',
    '</body></html>',
  ].join('\n');
}

/** レビューの頼みから依頼書のページを作って置き、URL を返す。 */
export const putStaffBrief = (ctx: Context, subject: RoleRecord, asks: Review[]): string => putPage(ctx, { text: staffBriefPage(subject, asks) }, 'brief', subject.key).url;

/** 頼みに、渡した依頼書の URL を書く（渡した後に呼ぶ。渡せなかった回に、依頼書にした事にしない）。 */
export function markBriefed(ctx: Context, asks: Review[], url: string): void {
  for (const r of asks) patchReview(ctx, r.n, { brief: url });
}

/**
 * 起きている Staff Engineer 担当の席の題と説明を、新しい依頼書の頼みに替え、名簿の題も同じ字にする（通知のバナーは、居場所の題と名簿の題で席を探す）。
 * 替えられなければ名簿は替えずに、そのことを 1 行返す（依頼書はもう渡してあるので、止めない）。
 * 送る前の検査（assertRead）と通知のバナーは、相手を題で見分ける。この関数より前に Staff の席が前の題で送ったメッセージは、後の検査で拾われない（1 回の assign の中の短い間だけ）。
 */
export function relabelStaff(ctx: Context, seat: RoleRecord, subjectKey: string, asks: Review[]): string[] {
  const { target, description } = reviewLabel(asks);
  const title = ROLES[STAFF].title(subjectKey, target);
  try {
    ctx.transport.relabel(seat.address ?? '', { title, ...(description === undefined ? {} : { description }) });
  }
  catch (e) {
    return [`居場所の題を替えられなかった（名簿の題は ${seat.title} のまま）: ${e instanceof Error ? e.message : String(e)}`];
  }
  seat.title = title;
  writeRole(ctx, seat);
  return [];
}
