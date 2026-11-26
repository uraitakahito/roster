// roster time <課題の Key>: 課題にかかった時間を、状態の移りの記録（waits.jsonl）から分けて出す。読むだけなので、どの担当も打てる。
// 「席を増やして縮んだか」「何を待っていたか」を、後から数で言うための物。出すのは 3 つ:
// - 席ごと: 状態の字の種類（作業中・PM 待ち など）ごとの時間。席の状態は、次に替えるまで続いたとして数える。
// - 課題（席を束ねて）: 始めから終わりまで・どれかの席が作業中だった時間・長い空き。
// - 長い空き: どの席の記録（状態の移り・送ったメッセージ・検査や guard が止めた回）も動かなかった間。
// 状態の字が「作業中」のまま止まっていた間（機械の止まり・利用の上限など）は、状態だけでは見えないので、長い空きで見る。
// 状態の移りは、roster hello・roster wait・送る命令・メッセージキューの止まりが書く（commands/messages.ts の showWait）。
import type { Context } from '../context.ts';
import type { GateStop, GuardStop, WaitChange } from '../evidence.ts';
import { ROLES, WAIT, type RoleName, type WaitKind } from '../protocol.ts';
import { repoSeatKeys, staffKey } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';

/** 長い空きとみなす長さの既定（分）。 */
export const GAP_MINUTES = 60;

/** 作業中の種類の名（どれかの席が作業中だった時間に数える）。 */
const WORK = '作業中';
/** Staff Engineer 担当の席が、次の頼みを待つ間の名（課題の担当が判定を待つ「レビュー待ち」と分ける）。 */
const NEXT_ASK = '次の頼み待ち';
/** 状態の種類（WAIT の字の頭）と、出す名。 */
const NAMES: Record<WaitKind, string> = { work: WORK, pm: 'PM 待ち', tpm: 'TPM 待ち', lead: 'Lead 待ち', review: 'レビュー待ち' };
/** 名を出す順（決まった名。ほかの名は、出てきた順に後ろへ）。 */
const ORDER = [...Object.values(NAMES), NEXT_ASK];
const PREFIXES = (Object.keys(WAIT) as WaitKind[]).map(kind => [kind, WAIT[kind]('')] as const);

/**
 * 状態の字から、種類の名を引く。決まった頭（`作業中: ` など）はその名。Staff Engineer 担当の席の `回答待ち(レビュー)` は、次の頼み待ち。
 * どれにも当たらない字（メッセージキューが応えません・後から足された状態の字）は、`:` の前の字をそのまま名にする
 * （新しい状態の字が足されても、命令を変えずに、その名で数えられる）。
 */
function nameOf(text: string, role: string): string {
  const kind = PREFIXES.find(([, prefix]) => text.startsWith(prefix))?.[0];
  if (kind === undefined) return text.split(/[:：]/)[0]?.trim() || 'ほか';
  return kind === 'review' && role === 'staff-engineer' ? NEXT_ASK : NAMES[kind];
}

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

/** 席 1 つの、種類の名ごとの間。 */
interface SeatTime {
  key: string
  role: string
  spans: Map<string, Span[]>
  /** 片付けの終わり（【end】）を送った時刻。送っていなければ無い。 */
  endedAt?: number
}

/** 送った記録の行（読む欄だけ）。 */
interface SentLine {
  at: string
  key?: string
  heading?: string
  sender?: { key: string }
}

/** 課題の最後の記録（時刻と、何の記録か）。 */
interface Mark {
  at: number
  what: string
}

/**
 * 課題の時間の分け。集める席は、課題の Key・その Staff Engineer 担当の席・Tech Lead 担当が起こした repo の席（とその Staff の席）。
 * 席の最後の状態は、その席が片付けの終わり（【end】）を送っていればその時刻まで、いなければ課題の最後の記録の時刻まで続いたとして数える。
 * gapMinutes は、長い空きとみなす長さ。
 */
