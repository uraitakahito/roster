// roster time <課題の Key>: 課題にかかった時間を、状態の移りの記録（waits.jsonl）から分けて出す。読むだけなので、どの担当も打てる。
// 「席を増やして縮んだか」「何を待っていたか」を、後から数で言うための物。出すのは 3 つ:
// - 席ごと: 状態の字（作業中・回答待ち(PM) など）ごとの時間。席の状態は、次に替えるまで続いたとして数える。
// - 課題（席を束ねて）: 始めから終わりまで・どれかの席が作業中だった時間・長い空き。
// - 長い空き: どの席の記録（状態の移り・送ったメッセージ・検査や guard が止めた回）も動かなかった間。
// 状態の字が「作業中」のまま止まっていた間（機械の止まり・利用の上限など）は、状態だけでは見えないので、長い空きで見る。
import type { Context } from '../context.ts';
import type { GateStop, GuardStop, WaitChange } from '../evidence.ts';
import { ROLES, WAIT, type RoleName, type WaitKind } from '../protocol.ts';
import { repoSeatKeys, staffKey } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';

/** 長い空きとみなす長さの既定（分）。 */
export const GAP_MINUTES = 60;

/** 状態の種類: WAIT の種類と、どれにも当たらない字（メッセージキューが応えません など）。 */
type Kind = WaitKind | 'other';

/** 種類の並びと、出す名。 */
const KINDS: [Kind, string][] = [['work', '作業中'], ['pm', 'PM 待ち'], ['tpm', 'TPM 待ち'], ['lead', 'Lead 待ち'], ['review', 'レビュー待ち'], ['other', 'ほか']];

/** 状態の字の頭（`作業中: ` など）から、種類を引く。 */
const PREFIXES = (Object.keys(WAIT) as WaitKind[]).map(kind => [kind, WAIT[kind]('')] as const);
const kindOf = (text: string): Kind => PREFIXES.find(([, prefix]) => text.startsWith(prefix))?.[0] ?? 'other';

/** 時刻の間（ミリ秒の組）。 */
interface Span {
  from: number
  to: number
}

const length = (spans: Span[]): number => spans.reduce((sum, s) => sum + (s.to - s.from), 0);

/** 重なる間をまとめる（どれかの席が作業中だった時間を、重ねて数えないため）。 */
function union(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last !== undefined && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** a のうち、b に重なる分の長さ（b は重なりの無い、時刻の順の間）。 */
const overlap = (a: Span[], b: Span[]): number => a.reduce((sum, s) => sum + b.reduce((n, g) => n + Math.max(0, Math.min(s.to, g.to) - Math.max(s.from, g.from)), 0), 0);

/** ミリ秒を「12.3 時間」にする。 */
const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)} 時間`;
/** 時刻（ミリ秒）を、ISO の分までにする（UTC）。 */
const stamp = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16)}Z`;

/** 席 1 つの、種類ごとの間。 */
interface SeatTime {
  key: string
  role: string
  spans: Record<Kind, Span[]>
}

/** 記録の行の時刻（読む欄だけ）。 */
interface Timed {
  at: string
}

/**
 * 課題の時間の分け。集める席は、課題の Key・その Staff Engineer 担当の席・Tech Lead 担当が起こした repo の席（とその Staff の席）。
 * 席の最後の状態は、課題の最後の記録の時刻まで続いたとして数える（閉じた時刻は、状態の記録に無い）。
 * gapMinutes は、長い空きとみなす長さ。
 */
