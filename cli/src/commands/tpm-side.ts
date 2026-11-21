// TPM 担当が打つ命令: 名乗る（tpmHello。tpm hello から呼ばれる）・名簿を見る（roles）・Key を作る（newKey）・課題を担当に振る（assign）・閉じる（close）。
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertSummary } from '../brief.ts';
import { shellQuote } from '../shell.ts';
import { describeTrackers, OWN_LABEL, readRolesConfig, rolesConfigFile, sourceLabel, type ConfigSource } from '../config.ts';
import type { Context } from '../context.ts';
import { modelStatus, ROLES, TPM_TITLE, WAIT, type RoleName } from '../protocol.ts';
import { resolveSettings } from '../settings.ts';
import { allRoles, assertKey, LOCAL_KEY, readRole, removeRole, writeRole, type RoleRecord, type TpmRecord } from '../roster.ts';
import { readSkillSets, skillSetDir, TpmError } from '../skill-sets.ts';
import { route } from '../tracker/routed.ts';
import { findHook } from './banner.ts';
import { copyIssue, issueTracker } from './issue.ts';
import { brief } from './messages.ts';
import { pageFolder } from './page.ts';

/** 名乗ったかを見る間（ミリ秒）。 */
const HELLO_INTERVAL_MS = 2000;

/**
 * TPM 担当が名乗る（$TPM_KEY の無い tpm hello）: 居場所の題と状態を出し、自分の宛先を状態に書く。続けて名簿を出す。
 * 状態の model は、旗が無ければ起こす 1 行と同じ決め方（resolveSettings）。effort は、旗が無ければ Claude Code が入れる $CLAUDE_EFFORT（実際の effort）を旗と同じに扱う。
 */
export function tpmHello(ctx: Context, options: { model?: string, effort?: string } = {}): string[] {
  const address = ctx.transport.whoami();
  ctx.transport.setTitle(TPM_TITLE);
  const settings = resolveSettings('tpm', { flags: { model: options.model, effort: options.effort ?? ctx.env.CLAUDE_EFFORT }, env: ctx.env });
  ctx.transport.setStatus('model', modelStatus(settings.model, settings.effort));
  ctx.transport.setStatus('wait', WAIT.work('起動'));
  ctx.state.write('tpm.jsonc', { address } satisfies TpmRecord);
  return [`TPM 担当の宛先: ${address}`, ...configLines(ctx), ...bannerHint(ctx), ...roles(ctx)];
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
    `課題管理: Jira の Key（SKILLS-12 の形）→ ${declared(trackers.jira, 'jira')}／gh- の Key → ${github}／t- の Key → 記録しない`,
    transportLine,
    ...(envs.length === 0 ? [] : [`infra: ${envs.join('・')}（手続きは tpm infra list）`]),
  ];
}

/** 課題の記録の先（「jira（skills の設定）」）。project の folder 自身の設定なら道具の名だけ。 */
export function recordingTo(ctx: Context, issue: string): string {
  const to = route(ctx.config.trackers, ctx.exec, issue);
  if (to === undefined) return 'none';
  return sourceLabel(to.source) === OWN_LABEL ? to.tool : `${to.tool}（${sourceLabel(to.source)} の設定）`;
}

/** cmux の連携で、cmux.json に Mac のバナーの hook が無ければ 1 行出す（TPM 担当が Product Manager に伝える）。 */
export function bannerHint(ctx: Context, cmuxFile?: string): string[] {
  if (ctx.config.transport !== 'cmux') return [];
  try {
    if (findHook(cmuxFile) !== undefined) return [];
    return ['Mac のバナー: cmux.json に tpm の hook がありません。tpm banner setup の字を足すと、Product Manager に要るバナーだけになる（Product Manager に伝える）'];
  }
  catch (e) {
    return [`Mac のバナー: cmux.json を読めません（${(e as Error).message}）`];
  }
}

/** 名簿を、実際に動いている居場所と突き合わせて出す。 */
export function roles(ctx: Context): string[] {
  const seats = ctx.transport.seats();
  const records = allRoles(ctx);
  if (records.length === 0) return ['名簿: 担当はいない'];
  return ['名簿:', ...records.map((r) => {
    const alive = r.address !== undefined && seats.some(s => s.address === r.address);
    const wait = alive && r.address !== undefined ? ctx.transport.status(r.address)?.wait : undefined;
    const where = alive ? `${r.address}（${wait ?? '状態なし'}）` : '消えた（居場所が無い。tpm assign で起こし直すか、tpm close で名簿から消す）';
    return `- ${r.key}  ${r.title}  ${where}${r.dismissed ? `  dismiss 済み（${r.dismissed === 'handover' ? '交代' : '終わり'}）` : ''}${r.brief ? `  依頼書: ${r.brief}` : ''}${r.issuePage ? `  課題の写し: ${r.issuePage}` : ''}`;
  })];
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
  /** 課題の写しを作らずに振る訳（--no-issue-copy の訳）。 */
  noIssueCopy?: string
  /** 起こした担当の tpm hello を待つ秒。0 なら待たない。 */
  wait: number
}

