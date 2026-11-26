// Staff Engineer 担当の席と、レビューのやりとり。
// 課題の担当が roster ask review で頼み、Staff Engineer 担当が roster report review で返す。どちらも TPM 担当を通らず、相手へじかに届く。
// 席が無ければ、頼みの命令が起こす（依頼書は頼みから作る）。TPM 担当の roster assign <課題の Key> --role staff-engineer（tpm-side.ts）は、席の起こし直しに残る。
// 判定を受けない時だけ、課題の担当が roster ask tpm --review <番号> で TPM 担当に上げる（messages.ts の askTpm）。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireUp, sessionRef } from '../castlist.ts';
import type { Context } from '../context.ts';
import { ROLES, WAIT, type RoleName } from '../protocol.ts';
import { addReview, openReviews, patchReview, readReviews, removeReview, reviewLabel, VERDICTS, type Review, type Verdict } from '../reviews.ts';
import { isRepoSeat, readRole, repoSeats, staffKey, subjectOf, writeRole, type RoleRecord } from '../roster.ts';
import { resolveSettings, type SettingsLayer } from '../settings.ts';
import { skillSetDir, TpmError } from '../skill-sets.ts';
import { issueCopy, launch, NotStartedError, roleDefaults } from './launch.ts';
import { notAuditor, notRepeatToPeer, oneLine, record, sender, showWait, toPeer, wait } from './messages.ts';
import { putPage } from './page.ts';
import { pageOwner } from './reply.ts';
import { markBrief, markVerdict } from './review-marks.ts';
import { isPageUrl } from './store.ts';

/** Staff Engineer 担当の役割の名。 */
export const STAFF: RoleName = 'staff-engineer';

/**
 * Staff Engineer 担当を起こす前の確かめ。課題の担当が名簿に居ること（Staff は、その隣に起こす）と、skill が在ること
 * （無いまま起こすと、最初の入力が Unknown command になる）。課題の担当の名簿の行を返す。
 */
export function staffSubject(ctx: Context, key: string): RoleRecord {
  const subject = readRole(ctx, key);
  if (subject === undefined) throw new TpmError(`${key} の担当が名簿にいません。Staff Engineer 担当は、課題の担当の隣に起こします（roster roles で名簿を見る）`);
  const skill = join(skillSetDir(ctx.root, 'core'), '.claude', 'skills', 'staff-engineer', 'SKILL.md');
  if (!existsSync(skill)) throw new TpmError(`skill /staff-engineer がまだありません（${skill}）。roster の repo を新しくしてから打ってください`);
  return subject;
}

/** HTML に入れる字の escape。 */
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] ?? c);

/**
 * レビューの依頼書（レビューの頼みから作る）。課題の概要の節を持つ。文は、見る者の役割で分ける:
 * Staff Engineer 担当には今までの文、Tech Lead 担当（repo の席の頼み）には、自分の計画と境の取り決めに照らす文。
 */
function staffBriefPage(subject: RoleRecord, asks: Review[]): string {
  const e = escapeHtml;
  const link = (url: string): string => `<a href="${e(url)}">${e(url)}</a>`;
  const [who, how] = isRepoSeat(subject)
    ? [`repo の席 ${e(subject.key)}`, '見る物を読み、この席の依頼書と、自分の計画・repo の境の取り決めに照らして、レビューのページを置き、roster report review で返す。レビューでは直さない（直すのは、頼んだ席）。']
    : [`課題 ${e(subject.key)} の担当`, '見る物を読み、課題の担当の依頼書と照らして、レビューのページを置き、roster report review で返す。直さない・決めない（レビューは助言）。'];
  return [
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${e(subject.key)} レビューの依頼書</title></head><body>`,
    `<h1>${e(subject.key)}: レビューの依頼書</h1>`,
    '<section id="summary"><h2>課題の概要</h2>',
    `<p>${who}（${e(subject.title)}）が、下の物のレビューを頼んだ。${how}</p>`,
    `<ul><li>${isRepoSeat(subject) ? 'この席の依頼書' : '課題の担当の依頼書'}: ${subject.brief === undefined ? '無し' : link(subject.brief)}</li></ul>`,
    '</section>',
    '<h2>見る物</h2>',
    '<ul>',
    ...asks.map(r => `<li>頼み #${r.n}: ${link(r.url)}${r.focus === undefined ? '' : `（見てほしい所: ${e(r.focus)}）`}</li>`),
    '</ul>',
    '</body></html>',
  ].join('\n');
}

