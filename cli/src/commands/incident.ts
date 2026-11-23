// roster incident …: 台帳（思わぬ出来事の記録）を書く・見直す・扱いを決める・追いかける。
// 書く（add）のは TPM 担当（担当と Auditor は roster report incident。messages.ts）。見直す・追いかけるのは TPM 担当と Auditor。
// 種類のある件（出来事）を「調べない」「済み」にできるのは Auditor だけ（TPM 担当の誤りの件を、TPM 担当が自分で決めないため）。
// 種類の無い件（「残り」と「PM の手」）は、TPM 担当も決められる。
import type { Command } from 'commander';
import { createContext, type Context } from '../context.ts';
import { actor } from '../evidence.ts';
import { addIncident, assertTags, incidentLine, incidentType, INCIDENT_TYPES, readIncidents, requireIncident, STATUS_LABEL, tagLines, writeIncident, type Incident, type IncidentStatus } from '../incidents.ts';
import { TPM_TITLE } from '../protocol.ts';
import { assertKey, readRole, requireTpmSide } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { roleOf } from './infra.ts';
import { DEFAULT_MINUTES, incidentTimeline } from './timeline.ts';
import { envOf } from '../env.ts';

/** 台帳に roster incident add で書くのは TPM 担当だけ（担当と Auditor は【incident】で書く）。 */
const requireAdder = (ctx: Context): void => requireTpmSide(ctx, 'roster incident add', 'roster incident add で書くのは TPM 担当です。担当は roster report incident "<起きた事実>" --type <種類> で書いてください');

/** 台帳を見直す・扱いを決める・追いかけるのは、TPM 担当と Auditor（ほかの担当は書くだけ）。 */
function requireLedgerSide(ctx: Context): void {
  if (envOf(ctx.env, 'KEY') && roleOf(ctx.env) !== 'auditor') {
    throw new TpmError('台帳を見直す・扱いを決めるのは TPM 担当と Auditor です。担当は roster report incident "<起きた事実>" --type <種類> で書いてください');
  }
}

/** `7` か `#7` を番号にする。 */
export function numberOf(value: string): number {
  const m = /^#?([1-9]\d*)$/.exec(value);
  if (m?.[1] === undefined) throw new TpmError(`件の番号を書いてください（7 か #7）: ${value}`);
  return Number(m[1]);
}

/** `roster incident add` の旗。 */
export interface AddOptions {
  text: string
  type: string
  tags: string[]
  msg?: string
  severe: boolean
}

/** TPM 担当が、気づいた出来事を台帳に書く。tag があれば、同じ tag の前の件数を返す。 */
export function incidentAdd(ctx: Context, key: string, options: AddOptions): string[] {
  requireAdder(ctx);
  assertKey(key);
  const incident = addIncident(ctx, { key, source: 'add', text: options.text, type: incidentType(options.type), tags: options.tags, severe: options.severe, ...(options.msg === undefined ? {} : { msg: options.msg }) });
  return [`台帳に書いた: ${incidentLine(incident)}`, ...tagLines(ctx, incident), ...(incident.severe ? ['重い件: すぐ Product Manager に伝える（監査を呼ぶなら、Audit の席で /audit <番号>）'] : [])];
}

/** `roster incident review` の旗。 */
export interface ReviewOptions {
  all?: boolean
  tag?: string
  json?: boolean
}

/** 重い物・種類の順（種類の無い「残り」「PM の手」は後ろ）。 */
const TYPE_ORDER = [...Object.keys(INCIDENT_TYPES), undefined];
const order = (i: Incident): number => (i.severe ? 0 : 10) + TYPE_ORDER.indexOf(i.type);