/**
 * 課題を担当に振る。同じ Key の担当が動いていれば、その担当に【brief】で新しい依頼書を送る（背景を知っているため）。
 * いなければ（居場所が消えていても）起こし、名乗るまで待つ。
 */
export function assign(ctx: Context, key: string, options: AssignOptions): string[] {
  assertKey(key);
  if (!Number.isFinite(options.wait) || options.wait < 0) throw new TpmError('--wait は 0 以上の数にしてください（0 なら待たない）');
  const existing = readRole(ctx, key);
  // 名簿にある担当（前の決まりの長い Key を含む）は、そのまま動き続けられるよう形を問わない。
  if (existing === undefined && key.startsWith('t-') && !LOCAL_KEY.test(key)) {
    throw new TpmError(`課題管理の課題が無いときの Key は、t- と英小文字・数字 4 文字にしてください（tpm key で作る）: ${key}`);
  }
  if (existing?.address !== undefined && ctx.transport.seats().some(s => s.address === existing.address)) {
    if (options.brief === undefined) throw new TpmError(`${key} の担当はもう動いています（${existing.address}）。新しい依頼書を --brief で渡してください`);
    // 続きのときも写しを作り直す（コメントが増えているため）。
    Object.assign(existing, issueCopy(ctx, existing.issue ?? key, key, options.noIssueCopy));
    return brief(ctx, existing, options.brief, options.note);
  }
  if (options.issue !== undefined && !ctx.tracker.owns(options.issue)) {
    throw new TpmError(`${options.issue} に記録を書く課題管理が、どの設定にもありません（読んだ設定: ${describeTrackers(ctx.config.sources)}）。記録するなら、その課題を扱う repo の .claude/roles/config.jsonc に "tracker"（jira・github）を書いてください`);
  }
  // 新しい担当（交代を含む）は背景を知らないので、依頼書に課題の概要の節を求める。続きの【brief】には求めない。
  if (options.brief !== undefined) assertSummary(ctx, key, options.brief);
  // 居場所を作る前に読む（読めなければ、担当を起こさずに止まる）。
  const copy = issueCopy(ctx, options.issue ?? key, key, options.noIssueCopy);
  const def = ROLES[options.role];
  const cwd = options.cwd ?? ctx.project;
  const settings = resolveSettings(options.role, { flags: options, config: roleDefaults(ctx, options.role, cwd), env: ctx.env });
  const record: RoleRecord = {
    key,
    role: options.role,
    title: def.title(key, options.title ?? '課題'),
    cwd,
    addDirs: ['core', ...ctx.skillSets].map(s => skillSetDir(ctx.root, s)),
    ...settings,
    ...(options.brief === undefined ? {} : { brief: options.brief }),
    ...(options.issue === undefined ? {} : { issue: options.issue }),
    ...copy,
  };
  writeRole(ctx, record);
  const command = [join(ctx.root, 'cli', 'bin', 'tpm'), 'run-role', key, '--project', ctx.project, '--state', ctx.state.dir].map(shellQuote).join(' ');
  record.address = ctx.transport.spawn({ title: record.title, cwd: record.cwd, command });
  writeRole(ctx, record);
  // 担当を起こした folder と、記録の先を出す（上の folder から振ると、どちらも 1 つに決まっていないため）。
  const head = [
    `${existing ? '起こし直した' : '起こした'}: ${record.title}（${record.address}・${modelStatus(record.model, record.effort)}）`,
    `folder: ${record.cwd}`,
    ...(options.issue === undefined ? [] : [`課題の記録: ${recordingTo(ctx, options.issue)}`]),
  ];
  if (options.wait === 0) return [...head, '名乗り（tpm hello）は待っていない'];
  for (let waited = 0; waited < options.wait * 1000; waited += HELLO_INTERVAL_MS) {
    if (readRole(ctx, key)?.helloAt !== undefined) return [...head, '名乗った（tpm hello が来た）'];
    ctx.sleep(HELLO_INTERVAL_MS);
  }
  if (readRole(ctx, key)?.helloAt !== undefined) return [...head, '名乗った（tpm hello が来た）'];
  throw new TpmError(notStarted(ctx, record, options.wait));
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

/** 担当の居場所を閉じ、名簿から消す。 */
export function close(ctx: Context, key: string): string[] {
  const record = readRole(ctx, key);
  if (record === undefined) throw new TpmError(`名簿に担当がいません: ${key}`);
  const alive = record.address !== undefined && ctx.transport.seats().some(s => s.address === record.address);
  if (alive && record.address !== undefined) ctx.transport.close(record.address);
  removeRole(ctx, key);
  return [`閉じた: ${record.title}${alive ? `（${record.address}）` : '（居場所はもう無かった）'}`];
}
