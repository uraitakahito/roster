// tpm incident timeline <番号|Key>: 件の前後に起きたことを、state の記録から時刻の順に 1 枚のページにして置く。
// TPM 担当は読まずに、監査の依頼書に URL を貼る（原因を調べるのは担当）。メッセージの本文が入るので、この Mac の外に写さない。
import type { Context } from '../context.ts';
import { syncDeliveries, type GateStop, type GuardStop, type WaitChange } from '../evidence.ts';
import { incidentLine, readIncidents, requireIncident, writeIncident, type Incident } from '../incidents.ts';
import { HEADINGS, type HeadingId } from '../protocol.ts';
import { TpmError } from '../skill-sets.ts';
import type { TrackerWrite } from '../tracker/recorded.ts';
import type { MessageTrace } from '../transport/types.ts';
import { putPage } from './page.ts';

/** 件の前後を拾う分の既定。 */
export const DEFAULT_MINUTES = 30;
/** 1 行に出す本文の長さ（これより長い本文は切る。全文は log.jsonl にある）。 */
const TEXT_LIMIT = 600;

/** log.jsonl の 1 行（読む欄だけ）。 */
interface Sent {
  at: string
  key: string
  heading: string
  from: string
  to: string
  text: string
  id: string
  delivered: boolean
  replyTo?: string
}

/** infra.jsonl の 1 行（読む欄だけ）。 */
interface InfraRun {
  at: string
  env: string
  key?: string
  command: string[]
  status: number
}

/** 時系列の 1 行。 */
export interface TimelineEvent {
  at: string
  /** 何の記録か（メッセージ・課題への書き込み・guard・入口の検査・wait・infra・台帳）。 */
  kind: 'メッセージ' | '課題管理' | 'guard' | '入口の検査' | 'wait' | 'infra' | '台帳'
  /** 誰が（差出人の題・担当の Key）。 */
  who: string
  /** 何を。 */
  what: string
  /** 添える印（届いた時刻・行き違い・引き金）。 */
  notes: string[]
  /** 件の引き金のメッセージか。 */
  trigger?: boolean
}

const hms = (iso: string): string => iso.slice(11, 19);
const seconds = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 1000);
const cut = (text: string): string => text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…（続きは log.jsonl）` : text;
/** 見出しの向き（担当から・TPM 担当から）。知らない見出しは undefined。 */
const direction = (heading: string): 'role' | 'tpm' | undefined => Object.hasOwn(HEADINGS, heading) ? HEADINGS[heading as HeadingId].from : undefined;

/**
 * Key の記録を集めて、時刻の順の行にする。window（from・to の ISO）があれば、その間だけ。
 * メッセージには届いた時刻を添え、届く前に相手が送ったメッセージがあれば「行き違い」の印を付ける。
 */
export function collect(ctx: Context, key: string, window?: { from: string, to: string }, triggerId?: string): TimelineEvent[] {
  // 同じ id の行は後ろが新しい。
  const traces = new Map(ctx.state.lines<MessageTrace>('deliveries.jsonl').map(t => [t.id, t]));
  const messages = ctx.state.lines<Sent>('log.jsonl').filter(l => l.key === key);
  const events: TimelineEvent[] = messages.map((m) => {
    const trace = traces.get(m.id);
    const arrived = trace?.deliveredAt;
    const notes = [
      arrived === undefined ? (m.delivered ? '送った時に届いた' : '届いた時刻: 分からない（送った時は、まだ届いていない）') : `届いた: ${hms(arrived)}（${seconds(m.at, arrived)} 秒後）`,
      ...(m.replyTo === undefined ? [] : [`返事の先: ${m.replyTo}`]),
    ];
    // 行き違い: これが届く前に、相手（向きが逆）が送ったメッセージ。
    if (arrived !== undefined) {
      const crossed = messages.filter(o => direction(o.heading) !== undefined && direction(o.heading) !== direction(m.heading) && o.at > m.at && o.at < arrived);
      if (crossed.length > 0) notes.push(`行き違い: これが届く前に、相手が ${crossed.length} 件送った（${crossed.map(o => `【${o.heading}】${hms(o.at)}`).join('・')}）`);
    }
    return { at: m.at, kind: 'メッセージ', who: m.from, what: `${cut(m.text)}（id ${m.id}）`, notes, ...(m.id === triggerId ? { trigger: true } : {}) };
  });
  for (const w of ctx.state.lines<TrackerWrite>('tracker.jsonl').filter(l => l.issue === key || l.by === key)) {
    events.push({ at: w.at, kind: '課題管理', who: w.by, what: `${w.issue} に${w.op === 'close' ? '「済み」' : `コメント【${w.kind ?? ''}】`}${w.ok ? '' : `（失敗: ${w.error ?? ''}）`}`, notes: [] });
  }
  for (const g of ctx.state.lines<GuardStop>('guard.jsonl').filter(l => l.by === key)) {
    events.push({ at: g.at, kind: 'guard', who: g.by, what: `止めた: ${g.command}`, notes: [g.reason] });
  }
  for (const g of ctx.state.lines<GateStop>('gate.jsonl').filter(l => l.by === key)) {
    events.push({ at: g.at, kind: '入口の検査', who: g.by, what: `送るのを止めた（${g.gate}）`, notes: [g.detail] });
  }
  for (const w of ctx.state.lines<WaitChange>('waits.jsonl').filter(l => l.by === key)) {
    events.push({ at: w.at, kind: 'wait', who: w.by, what: w.text, notes: [] });
  }
  for (const r of ctx.state.lines<InfraRun>('infra.jsonl').filter(l => l.key === key)) {
    events.push({ at: r.at, kind: 'infra', who: key, what: `${r.env}: ${r.command.join(' ')}`, notes: [`exit ${r.status}`] });
  }
  for (const i of readIncidents(ctx).filter(i => i.key === key)) {
    events.push({ at: i.at, kind: '台帳', who: i.by, what: incidentLine(i), notes: [] });
  }
  return events
    .filter(e => window === undefined || (e.at >= window.from && e.at <= window.to))
    .sort((a, b) => a.at.localeCompare(b.at));
}

const esc = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** 時系列のページの HTML。 */
export function render(title: string, lead: string[], events: TimelineEvent[]): string {
  const rows = events.map(e => `<tr${e.trigger === true ? ' class="trigger"' : ''}><td class="t">${esc(e.at.slice(0, 10))}<br>${esc(hms(e.at))}</td><td>${esc(e.kind)}</td><td>${esc(e.who)}</td><td>${esc(e.what)}${e.notes.map(n => `<br><span class="${n.startsWith('行き違い') ? 'cross' : 'note'}">${esc(n)}</span>`).join('')}</td></tr>`);
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#1b1b1f;--muted:#5d5d66;--line:#d4d4d8;--soft:#f6f7f9;--warn:#a15c00;--mark:#fff4d6}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#e8e8ea;--muted:#a0a0aa;--line:#3a3a3e;--soft:#202024;--warn:#f0b35a;--mark:#3a3118}}
body{font:15px/1.65 system-ui,sans-serif;max-width:70rem;margin:0 auto;padding:1rem 16px 3rem;background:var(--bg);color:var(--fg)}
h1{font-size:1.3rem}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{border:1px solid var(--line);padding:.35rem .5rem;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:var(--soft);white-space:nowrap}
td.t{white-space:nowrap;font-variant-numeric:tabular-nums}.note{color:var(--muted)}.cross{color:var(--warn);font-weight:600}tr.trigger td{background:var(--mark)}
</style></head><body>
<h1>${esc(title)}</h1>
${lead.map(l => `<p>${esc(l)}</p>`).join('\n')}
<p class="note">時刻は UTC（日本の時刻は +9 時間）。tpm が state に残した記録から作った。メッセージの本文が入るので、この Mac の外に写さない。色の付いた行は、件の引き金のメッセージ。</p>
<div class="scroll"><table>
<tr><th>時刻</th><th>記録</th><th>誰が</th><th>何を</th></tr>
${rows.join('\n')}
</table></div>
</body></html>
`;
}

