// TPM 担当が打つ命令: 名乗る（tpmHello。tpm hello から呼ばれる）・名簿を見る（roles）・Key を作る（newKey）・課題を担当に振る（assign）・閉じる（close）。
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertSummary } from '../brief.ts';
import { shellQuote } from '../shell.ts';
import { castlistUrl, requireUp, sessionRef } from '../castlist.ts';
import { describeTrackers, OWN_LABEL, readRolesConfig, rolesConfigFile, sourceLabel, type ConfigSource } from '../config.ts';
import type { Context } from '../context.ts';
import { syncDeliveries } from '../evidence.ts';
import { AUDIT_KEY, modelStatus, ROLES, TPM_TITLE, WAIT, type RoleDef, type RoleName } from '../protocol.ts';
import { lastAuditLine } from '../audits.ts';
import { openLine } from '../incidents.ts';
import { openReviews, patchReview, reviewLabel, type Review } from '../reviews.ts';
import { resolveSettings } from '../settings.ts';
import { allRoles, assertKey, isStaffKey, LOCAL_KEY, readRole, removeRole, staffKey, writeRole, type RoleRecord, type TpmRecord } from '../roster.ts';
import { readSkillSets, skillSetDir, TpmError } from '../skill-sets.ts';
import { route } from '../tracker/routed.ts';
import { findHook, staleHook } from './banner.ts';
import { castlistHello, closeLaunch } from './castlist.ts';
import { copyIssue, issueTracker } from './issue.ts';
import { assertRead, assertSettled, brief } from './messages.ts';
import { pageFolder, putPage } from './page.ts';

/** 名乗ったかを見る間（ミリ秒）。 */
const HELLO_INTERVAL_MS = 2000;

/**
 * TPM 担当が名乗る（$TPM_KEY の無い tpm hello）: 居場所の題と状態を出し、自分の宛先を状態に書く。続けて名簿を出す。
 * 状態の model は、旗が無ければ起こす 1 行と同じ決め方（resolveSettings）。effort は、旗が無ければ Claude Code が入れる $CLAUDE_EFFORT（実際の effort）を旗と同じに扱う。
 * castlist を設定していれば、名乗りを送り、`アクター: <名>` の行を頭に出す（castlist が止まっていれば、名乗らずに止まる）。
 */
export function tpmHello(ctx: Context, options: { model?: string, effort?: string } = {}): string[] {
  const settings = resolveSettings('tpm', { flags: { model: options.model, effort: options.effort ?? ctx.env.CLAUDE_EFFORT }, env: ctx.env });
  const actor = castlistHello(ctx);
  const address = ctx.transport.whoami();
  ctx.transport.setTitle(TPM_TITLE);
  ctx.transport.setStatus('model', modelStatus(settings.model, settings.effort));
  ctx.transport.setStatus('wait', WAIT.work('起動'));
  ctx.state.write('tpm.jsonc', { address } satisfies TpmRecord);
  // 連携の道具が古いメッセージを捨てる前に、届いた時刻を写す。
  syncDeliveries(ctx);
  return [...actor, `TPM 担当の宛先: ${address}`, ...configLines(ctx), ...bannerHint(ctx), ...roles(ctx)];
}

/** 既定で埋めた値には「（既定）」を付ける（設定に書いた値と見分けるため）。 */
const orDefault = (source: ConfigSource, field: string, value: string): string => source.written.includes(field) ? value : `${value}（既定）`;

