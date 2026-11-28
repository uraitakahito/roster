// roster incident timeline <番号|Key>: 件の前後に起きたことを、state の記録から時刻の順に 1 枚のページにして置く。
// TPM 担当は読まずに、監査の依頼書に URL を貼る（原因を調べるのは担当）。メッセージの本文が入るので、roster を動かす機械の外に写さない。
// castlist を設定していれば、行ごとに、その時刻にその席に居たアクターを castlist に聞いて欄に出す（聞けなければ、そう書いてページは置く）。
import { callboardUrl, castlistUrl } from '../castlist.ts';
import type { Context } from '../context.ts';
import type { GateStop, GuardStop, WaitChange } from '../evidence.ts';
import { incidentLine, readIncidents, requireIncident, writeIncident, type Incident } from '../incidents.ts';
import { HEADINGS, type HeadingId } from '../protocol.ts';
import { isStaffKey, repoSeatKeys, staffKey, subjectOfStaffKey } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import type { TrackerWrite } from '../tracker/recorded.ts';
import { returnedIds, seenTimes, type Seen } from '../seen.ts';
import { profileUrl, seatActorsAt } from './castlist-read.ts';
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
  /** 前の版の行だけ（送った後 2 秒の内に届いたのを見たか）。 */
  delivered?: boolean
  replyTo?: string
  /** 担当から担当へじかに送った行（レビューの頼みと判定）。 */
  peer?: true
  /** 送った担当（TPM 担当は tpm）。前の版の行には無い。 */
  sender?: { key: string }
  /** 届く担当。前の版の行には無い。 */
  recipient?: { key: string }
  /** 席を起こす時の依頼書で渡した頼みの行（メッセージとしては送っていない）。 */
  launch?: true
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
  /** その行の手の席（担当は課題の Key、TPM 担当は tpm）。castlist のアクターを引く。分からない行は undefined。 */
  seat?: string
}

