// Staff Engineer 担当の席と、レビューのやりとり。
// 課題の担当が roster ask review で頼み、Staff Engineer 担当が roster report review で返す。どちらも TPM 担当を通らず、相手へじかに届く。
// 席が無ければ、頼みの命令が起こす（依頼書は頼みから作る）。TPM 担当の roster assign <課題の Key> --role staff-engineer（tpm-side.ts）は、席の起こし直しに残る。
// 判定を受けない時だけ、課題の担当が roster ask tpm --review <番号> で TPM 担当に上げる（messages.ts の askTpm）。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireUp, sessionRef } from '../castlist.ts';
import type { Context } from '../context.ts';
import { ROLES, WAIT, type RoleName } from '../protocol.ts';
import { addReview, leadReviews, openReviews, parsePullName, patchReview, pullKey, readHead, readReviews, recordHead, removeReview, reviewLabel, sameTarget, VERDICTS, type Review, type Verdict } from '../reviews.ts';
import { isRepoSeat, readRole, staffKey, subjectOf, writeRole, type RoleRecord } from '../roster.ts';
import { resolveSettings, type SettingsLayer } from '../settings.ts';
import { skillSetDir, TpmError } from '../skill-sets.ts';
import { issueCopy, launch, NotStartedError, roleDefaults } from './launch.ts';
import { notAuditor, notRepeatToPeer, oneLine, record, recordLaunchAsk, sender, showWait, toPeer, wait } from './messages.ts';
import { putPage } from './page.ts';
import { pageOwner } from './reply.ts';
import { markBrief, markVerdict } from './review-marks.ts';
import { isPageUrl } from './store.ts';
import { checkoutPull, ensurePlace, parsePull, placeDir } from '../review-place.ts';
import { pruneReview } from '../review-run.ts';

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
function staffBriefPage(subject: RoleRecord, asks: Review[], previous: Map<number, Review>, changes: Map<number, ChangesSince>, place?: string): string {
  const e = escapeHtml;
  const link = (url: string): string => `<a href="${e(url)}">${e(url)}</a>`;
  const light = asks.filter(r => r.light === true);
  // 見直しの頼み: 前の頼みの番号と判定・前に見た commit と、前の判定からの差分を見る 1 行。右はその PR の head の ref
  // （roster review checkout が refs/remotes/pull/<番号> に取る。HEAD は、最後に出した PR なので、まとめた頼みでは別の PR になりうる）。
  // 差の数（commit と file）が読めれば、その下に並べ、前に見た commit が今の head の祖先でなければ（rebase・force push）range-diff の 1 行も足す（t-vqhy）。
  const again = (ask: Review, prev: Review | undefined): string => {
    if (prev?.verdict === undefined) return '';
    const pull = parsePullName(ask.url);
    const seen = prev.head === undefined || pull === undefined
      ? '見た commit の記録は無い。全体を見る'
      : `見た ${e(prev.head.slice(0, 7))}。前の判定からの差分を見る（roster review checkout で出してから）: <code>roster review git --repo ${e(pull.repo)} -- diff ${e(prev.head)}..refs/remotes/pull/${pull.number}</code>`;
    const diff = changes.get(ask.n);
    return `。見直し: 前の頼み #${prev.n}（${VERDICTS[prev.verdict]}・${seen}）${diff === undefined || prev.head === undefined || pull === undefined ? '' : changesList(diff, prev.head, ask.askedHead ?? '', pull)}`;
  };
  const changesList = (diff: ChangesSince, from: string, to: string, pull: { repo: string, number: number }): string => {
    const plus = diff.files.reduce((n, f) => n + f.additions, 0);
    const minus = diff.files.reduce((n, f) => n + f.deletions, 0);
    const more = (shown: number, all: number): string[] => all > shown ? [`<li>ほか ${all - shown}</li>`] : [];
    const rebased = diff.status === 'diverged'
      ? [`<li>前に見た commit は、頼んだ時の head の祖先でない（rebase か force push）。数は分かれた所からの物で、main の分も含みうる。commit ごとの差: <code>roster review git --repo ${e(pull.repo)} -- range-diff refs/remotes/origin/main ${e(from)} refs/remotes/pull/${pull.number}</code></li>`]
      : [];
    return [
      '<ul>',
      `<li>前に見た ${e(from.slice(0, 7))} から頼んだ時の head ${e(to.slice(0, 7))} まで: ${diff.commits.length} commit・${diff.files.length} file（+${plus} −${minus}。GitHub の compare）</li>`,
      ...rebased,
      ...diff.commits.slice(0, CHANGES_SHOWN).map(c => `<li>commit: ${e(c)}</li>`),
      ...more(CHANGES_SHOWN, diff.commits.length),
      ...diff.files.slice(0, CHANGES_SHOWN).map(f => `<li>file: ${e(f.filename)}（+${f.additions} −${f.deletions}）</li>`),
      ...more(CHANGES_SHOWN, diff.files.length),
      '</ul>',
    ].join('');
  };
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
    ...asks.map(r => `<li>頼み #${r.n}: ${link(r.url)}${r.focus === undefined ? '' : `（見てほしい所: ${e(r.focus)}）`}${again(r, previous.get(r.n))}</li>`),
    '</ul>',
    ...(light.length === 0 ? [] : [`<p>${light.map(r => `頼み #${r.n}`).join('・')}は、軽い見方でよい（版上げ・CHANGELOG・文書・lock だけの差分。超えていれば普段の見方）。</p>`]),
    ...(place === undefined
      ? []
      : [
          '<h2>自分の場所</h2>',
          `<p>${e(place)}（席が起きる folder。PR の head は、その下の repo の名の folder に roster review checkout &lt;PR の URL&gt; が出す。clone は roster review git で読む）</p>`,
        ]),
    '</body></html>',
  ].join('\n');
}

/** レビューの頼みから依頼書のページを作って置き、URL を返す。置く folder は、頼んだ担当の課題の Key（repo の席は、親の課題の folder）。 */
export async function putStaffBrief(ctx: Context, subject: RoleRecord, asks: Review[]): Promise<string> {
  const previous = previousReviews(ctx, asks);
  const changes = new Map<number, ChangesSince>();
  for (const ask of asks) {
    const from = previous.get(ask.n)?.head;
    const pull = parsePullName(ask.url);
    const diff = from === undefined || ask.askedHead === undefined || pull === undefined ? undefined : changesSince(ctx, pull, from, ask.askedHead);
    if (diff !== undefined) changes.set(ask.n, diff);
  }
  return (await putPage(ctx, { text: staffBriefPage(subject, asks, previous, changes, isRepoSeat(subject) ? undefined : placeDir(ctx, subject.key)) }, 'brief', subjectOf(subject))).url;
}

/** 見直しの依頼書に並べる commit と file の数（超えた分は「ほか N」）。 */
const CHANGES_SHOWN = 30;

/** 前に見た commit から頼んだ時の head までの差（GitHub の compare が返す物。commit は 250・file は 300 まで）。 */
export interface ChangesSince {
  /** ahead（前に見た commit の後に足した）・diverged（前に見た commit が head の祖先でない）・identical など。 */
  status: string
  /** 短い sha と、文の 1 行目。 */
  commits: string[]
  files: { filename: string, additions: number, deletions: number }[]
}

/** compare の答えから、ChangesSince の欄だけを出す jq（patch の字は持ち帰らない）。 */
export const COMPARE_JQ = '{status, commits: [.commits[] | .sha[0:7] + " " + (.commit.message | split("\\n")[0])], files: [.files[]? | {filename, additions, deletions}]}';

/** 前に見た commit から頼んだ時の head までの差を、GitHub の compare で読む。読めなければ（網の誤り・消えた commit）undefined（依頼書は差の数を載せずに置く）。 */
function changesSince(ctx: Context, pull: { owner: string, repo: string }, from: string, to: string): ChangesSince | undefined {
  const r = ctx.exec('gh', ['api', `repos/${pull.owner}/${pull.repo}/compare/${from}...${to}`, '--jq', COMPARE_JQ]);
  if (r.status !== 0) return undefined;
  try {
    const got = JSON.parse(r.stdout) as Partial<ChangesSince>;
    if (typeof got.status !== 'string' || !Array.isArray(got.commits) || !Array.isArray(got.files)) return undefined;
    return {
      status: got.status,
      commits: got.commits.filter((c): c is string => typeof c === 'string'),
      files: got.files.filter(f => typeof f.filename === 'string').map(f => ({ filename: f.filename, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 })),
    };
  }
  catch {
    return undefined;
  }
}

/** PR の頼みごとの、同じ PR の前の頼み（判定の返った物のうち、番号のいちばん大きい物）。 */
function previousReviews(ctx: Context, asks: Review[]): Map<number, Review> {
  const all = readReviews(ctx).filter(r => r.verdict !== undefined);
  const out = new Map<number, Review>();
  for (const ask of asks) {
    const key = pullKey(ask.url);
    const prev = key === undefined ? undefined : all.filter(r => r.n < ask.n && pullKey(r.url) === key).at(-1);
    if (prev !== undefined) out.set(ask.n, prev);
  }
  return out;
}

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
 * 頼みに、依頼書を渡した席の起こしの id を書く（受け箱は起こした回ごとなので、roster review list が、今の回に届いた頼みかを見分ける）。
 * 席が起こしの id を持たない（castlist の無い project。受け箱は Key ごと）なら、前の id を消す。
 */
export function markDelivered(ctx: Context, asks: Review[], seat: Pick<RoleRecord, 'launch'>): void {
  for (const r of asks) patchReview(ctx, r.n, { launch: seat.launch });
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
  // 席は、課題ごとの自分の場所（project の folder の外）で起こす。手伝いもそこで起き、PR の head を探しに行かない（t-n4j9 の段 2）。
  // 設定（model など）は、今までどおり project の folder（か、--cwd で名指した folder）から読む。
  const cwd = options.cwd ?? ensurePlace(ctx, subject.key);
  const settings = resolveSettings(STAFF, { flags: options.flags ?? {}, config: roleDefaults(ctx, STAFF, options.cwd ?? ctx.project), env: ctx.env });
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
    // 起こす時に渡した頼みを、送った記録に残す（依頼書 1 つに 1 行。判定は依頼書ごとに 1 通で返るので、その返事の先になる）。
    // 返っていない頼みのまま起こし直した時は、新しい行が、元の頼み（前に渡した【ask-review】のうち、いちばん古い物）を返事の先に持つ
    // （頼みが、前の頼みを閉じる。元の頼みが、返事の無いまま残らない）。頼みの ask は、みな新しい行に替える（判定は、新しい行に返る）。
    const spawned = (made: RoleRecord): void => {
      const last = asks.at(-1);
      if (last === undefined) return;
      const before = asks.find(r => r.ask !== undefined)?.ask;
      const id = recordLaunchAsk(ctx, 'ask-review', subject.key, subject.title, made, `${briefUrl} 頼み: ${asks.map(r => `#${r.n}`).join(' ')} ${last.url}`, subject, before);
      for (const r of asks) patchReview(ctx, r.n, { ask: id });
    };
    out = await launch(ctx, seat, options.again, options.wait, [...(options.more?.(issue) ?? []), ...skew], sid ? sessionRef(sid) : undefined, label.description, spawned);
    markDelivered(ctx, asks, seat);
  }
  catch (e) {
    // 居場所ができた後の失敗（名乗らない など）は、頼みが残るので印も付ける。居場所を作る前に止まった回は付けない（依頼書の待ちを残さない）。
    const after = readRole(ctx, seat.key)?.address;
    if (e instanceof NotStartedError || (after !== undefined && after !== before)) {
      markDelivered(ctx, asks, seat);
      await markBrief(ctx, briefUrl, asks, previous);
    }
    throw e;
  }
  // 置き場の印は、居場所ができた後に付ける。
  return [...out, ...await markBrief(ctx, briefUrl, asks, previous)];
}

// ---- レビュー（課題の担当が頼み、Staff Engineer 担当が返す。どちらも相手へじかに届く） ----

/** github.com の PR の URL か（pullKey で引ける形だけ。`<owner>/<repo>#<番号>` の短い形は見る物にしない）。 */
const isPrUrl = (url: string): boolean => url.startsWith('https://') && parsePullName(url) !== undefined;
/** 置き場のレビューのページの URL の終わり。 */
const REVIEW_PAGE = /\/review-[1-9]\d*\.html(?:[?#].*)?$/;
/** roster ask review が、起こした席の名乗りを待つ秒の既定（roster assign と同じ）。 */
export const ASK_REVIEW_WAIT = 90;

/** `roster ask review` の旗。 */
export interface AskReviewOptions {
  /** 見る物（置き場のページか PR の URL）。PR なら、いくつも書ける（1 つの依頼書・1 通の【ask-review】で渡す）。 */
  url: string | string[]
  focus?: string
  /** 起こした席の名乗りを待つ秒（0 なら待たない）。 */
  wait?: number
  /** 軽い見方でよい（版上げ・CHANGELOG・文書・lock だけの差分）。 */
  light?: boolean
}

/**
 * 課題の担当が、計画・提案のページか PR のレビューを頼む（【ask-review】）。TPM 担当を通らない。
 * 頼みを記録（reviews.ts）に書き、頼みから依頼書を作って置く。Staff Engineer 担当の席が無ければ（落ちていても）起こして依頼書を名簿の行で渡し、
 * 居れば【ask-review】（頭が依頼書の URL）を席へじかに送って、席の題と説明を替える。前の頼みがまだ返っていなければ、その後ろに積む（席は積まれた順にこなす）。
 * まだ席に渡していない前の頼み（前の流れで TPM 担当に送られたままの物）があれば、同じ依頼書で一緒に渡す。
 * PR はいくつもまとめて頼める（頼みは PR ごとに 1 件。依頼書と【ask-review】は 1 つ）。PR の頼みには、頼んだ時の head を書く（読めなくても頼む）。
 * 状態を `回答待ち(レビュー)` にする。判定は、席から【review】でじかに届く。レビューは助言で、頼んだ担当を縛らない。
 */
export async function askReview(ctx: Context, options: AskReviewOptions): Promise<string[]> {
  const self = await sender(ctx);
  notAuditor(self, 'roster ask review');
  const urls = [options.url].flat();
  if (urls.length === 0) throw new TpmError('--url で、見る物（置き場のページか PR の URL）を書いてください');
  for (const url of urls) if (!isPageUrl(ctx.env, url) && !isPrUrl(url)) throw new TpmError(`--url は、置き場のページか github.com の PR の URL にしてください（見る物）: ${url}`);
  if (urls.length > 1 && urls.some(url => !isPrUrl(url))) throw new TpmError('--url をいくつも書けるのは PR だけです（ページと混ぜない。ページは 1 つずつ頼む）。頼んでいません');
  const twice = urls.find((url, i) => urls.slice(0, i).some(u => sameTarget(u, url)));
  if (twice !== undefined) throw new TpmError(`--url に同じ PR を 2 度書いています: ${twice}。頼んでいません`);
  // 同じ物（PR は書き方が違っても同じ PR）の、判定待ちの頼みがあれば断る。判定の後の頼み（見直し）は通す。
  const same = openReviews(ctx, self.key).find(r => urls.some(url => sameTarget(r.url, url)));
  if (same !== undefined) throw new TpmError(`同じ物のレビューを、もう頼んであります（#${same.n}。${same.askedAt} に頼んだ）。2 度目は送っていません。判定は ${isRepoSeat(self) ? 'Tech Lead 担当' : 'Staff Engineer 担当'}から【review】で届きます`);
  const focus = options.focus?.trim() || undefined;
  const fields = (url: string): Omit<Review, 'n' | 'askedAt' | 'key' | 'by'> => {
    const head = isPrUrl(url) ? prHead(ctx, url) : undefined;
    return { url, ...(focus === undefined ? {} : { focus }), ...(options.light === true ? { light: true } : {}), ...(head === undefined ? {} : { askedHead: head }) };
  };
  // repo の席の頼みは、親の課題の Tech Lead 担当が見る（Staff Engineer 担当の席は起こさない）。
  if (isRepoSeat(self)) return await askLeadReview(ctx, self, urls.map(fields), focus);
  const subject = staffSubject(ctx, self.key);
  const seat = readRole(ctx, staffKey(self.key));
  const alive = seat?.address !== undefined && ctx.seats.seats().some(s => s.address === seat.address);
  // 前の頼みで、席に渡したがまだ返っていない物（席が居る時は、その後ろに積む）と、まだ席に渡していない物（前の流れで TPM 担当に送られたまま、振られていない頼み。一緒に渡す）。
  const open = openReviews(ctx, self.key);
  const before = open.filter(r => r.brief !== undefined);
  const loose = open.filter(r => r.brief === undefined);
  const reviews = urls.map(fields).map(f => addReview(ctx, { key: self.key, ...f, by: self.title }));
  const remove = (): void => {
    for (const r of reviews) removeReview(ctx, r.n);
  };
  const asks = [...loose, ...reviews];
  const place = preparePlace(ctx, self.key, urls, !(seat !== undefined && alive));
  let out: string[];
  if (seat !== undefined && alive) {
    let url: string;
    let asked: { note: string, id: string };
    try {
      url = await putStaffBrief(ctx, subject, asks);
      asked = await toPeer(ctx, self, seat, 'ask-review', askBody(url, asks, urls, focus, options.light, before));
    }
    catch (e) {
      // 送る前に止まった頼みを残すと、打ち直しが「もう頼んであります」で止まる。送った後の失敗では消さない（席にはもう届いている）。
      remove();
      throw e;
    }
    // 判定（【review】）が、この頼みを返事の先にできるように、送った id を頼みに書く。
    for (const r of asks) patchReview(ctx, r.n, { ask: asked.id });
    const previous = markBriefed(ctx, asks, url);
    markDelivered(ctx, asks, seat);
    seat.brief = url;
    writeRole(ctx, seat);
    // 席の題は、返っていない頼みをみな数える（新しい頼みと +<残りの数>）。
    out = [asked.note, ...relabelStaff(ctx, seat, self.key, [...before, ...asks]), ...await markBrief(ctx, url, asks, previous), ...place];
  }
  else {
    try {
      // 席が無い・落ちた: 返っていない前の頼み（渡したが返っていない物も、渡せていなかった物も）を、新しい依頼書で渡し直す。
      out = await launchStaff(ctx, subject, [...open, ...reviews], {
        wait: options.wait ?? ASK_REVIEW_WAIT,
        again: seat !== undefined,
        castlistHint: ['この 1 行は自分で打たない。roster ask tpm で、castlist が止まっていることを TPM 担当に知らせ、起きた後にもう 1 度 roster ask review を打ってください。'],
      });
      out.push(...place);
    }
    catch (e) {
      // 居場所を作った後の失敗（名乗らなかった など）は、頼みを残す（依頼書は名簿の行で渡してある）。その前に止まった回は、頼みを取り消す（打ち直せる）。
      const made = readRole(ctx, staffKey(self.key))?.address;
      const spawned = made !== undefined && made !== seat?.address;
      if (!(e instanceof NotStartedError) && !spawned) {
        remove();
        throw e;
      }
      const message = e instanceof Error ? e.message : String(e);
      throw new TpmError(`${message}\n頼み ${reviews.map(r => `#${r.n}`).join(' ')} は残してあります。Staff Engineer 担当の席が名乗らないことを、roster ask tpm で TPM 担当に知らせてください（TPM 担当が、残った居場所を roster close ${staffKey(self.key)} で閉じてから起こし直す）。`);
    }
  }
  return [...out, ...wait(ctx, 'review', reviewLabel(reviews).target)];
}

/** 【ask-review】の本文: 依頼書の URL・頼みの番号・見る物・見てほしい所・軽い見方・先に済ませる頼み。 */
function askBody(url: string, asks: Review[], urls: string[], focus: string | undefined, light: boolean | undefined, before: Review[]): string {
  return [
    url,
    `頼み: ${asks.map(r => `#${r.n}`).join(' ')} ${urls.join(' ')}`,
    ...(focus === undefined ? [] : [`見てほしい所: ${focus}`]),
    ...(light === true ? ['軽い見方でよい'] : []),
    ...(before.length === 0 ? [] : [`${before.map(r => `#${r.n}`).join('・')}を済ませてから、これをする`]),
  ].join(' ');
}

/** PR の今の head（gh pr view の headRefOid）。読めなければ undefined（頼みも判定も止めない）。 */
function prHead(ctx: Context, url: string): string | undefined {
  const r = ctx.exec('gh', ['pr', 'view', parsePullName(url)?.url ?? url, '--json', 'headRefOid']);
  if (r.status !== 0) return undefined;
  try {
    const head = (JSON.parse(r.stdout) as { headRefOid?: unknown }).headRefOid;
    return typeof head === 'string' && head !== '' ? head : undefined;
  }
  catch {
    return undefined;
  }
}

/**
 * レビューの席の場所を用意する（t-n4j9 の段 2）: 名簿に居ない古い課題の場所を片付け、この課題の場所を作る。
 * 席を起こす時（checkout が true）だけ、見る物が PR 1 つなら head を出す（いくつもの PR は、席が 1 つずつ roster review checkout で出す）。
 * 席が居る時は出し直さない（前の頼みを見ている途中で作業の木を替えない。
 * 席が頼みに取りかかる時に roster review checkout を打つ。review-8 の指摘 5）。head を出せなくても頼みは止めない。出す行を返す。
 */
function preparePlace(ctx: Context, key: string, urls: string[], checkout: boolean): string[] {
  const lines = pruneReview(ctx, k => readRole(ctx, staffKey(k)) !== undefined);
  const dir = ensurePlace(ctx, key);
  const [url] = urls;
  if (!checkout || urls.length !== 1 || url === undefined || parsePull(url) === undefined) return lines;
  try {
    const { tree, head } = checkoutPull(ctx, key, url);
    // 起こす席が見る作業の木なので、見た commit の表に、席の Key で書く。
    recordHead(ctx, key, url, head, staffKey(key));
    return [...lines, `レビューの場所に PR の head を出した: ${tree}（${head.slice(0, 7)}）`];
  }
  catch (e) {
    return [...lines, `レビューの場所（${dir}）に PR の head を出せませんでした（席が roster review checkout で打ち直せます）: ${e instanceof Error ? e.message : String(e)}`];
  }
}

/**
 * repo の席のレビューの頼み: 親の課題の Tech Lead 担当の席へ、じかに【ask-review】を送る。席が無い・応えない時は、送らずに止まる
 * （Staff Engineer 担当の席は起こさない。TPM 担当への相談を案内する）。Tech Lead 担当は、TPM 担当の依頼書も受けているので、
 * 席の依頼書（名簿の brief）と題は替えない。頼みは、Tech Lead 担当の依頼書の列には積まれない（messages.ts の openBriefs）。
 */
async function askLeadReview(ctx: Context, self: RoleRecord, asking: Omit<Review, 'n' | 'askedAt' | 'key' | 'by'>[], focus: string | undefined): Promise<string[]> {
  const lead = self.subject === undefined ? undefined : readRole(ctx, self.subject);
  if (lead === undefined || lead.address === undefined || !ctx.seats.seats().some(s => s.address === lead.address)) {
    throw new TpmError(`${self.subject ?? ''} の Tech Lead 担当の席がありません。レビューは頼んでいません。roster ask tpm で TPM 担当に知らせてください`);
  }
  const before = openReviews(ctx, self.key).filter(r => r.brief !== undefined);
  const reviews = asking.map(f => addReview(ctx, { key: self.key, ...f, by: self.title, reviewer: 'tech-lead', lead: lead.key }));
  let url: string;
  let asked: { note: string, id: string };
  try {
    url = await putStaffBrief(ctx, self, reviews);
    asked = await toPeer(ctx, self, lead, 'ask-review', askBody(url, reviews, reviews.map(r => r.url), focus, reviews[0]?.light, before));
  }
  catch (e) {
    // 送る前に止まった頼みを残すと、打ち直しが「もう頼んであります」で止まる。
    for (const r of reviews) removeReview(ctx, r.n);
    throw e;
  }
  for (const r of reviews) patchReview(ctx, r.n, { ask: asked.id });
  const previous = markBriefed(ctx, reviews, url);
  markDelivered(ctx, reviews, lead);
  return [asked.note, ...await markBrief(ctx, url, reviews, previous), ...wait(ctx, 'review', reviewLabel(reviews).target)];
}

/** `roster report review` の旗。 */
export interface ReviewOptions {
  /** レビューのページ（roster page put --kind review で置いた URL）。 */
  url: string
  /** 判定（VERDICTS の語）。 */
  verdict: string
  summary: string
  /**
   * 判定を返す頼みの番号（その頼みだけに書く）。Tech Lead 担当は、返していない頼みがいくつもある時に名指す。
   * Staff Engineer 担当は、まとめた頼みの PR ごとに違う判定を返す時に名指す。
   */
  review?: number
}

/** 次のレビューの頼みを待つ（Staff Engineer 担当の【review】の後）。 */
const WAIT_NEXT_REVIEW = WAIT.review('次の頼み');

/**
 * PR の頼みの、席が見た commit を決める: 頼みより後に席が出した head（review-heads の表）があれば、それ（checkout）。
 * 無ければ、判定の時の PR の head が頼んだ時の head と同じ時だけ、それ（asked。見ている間に push が無かった）。
 * ただし、頼みより前に席が出した head が表にあり、頼んだ時の head と違えば、席の作業の木は古いままなので使わない。
 * 決められなければ、その訳の字を返す（head は書かない。merge は見直しを求める）。
 */
function seenHead(ctx: Context, key: string, r: Review): { head: string, headFrom: 'checkout' | 'asked' } | string {
  const out = readHead(ctx, key, r.url);
  if (out !== undefined && out.at >= r.askedAt) return { head: out.head, headFrom: 'checkout' };
  if (r.askedHead === undefined) return '頼んだ時の head を読めず、頼みの後の checkout も無い';
  if (out !== undefined && out.head !== r.askedHead) return '席の作業の木が前の head のまま。roster review checkout で出し直してから見直す';
  const now = prHead(ctx, r.url);
  if (now === undefined) return '判定の時の PR の head を読めなかった';
  return now === r.askedHead ? { head: now, headFrom: 'asked' } : '頼んだ後に push があった';
}

/**
 * Staff Engineer 担当が、レビューのページと判定を返す（【review】）。頼んだ課題の担当へじかに届く（TPM 担当を通らない）。
 * いちばん古い依頼書の頼み（まだ返していない物）に判定を書き、課題があれば記録「レビュー」を書く。--review で名指せば、その頼みだけに書く
 * （名指さなければ、同じ依頼書の、まだ返していない頼みにだけ書く。先に返した判定は上書きしない）。
 * PR の頼みには、席が見た commit（seenHead）も書く。決められなければ（訳を問わず）、【review】の本文と出す行に、merge の前に見直しが要ると書く。
 * Staff の席の --review は、いちばん古い依頼書の頼みだけを名指せる（後ろの依頼書は、前の依頼書を返してから）。
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
  // Tech Lead 担当は、自分の課題の repo の席の頼みを束ねて受ける（頼みの lead の欄。頼んだ席を閉じた後も引ける）。判定は、頼んだ席へ返す。
  const briefed = lead ? leadReviews(ctx, self.key) : readReviews(ctx).filter(r => r.verdict === undefined && r.brief !== undefined && r.reviewer === undefined && r.key === subject);
  if (briefed.length === 0) throw new TpmError(`${subject} に、返していないレビューの頼みがありません（もう返したか、頼みがまだ来ていない）。送っていません`);
  // Tech Lead 担当は、席いくつかの頼みを、ほかの仕事の合間に見る。どの頼みへの判定かを取り違えないよう、いくつもあれば名指させる。
  const listed = briefed.map(r => `#${r.n} ${r.key} ${r.url}`);
  if (lead && options.review === undefined && briefed.length > 1) {
    throw new TpmError(['返していないレビューの頼みが、いくつもあります。どの頼みへの判定かを --review <番号> で名指してください。送っていません。', ...listed].join('\n'));
  }
  const named = options.review === undefined ? briefed[0] : briefed.find(r => r.n === options.review);
  if (named === undefined) throw new TpmError([`--review の #${options.review ?? ''} は、返していない頼みにありません。送っていません。`, ...listed].join('\n'));
  const first = briefed.filter(r => r.brief === briefed[0]?.brief);
  if (!lead && !first.includes(named)) throw new TpmError([`--review の #${named.n} は、いちばん古い依頼書の頼みではありません。依頼書は積まれた順に返します。送っていません。今の依頼書の頼み:`, ...first.map(r => `#${r.n} ${r.url}`)].join('\n'));
  const asks = options.review === undefined ? briefed.filter(r => r.brief === named.brief) : [named];
  // 見た commit は、席のレビューの場所の表で引く（Staff の席は課題の Key、Tech Lead 担当は自分の Key の場所）。
  const seen = new Map(asks.filter(r => pullKey(r.url) !== undefined).map(r => [r.n, seenHead(ctx, lead ? self.key : subject, r)]));
  const unseen = [...seen].flatMap(([n, h]) => typeof h === 'string' ? [asks.length === 1 ? h : `#${n}: ${h}`] : []);
  const unseenNote = unseen.length === 0 ? undefined : `見た commit を記録できなかった（${unseen.join('・')}）。merge の前に見直しが要る`;
  const asker = asks[0]?.key ?? subject;
  const owner = readRole(ctx, asker);
  if (owner === undefined) throw new TpmError(`${asker} の担当が名簿にいません。送っていません・記録も書いていません。roster ask tpm で TPM 担当に知らせてください（レビューのページ: ${options.url}）`);
  const label = VERDICTS[verdict];
  const body = `${options.url} 判定: ${label}（${verdict}）／一言: ${options.summary}／頼み: ${asks.map(r => `#${r.n}`).join(' ')}${unseenNote === undefined ? '' : `／${unseenNote}`}`;
  // 相手の居場所と 2 度送りを、課題に記録を書く前に見る。
  await notRepeatToPeer(ctx, self, owner, 'review', body);
  const recorded = record(ctx, self, { kind: 'レビュー', role: ROLES[self.role].label, summary: oneLine(`${label}: ${options.summary}`), links: [{ label: 'レビュー', url: options.url }], points: [] });
  // 返事の先は、頼みを渡したメッセージ（頼みの記録の ask。前の版の頼みには無い）。頼みの記録は、渡した後に読み直す（ask は渡した時に書かれる）。
  const { note: sent } = await toPeer(ctx, self, owner, 'review', body, readReviews(ctx).find(r => r.n === named.n)?.ask);
  const reviewedAt = ctx.now().toISOString();
  for (const r of asks) {
    const h = seen.get(r.n);
    patchReview(ctx, r.n, { verdict, page: options.url, summary: options.summary, reviewedAt, ...(h === undefined || typeof h === 'string' ? {} : h) });
  }
  const marks = await markVerdict(ctx, options.url, verdict, asks);
  const note = unseenNote === undefined ? [] : [unseenNote];
  // Tech Lead 担当は、レビューのほかの仕事（TPM 担当の依頼書）も持つので、状態は替えない。
  if (lead) {
    const left = briefed.length - asks.length;
    return [...recorded, sent, `届けた先: ${asker}（頼み ${asks.map(r => `#${r.n} ${r.url}`).join('・')}）`, ...note, ...marks, ...(left === 0 ? [] : [`返していない頼みが、あと ${left} 件あります（roster review list）`])];
  }
  // PR ごとに返す時: 同じ依頼書に、まだ返していない頼みが残れば、それを出す（状態は、残りを返すまで替えない）。
  const rest = briefed.filter(r => r.brief === named.brief && !asks.includes(r));
  if (rest.length > 0) return [...recorded, sent, ...note, ...marks, `同じ依頼書の頼みが、あと ${rest.length} 件返っていません（${rest.map(r => `#${r.n}`).join(' ')}。roster report review --review <番号>）`];
  showWait(ctx, WAIT_NEXT_REVIEW);
  return [...recorded, sent, ...note, ...marks, `状態: ${WAIT_NEXT_REVIEW}`];
}
