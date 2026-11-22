// Staff Engineer 担当の席と、レビューのやりとり。
// 課題の担当が tpm ask review で頼み、Staff Engineer 担当が tpm report review で返す。どちらも TPM 担当を通らず、相手へじかに届く。
// 席が無ければ、頼みの命令が起こす（依頼書は頼みから作る）。TPM 担当の tpm assign <課題の Key> --role staff-engineer（tpm-side.ts）は、席の起こし直しに残る。
// 判定を受けない時だけ、課題の担当が tpm ask tpm --review <番号> で TPM 担当に上げる（messages.ts の askTpm）。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireUp, sessionRef } from '../castlist.ts';
import type { Context } from '../context.ts';
import { syncDeliveries } from '../evidence.ts';
import { ROLES, WAIT, type RoleName } from '../protocol.ts';
import { addReview, openReviews, patchReview, removeReview, reviewLabel, VERDICTS, type Review, type Verdict } from '../reviews.ts';
import { readRole, staffKey, subjectOf, writeRole, type RoleRecord } from '../roster.ts';
import { resolveSettings, type SettingsLayer } from '../settings.ts';
import { skillSetDir, TpmError } from '../skill-sets.ts';
import { issueCopy, launch, NotStartedError, roleDefaults } from './launch.ts';
import { notAuditor, notRepeatToPeer, oneLine, record, sender, showWait, toPeer, wait } from './messages.ts';
import { putPage } from './page.ts';
import { pageOwner } from './reply.ts';
import { isPageUrl } from './store.ts';

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

/** `launchStaff` に渡す物。 */
export interface LaunchStaffOptions {
  /** model などの旗（TPM 担当の tpm assign だけ。tpm ask review からは付けられない）。 */
  flags?: SettingsLayer
  cwd?: string
  issue?: string
  noIssueCopy?: string
  /** 名乗りを待つ秒（0 なら待たない）。 */
  wait: number
  /** 起こし直しか（出す字が変わる）。 */
  again: boolean
  /** castlist が止まっていた時に、止まった訳の後ろに出す行。 */
  castlistHint: string[]
  /** 起こした行の後に出す行（課題の記録の先など）。 */
  more?: (issue: string | undefined) => string[]
}

/**
 * Staff Engineer 担当の席を起こす: 頼みから依頼書を作って置き、名簿の行（Key は `<課題の Key>.staff`）を書き、居場所を作る。
 * 題（`レビュー <課題の Key>: <見る物>`）と説明（見てほしい所）は頼みから作り、色は役割の表から付く。
 * 課題の担当の tpm ask review（席が無い時）と、TPM 担当の tpm assign --role staff-engineer（起こし直し）が使う。
 * 起こした者（castlist の launchedBy）は、命令を打った session（tpm ask review なら課題の担当）。
 */
export function launchStaff(ctx: Context, subject: RoleRecord, asks: Review[], options: LaunchStaffOptions): string[] {
  // Staff Engineer 担当の記録は、見ている課題の課題管理の課題に書く。
  const issue = options.issue ?? subject.issue;
  const cwd = options.cwd ?? ctx.project;
  const settings = resolveSettings(STAFF, { flags: options.flags ?? {}, config: roleDefaults(ctx, STAFF, cwd), env: ctx.env });
  // castlist を設定していれば、起きているかを、写しを置く前に見る（止まっていれば、席を起こさずに止まる）。
  const skew = requireUp(ctx, '担当は起こしていません。', options.castlistHint);
  // 居場所を作る前に読む（読めなければ、席を起こさずに止まる）。
  const copy = issueCopy(ctx, issue ?? subject.key, subject.key, options.noIssueCopy);
  const label = reviewLabel(asks);
  // 起こす席には、依頼書を名簿の行で渡す（起こせなかった回は席が無いので、次の回に渡し直す）。
  const briefUrl = putStaffBrief(ctx, subject, asks);
  markBriefed(ctx, asks, briefUrl);
  const seat: RoleRecord = {
    key: staffKey(subject.key),
    subject: subject.key,
    role: STAFF,
    title: ROLES[STAFF].title(subject.key, label.target),
    cwd,
    addDirs: ['core', ...ctx.skillSets].map(s => skillSetDir(ctx.root, s)),
    ...settings,
    brief: briefUrl,
    firstBrief: briefUrl,
    ...(issue === undefined ? {} : { issue }),
    ...copy,
  };
  const sid = ctx.env.CLAUDE_CODE_SESSION_ID;
  return launch(ctx, seat, options.again, options.wait, [...(options.more?.(issue) ?? []), ...skew], sid ? sessionRef(sid) : undefined, label.description);
}