const hms = (iso: string): string => iso.slice(11, 19);
const seconds = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 1000);
const cut = (text: string): string => text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…（続きは log.jsonl）` : text;
/** 見た時刻の欄。配った時刻は「届いた」、見せた時刻は「見た」と書き分ける。 */
function seenNote(m: Sent, seen: Seen | undefined, returned: Set<string>): string {
  if (returned.has(m.id)) return '届け違いで返した（宛先の担当は見ていない。roster returned show）';
  if (m.launch === true) return '席を起こす時の依頼書で渡した頼み（メッセージとしては送っていない）';
  // 後ろ半分は、前の版の行が送った時に「まだ届いていない」と書いた時だけ（今の版の行は、送る時に見ない）。
  if (seen === undefined) return `届いた時刻: 分からない${m.delivered === false ? '（送った時は、まだ届いていない）' : ''}`;
  if (seen.by === 'legacy') return '送った時に届いた';
  if (seen.by === 'shown') return `見た: ${hms(seen.at)}（${seconds(m.at, seen.at)} 秒後。届く前に roster が見せた）`;
  return `届いた: ${hms(seen.at)}（${seconds(m.at, seen.at)} 秒後）`;
}

/** 見出しの向き（担当から・TPM 担当から）。知らない見出しは undefined。 */
const direction = (heading: string): 'role' | 'tpm' | undefined => Object.hasOwn(HEADINGS, heading) ? HEADINGS[heading as HeadingId].from : undefined;

/** じかのやりとりの相手の Key（課題の担当 ⇄ その課題の Staff Engineer 担当の席）。 */
const counterpart = (key: string): string => isStaffKey(key) ? subjectOfStaffKey(key) : staffKey(key);

/**
 * Key の記録を集めて、時刻の順の行にする。window（from・to の ISO）があれば、その間だけ。
 * メッセージには届いた時刻を添え、届く前に相手が送ったメッセージがあれば「行き違い」の印を付ける。
 */
export function collect(ctx: Context, key: string, window?: { from: string, to: string }, triggerId?: string): TimelineEvent[] {
  // 見た時刻は口から引く（送る前の検査と同じ決め方。時刻が無ければ、送った時刻に倒さず「分からない」にする）。
  const seenAt = seenTimes(ctx, { live: false });
  const returned = returnedIds(ctx);
  // 課題の Key で集めると、その課題の Staff Engineer 担当の席（名簿の Key は <課題の Key>.staff）と、Tech Lead 担当が起こした
  // repo の席（<課題の Key>.<名>。その席の Staff の席も）の行も入る。repo の席は、起こした時の控えで見分ける（閉じた席は名簿に無い。
  // Key の頭では見ない: 点を含む別の課題の Key（web と web.app）を混ぜない）。
  const keys = new Set([key, ...repoSeatKeys(ctx, key)].flatMap(k => [k, staffKey(k)]));
  const mine = (k: string | undefined): boolean => k !== undefined && keys.has(k);
  const messages = ctx.state.lines<Sent>('log.jsonl').filter(l => mine(l.key));
  const events: TimelineEvent[] = messages.map((m) => {
    const seen = seenAt(m);
    const arrived = seen?.at;
    const notes = [
      seenNote(m, seen, returned),
      ...(m.replyTo === undefined ? [] : [`返事の先: ${m.replyTo}`]),
    ];
    // 行き違い: これが届く（見せた時刻の方が早ければ、見る）前に、相手が送ったメッセージ。相手は、送り手と受け手の組で見る。じかの物は、記録の行の印（peer）で見分ける
    // （見出しでは見ない。前の版の【ask-review】【review】は TPM 担当との間の物で、今までどおり「同じ Key で向きが逆」で数える）。
    // 担当と TPM 担当の間の物は、同じ Key で向きが逆の物。じかの物（レビューの頼みと判定）は、課題の担当と、その Staff Engineer 担当の席の間の、逆向きのじかの物。
    // じかの物を「同じ Key で向きが逆」で数えると、課題の担当が続けて TPM 担当へ送った物や、TPM 担当からの【notify】まで相手の物に数えてしまう。
    if (arrived !== undefined) {
      // じかの物の相手は、送り手と受け手の担当の組で見る（repo の席 ⇄ Tech Lead 担当のレビューも、課題の担当 ⇄ Staff の席も）。
      // 組の欄の無い前の版の行は、Key の形（<Key> ⇄ <Key>.staff）で見る。
      const back = (o: Sent): boolean => m.sender !== undefined && m.recipient !== undefined && o.sender !== undefined && o.recipient !== undefined
        ? o.sender.key === m.recipient.key && o.recipient.key === m.sender.key
        : o.key === counterpart(m.key);
      const reply = (o: Sent): boolean => m.peer === true
        ? o.peer === true && back(o)
        : o.peer !== true && o.key === m.key && direction(o.heading) !== undefined && direction(o.heading) !== direction(m.heading);
      const crossed = messages.filter(o => reply(o) && o.at > m.at && o.at < arrived);
      if (crossed.length > 0) notes.push(`行き違い: これ${seen?.by === 'shown' ? 'を見る' : 'が届く'}前に、相手が ${crossed.length} 件送った（${crossed.map(o => `【${o.heading}】${hms(o.at)}`).join('・')}）`);
    }
    // 列は、送った担当で決める（Tech Lead 担当が repo の席へ送った【brief】【dismiss】を、TPM 担当の列に入れない）。
    // 送り手の欄の無い前の版の行は、見出しの向きで決める（担当からなら行の Key、TPM 担当からなら TPM 担当の列）。
    const from = direction(m.heading);
    const seat = m.sender?.key ?? (from === 'role' ? m.key : from === 'tpm' ? 'tpm' : undefined);
    return { at: m.at, kind: 'メッセージ', who: m.from, what: `${cut(m.text)}（id ${m.id}）`, notes, ...(m.id === triggerId ? { trigger: true } : {}), ...(seat === undefined ? {} : { seat }) };
  });
  for (const w of ctx.state.lines<TrackerWrite>('tracker.jsonl').filter(l => l.issue === key || mine(l.by))) {
    events.push({ at: w.at, kind: '課題管理', who: w.by, what: `${w.issue} に${w.op === 'close' ? '「済み」' : `コメント【${w.kind ?? ''}】`}${w.ok ? '' : `（失敗: ${w.error ?? ''}）`}`, notes: [], seat: w.by });
  }
  for (const g of ctx.state.lines<GuardStop>('guard.jsonl').filter(l => mine(l.by))) {
    events.push({ at: g.at, kind: 'guard', who: g.by, what: `止めた: ${g.command}`, notes: [g.reason], seat: g.by });
  }
  for (const g of ctx.state.lines<GateStop>('gate.jsonl').filter(l => mine(l.by))) {
    events.push({ at: g.at, kind: '入口の検査', who: g.by, what: `送るのを止めた（${g.gate}）`, notes: [g.detail], seat: g.by });
  }
  for (const w of ctx.state.lines<WaitChange>('waits.jsonl').filter(l => mine(l.by))) {
    events.push({ at: w.at, kind: 'wait', who: w.by, what: w.text, notes: [], seat: w.by });
  }
  for (const r of ctx.state.lines<InfraRun>('infra.jsonl').filter(l => l.key === key)) {
    events.push({ at: r.at, kind: 'infra', who: key, what: `${r.env}: ${r.command.join(' ')}`, notes: [`exit ${r.status}`], seat: key });
  }
  for (const i of readIncidents(ctx).filter(i => mine(i.key))) {
    events.push({ at: i.at, kind: '台帳', who: i.by, what: incidentLine(i), notes: [], seat: i.by });
  }
  return events
    .filter(e => window === undefined || (e.at >= window.from && e.at <= window.to))
    .sort((a, b) => a.at.localeCompare(b.at));
}

const esc = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * 行ごとのアクターの欄（HTML）。席の分かる行は、その時刻にその席に居た castlist のアクターを、プロフィールの画面への link で出す。
 * castlist が止まっていれば、その後の行には聞かずに「castlist に聞けない」と書く（ページは置く）。聞けなかった訳は、初めの 1 つを返す。
 */
async function actorCells(ctx: Context, url: string, events: TimelineEvent[]): Promise<{ cells: string[], failed?: string }> {
  const asked = new Map<string, string>();
  let down = false;
  let failed: string | undefined;
  const cells: string[] = [];
  for (const e of events) {
    if (e.seat === undefined) {
      cells.push('-');
      continue;
    }
    if (down) {
      cells.push('castlist に聞けない');
      continue;
    }
    const key = `${e.seat} ${e.at}`;
    const had = asked.get(key);
    if (had !== undefined) {
      cells.push(had);
      continue;
    }
    const answer = await seatActorsAt(ctx, url, e.seat, e.at);
    let cell: string;
    if (answer.kind === 'failed') {
      failed ??= answer.reason;
      down = answer.down;
      cell = esc(answer.down ? 'castlist に聞けない' : `castlist に聞けない（${answer.reason}）`);
    }
    else {
      cell = answer.body.actors.length === 0 ? 'castlist に無い' : answer.body.actors.map(a => `<a href="${esc(profileUrl(callboardUrl(ctx), a.id))}">${esc(a.name)}</a>`).join('・');
    }
    asked.set(key, cell);
    cells.push(cell);
  }
  return failed === undefined ? { cells } : { cells, failed };
}

/** 時系列のページの HTML。actors は行ごとのアクターの欄（HTML。castlist を設定していなければ無く、欄も出さない）。 */
export function render(title: string, lead: string[], events: TimelineEvent[], actors?: string[]): string {
  const rows = events.map((e, i) => `<tr${e.trigger === true ? ' class="trigger"' : ''}><td class="t">${esc(e.at.slice(0, 10))}<br>${esc(hms(e.at))}</td><td>${esc(e.kind)}</td><td>${esc(e.who)}</td>${actors === undefined ? '' : `<td>${actors[i] ?? '-'}</td>`}<td>${esc(e.what)}${e.notes.map(n => `<br><span class="${n.startsWith('行き違い') ? 'cross' : 'note'}">${esc(n)}</span>`).join('')}</td></tr>`);
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
<p class="note">時刻は UTC（日本の時刻は +9 時間）。roster が state に残した記録から作った。メッセージの本文が入るので、roster を動かす機械の外に写さない。色の付いた行は、件の引き金のメッセージ。</p>
<div class="scroll"><table>
<tr><th>時刻</th><th>記録</th><th>誰が</th>${actors === undefined ? '' : '<th>アクター</th>'}<th>何を</th></tr>
${rows.join('\n')}
</table></div>
</body></html>
`;
}