/** 未決の件（`--all` ならすべて）を、重い物・種類の順に並べ、tag ごとの件数を出す。 */
export function incidentReview(ctx: Context, options: ReviewOptions = {}): string[] {
  requireLedgerSide(ctx);
  const all = readIncidents(ctx);
  const picked = all
    .filter(i => options.all === true || i.status === 'open')
    .filter(i => options.tag === undefined || i.tags.includes(options.tag))
    .sort((a, b) => order(a) - order(b) || a.n - b.n);
  if (options.json === true) return [JSON.stringify(picked, null, 2)];
  if (picked.length === 0) return [options.all === true ? '台帳: 件は無い' : '台帳: 未決の件は無い'];
  // tag の件数は、扱いを問わず台帳の全件で数える（同じことが前にもあったかを見るため）。
  const counts = new Map<string, number>();
  for (const tag of all.flatMap(i => i.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const byStatus = (Object.keys(STATUS_LABEL) as IncidentStatus[]).map(s => [s, all.filter(i => i.status === s).length] as const).filter(([, n]) => n > 0);
  return [
    `台帳: ${byStatus.map(([s, n]) => `${STATUS_LABEL[s]} ${n}`).join('・')}`,
    ...picked.map(incidentLine),
    ...(counts.size === 0 ? [] : [`tag ごと（全件）: ${[...counts].sort((a, b) => b[1] - a[1]).map(([tag, n]) => `${tag} ${n}`).join('・')}`]),
  ];
}

/** 件に tag を足す（見直しの時に付け直す）。 */
export function incidentTag(ctx: Context, n: string, tags: string[]): string[] {
  requireLedgerSide(ctx);
  const incident = requireIncident(ctx, numberOf(n));
  incident.tags = assertTags([...incident.tags, ...tags]);
  writeIncident(ctx, incident);
  return [`tag を付けた: ${incidentLine(incident)}`, ...tagLines(ctx, incident)];
}

/** 件の扱いを替える。fields は扱いと一緒に書く欄（振り先・PR・訳）。誰が決めたかも残す。 */
function decide(ctx: Context, numbers: string[], status: IncidentStatus, fields: Partial<Pick<Incident, 'to' | 'pr' | 'lesson' | 'why'>>): string[] {
  requireLedgerSide(ctx);
  if (numbers.length === 0) throw new TpmError('件の番号を 1 つ以上書いてください');
  // 先にみな読む（番号の誤りがあれば、どれも書き替えない）。
  const incidents = numbers.map(n => requireIncident(ctx, numberOf(n)));
  if ((status === 'dropped' || status === 'closed') && roleOf(ctx.env) !== 'auditor') {
    const typed = incidents.filter(i => i.type !== undefined);
    if (typed.length > 0) {
      throw new TpmError(`出来事（種類のある件）を「${STATUS_LABEL[status]}」にできるのは Auditor だけです: ${typed.map(i => `#${i.n}`).join('・')}。どれも書き替えていません。「残り」と「PM の手」（種類の無い件）だけを名指して打ち直してください。出来事は、Product Manager が Audit の席で /audit を呼んだ時に、Auditor が決めます`);
    }
  }
  return incidents.map((incident) => {
    const next: Incident = { ...incident, ...fields, status, decidedAt: ctx.now().toISOString(), decidedBy: actor(ctx.env) };
    writeIncident(ctx, next);
    return `${STATUS_LABEL[status]}: ${incidentLine(next)}`;
  });
}

const given = (value: string | undefined, flag: string): string => {
  if (value === undefined || value.trim() === '') throw new TpmError(`${flag} を書いてください`);
  return value;
};

/** 調べを振った（振り先の課題の Key を結ぶ）。 */
export function incidentAssign(ctx: Context, numbers: string[], options: { to?: string }): string[] {
  const to = given(options.to, '--to <振り先の課題の Key>');
  assertKey(to);
  return decide(ctx, numbers, 'assigned', { to });
}

/** 調べないと決めた（訳を書く）。出来事は Auditor だけ。 */
export function incidentDrop(ctx: Context, numbers: string[], options: { why?: string }): string[] {
  return decide(ctx, numbers, 'dropped', { why: given(options.why, '--why "<調べない訳>"') });
}

/** 改善が済んだ（直した PR・教訓・訳のどれかを結ぶ）。出来事は Auditor だけ。 */
export function incidentClose(ctx: Context, numbers: string[], options: { pr?: string, lesson?: string, why?: string }): string[] {
  const fields = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v.trim() !== ''));
  if (Object.keys(fields).length === 0) throw new TpmError('--pr <直した PR>・--lesson "<教訓の file と一言>"・--why "<訳>" のどれかを書いてください（何で済んだかを結ぶ）');
  return decide(ctx, numbers, 'closed', fields);
}

/** `roster incident follow` の旗。 */
export interface FollowOptions {
  /** 「TPM 担当の決め」に出す件を、この時より後に決めた物に絞る（前の監査の日。Date が読める字）。 */
  since?: string
  json?: boolean
}

/** log.jsonl の 1 行（読む欄だけ）。 */
interface Sent {
  at: string
  key: string
  heading: string
  from: string
}

/** 追いかけの一覧。 */
export interface Follow {
  /** 振ったまま: 振った件と、振り先の今。 */
  assigned: { incident: Incident, to: string }[]
  /** 済みの後の再発: tag ごとに、済みにした件と、いちばん新しい済みの後に起きた件。 */
  recurred: { tag: string, closed: number[], after: number[] }[]
  /** 古い残り: 未決の「残り」と「PM の手」（古い順）。 */
  remaining: Incident[]
  /** TPM 担当の決め: TPM 担当が調べない・済みにした件。 */
  decided: Incident[]
}

/** MM-DD HH:MM（台帳の 1 行と同じ形）。 */
const stamp = (iso: string): string => iso.slice(5, 16).replace('T', ' ');

/** from から now までを「3 日」「5 時間」にする。 */
function age(from: string, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / 3_600_000));
  return hours < 24 ? `${hours} 時間` : `${Math.floor(hours / 24)} 日`;
}