/** 設定 1 つに書いてある物（「課題管理: jira・infra: pagetray」）。file が無ければ、その path と「無い」。 */
function sourceSummary(ctx: Context, source: ConfigSource): string {
  if (!source.exists) return `${source.file}（無い）`;
  const roles = Object.keys(source.config.roles);
  const skillSets = readSkillSets(source.file, ctx.root);
  const parts = [
    ...(source.written.includes('tracker') ? [`課題管理: ${source.config.tracker}`] : []),
    ...(Object.keys(source.config.infra).length === 0 ? [] : [`infra: ${Object.keys(source.config.infra).join('・')}`]),
    ...(skillSets.length === 0 ? [] : [`skill-sets: ${skillSets.join('・')}`]),
    ...(roles.length === 0 ? [] : [`担当の既定: ${roles.join('・')}`]),
    // 連携は project の folder の設定で 1 つ。直下の folder に違う値があっても読まない。
    ...(source.name !== '' && source.written.includes('transport') && source.config.transport !== ctx.config.transport ? [`連携: ${source.config.transport}（読まない。連携はこの folder の設定で決まる）`] : []),
  ];
  return parts.join('・') || '道具の欄は無い';
}

/**
 * TPM 担当の名乗りに出す設定の行。どの値がどの設定から来たかを出す（値だけを出すと、設定が無いための既定を「設定の値」と読み違える）。
 * 直下の folder の設定を合わせていなければ、設定の file と値の 2 行。合わせていれば、設定ごとの中身と、Key の形ごとの記録の先。
 */
export function configLines(ctx: Context): string[] {
  const { sources, trackers, transport, infra } = ctx.config;
  const [own, ...folders] = sources;
  if (own === undefined) return [];
  const transportLine = `連携: ${orDefault(own, 'transport', transport)}`;
  if (folders.length === 0) {
    return [`設定: ${own.file}${own.exists ? '' : '（無いので既定）'}`, `課題管理: ${orDefault(own, 'tracker', own.config.tracker)}・${transportLine}`];
  }
  const declared = (found: ConfigSource[], tool: string): string => found.length === 0 ? '宣言した設定が無い（記録しない）' : `${tool}（${found.map(sourceLabel).join('・')}）`;
  const github = trackers.github.length > 1
    ? `決まらない（github の設定が 2 つ以上: ${trackers.github.map(sourceLabel).join('・')}。この folder の設定の folders で 1 つに絞る。Product Manager に伝える）`
    : declared(trackers.github, 'github');
  const envs = Object.entries(infra).map(([name, env]) => `${name}（${(env.from ?? []).join('・')}）`);
  return [
    '設定（この folder と直下の folder を合わせた物）:',
    ...sources.map(s => `- ${sourceLabel(s)}  ${sourceSummary(ctx, s)}`),
    `課題管理: Jira の Key（AI-12 の形）→ ${declared(trackers.jira, 'jira')}／gh- の Key → ${github}／t- の Key → 記録しない`,
    transportLine,
    ...(envs.length === 0 ? [] : [`infra: ${envs.join('・')}（手続きは tpm infra list）`]),
  ];
}

/** 課題の記録の先（「jira（roster の設定）」）。project の folder 自身の設定なら道具の名だけ。 */
export function recordingTo(ctx: Context, issue: string): string {
  const to = route(ctx.config.trackers, ctx.exec, issue);
  if (to === undefined) return 'none';
  return sourceLabel(to.source) === OWN_LABEL ? to.tool : `${to.tool}（${sourceLabel(to.source)} の設定）`;
}

/** cmux の連携で、cmux.json に通知のバナーの hook が無い・命令が古ければ 1 行出す（TPM 担当が Product Manager に伝える）。 */
export function bannerHint(ctx: Context, cmuxFile?: string): string[] {
  if (ctx.config.transport !== 'cmux') return [];
  try {
    const hook = findHook(cmuxFile);
    if (hook === undefined) return ['通知のバナー: cmux.json に tpm の hook がありません。tpm banner setup の字を足すと、Product Manager に要るバナーだけになる（Product Manager に伝える）'];
    const stale = staleHook(hook.command, ctx.root, ctx.env);
    return stale === undefined ? [] : [`通知のバナー: cmux.json の hook の命令が${stale}。tpm banner setup の字に替える（Product Manager に伝える）`];
  }
  catch (e) {
    return [`通知のバナー: cmux.json を読めません（${(e as Error).message}）`];
  }
}

