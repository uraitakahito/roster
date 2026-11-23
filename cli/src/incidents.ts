// 台帳: 思わぬ出来事（信頼性・安全性・効率性が落ちた時）を 1 件 1 ファイルで覚える。状態の folder の incidents/<番号>.jsonc。
// 書くのは事実だけ（何が起きたか）。原因は、後で監査の担当が調べる。中身は roster を動かす機械の外に写さない。
import type { Context } from './context.ts';
import { actor } from './evidence.ts';
import { TpmError } from './skill-sets.ts';

/** 出来事の種類（`--type` の値）と、出す字。 */
export const INCIDENT_TYPES = { reliability: '信頼性', safety: '安全性', efficiency: '効率性' } as const;
/** 出来事の種類の名前。 */
export type IncidentType = keyof typeof INCIDENT_TYPES;

/** `--type` の値を読む。日本語で打ったら、替わりの値を案内して止まる。 */
export function incidentType(value: string): IncidentType {
  if (Object.hasOwn(INCIDENT_TYPES, value)) return value as IncidentType;
  const english = Object.entries(INCIDENT_TYPES).find(([, label]) => label === value)?.[0];
  if (english !== undefined) throw new TpmError(`--type ${value} は ${english} と書いてください（--type ${english}）`);
  throw new TpmError(`--type は ${Object.entries(INCIDENT_TYPES).map(([k, v]) => `${k}（${v}）`).join('・')} のどれかにしてください`);
}

/**
 * 件がどこから入ったか。add は TPM 担当が書いた、report は担当が書いた（【incident】）、
 * remaining は【done】の「残り」・【end】の「残っている物」、pm-hand は Product Manager に頼んだ手の操作（`roster wait pm --hand`）。
 */
export type IncidentSource = 'add' | 'report' | 'remaining' | 'pm-hand';

/** 件の扱い。open は未決、assigned は調べを振った、dropped は調べないと決めた、closed は改善が済んだ。 */
export type IncidentStatus = 'open' | 'assigned' | 'dropped' | 'closed';

/** 扱いの字。 */
export const STATUS_LABEL: Record<IncidentStatus, string> = { open: '未決', assigned: '振った', dropped: '調べない', closed: '済み' };

/** 台帳の 1 件。 */
export interface Incident {
  n: number
  at: string
  /** 出来事のあった課題の Key（TPM 担当の手の操作などは tpm）。 */
  key: string
  /** 書いた担当の課題の Key（TPM 担当は tpm）と役割。 */
  by: string
  role: string
  source: IncidentSource
  /** remaining と pm-hand は種類を書かなくてよい。 */
  type?: IncidentType
  /** 起きた事実。 */
  text: string
  tags: string[]
  /** 引き金になったメッセージの id（時系列の真ん中にする）。 */
  msg?: string
  /** すぐ止めないと害が広がる物。TPM 担当は見直しを待たずに振る。 */
  severe: boolean
  status: IncidentStatus
  /** 調べを振った先の課題の Key（assigned）。 */
  to?: string
  /** 改善の PR（closed）。 */
  pr?: string
  /** 改善を入れた教訓（closed）。 */
  lesson?: string
  /** 調べない訳（dropped）・PR も教訓も無く済んだ訳（closed）。 */
  why?: string
  /** 時系列のページの URL（roster incident timeline が置いた、いちばん新しい物）。 */
  timeline?: string
  /** 扱いを替えた時刻。 */
  decidedAt?: string
  /** 扱いを替えた担当（課題の Key と役割。TPM 担当は tpm）。この欄ができる前に決めた件には無い。 */
  decidedBy?: { by: string, role: string }
}

const fileOf = (n: number): string => `incidents/${n}.jsonc`;

/** 台帳の全件を番号の順に返す。 */
export function readIncidents(ctx: Context): Incident[] {
  return ctx.state.list('incidents')
    .map(name => ctx.state.read<Incident>(`incidents/${name}.jsonc`))
    .filter(i => i !== undefined)
    .sort((a, b) => a.n - b.n);
}

/** 番号の件を読む。無ければ止まる。 */
export function requireIncident(ctx: Context, n: number): Incident {
  const incident = ctx.state.read<Incident>(fileOf(n));
  if (incident === undefined) throw new TpmError(`台帳に #${n} はありません（roster incident review --all で見る）`);
  return incident;
}

/** 件を書き直す。 */
export const writeIncident = (ctx: Context, incident: Incident): void => ctx.state.write(fileOf(incident.n), incident);