/** 振り先の今: 名簿に居るか・居場所が動いているかと、その Key が最後に返した【done】【end】【merged】。 */
function whereabouts(ctx: Context, to: string, log: Sent[]): string {
  const record = readRole(ctx, to);
  const alive = record?.address !== undefined && ctx.transport.seats().some(s => s.address === record.address);
  const seat = record === undefined ? '名簿に居ない' : alive ? '動いている' : '名簿にあるが、居場所が無い';
  const last = log.findLast(l => l.key === to && l.from !== TPM_TITLE && ['done', 'end', 'merged'].includes(l.heading));
  return `${seat}・${last === undefined ? '【done】【end】【merged】は無い' : `最後の【${last.heading}】 ${stamp(last.at)}`}`;
}

/** 台帳から、追いかけの一覧を作る。 */
export function follow(ctx: Context, since?: string): Follow {
  const all = readIncidents(ctx);
  const after = since === undefined ? undefined : Date.parse(since);
  if (after !== undefined && Number.isNaN(after)) throw new TpmError(`--since は日付にしてください（2026-11-22 など）: ${since}`);
  const recurred = [...new Set(all.flatMap(i => i.tags))].flatMap((tag) => {
    const tagged = all.filter(i => i.tags.includes(tag));
    const closed = tagged.filter(i => i.status === 'closed' && i.decidedAt !== undefined);
    const latest = closed.map(i => i.decidedAt ?? '').sort().at(-1);
    const later = latest === undefined ? [] : tagged.filter(i => i.at > latest);
    return later.length === 0 ? [] : [{ tag, closed: closed.map(i => i.n), after: later.map(i => i.n) }];
  });
  return {
    assigned: all.filter(i => i.status === 'assigned').map(incident => ({ incident, to: incident.to ?? '' })),
    recurred,
    remaining: all.filter(i => i.status === 'open' && i.type === undefined),
    // 誰が決めたかの欄が無い件は、Auditor ができる前に TPM 担当が決めた物。
    decided: all.filter(i => (i.status === 'dropped' || i.status === 'closed') && (i.decidedBy?.role ?? 'tpm') === 'tpm' && (after === undefined || Date.parse(i.decidedAt ?? '') > after)),
  };
}

/**
 * 追いかけの一覧を出す（読むだけ）: 振ったまま止まった件・済みの後に同じ tag が起きた件・古い「残り」・TPM 担当が調べない・済みにした件。
 * 定期の監査の「追いかける」段で Auditor が読む。
 */