/**
 * 件の番号か課題の Key を受け、時系列のページを置いて URL を返す。
 * 番号なら、引き金のメッセージ（無ければ件を書いた時刻）の前後 minutes 分を拾い、件に URL を結ぶ。Key なら、その Key の記録をみな拾う。
 */
export function incidentTimeline(ctx: Context, target: string, options: { minutes?: number } = {}): string[] {
  const minutes = options.minutes ?? DEFAULT_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new TpmError('--minutes は 1 以上の数にしてください');
  // 連携の道具が古いメッセージを捨てる前に、届いた時刻を写す。
  syncDeliveries(ctx);
  const n = /^#?([1-9]\d*)$/.exec(target)?.[1];
  let incident: Incident | undefined;
  let events: TimelineEvent[];
  let title: string;
  let lead: string[];
  let key = target;
  if (n === undefined) {
    events = collect(ctx, key);
    title = `${key} の時系列`;
    lead = [`${key} の記録をみな並べた（${events.length} 行）。`];
  }
  else {
    incident = requireIncident(ctx, Number(n));
    key = incident.key;
    const trigger = incident.msg === undefined ? undefined : ctx.state.lines<Sent>('log.jsonl').find(l => l.id === incident?.msg);
    const center = Date.parse(trigger?.at ?? incident.at);
    const window = { from: new Date(center - minutes * 60_000).toISOString(), to: new Date(center + minutes * 60_000).toISOString() };
    events = collect(ctx, key, window, incident.msg);
    title = `台帳 #${incident.n}（${key}）の時系列`;
    lead = [
      `件: ${incidentLine(incident)}`,
      `${trigger === undefined ? '件を書いた時刻' : '引き金のメッセージ'}（${hms(new Date(center).toISOString())}）の前後 ${minutes} 分の、${key} の記録（${events.length} 行）。`,
      ...(incident.msg !== undefined && trigger === undefined ? [`引き金のメッセージ（id ${incident.msg}）は log.jsonl に無かったので、件を書いた時刻を真ん中にした。`] : []),
    ];
  }
  if (events.length === 0) throw new TpmError(`${key} の記録がありません（Key を確かめる。記録は state の log.jsonl など）`);
  const { url } = putPage(ctx, { text: render(title, lead, events) }, 'timeline', key);
  if (incident !== undefined) writeIncident(ctx, { ...incident, timeline: url });
  return [`時系列を置いた（${events.length} 行）: ${url}`, ...(incident === undefined ? [] : [`件に結んだ: #${incident.n}`])];
}