/** 名簿を、実際に動いている居場所と突き合わせて出す。 */
export function roles(ctx: Context): string[] {
  const seats = ctx.transport.seats();
  const records = allRoles(ctx);
  // 台帳に未決の件があれば、名簿の終わりに 1 行出す（見直しを忘れないため）。
  if (records.length === 0) return ['名簿: 担当はいない', ...lastAuditLine(ctx), ...openLine(ctx)];
  return ['名簿:', ...records.map((r) => {
    const alive = r.address !== undefined && seats.some(s => s.address === r.address);
    const wait = alive && r.address !== undefined ? ctx.transport.status(r.address)?.wait : undefined;
    const gone = r.role === 'auditor' ? '消えた（居場所が無い。起こし直すのは Product Manager: tpm audit start）' : '消えた（居場所が無い。tpm assign で起こし直すか、tpm close で名簿から消す）';
    const where = alive ? `${r.address}（${wait ?? '状態なし'}）` : gone;
    return `- ${r.key}  ${r.title}  ${where}${r.dismissed ? `  dismiss 済み（${r.dismissed === 'handover' ? '交代' : '終わり'}）` : ''}${r.brief ? `  依頼書: ${r.brief}` : ''}${r.issuePage ? `  課題の写し: ${r.issuePage}` : ''}`;
  }), ...lastAuditLine(ctx), ...openLine(ctx)];
}

/** Key に使う字: 英小文字と数字から、読み違えやすい 0・o・1・l・i を除いた 31 字。 */
const SAFE_CHARS = [...'0123456789abcdefghijklmnopqrstuvwxyz'].filter(c => !'0o1li'.includes(c)).join('');
/** 使われていない Key を探す回数（31 の 4 乗 ≒ 92 万通りなので、まず 1 回目で見つかる）。 */
const KEY_TRIES = 100;

/**
 * 課題管理の課題が無い課題の Key を作る（`t-` と SAFE_CHARS の 4 文字）。名簿の担当とも、置き場のページの folder（前に使った Key）ともぶつからない物を返す。
 * pick は 0 以上 n 未満の整数を返す（試験で替える）。
 */
export function newKey(ctx: Context, pick: (n: number) => number = randomInt): string {
  for (let i = 0; i < KEY_TRIES; i++) {
    const key = `t-${Array.from({ length: 4 }, () => SAFE_CHARS.charAt(pick(SAFE_CHARS.length))).join('')}`;
    if (readRole(ctx, key) === undefined && !existsSync(pageFolder(ctx, key))) return key;
  }
  throw new TpmError(`使われていない Key を ${KEY_TRIES} 回で作れませんでした`);
}

/** `tpm assign` の旗。 */
export interface AssignOptions {
  role: RoleName
  /** 居場所の題に付ける短い題（Software Engineer 担当だけが使う）。 */
  title?: string
  brief?: string
  issue?: string
  cwd?: string
  model?: string
  effort?: string
  permissionMode?: string
  /** 【brief】に添える一言。 */
  note?: string
  /** 続きの【brief】で、済んでいない前の依頼書を取り消す。 */
  supersede?: boolean
  /** 続きの【brief】で、済んでいない前の依頼書を済ませてから、これをさせる。 */
  after?: boolean
  /** 課題の写しを作らずに振る訳（--no-issue-copy の訳）。 */
  noIssueCopy?: string
  /** 起こした担当の tpm hello を待つ秒。0 なら待たない。 */
  wait: number
}

/** Staff Engineer 担当の役割の名。 */
const STAFF: RoleName = 'staff-engineer';

/**
 * Staff Engineer 担当を起こす前の確かめ。課題の担当が名簿に居ること（Staff は、その隣に起こす）と、skill が在ること
 * （無いまま起こすと、最初の入力が Unknown command になる）。課題の担当の名簿の行を返す。
 */