/** tag の字。空白と , を含まない短い字にする（一覧で 1 語に見えるように）。 */
export function assertTags(tags: string[]): string[] {
  for (const tag of tags) {
    if (!/^[^\s,]{1,24}$/u.test(tag)) throw new TpmError(`tag は空白と , を含まない 24 字までにしてください: ${tag}`);
  }
  return [...new Set(tags)];
}

/** 台帳に書く物（番号・時刻・書いた担当・扱いは命令が決める）。 */
export type NewIncident = Pick<Incident, 'key' | 'source' | 'text'> & Partial<Pick<Incident, 'type' | 'tags' | 'msg' | 'severe'>>;

/**
 * 台帳に 1 件足す。番号は、今の最大＋1 から、無い番号の file を「在れば失敗」で作って決める
 * （担当が同時に書いても同じ番号にならない）。
 */
export function addIncident(ctx: Context, fields: NewIncident): Incident {
  if (fields.text.trim() === '') throw new TpmError('起きた事実を 1 行で書いてください');
  const base = {
    at: ctx.now().toISOString(),
    key: fields.key,
    ...actor(ctx.env),
    source: fields.source,
    ...(fields.type === undefined ? {} : { type: fields.type }),
    text: fields.text,
    tags: assertTags(fields.tags ?? []),
    ...(fields.msg === undefined ? {} : { msg: fields.msg }),
    severe: fields.severe ?? false,
    status: 'open' as const,
  };
  for (let n = Math.max(0, ...readIncidents(ctx).map(i => i.n)) + 1; ; n++) {
    const incident: Incident = { n, ...base };
    if (ctx.state.create(fileOf(n), incident)) return incident;
  }
}

/**
 * 未決の件に、同じ中身の続き（【end】の「残っている物」・`roster wait pm --hand` の打ち直し）を寄せ、新しい件を作らない。
 * 続きの字（body）が件の事実にもう入っていれば、足さない。寄せた後の件を返す。
 */
export function foldIntoIncident(ctx: Context, incident: Incident, more: string, body: string): Incident {
  if (incident.text.includes(body.trim())) return incident;
  const folded: Incident = { ...incident, text: `${incident.text} ／ ${more}` };
  writeIncident(ctx, folded);
  return folded;
}

/** 件の 1 行（`#7 [重い] 効率性 t-8zuk 11-21 09:53「…」tag: 権限`）。 */
export function incidentLine(i: Incident): string {
  const kind = i.type !== undefined ? INCIDENT_TYPES[i.type] : i.source === 'pm-hand' ? 'PM の手' : '残り';
  const extra = [
    ...(i.tags.length === 0 ? [] : [`tag: ${i.tags.join('・')}`]),
    ...(i.msg === undefined ? [] : [`msg: ${i.msg}`]),
    ...(i.timeline === undefined ? [] : [`時系列: ${i.timeline}`]),
    ...(i.status === 'open' ? [] : [`${STATUS_LABEL[i.status]}${[i.to, i.pr, i.lesson, i.why].filter(v => v !== undefined).map(v => `: ${v}`).join('')}`]),
  ];
  return `#${i.n}${i.severe ? ' [重い]' : ''} ${kind} ${i.key} ${i.at.slice(5, 16).replace('T', ' ')}「${i.text}」${extra.map(e => ` ${e}`).join('')}`;
}

/** 同じ tag の、この件より前の件（「権限: これで 4 件目」を返すため）。 */
export function earlierWithTag(ctx: Context, incident: Incident, tag: string): Incident[] {
  return readIncidents(ctx).filter(i => i.n !== incident.n && i.tags.includes(tag));
}

/** tag ごとの件数の行（`権限: これで 4 件目（前: #2 t-8zuk・#4 t-3m36）`）。tag が無ければ空。 */
export function tagLines(ctx: Context, incident: Incident): string[] {
  return incident.tags.map((tag) => {
    const before = earlierWithTag(ctx, incident, tag);
    return before.length === 0 ? `${tag}: 初めて` : `${tag}: これで ${before.length + 1} 件目（前: ${before.map(i => `#${i.n} ${i.key}`).join('・')}）`;
  });
}

/** 未決の件数の 1 行（TPM 担当の名簿の終わりに出す）。未決が無ければ空。 */
export function openLine(ctx: Context): string[] {
  const open = readIncidents(ctx).filter(i => i.status === 'open');
  if (open.length === 0) return [];
  const severe = open.filter(i => i.severe).length;
  return [`台帳: 未決 ${open.length} 件${severe === 0 ? '' : `（重い ${severe}）`}。roster incident review で見る`];
}