export function time(ctx: Context, key: string, options: { gapMinutes?: number } = {}): string[] {
  const gapMinutes = options.gapMinutes ?? GAP_MINUTES;
  if (!Number.isFinite(gapMinutes) || gapMinutes <= 0) throw new TpmError('--gap は 0 より大きい数（分）にしてください');
  const keys = new Set([key, ...repoSeatKeys(ctx, key)].flatMap(k => [k, staffKey(k)]));
  const mine = (by: string | undefined): boolean => by !== undefined && keys.has(by);
  const waits = ctx.state.lines<WaitChange>('waits.jsonl').filter(l => mine(l.by)).sort((a, b) => a.at.localeCompare(b.at));
  if (waits.length === 0) return [`${key} の状態の記録がありません（waits.jsonl。roster wait・roster hello・送る命令が書く）`];
  // どの席の記録も動かなかった間を見るための、記録の時刻（状態の移り・送ったメッセージ・検査や guard が止めた回）。
  const others = [
    ...ctx.state.lines<Timed & { key?: string }>('log.jsonl').filter(l => mine(l.key)),
    ...ctx.state.lines<GateStop>('gate.jsonl').filter(l => mine(l.by)),
    ...ctx.state.lines<GuardStop>('guard.jsonl').filter(l => mine(l.by)),
  ];
  const marks = [...new Set([...waits, ...others].map(l => Date.parse(l.at)))].sort((a, b) => a - b);
  const start = marks[0] ?? 0;
  const end = marks.at(-1) ?? start;

  const seats = new Map<string, SeatTime>();
  const lastOf = new Map<string, WaitChange>();
  const close = (seat: SeatTime, change: WaitChange, to: number): void => {
    const from = Date.parse(change.at);
    if (to > from) seat.spans[kindOf(change.text)].push({ from, to });
  };
  for (const w of waits) {
    const seat = seats.get(w.by) ?? { key: w.by, role: w.role, spans: { work: [], pm: [], tpm: [], lead: [], review: [], other: [] } };
    seats.set(w.by, seat);
    const before = lastOf.get(w.by);
    if (before !== undefined) close(seat, before, Date.parse(w.at));
    lastOf.set(w.by, w);
  }
  for (const [by, last] of lastOf) {
    const seat = seats.get(by);
    if (seat !== undefined) close(seat, last, end);
  }

  const gapMs = gapMinutes * 60_000;
  const gaps: Span[] = marks.slice(1).flatMap((at, i) => at - (marks[i] ?? at) >= gapMs ? [{ from: marks[i] ?? at, to: at }] : []);
  const working = union([...seats.values()].flatMap(s => s.spans.work));
  // 空きの間の、席ごとの状態（空きの始まりに出ていた字の種類）。何を待って止まっていたかを見る。
  const kindName = new Map(KINDS);
  const stateAt = (ms: number): string => [...seats.keys()].flatMap((by) => {
    const last = waits.findLast(w => w.by === by && Date.parse(w.at) <= ms);
    return last === undefined ? [] : [`${by} ${kindName.get(kindOf(last.text)) ?? ''}`];
  }).join('・') || '無し';
  const label = (role: string): string => Object.hasOwn(ROLES, role) ? ROLES[role as RoleName].label : role;
  const row = (seat: SeatTime): string => `- ${seat.key}（${label(seat.role)}）  ${KINDS.filter(([kind]) => seat.spans[kind].length > 0).map(([kind, name]) => `${name} ${hours(length(seat.spans[kind]))}`).join('・')}`;
  return [
    `${key} の時間の分け（${stamp(start)} 〜 ${stamp(end)}。席 ${seats.size} つ）`,
    `始めから終わりまで: ${hours(end - start)}`,
    `どれかの席が作業中: ${hours(length(working))}（うち、長い空きに重なる分 ${hours(overlap(working, gaps))}。状態が作業中のまま、どの席の記録も動かなかった間）`,
    `長い空き（どの席の記録も ${gapMinutes} 分以上動かなかった間）: ${gaps.length} 回・合わせて ${hours(length(gaps))}`,
    ...gaps.map(g => `  ${stamp(g.from)} → ${stamp(g.to)}  ${hours(g.to - g.from)}（その間の状態: ${stateAt(g.from)}）`),
    '席ごと（状態は、次に替えるまで続いたとして数える。席を足すと、始めから終わりまでより長くなる）:',
    ...[...seats.values()].map(row),
  ];
}