function staffSubject(ctx: Context, key: string): RoleRecord {
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
const putStaffBrief = (ctx: Context, subject: RoleRecord, asks: Review[]): string => putPage(ctx, { text: staffBriefPage(subject, asks) }, 'brief', subject.key).url;

/** 頼みに、渡した依頼書の URL を書く（渡した後に呼ぶ。渡せなかった回に、依頼書にした事にしない）。 */
function markBriefed(ctx: Context, asks: Review[], url: string): void {
  for (const r of asks) patchReview(ctx, r.n, { brief: url });
}

/**
 * 起きている Staff Engineer 担当の席の題と説明を、新しい依頼書の頼みに替え、名簿の題も同じ字にする（通知のバナーは、居場所の題と名簿の題で席を探す）。
 * 替えられなければ名簿は替えずに、そのことを 1 行返す（依頼書はもう渡してあるので、止めない）。
 * 送る前の検査（assertRead）と通知のバナーは、相手を題で見分ける。この関数より前に Staff の席が前の題で送ったメッセージは、後の検査で拾われない（1 回の assign の中の短い間だけ）。
 */
function relabelStaff(ctx: Context, seat: RoleRecord, subjectKey: string, asks: Review[]): string[] {
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

/**
 * 課題を担当に振る。同じ Key の担当が動いていれば、その担当に【brief】で新しい依頼書を送る（背景を知っているため）。
 * いなければ（居場所が消えていても）起こし、名乗るまで待つ。
 * Staff Engineer 担当（--role staff-engineer）は、課題の担当と並べるために、名簿の Key を `<課題の Key>.staff` にして起こす（subjectKey は、どの役割でも課題の Key）。
 * その依頼書は、課題の担当のレビューの頼み（tpm ask review）から命令が作る（--brief は受けない）。
 */
export function assign(ctx: Context, subjectKey: string, options: AssignOptions): string[] {
  assertKey(subjectKey);
  if (!Number.isFinite(options.wait) || options.wait < 0) throw new TpmError('--wait は 0 以上の数にしてください（0 なら待たない）');
  // Auditor は TPM 担当の回し方も見るので、TPM 担当の手では起こさない・依頼書も送らない。
  if (options.role === 'auditor' || subjectKey === AUDIT_KEY) throw new TpmError('Auditor の席（Key audit）は、Product Manager が tpm audit start で起こします。tpm assign では起こせません・依頼書も送れません');
  if (isStaffKey(subjectKey)) throw new TpmError(`${subjectKey} は Staff Engineer 担当の席の Key です。席を起こす・依頼書を送るのは tpm assign <課題の Key> --role staff-engineer`);
  const subject = options.role === STAFF ? staffSubject(ctx, subjectKey) : undefined;
  // 名簿の Key。Staff Engineer 担当の席だけ、課題の Key と違う。
  const key = subject === undefined ? subjectKey : staffKey(subjectKey);
  const existing = readRole(ctx, key);
  const alive = existing?.address !== undefined && ctx.transport.seats().some(s => s.address === existing.address);
  // Staff に渡す頼み: まだ依頼書にしていない物。席が無い時（消えたら、起こし直して渡し直す）と、前の依頼書を取り消す時（--supersede）は、依頼書にしたが返っていない物も。
  const asks = subject === undefined ? [] : openReviews(ctx, subjectKey).filter(r => r.brief === undefined || !alive || options.supersede === true);
  if (subject !== undefined) {
    if (options.brief !== undefined) throw new TpmError('Staff Engineer 担当への依頼書は、レビューの頼み（tpm ask review）から命令が作ります。--brief は書かないでください');
    if (options.title !== undefined) throw new TpmError('Staff Engineer 担当の席の題は、レビューの頼みから命令が作ります。--title は書かないでください');
    if (asks.length === 0) throw new TpmError(`${subjectKey} に、まだ依頼書にしていないレビューの頼みがありません。頼むのは課題の担当（tpm ask review）。今の頼みは tpm review list --key ${subjectKey}`);
  }
  // 名簿にある担当（前の決まりの長い Key を含む）は、そのまま動き続けられるよう形を問わない。
  if (existing === undefined && subject === undefined && key.startsWith('t-') && !LOCAL_KEY.test(key)) {
    throw new TpmError(`課題管理の課題が無いときの Key は、t- と英小文字・数字 4 文字にしてください（tpm key で作る）: ${key}`);
  }
  if (existing !== undefined && alive) {
    if (options.brief === undefined && subject === undefined) throw new TpmError(`${key} の担当はもう動いています（${existing.address}）。新しい依頼書を --brief で渡してください`);
    if (options.supersede === true && options.after === true) throw new TpmError('--supersede と --after は、どちらか 1 つにしてください');
    // 写しを置く前に、送る前の検査を通す（止まった回に写しだけが増えないように）。
    assertRead(ctx, `${existing.key} の担当`, existing.title);
    const choice = options.supersede === true ? 'supersede' : options.after === true ? 'after' : undefined;
    const settled = assertSettled(ctx, existing, 'assign', choice);
    // 続きのときも写しを作り直す（コメントが増えているため）。
    Object.assign(existing, issueCopy(ctx, existing.issue ?? subjectKey, subjectKey, options.noIssueCopy));
    // 送る前の検査を通ってから、頼みを依頼書にする（止まった回に、渡した事にしない）。
    const url = subject === undefined ? options.brief ?? '' : putStaffBrief(ctx, subject, asks);
    const sent = brief(ctx, existing, url, options.note, settled === undefined || choice === undefined ? undefined : { text: settled, choice });
    markBriefed(ctx, asks, url);
    return subject === undefined ? sent : [...sent, ...relabelStaff(ctx, existing, subjectKey, asks)];
  }
  if (options.issue !== undefined && !ctx.tracker.owns(options.issue)) {
    throw new TpmError(`${options.issue} に記録を書く課題管理が、どの設定にもありません（読んだ設定: ${describeTrackers(ctx.config.sources)}）。記録するなら、その課題を扱う repo の .claude/roles/config.jsonc に "tracker"（jira・github）を書いてください`);
  }
  // 新しい担当（交代を含む）は背景を知らないので、依頼書に課題の概要の節を求める。続きの【brief】には求めない。
  if (options.brief !== undefined) assertSummary(ctx, key, options.brief);
  // Staff Engineer 担当の記録は、見ている課題の課題管理の課題に書く。
  const issue = options.issue ?? subject?.issue;
  const cwd = options.cwd ?? ctx.project;
  const settings = resolveSettings(options.role, { flags: options, config: roleDefaults(ctx, options.role, cwd), env: ctx.env });
  // castlist を設定していれば、起きているかを、写しを置く前に見る（止まっていれば、担当を起こさずに止まる）。
  const skew = requireUp(ctx, '担当は起こしていません。', [`この 1 行を Product Manager に頼み、tpm wait pm "castlist を起こす" --hand で待ってから、もう 1 度 tpm assign を打ってください。`]);
  // 居場所を作る前に読む（読めなければ、担当を起こさずに止まる）。
  const copy = issueCopy(ctx, issue ?? subjectKey, subjectKey, options.noIssueCopy);
  const def = ROLES[options.role];
  // Staff Engineer 担当の席の題と説明は、渡す頼みから作る。
  const label = subject === undefined ? undefined : reviewLabel(asks);
  // 起こす席には、依頼書を名簿の行で渡す（起こせなかった回は席が無いので、次の回に渡し直す）。
  const briefUrl = subject === undefined ? options.brief : putStaffBrief(ctx, subject, asks);
  if (briefUrl !== undefined) markBriefed(ctx, asks, briefUrl);
  const record: RoleRecord = {
    key,
    ...(subject === undefined ? {} : { subject: subjectKey }),
    role: options.role,
    title: def.title(subjectKey, label?.target ?? options.title ?? '課題'),
    cwd,
    addDirs: ['core', ...ctx.skillSets].map(s => skillSetDir(ctx.root, s)),
    ...settings,
    ...(briefUrl === undefined ? {} : { brief: briefUrl, firstBrief: briefUrl }),
    ...(issue === undefined ? {} : { issue }),
    ...copy,
  };
  // 担当を起こした folder と、記録の先を出す（上の folder から振ると、どちらも 1 つに決まっていないため）。
  const sid = ctx.env.CLAUDE_CODE_SESSION_ID;
  const more = [...(issue === undefined ? [] : [`課題の記録: ${recordingTo(ctx, issue)}`]), ...skew];
  return launch(ctx, record, existing !== undefined, options.wait, more, sid ? sessionRef(sid) : undefined, label?.description);
}

/**
 * 起こした居場所に、役割の色を付ける。色は飾りなので、付けられなくても止めずに 1 行で知らせる（居場所はもう動いていて、宛先も名簿に書いてある）。
 */
function paint(ctx: Context, role: RoleName, address: string): string[] {
  const { color }: RoleDef = ROLES[role];
  if (color === undefined) return [];
  try {
    ctx.transport.setColor(address, color);
  }
  catch (e) {
    return [`居場所の色（${color}）を付けられなかった: ${e instanceof Error ? e.message : String(e)}`];
  }
  return [];
}

/**
 * 名簿の行の担当を起こす: 名簿に書き、居場所を作って tpm run-role を動かし、名乗るまで wait 秒待つ（0 なら待たない）。
 * again は起こし直しか（出す字が変わる）。more は、起こした行と folder の行の後に出す行。tpm assign と tpm audit start が使う。
 * castlist を設定していれば、起こしの id と、起こした者（launchedBy。castlist の付随する id）を名簿に書く（tpm run-role が担当の環境変数にする）。
 * description は題の下に出す説明。色は役割の表（ROLES の color）から、宛先を名簿に書いた後に付ける（paint）。
 */
export function launch(ctx: Context, record: RoleRecord, again: boolean, wait: number, more: string[] = [], launchedBy?: string, description?: string): string[] {
  if (castlistUrl(ctx) !== undefined) {
    record.launch = randomUUID();
    if (launchedBy !== undefined) record.launchedBy = launchedBy;
  }
  writeRole(ctx, record);
  const command = [join(ctx.root, 'cli', 'bin', 'tpm'), 'run-role', record.key, '--project', ctx.project, '--state', ctx.state.dir].map(shellQuote).join(' ');
  record.address = ctx.transport.spawn({ title: record.title, cwd: record.cwd, command, ...(description === undefined ? {} : { description }) });
  writeRole(ctx, record);
  const head = [`${again ? '起こし直した' : '起こした'}: ${record.title}（${record.address}・${modelStatus(record.model, record.effort)}）`, `folder: ${record.cwd}`, ...more, ...paint(ctx, record.role, record.address)];
  if (wait === 0) return [...head, '名乗り（tpm hello）は待っていない'];
  for (let waited = 0; waited < wait * 1000; waited += HELLO_INTERVAL_MS) {
    if (readRole(ctx, record.key)?.helloAt !== undefined) return [...head, '名乗った（tpm hello が来た）'];
    ctx.sleep(HELLO_INTERVAL_MS);
  }
  if (readRole(ctx, record.key)?.helloAt !== undefined) return [...head, '名乗った（tpm hello が来た）'];
  throw new TpmError(notStarted(ctx, record, wait));
}

/**
 * 設定に書いた担当の既定。欄ごとに、担当を起こす folder（--cwd）の設定が先、次に project の folder の設定。
 * 直下の folder の設定どうしは合わせない（担当は 1 人で値は 1 つなので、起こす folder で決める）。
 */
function roleDefaults(ctx: Context, role: RoleName, cwd: string): Partial<Record<'model' | 'effort' | 'permissionMode', string>> {
  const dir = resolve(cwd);
  const here = dir === ctx.project ? {} : readRolesConfig(rolesConfigFile(dir)).roles[role];
  return { ...ctx.config.roles[role], ...here };
}

/**
 * 課題の写し（名簿に書く欄）。読める形の Key なら写しを置いて URL を、--no-issue-copy ならその訳を返す。読める形でなければ空。
 * 前の写しの欄は、どちらかに上書きするため両方を返す（undefined は消す）。
 */
function issueCopy(ctx: Context, issueKey: string, roleKey: string, skip: string | undefined): Pick<RoleRecord, 'issuePage' | 'issueCopySkipped'> {
  if (issueTracker(ctx, issueKey) === undefined) return {};
  if (skip !== undefined) {
    if (skip.trim() === '') throw new TpmError('--no-issue-copy には、写しを作らずに振る訳を書いてください');
    return { issuePage: undefined, issueCopySkipped: skip };
  }
  return { issuePage: copyIssue(ctx, issueKey, roleKey), issueCopySkipped: undefined };
}

/** 名乗らなかった訳を画面から読む。信頼のダイアログと命令の誤りは、居場所を閉じてから知らせる。 */
function notStarted(ctx: Context, record: RoleRecord, waited: number): string {
  const address = record.address ?? '';
  const screen = ctx.transport.screen(address);
  const head = `${record.title}（${address}）が ${waited} 秒たっても名乗りません。`;
  const closeSeat = (): void => {
    ctx.transport.close(address);
    delete record.address;
    writeRole(ctx, record);
  };
  if (/Adding a new directory|trust/i.test(screen)) {
    closeSeat();
    return `${head}信頼のダイアログで止まっていたので、Yes は押さずに閉じました。${record.cwd} と ${ctx.root} で 1 度 Claude Code を対話で起こして信頼するよう、Product Manager に頼んでください。`;
  }
  if (/Unknown command/i.test(screen)) {
    closeSeat();
    return `${head}最初の入力 ${ROLES[record.role].prompt} が Unknown command でした（skill セットの folder の誤り）。閉じました。`;
  }
  return `${head}居場所は残してあります。画面の終わり:\n${screen.trimEnd().split('\n').slice(-12).join('\n')}`;
}

/** 担当の居場所を閉じ、名簿から消す。課題の担当を閉じる時は、その課題の Staff Engineer 担当の席が残っていれば、一緒に閉じる。 */
export function close(ctx: Context, key: string): string[] {
  const record = readRole(ctx, key);
  if (record === undefined) throw new TpmError(`名簿に担当がいません: ${key}`);
  if (record.role === 'auditor') throw new TpmError('Auditor の席は、Product Manager が起こし、閉じます。tpm close では閉じられません（居場所が消えていたら、Product Manager が tpm audit start で起こし直す）');
  const alive = record.address !== undefined && ctx.transport.seats().some(s => s.address === record.address);
  // 閉じる前に、この担当とのメッセージの届いた時刻を写す。
  syncDeliveries(ctx);
  // 居場所を閉じる前に、castlist に幕引きを送る（閉じた後の SessionEnd の hook が届くかは、閉じ方による）。
  const castlist = closeLaunch(ctx, record);
  if (alive && record.address !== undefined) ctx.transport.close(record.address);
  removeRole(ctx, key);
  const staff = isStaffKey(key) || readRole(ctx, staffKey(key)) === undefined ? [] : close(ctx, staffKey(key));
  return [`閉じた: ${record.title}${alive ? `（${record.address}）` : '（居場所はもう無かった）'}`, ...castlist, ...staff];
}