/**
 * 件の番号か課題の Key を受け、時系列のページを置いて URL を返す。
 * 番号なら、引き金のメッセージの前後 minutes 分を拾い、件に URL を結ぶ。引き金が無い件は、出来事がいつかが分からない
 * （件は、出来事のしばらく後に書かれることが多い）ので、その Key の初めから、件を書いた minutes 分後までを拾う。
 * Key なら、その Key の記録をみな拾う。
 */
export async function incidentTimeline(ctx: Context, target: string, options: { minutes?: number } = {}): Promise<string[]> {
  const minutes = options.minutes ?? DEFAULT_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new TpmError('--minutes は 1 以上の数にしてください');
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
    const window = { from: trigger === undefined ? '' : new Date(center - minutes * 60_000).toISOString(), to: new Date(center + minutes * 60_000).toISOString() };
    events = collect(ctx, key, window, incident.msg);
    title = `台帳 #${incident.n}（${key}）の時系列`;
    lead = [
      `件: ${incidentLine(incident)}`,
      trigger === undefined
        ? `引き金のメッセージが${incident.msg === undefined ? '書かれていない' : `（id ${incident.msg}）log.jsonl に無い`}ので、${key} の初めから、件を書いた時刻（${hms(incident.at)}）の ${minutes} 分後までの記録を並べた（${events.length} 行）。`
        : `引き金のメッセージ（${hms(trigger.at)}）の前後 ${minutes} 分の、${key} の記録（${events.length} 行）。`,
    ];
  }
  if (events.length === 0) throw new TpmError(`${key} の記録がありません（Key を確かめる。記録は state の log.jsonl など）`);
  const castlist = castlistUrl(ctx);
  const actors = castlist === undefined ? undefined : await actorCells(ctx, castlist, events);
  if (castlist !== undefined) {
    const failed = actors?.failed === undefined ? '' : `聞けなかった行がある: ${actors.failed}`;
    lead.push(`アクターの欄は、castlist（${castlist}）に、その時刻にその席（担当は課題の Key、TPM 担当は tpm）に居たアクターを聞いた答え（名は、画面のサーバー callboard のプロフィールの画面への link）。${failed}`);
  }
  const { url } = await putPage(ctx, { text: render(title, lead, events, actors?.cells) }, 'timeline', key);
  if (incident !== undefined) writeIncident(ctx, { ...incident, timeline: url });
  return [`時系列を置いた（${events.length} 行）: ${url}`, ...(incident === undefined ? [] : [`件に結んだ: #${incident.n}`])];
}