export function incidentFollow(ctx: Context, options: FollowOptions = {}): string[] {
  requireLedgerSide(ctx);
  const f = follow(ctx, options.since);
  if (options.json === true) return [JSON.stringify(f, null, 2)];
  const now = ctx.now();
  const log = ctx.state.lines<Sent>('log.jsonl');
  const section = (title: string, lines: string[]): string[] => lines.length === 0 ? [`${title}: 無い`] : [`${title}: ${lines.length} 件`, ...lines.map(l => `- ${l}`)];
  return [
    ...section('振ったまま', f.assigned.map(a => `${incidentLine(a.incident)}（${age(a.incident.decidedAt ?? a.incident.at, now)}前に振った。振り先: ${whereabouts(ctx, a.to, log)}）`)),
    ...section('済みの後の再発（tag）', f.recurred.map(r => `${r.tag}: 済み ${r.closed.length} 件（${r.closed.map(n => `#${n}`).join('・')}）の後に ${r.after.length} 件（${r.after.map(n => `#${n}`).join('・')}）`)),
    ...section('古い残り（未決の「残り」と「PM の手」。古い順）', f.remaining.map(i => `${incidentLine(i)}（${age(i.at, now)}）`)),
    ...section(`TPM 担当の決め（調べない・済み${options.since === undefined ? '' : `。${options.since} より後`}）`, f.decided.map(i => `${incidentLine(i)}（決めた: ${stamp(i.decidedAt ?? i.at)}）`)),
  ];
}

const collect = (value: string, all: string[]): string[] => [...all, value];

/** `roster incident` の命令を命令の木に足す。 */
export function registerIncident(program: Command, print: (lines: string[]) => void): void {
  const types = Object.keys(INCIDENT_TYPES).join('・');
  const incident = program.command('incident').description('台帳（思わぬ出来事の記録）を書く・見直す・扱いを決める・追いかける（TPM 担当と Auditor。ほかの担当は roster report incident で書く）');
  incident.command('add <key> <text>').description('TPM 担当が、気づいた出来事（起きた事実）を台帳に書く')
    .requiredOption('--type <種類>', types)
    .option('--tag <tag>', '同じ種の出来事を数える印（繰り返せる。後から roster incident tag で付けられる）', collect, [] as string[])
    .option('--msg <id>', '引き金になったメッセージの id')
    .option('--severe', 'すぐ止めないと害が広がる（見直しを待たずに振る）', false)
    .action((key: string, text: string, options: { type: string, tag: string[], msg?: string, severe: boolean }) => print(incidentAdd(createContext(), key, { ...options, text, tags: options.tag })));
  incident.command('review').description('未決の件を、重い物・種類の順に並べ、tag ごとの件数を出す')
    .option('--all', '扱いを決めた件も出す')
    .option('--tag <tag>', 'この tag の件だけ')
    .option('--json', '件を JSON で出す')
    .action((options: ReviewOptions) => print(incidentReview(createContext(), options)));
  incident.command('tag <n> <tags...>').description('件に tag を足す')
    .action((n: string, tags: string[]) => print(incidentTag(createContext(), n, tags)));
  incident.command('assign <n...>').description('調べを振った（振り先の課題の Key を結ぶ）')
    .option('--to <Key>', '振り先の課題の Key')
    .action((n: string[], options: { to?: string }) => print(incidentAssign(createContext(), n, options)));
  incident.command('drop <n...>').description('調べないと決めた（出来事は Auditor だけ。「残り」と「PM の手」は TPM 担当も）')
    .option('--why <訳>', '調べない訳')
    .action((n: string[], options: { why?: string }) => print(incidentDrop(createContext(), n, options)));
  incident.command('close <n...>').description('改善が済んだ（直した PR・教訓・訳のどれかを結ぶ。出来事は Auditor だけ）')
    .option('--pr <URL>', '直した PR')
    .option('--lesson <教訓>', '改善を入れた教訓（file と一言）')
    .option('--why <訳>', 'PR も教訓も無く済んだ訳')
    .action((n: string[], options: { pr?: string, lesson?: string, why?: string }) => print(incidentClose(createContext(), n, options)));
  incident.command('follow').description('追いかけの一覧を出す: 振ったまま止まった件・済みの後に同じ tag が起きた件・古い「残り」・TPM 担当が調べない・済みにした件')
    .option('--since <日付>', '「TPM 担当の決め」を、この時より後に決めた件に絞る（前の監査の日）')
    .option('--json', '一覧を JSON で出す')
    .action((options: FollowOptions) => print(incidentFollow(createContext(), options)));
  incident.command('timeline <target>').description('件の番号か課題の Key の前後の記録を、時刻の順に 1 枚のページにして置く（依頼書に URL を貼る）')
    .option('--minutes <分>', '件の前後に拾う分（番号を名指した時）', String(DEFAULT_MINUTES))
    .action((target: string, options: { minutes: string }) => print(incidentTimeline(createContext(), target, { minutes: Number(options.minutes) })));
}
