// tpm incident …: 台帳（思わぬ出来事の記録）を TPM 担当が書く・見直す・扱いを決める。担当は tpm report incident で書く（messages.ts）。
import type { Command } from 'commander';
import { createContext, type Context } from '../context.ts';
import { addIncident, assertTags, incidentLine, incidentType, INCIDENT_TYPES, readIncidents, requireIncident, STATUS_LABEL, tagLines, writeIncident, type Incident, type IncidentStatus } from '../incidents.ts';
import { assertKey } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';

/** 台帳を見直す・扱いを決めるのは TPM 担当だけ（担当は書くだけ）。 */
function requireTpmSide(ctx: Context): void {
  if (ctx.env.TPM_KEY) throw new TpmError('台帳を見直す・扱いを決めるのは TPM 担当です。担当は tpm report incident "<起きた事実>" --type <種類> で書いてください');
}

/** `7` か `#7` を番号にする。 */
function numberOf(value: string): number {
  const m = /^#?([1-9]\d*)$/.exec(value);
  if (m?.[1] === undefined) throw new TpmError(`件の番号を書いてください（7 か #7）: ${value}`);
  return Number(m[1]);
}

/** `tpm incident add` の旗。 */
export interface AddOptions {
  text: string
  type: string
  tags: string[]
  msg?: string
  severe: boolean
}

/** TPM 担当が、気づいた出来事を台帳に書く。tag があれば、同じ tag の前の件数を返す。 */
export function incidentAdd(ctx: Context, key: string, options: AddOptions): string[] {
  requireTpmSide(ctx);
  assertKey(key);
  const incident = addIncident(ctx, { key, source: 'add', text: options.text, type: incidentType(options.type), tags: options.tags, severe: options.severe, ...(options.msg === undefined ? {} : { msg: options.msg }) });
  return [`台帳に書いた: ${incidentLine(incident)}`, ...tagLines(ctx, incident), ...(incident.severe ? ['重い件: 見直しを待たずに、調べを振る'] : [])];
}

/** `tpm incident review` の旗。 */
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
  requireTpmSide(ctx);
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
  requireTpmSide(ctx);
  const incident = requireIncident(ctx, numberOf(n));
  incident.tags = assertTags([...incident.tags, ...tags]);
  writeIncident(ctx, incident);
  return [`tag を付けた: ${incidentLine(incident)}`, ...tagLines(ctx, incident)];
}

/** 件の扱いを替える。fields は扱いと一緒に書く欄（振り先・PR・訳）。 */
function decide(ctx: Context, numbers: string[], status: IncidentStatus, fields: Partial<Pick<Incident, 'to' | 'pr' | 'lesson' | 'why'>>): string[] {
  requireTpmSide(ctx);
  if (numbers.length === 0) throw new TpmError('件の番号を 1 つ以上書いてください');
  // 先にみな読む（番号の誤りがあれば、どれも書き替えない）。
  const incidents = numbers.map(n => requireIncident(ctx, numberOf(n)));
  return incidents.map((incident) => {
    const next: Incident = { ...incident, ...fields, status, decidedAt: ctx.now().toISOString() };
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

/** 調べないと決めた（訳を書く）。 */
export function incidentDrop(ctx: Context, numbers: string[], options: { why?: string }): string[] {
  return decide(ctx, numbers, 'dropped', { why: given(options.why, '--why "<調べない訳>"') });
}

/** 改善が済んだ（直した PR・教訓・訳のどれかを結ぶ）。 */
export function incidentClose(ctx: Context, numbers: string[], options: { pr?: string, lesson?: string, why?: string }): string[] {
  const fields = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v.trim() !== ''));
  if (Object.keys(fields).length === 0) throw new TpmError('--pr <直した PR>・--lesson "<教訓の file と一言>"・--why "<訳>" のどれかを書いてください（何で済んだかを結ぶ）');
  return decide(ctx, numbers, 'closed', fields);
}

const collect = (value: string, all: string[]): string[] => [...all, value];

/** `tpm incident` の命令を命令の木に足す。 */
export function registerIncident(program: Command, print: (lines: string[]) => void): void {
  const types = Object.keys(INCIDENT_TYPES).join('・');
  const incident = program.command('incident').description('台帳（思わぬ出来事の記録）を TPM 担当が書く・見直す・扱いを決める（担当は tpm report incident）');
  incident.command('add <key> <text>').description('TPM 担当が、気づいた出来事（起きた事実）を台帳に書く')
    .requiredOption('--type <種類>', types)
    .option('--tag <tag>', '同じ種の出来事を数える印（繰り返せる。後から tpm incident tag で付けられる）', collect, [] as string[])
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
  incident.command('drop <n...>').description('調べないと決めた')
    .option('--why <訳>', '調べない訳')
    .action((n: string[], options: { why?: string }) => print(incidentDrop(createContext(), n, options)));
  incident.command('close <n...>').description('改善が済んだ（直した PR・教訓・訳のどれかを結ぶ）')
    .option('--pr <URL>', '直した PR')
    .option('--lesson <教訓>', '改善を入れた教訓（file と一言）')
    .option('--why <訳>', 'PR も教訓も無く済んだ訳')
    .action((n: string[], options: { pr?: string, lesson?: string, why?: string }) => print(incidentClose(createContext(), n, options)));
}