/** レビューの頼みから依頼書のページを作って置き、URL を返す。置く folder は、頼んだ担当の課題の Key（repo の席は、親の課題の folder）。 */
export const putStaffBrief = async (ctx: Context, subject: RoleRecord, asks: Review[]): Promise<string> => (await putPage(ctx, { text: staffBriefPage(subject, asks) }, 'brief', subjectOf(subject))).url;

/**
 * 頼みに、渡した依頼書の URL を書く（渡した後に呼ぶ。渡せなかった回に、依頼書にした事にしない）。
 * 頼みが前に持っていた依頼書（置き換えた物）を返す。置き場の印は、その後に markBrief（review-marks.ts）で書く。
 */
export function markBriefed(ctx: Context, asks: Review[], url: string): string[] {
  const previous = asks.flatMap(r => r.brief === undefined ? [] : [r.brief]);
  for (const r of asks) patchReview(ctx, r.n, { brief: url });
  return previous;
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
    ctx.seats.relabel(seat.address ?? '', { title, ...(description === undefined ? {} : { description }) });
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
  /** model などの旗（TPM 担当の roster assign だけ。roster ask review からは付けられない）。 */
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
 * 課題の担当の roster ask review（席が無い時）と、TPM 担当の roster assign --role staff-engineer（起こし直し）が使う。
 * 起こした者（castlist の launchedBy）は、命令を打った session（roster ask review なら課題の担当）。
 */
export async function launchStaff(ctx: Context, subject: RoleRecord, asks: Review[], options: LaunchStaffOptions): Promise<string[]> {
  // Staff Engineer 担当の記録は、見ている課題の課題管理の課題に書く。
  const issue = options.issue ?? subject.issue;
  const cwd = options.cwd ?? ctx.project;
  const settings = resolveSettings(STAFF, { flags: options.flags ?? {}, config: roleDefaults(ctx, STAFF, cwd), env: ctx.env });
  // castlist を設定していれば、起きているかを、写しを置く前に見る（止まっていれば、席を起こさずに止まる）。
  const skew = await requireUp(ctx, '担当は起こしていません。', options.castlistHint);
  // 居場所を作る前に読む（読めなければ、席を起こさずに止まる）。
  const copy = await issueCopy(ctx, issue ?? subject.key, subject.key, options.noIssueCopy);
  const label = reviewLabel(asks);
  // 起こす席には、依頼書を名簿の行で渡す（起こせなかった回は席が無いので、次の回に渡し直す）。
  const briefUrl = await putStaffBrief(ctx, subject, asks);
  const previous = markBriefed(ctx, asks, briefUrl);
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
  const before = readRole(ctx, seat.key)?.address;
  let out: string[];
  try {
    out = await launch(ctx, seat, options.again, options.wait, [...(options.more?.(issue) ?? []), ...skew], sid ? sessionRef(sid) : undefined, label.description);
  }
  catch (e) {
    // 居場所ができた後の失敗（名乗らない など）は、頼みが残るので印も付ける。居場所を作る前に止まった回は付けない（依頼書の待ちを残さない）。
    const after = readRole(ctx, seat.key)?.address;
    if (e instanceof NotStartedError || (after !== undefined && after !== before)) await markBrief(ctx, briefUrl, asks, previous);
    throw e;
  }
  // 置き場の印は、居場所ができた後に付ける。
  return [...out, ...await markBrief(ctx, briefUrl, asks, previous)];
}

// ---- レビュー（課題の担当が頼み、Staff Engineer 担当が返す。どちらも相手へじかに届く） ----

/** PR の URL の形（`https://<host>/<owner>/<repo>/pull/<番号>`）。 */
const PR_URL = /^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/;
/** 置き場のレビューのページの URL の終わり。 */
const REVIEW_PAGE = /\/review-[1-9]\d*\.html(?:[?#].*)?$/;
/** roster ask review が、起こした席の名乗りを待つ秒の既定（roster assign と同じ）。 */
export const ASK_REVIEW_WAIT = 90;

/**
 * 課題の担当が、計画・提案のページか PR のレビューを頼む（【ask-review】）。TPM 担当を通らない。
 * 頼みを記録（reviews.ts）に書き、頼みから依頼書を作って置く。Staff Engineer 担当の席が無ければ（落ちていても）起こして依頼書を名簿の行で渡し、
 * 居れば【ask-review】（頭が依頼書の URL）を席へじかに送って、席の題と説明を替える。前の頼みがまだ返っていなければ、その後ろに積む（席は積まれた順にこなす）。
 * まだ席に渡していない前の頼み（前の流れで TPM 担当に送られたままの物）があれば、同じ依頼書で一緒に渡す。
 * 状態を `回答待ち(レビュー)` にする。判定は、席から【review】でじかに届く。レビューは助言で、頼んだ担当を縛らない。
 * wait は、起こした席の名乗りを待つ秒（0 なら待たない）。
 */
export async function askReview(ctx: Context, options: { url: string, focus?: string, wait?: number }): Promise<string[]> {
  const self = await sender(ctx);
  notAuditor(self, 'roster ask review');
  if (!isPageUrl(ctx.env, options.url) && !PR_URL.test(options.url)) throw new TpmError(`--url は、置き場のページか PR の URL にしてください（見る物）: ${options.url}`);
  const same = openReviews(ctx, self.key).find(r => r.url === options.url);
  if (same !== undefined) throw new TpmError(`同じ物のレビューを、もう頼んであります（#${same.n}。${same.askedAt} に頼んだ）。2 度目は送っていません。判定は ${isRepoSeat(self) ? 'Tech Lead 担当' : 'Staff Engineer 担当'}から【review】で届きます`);
  // repo の席の頼みは、親の課題の Tech Lead 担当が見る（Staff Engineer 担当の席は起こさない）。
  if (isRepoSeat(self)) return await askLeadReview(ctx, self, options);
  const subject = staffSubject(ctx, self.key);
  const seat = readRole(ctx, staffKey(self.key));
  const alive = seat?.address !== undefined && ctx.seats.seats().some(s => s.address === seat.address);
  const focus = options.focus?.trim() || undefined;
  // 前の頼みで、席に渡したがまだ返っていない物（席が居る時は、その後ろに積む）と、まだ席に渡していない物（前の流れで TPM 担当に送られたまま、振られていない頼み。一緒に渡す）。
  const open = openReviews(ctx, self.key);
  const before = open.filter(r => r.brief !== undefined);
  const loose = open.filter(r => r.brief === undefined);
  const review = addReview(ctx, { key: self.key, url: options.url, ...(focus === undefined ? {} : { focus }), by: self.title });
  const asks = [...loose, review];
  let out: string[];
  if (seat !== undefined && alive) {
    let url: string;
    let sent: string;
    try {
      url = await putStaffBrief(ctx, subject, asks);
      const body = [
        url,
        `頼み: ${asks.map(r => `#${r.n}`).join(' ')} ${options.url}`,
        ...(focus === undefined ? [] : [`見てほしい所: ${focus}`]),
        ...(before.length === 0 ? [] : [`${before.map(r => `#${r.n}`).join('・')}を済ませてから、これをする`]),
      ].join(' ');
      sent = await toPeer(ctx, self, seat, 'ask-review', body);
    }
    catch (e) {
      // 送る前に止まった頼みを残すと、打ち直しが「もう頼んであります」で止まる。送った後の失敗では消さない（席にはもう届いている）。
      removeReview(ctx, review.n);
      throw e;
    }
    const previous = markBriefed(ctx, asks, url);
    seat.brief = url;
    writeRole(ctx, seat);
    // 席の題は、返っていない頼みをみな数える（新しい頼みと +<残りの数>）。
    out = [sent, ...relabelStaff(ctx, seat, self.key, [...before, ...asks]), ...await markBrief(ctx, url, asks, previous)];
  }
  else {
    try {
      // 席が無い・落ちた: 返っていない前の頼み（渡したが返っていない物も、渡せていなかった物も）を、新しい依頼書で渡し直す。
      out = await launchStaff(ctx, subject, [...open, review], {
        wait: options.wait ?? ASK_REVIEW_WAIT,
        again: seat !== undefined,
        castlistHint: ['この 1 行は自分で打たない。roster ask tpm で、castlist が止まっていることを TPM 担当に知らせ、起きた後にもう 1 度 roster ask review を打ってください。'],
      });
    }
    catch (e) {
      // 居場所を作った後の失敗（名乗らなかった など）は、頼みを残す（依頼書は名簿の行で渡してある）。その前に止まった回は、頼みを取り消す（打ち直せる）。
      const made = readRole(ctx, staffKey(self.key))?.address;
      const spawned = made !== undefined && made !== seat?.address;
      if (!(e instanceof NotStartedError) && !spawned) {
        removeReview(ctx, review.n);
        throw e;
      }
      const message = e instanceof Error ? e.message : String(e);
      throw new TpmError(`${message}\n頼み #${review.n} は残してあります。Staff Engineer 担当の席が名乗らないことを、roster ask tpm で TPM 担当に知らせてください（TPM 担当が、残った居場所を roster close ${staffKey(self.key)} で閉じてから起こし直す）。`);
    }
  }
  return [...out, ...wait(ctx, 'review', reviewLabel([review]).target)];
}

/**
 * repo の席のレビューの頼み: 親の課題の Tech Lead 担当の席へ、じかに【ask-review】を送る。席が無い・応えない時は、送らずに止まる
 * （Staff Engineer 担当の席は起こさない。TPM 担当への相談を案内する）。Tech Lead 担当は、TPM 担当の依頼書も受けているので、
 * 席の依頼書（名簿の brief）と題は替えない。頼みは、Tech Lead 担当の依頼書の列には積まれない（messages.ts の openBriefs）。
 */
async function askLeadReview(ctx: Context, self: RoleRecord, options: { url: string, focus?: string }): Promise<string[]> {
  const lead = self.subject === undefined ? undefined : readRole(ctx, self.subject);
  if (lead === undefined || lead.address === undefined || !ctx.seats.seats().some(s => s.address === lead.address)) {
    throw new TpmError(`${self.subject ?? ''} の Tech Lead 担当の席がありません。レビューは頼んでいません。roster ask tpm で TPM 担当に知らせてください`);
  }
  const focus = options.focus?.trim() || undefined;
  const before = openReviews(ctx, self.key).filter(r => r.brief !== undefined);
  const review = addReview(ctx, { key: self.key, url: options.url, ...(focus === undefined ? {} : { focus }), by: self.title, reviewer: 'tech-lead' });
  let url: string;
  let sent: string;
  try {
    url = await putStaffBrief(ctx, self, [review]);
    const body = [
      url,
      `頼み: #${review.n} ${options.url}`,
      ...(focus === undefined ? [] : [`見てほしい所: ${focus}`]),
      ...(before.length === 0 ? [] : [`${before.map(r => `#${r.n}`).join('・')}を済ませてから、これをする`]),
    ].join(' ');
    sent = await toPeer(ctx, self, lead, 'ask-review', body);
  }
  catch (e) {
    // 送る前に止まった頼みを残すと、打ち直しが「もう頼んであります」で止まる。
    removeReview(ctx, review.n);
    throw e;
  }
  const previous = markBriefed(ctx, [review], url);
  return [sent, ...await markBrief(ctx, url, [review], previous), ...wait(ctx, 'review', reviewLabel([review]).target)];
}

/** `roster report review` の旗。 */
export interface ReviewOptions {
  /** レビューのページ（roster page put --kind review で置いた URL）。 */
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
export async function reportReview(ctx: Context, options: ReviewOptions): Promise<string[]> {
  const self = await sender(ctx);
  const lead = self.role === 'tech-lead';
  if (self.role !== 'staff-engineer' && !lead) throw new TpmError('roster report review は、Staff Engineer 担当（Staff の席）か、repo の席の頼みを受けた Tech Lead 担当が打ちます。レビューを頼むのは roster ask review');
  if (!Object.hasOwn(VERDICTS, options.verdict)) throw new TpmError(`--verdict は ${Object.keys(VERDICTS).join('・')} のどれかにしてください（${Object.entries(VERDICTS).map(([id, label]) => `${id}＝${label}`).join('・')}）`);
  const verdict = options.verdict as Verdict;
  if (!isPageUrl(ctx.env, options.url) || !REVIEW_PAGE.test(options.url)) throw new TpmError(`--url は、roster page put --kind review で置いたレビューのページの URL にしてください: ${options.url}`);
  const subject = subjectOf(self);
  if (pageOwner(ctx, options.url)?.key !== subject) throw new TpmError(`--url は、${subject} のレビューのページにしてください（別の課題のページ）: ${options.url}`);
  // 返すのは、いちばん古い依頼書の頼みだけ（依頼書は積まれた順にこなす。後ろに積まれた依頼書の頼みは、次の【review】で返す）。
  // Tech Lead 担当は、自分の課題の repo の席の頼みを束ねて、古い順（頼みの番号の順）に返す。判定は、頼んだ席へ返す。
  const askers = lead ? repoSeats(ctx, self.key).map(r => r.key) : [subject];
  const briefed = readReviews(ctx).filter(r => r.verdict === undefined && r.brief !== undefined && askers.includes(r.key) && (r.reviewer === 'tech-lead') === lead);
  const asks = briefed.filter(r => r.brief === briefed[0]?.brief);
  if (asks.length === 0) throw new TpmError(`${subject} に、返していないレビューの頼みがありません（もう返したか、頼みがまだ来ていない）。送っていません`);
  const asker = asks[0]?.key ?? subject;
  const owner = readRole(ctx, asker);
  if (owner === undefined) throw new TpmError(`${asker} の担当が名簿にいません。送っていません・記録も書いていません。roster ask tpm で TPM 担当に知らせてください（レビューのページ: ${options.url}）`);
  const label = VERDICTS[verdict];
  const body = `${options.url} 判定: ${label}（${verdict}）／一言: ${options.summary}／頼み: ${asks.map(r => `#${r.n}`).join(' ')}`;
  // 相手の居場所と 2 度送りを、課題に記録を書く前に見る。
  await notRepeatToPeer(ctx, self, owner, 'review', body);
  const recorded = record(ctx, self, { kind: 'レビュー', role: ROLES[self.role].label, summary: oneLine(`${label}: ${options.summary}`), links: [{ label: 'レビュー', url: options.url }], points: [] });
  const sent = await toPeer(ctx, self, owner, 'review', body);
  const reviewedAt = ctx.now().toISOString();
  for (const r of asks) patchReview(ctx, r.n, { verdict, page: options.url, summary: options.summary, reviewedAt });
  const marks = await markVerdict(ctx, options.url, verdict, asks);
  // Tech Lead 担当は、レビューのほかの仕事（TPM 担当の依頼書）も持つので、状態は替えない。
  if (lead) {
    const left = briefed.length - asks.length;
    return [...recorded, sent, ...marks, ...(left === 0 ? [] : [`返していない頼みが、あと ${left} 件あります（roster review list）`])];
  }
  showWait(ctx, WAIT_NEXT_REVIEW);
  return [...recorded, sent, ...marks, `状態: ${WAIT_NEXT_REVIEW}`];
}