// ---- レビュー（課題の担当が頼み、Staff Engineer 担当が返す。どちらも相手へじかに届く） ----

/** PR の URL の形（`https://<host>/<owner>/<repo>/pull/<番号>`）。 */
const PR_URL = /^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/;
/** 置き場のレビューのページの URL の終わり。 */
const REVIEW_PAGE = /\/review-[1-9]\d*\.html(?:[?#].*)?$/;
/** tpm ask review が、起こした席の名乗りを待つ秒の既定（tpm assign と同じ）。 */
export const ASK_REVIEW_WAIT = 90;

/**
 * 課題の担当が、計画・提案のページか PR のレビューを頼む（【ask-review】）。TPM 担当を通らない。
 * 頼みを記録（reviews.ts）に書き、頼みから依頼書を作って置く。Staff Engineer 担当の席が無ければ（落ちていても）起こして依頼書を名簿の行で渡し、
 * 居れば【ask-review】（頭が依頼書の URL）を席へじかに送って、席の題と説明を替える。前の頼みがまだ返っていなければ、その後ろに積む（席は積まれた順にこなす）。
 * 状態を `回答待ち(レビュー)` にする。判定は、席から【review】でじかに届く。レビューは助言で、頼んだ担当を縛らない。
 * wait は、起こした席の名乗りを待つ秒（0 なら待たない）。
 */
export function askReview(ctx: Context, options: { url: string, focus?: string, wait?: number }): string[] {
  const self = sender(ctx);
  notAuditor(self, 'tpm ask review');
  if (!isPageUrl(ctx.env, options.url) && !PR_URL.test(options.url)) throw new TpmError(`--url は、置き場のページか PR の URL にしてください（見る物）: ${options.url}`);
  const same = openReviews(ctx, self.key).find(r => r.url === options.url);
  if (same !== undefined) throw new TpmError(`同じ物のレビューを、もう頼んであります（#${same.n}。${same.askedAt} に頼んだ）。2 度目は送っていません。判定は Staff Engineer 担当から【review】で届きます`);
  const subject = staffSubject(ctx, self.key);
  const seat = readRole(ctx, staffKey(self.key));
  const alive = seat?.address !== undefined && ctx.transport.seats().some(s => s.address === seat.address);
  const focus = options.focus?.trim() || undefined;
  // 前の頼みで、席に渡したがまだ返っていない物（席が居る時は、その後ろに積む）。
  const before = openReviews(ctx, self.key).filter(r => r.brief !== undefined);
  const review = addReview(ctx, { key: self.key, url: options.url, ...(focus === undefined ? {} : { focus }), by: self.title });
  let out: string[];
  if (seat !== undefined && alive) {
    try {
      const url = putStaffBrief(ctx, subject, [review]);
      const body = [
        url,
        `頼み: #${review.n} ${options.url}`,
        ...(focus === undefined ? [] : [`見てほしい所: ${focus}`]),
        ...(before.length === 0 ? [] : [`${before.map(r => `#${r.n}`).join('・')}を済ませてから、これをする`]),
      ].join(' ');
      const sent = toPeer(ctx, self, seat, 'ask-review', body);
      markBriefed(ctx, [review], url);
      seat.brief = url;
      writeRole(ctx, seat);
      out = [sent, ...relabelStaff(ctx, seat, self.key, [review])];
    }
    catch (e) {
      // 送れなかった頼みを残すと、打ち直しが「もう頼んであります」で止まる。
      removeReview(ctx, review.n);
      throw e;
    }
  }
  else {
    try {
      // 席が無い・落ちた: 返っていない前の頼み（渡したが返っていない物も、渡せていなかった物も）を、新しい依頼書で渡し直す。
      out = launchStaff(ctx, subject, openReviews(ctx, self.key), {
        wait: options.wait ?? ASK_REVIEW_WAIT,
        again: seat !== undefined,
        castlistHint: ['この 1 行は自分で打たない。tpm ask tpm で、castlist が止まっていることを TPM 担当に知らせ、起きた後にもう 1 度 tpm ask review を打ってください。'],
      });
    }
    catch (e) {
      // 居場所を作った後に名乗らなかった回は、頼みを残す（依頼書は渡してある）。その前に止まった回は、頼みを取り消す（打ち直せる）。
      if (e instanceof NotStartedError) throw new TpmError(`${e.message}\n頼み #${review.n} は残してあります。Staff Engineer 担当の席が名乗らないことを、tpm ask tpm で TPM 担当に知らせてください。`);
      removeReview(ctx, review.n);
      throw e;
    }
  }
  // じかのメッセージは TPM 担当の命令を通らないので、届いた時刻をここで写す。
  syncDeliveries(ctx);
  return [...out, ...wait(ctx, 'review', reviewLabel([review]).target)];
}

/** `tpm report review` の旗。 */
export interface ReviewOptions {
  /** レビューのページ（tpm page put --kind review で置いた URL）。 */
  url: string
  /** 判定（VERDICTS の語）。 */
  verdict: string
  summary: string
}

/** 次のレビューの頼みを待つ（Staff Engineer 担当の【review】の後）。 */
const WAIT_NEXT_REVIEW = WAIT.review('次の頼み');

/**
 * Staff Engineer 担当が、レビューのページと判定を返す（【review】）。頼んだ課題の担当へじかに届く（TPM 担当を通らない）。
 * いちばん古い依頼書の頼み（まだ返していない物）に判定を書き、課題があれば記録「レビュー」を書く。
 * 課題の担当の居場所が無ければ、送らず・記録も書かずに止まる（TPM 担当に知らせる）。
 */
export function reportReview(ctx: Context, options: ReviewOptions): string[] {
  const self = sender(ctx);
  if (self.role !== 'staff-engineer') throw new TpmError('tpm report review は Staff Engineer 担当（Staff の席）が打ちます。レビューを頼むのは tpm ask review');
  if (!Object.hasOwn(VERDICTS, options.verdict)) throw new TpmError(`--verdict は ${Object.keys(VERDICTS).join('・')} のどれかにしてください（${Object.entries(VERDICTS).map(([id, label]) => `${id}＝${label}`).join('・')}）`);
  const verdict = options.verdict as Verdict;
  if (!isPageUrl(ctx.env, options.url) || !REVIEW_PAGE.test(options.url)) throw new TpmError(`--url は、tpm page put --kind review で置いたレビューのページの URL にしてください: ${options.url}`);
  const subject = subjectOf(self);
  if (pageOwner(ctx, options.url)?.key !== subject) throw new TpmError(`--url は、${subject} のレビューのページにしてください（別の課題のページ）: ${options.url}`);
  // 返すのは、いちばん古い依頼書の頼みだけ（依頼書は積まれた順にこなす。後ろに積まれた依頼書の頼みは、次の【review】で返す）。
  const briefed = openReviews(ctx, subject).filter(r => r.brief !== undefined);
  const asks = briefed.filter(r => r.brief === briefed[0]?.brief);
  if (asks.length === 0) throw new TpmError(`${subject} に、返していないレビューの頼みがありません（もう返したか、頼みがまだ来ていない）。送っていません`);
  const owner = readRole(ctx, subject);
  if (owner === undefined) throw new TpmError(`${subject} の担当が名簿にいません。送っていません・記録も書いていません。tpm ask tpm で TPM 担当に知らせてください（レビューのページ: ${options.url}）`);
  const label = VERDICTS[verdict];
  const body = `${options.url} 判定: ${label}（${verdict}）／一言: ${options.summary}／頼み: ${asks.map(r => `#${r.n}`).join(' ')}`;
  // 相手の居場所と 2 度送りを、課題に記録を書く前に見る。
  notRepeatToPeer(ctx, self, owner, 'review', body);
  const recorded = record(ctx, self, { kind: 'レビュー', role: ROLES[self.role].label, summary: oneLine(`${label}: ${options.summary}`), links: [{ label: 'レビュー', url: options.url }], points: [] });
  const sent = toPeer(ctx, self, owner, 'review', body);
  const reviewedAt = ctx.now().toISOString();
  for (const r of asks) patchReview(ctx, r.n, { verdict, page: options.url, summary: options.summary, reviewedAt });
  syncDeliveries(ctx);
  showWait(ctx, WAIT_NEXT_REVIEW);
  return [...recorded, sent, `状態: ${WAIT_NEXT_REVIEW}`];
}