export function time(ctx: Context, key: string, options: { gapMinutes?: number } = {}): string[] {
  const gapMinutes = options.gapMinutes ?? GAP_MINUTES;
  if (!Number.isFinite(gapMinutes) || gapMinutes <= 0) throw new TpmError('--gap は 0 より大きい数（分）にしてください');
  const keys = new Set([key, ...repoSeatKeys(ctx, key)].flatMap(k => [k, staffKey(k)]));
  const mine = (by: string | undefined): boolean => by !== undefined && keys.has(by);
  const waits = ctx.state.lines<WaitChange>('waits.jsonl').filter(l => mine(l.by)).sort((a, b) => a.at.localeCompare(b.at));
  if (waits.length === 0) return [`${key} の状態の記録がありません（waits.jsonl。roster hello・roster wait・送る命令が書く）`];
  // どの席の記録も動かなかった間を見るための、記録の時刻（状態の移り・送ったメッセージ・検査や guard が止めた回）。
  const sent = ctx.state.lines<SentLine>('log.jsonl').filter(l => mine(l.key));
  const marks: Mark[] = [
    ...waits.map(l => ({ at: Date.parse(l.at), what: `状態の移り（${l.by}）` })),
    ...sent.map(l => ({ at: Date.parse(l.at), what: `メッセージ【${l.heading ?? ''}】（${l.key ?? ''}）` })),
    ...ctx.state.lines<GateStop>('gate.jsonl').filter(l => mine(l.by)).map(l => ({ at: Date.parse(l.at), what: `送る前の検査（${l.by}）` })),
    ...ctx.state.lines<GuardStop>('guard.jsonl').filter(l => mine(l.by)).map(l => ({ at: Date.parse(l.at), what: `guard（${l.by}）` })),
  ].sort((a, b) => a.at - b.at);
  const times = [...new Set(marks.map(m => m.at))];
  const start = times[0] ?? 0;
  const last = marks.at(-1);
  const end = last?.at ?? start;

  const seats = new Map<string, SeatTime>();
  const lastOf = new Map<string, WaitChange>();
  const close = (seat: SeatTime, change: WaitChange, to: number): void => {
    const from = Date.parse(change.at);
    if (to <= from) return;
    const name = nameOf(change.text, seat.role);
    seat.spans.set(name, [...seat.spans.get(name) ?? [], { from, to }]);
  };
  for (const w of waits) {
    const seat = seats.get(w.by) ?? { key: w.by, role: w.role, spans: new Map<string, Span[]>() };
    seats.set(w.by, seat);
    const before = lastOf.get(w.by);
    if (before !== undefined) close(seat, before, Date.parse(w.at));
    lastOf.set(w.by, w);
  }
  for (const [by, change] of lastOf) {
    const seat = seats.get(by);
    if (seat === undefined) continue;
    // 片付けの終わり（【end】）を送った席は、そこで終える（その後の「workspace を閉じる」の待ちを、課題の終わりまで数えない）。
    const ended = sent.findLast(l => l.heading === 'end' && l.key === by && (l.sender === undefined || l.sender.key === by));
    if (ended !== undefined) seat.endedAt = Date.parse(ended.at);
    close(seat, change, Math.max(Date.parse(change.at), seat.endedAt ?? end));
  }

  const gapMs = gapMinutes * 60_000;
  const gaps: Span[] = times.slice(1).flatMap((at, i) => at - (times[i] ?? at) >= gapMs ? [{ from: times[i] ?? at, to: at }] : []);
  const working = union([...seats.values()].flatMap(s => s.spans.get(WORK) ?? []));
  // 空きの間の、席ごとの状態（空きの始まりに出ていた字の種類）。何を待って止まっていたかを見る。片付けを終えた席は出さない。
  const stateAt = (ms: number): string => [...seats.values()].flatMap((seat) => {
    if (seat.endedAt !== undefined && seat.endedAt <= ms) return [];
    const change = waits.findLast(w => w.by === seat.key && Date.parse(w.at) <= ms);
    return change === undefined ? [] : [`${seat.key} ${nameOf(change.text, seat.role)}`];
  }).join('・') || '無し';
  const label = (role: string): string => Object.hasOwn(ROLES, role) ? ROLES[role as RoleName].label : role;
  const named = (seat: SeatTime): string[] => [...ORDER.filter(n => seat.spans.has(n)), ...[...seat.spans.keys()].filter(n => !ORDER.includes(n))];
  const row = (seat: SeatTime): string => `- ${seat.key}（${label(seat.role)}）  ${named(seat).map(name => `${name} ${hours(length(seat.spans.get(name) ?? []))}`).join('・')}`;
  return [
    `${key} の時間の分け（${stamp(start)} 〜 ${stamp(end)}。席 ${seats.size} つ。最後の記録: ${last?.what ?? '無し'}）`,
    `始めから終わりまで: ${hours(end - start)}`,
    `どれかの席が作業中: ${hours(length(working))}（うち、長い空きに重なる分 ${hours(overlap(working, gaps))}。状態が作業中のまま、どの席の記録も動かなかった間）`,
    `長い空き（どの席の記録も ${gapMinutes} 分以上動かなかった間）: ${gaps.length} 回・合わせて ${hours(length(gaps))}`,
    ...gaps.map(g => `  ${stamp(g.from)} → ${stamp(g.to)}  ${hours(g.to - g.from)}（その間の状態: ${stateAt(g.from)}）`),
    '席ごと（状態は、次に替えるまで続いたとして数える。席を足すと、始めから終わりまでより長くなる）:',
    ...[...seats.values()].map(row),
  ];
}
