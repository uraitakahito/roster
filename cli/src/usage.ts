// 席（Claude Code の session）の「トークンの数と費え」を、session の記録（写し。JSONL）から数える、純な関数。
//
// castlist の数の表（PutUsage）へ送る行を作る。1 行は、席 1 つの、時計の 1 時間（UTC の時）の内の、同じ種類の回のまとめ。
// 「同じ種類」は、model・本体か手伝いか（手伝いならその種類）・速さの種類（speed）・service tier が同じ物。
//
// ここは file も castlist も触らない（読むのは渡された行の字だけ）。読んで送るのは、取り込みの側。
// 会話の字・命令の出力・path は読まない（使うのは、時刻・model・usage の数・応答の id・圧縮の印だけ）。

/** 文脈の長さの段の幅（トークン）。castlist の数の表の決まりと揃える。 */
export const BUCKET_WIDTH = 25_000;
/** いちばん上の段の番号（1,000,000 以上はみなここ）。 */
export const LAST_BUCKET = 40;

/** 回 1 つ（応答 1 つ）の数。写しの `assistant` の行の `message.usage` から読む。 */
export interface Turn {
  /** 応答の id（`message.id`）。同じ応答は、写しの中で何行にも分かれるので、これで 1 つにする。 */
  id: string
  /** 回の時刻（ISO。UTC）。 */
  at: string
  model: string
  /** 手伝い（subagent）の種類。本体の回なら無い。 */
  agent?: string
  speed: string
  serviceTier: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
}

/** 圧縮 1 回。写しの圧縮の印（`compact_boundary`）の欄をそのまま持つ（見立ては足さない）。 */
export interface Compaction {
  at: string
  /** 自動（`auto`）か、人が打った（`manual`）か。 */
  trigger?: string
  preTokens?: number
  postTokens?: number
}

/** 写しを読んだ結果。ids は、読んだ応答の id（出てきた順）。次の読みが、読みの切れ目をまたいだ同じ応答を除くのに使う。 */
export interface Reading {
  turns: Turn[]
  compactions: Compaction[]
  ids: string[]
}

/** 文脈の長さの段 1 つ（castlist の `buckets` の要素）。 */
export interface Bucket {
  bucket: number
  turns: number
  costMicroUsd: number
}

/** castlist の数の表の 1 行（送り手の id・アクター・送った時刻は、取り込みの側が付ける）。 */
export interface UsageRow {
  fromAt: string
  toAt: string
  model: string
  agent?: string
  speed: string
  serviceTier: string
  turns: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  costMicroUsd: number
  maxContext: number
  buckets: Bucket[]
}

/**
 * model 1 つの値段（100 万トークンあたりのドル）。from は、この値段が効き始める日（ISO の日付。UTC）。
 * longFrom を越える文脈の回は、どの数にも longTimes を掛ける（Haiku 5.5 の、長い文脈の割増）。
 */
export interface Price {
  /** model の名の頭（`claude-opus-5-5` など。日付の付いた名にも当たる）。 */
  model: string
  from: string
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
  longFrom?: number
  longTimes?: number
}

/**
 * 値段の表。値段が替わったら、前の行は消さずに、新しい from の行を足す（前の日の額が変わらないように）。
 * 入力と出力と cache の読みは、Anthropic の値段の表（2026-11 の時点）。cache の書きは、入力の 1.25 倍（5 分）と 2 倍（1 時間）。
 * 定額の契約で払う額ではなく、使った量を API の値段に直した目安。
 */
export const PRICES: readonly Price[] = [
  { model: 'claude-fable-5-2', from: '2026-01-01', input: 8, output: 40, cacheRead: 0.2, cacheWrite5m: 10, cacheWrite1h: 16 },
  { model: 'claude-opus-5-5', from: '2026-01-01', input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
  { model: 'claude-sonnet-5-5', from: '2026-01-01', input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  { model: 'claude-haiku-5-5', from: '2026-01-01', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2, longFrom: 100_000, longTimes: 5 },
];

/** その model の、その時刻に効いている値段。表に無い model は undefined（額は 0 で数え、トークンの数は残す）。 */
export function priceOf(model: string, at: string, prices: readonly Price[] = PRICES): Price | undefined {
  const day = at.slice(0, 10);
  return prices
    .filter(p => model.startsWith(p.model) && p.from <= day)
    .sort((a, b) => b.model.length - a.model.length || (a.from < b.from ? 1 : -1))[0];
}

/** 回の文脈の長さ（その回に model が読んだトークン）: 入力 + cache の読み + cache の書き。 */
export function contextOf(turn: Turn): number {
  return turn.inputTokens + turn.cacheReadTokens + turn.cacheWrite5mTokens + turn.cacheWrite1hTokens;
}

/** 回の額（100 万分の 1 ドルの整数）。回ごとに丸めるので、行の額は、回の額の和にぴったり合う。 */
export function costMicroUsd(turn: Turn, prices: readonly Price[] = PRICES): number {
  const p = priceOf(turn.model, turn.at, prices);
  if (p === undefined) return 0;
  const times = p.longFrom !== undefined && contextOf(turn) > p.longFrom ? p.longTimes ?? 1 : 1;
  // 値段は「100 万トークンあたりのドル」なので、トークン × 値段が、そのまま 100 万分の 1 ドル。
  return Math.round(times * (
    turn.inputTokens * p.input
    + turn.outputTokens * p.output
    + turn.cacheReadTokens * p.cacheRead
    + turn.cacheWrite5mTokens * p.cacheWrite5m
    + turn.cacheWrite1hTokens * p.cacheWrite1h
  ));
}

/** 文脈の長さの段の番号（0〜{@link LAST_BUCKET}）。 */
export function bucketOf(context: number): number {
  return Math.min(LAST_BUCKET, Math.floor(context / BUCKET_WIDTH));
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function word(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/**
 * 写しの行（JSONL の 1 行ずつ）から、回と圧縮を読む。
 * - 回は `type` が `assistant` で、`message.model` が `claude-` で始まり、`message.id` と `message.usage` の在る行（Claude Code が自分で足す `<synthetic>` の行は数えない）。
 * - 同じ応答（同じ `message.id`）は、間に別の行を挟んで何行にも分かれる。どの行の usage も同じ値なので、初めの 1 行だけを数える。
 * - skip は、前の読みで数えた応答の id。読みを 2 回に分けた時に、切れ目をまたいだ応答を 2 度数えないため。
 * - 本体の写しでは、行の `sessionId` が sessionId と違う行（resume・fork で、ほかの session から写された行）は数えない。手伝いの写し（agent を渡した時）では見ない。
 * - JSON でない行・形の違う行は飛ばす（写しの形は Claude Code の版で変わる）。
 */
export function readTurns(lines: Iterable<string>, options: { sessionId?: string, agent?: string, skip?: ReadonlySet<string> } = {}): Reading {
  const seen = new Set<string>(options.skip ?? []);
  const reading: Reading = { turns: [], compactions: [], ids: [] };
  for (const line of lines) {
    if (line.trim() === '') continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    }
    catch {
      continue;
    }
    if (entry === null || typeof entry !== 'object') continue;
    const at = entry.timestamp;
    if (typeof at !== 'string') continue;
    if (options.agent === undefined && options.sessionId !== undefined && typeof entry.sessionId === 'string' && entry.sessionId !== options.sessionId) continue;
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      const meta = (entry.compactMetadata ?? {}) as Record<string, unknown>;
      reading.compactions.push({
        at,
        ...(typeof meta.trigger === 'string' ? { trigger: meta.trigger } : {}),
        ...(typeof meta.preTokens === 'number' ? { preTokens: meta.preTokens } : {}),
        ...(typeof meta.postTokens === 'number' ? { postTokens: meta.postTokens } : {}),
      });
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const message = (entry.message ?? {}) as Record<string, unknown>;
    const { id, model, usage } = message;
    if (typeof id !== 'string' || typeof model !== 'string' || !model.startsWith('claude-') || usage === null || typeof usage !== 'object') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    reading.ids.push(id);
    const u = usage as Record<string, unknown>;
    const split = (u.cache_creation ?? {}) as Record<string, unknown>;
    const written = count(u.cache_creation_input_tokens);
    // 書きの分けが無い（古い形の）行は、みな 5 分の書きとして数える。分けの和が合わない時も、1 時間の分を信じて残りを 5 分に。
    const hour = Math.min(written, count(split.ephemeral_1h_input_tokens));
    reading.turns.push({
      id,
      at,
      model,
      ...(options.agent === undefined ? {} : { agent: options.agent }),
      speed: word(u.speed, 'standard'),
      serviceTier: word(u.service_tier, 'standard'),
      inputTokens: count(u.input_tokens),
      outputTokens: count(u.output_tokens),
      cacheReadTokens: count(u.cache_read_input_tokens),
      cacheWrite5mTokens: written - hour,
      cacheWrite1hTokens: hour,
    });
  }
  return reading;
}

/**
 * 回を、castlist の数の行にまとめる: 時計の 1 時間（UTC の時）と種類（model・手伝いの種類・speed・service tier）ごとに 1 行。
 * 行は、時 → 種類の順（同じ入力なら、いつも同じ並び。送り直しの時に、同じ id に同じ本文を当てるため）。
 */
export function toRows(turns: readonly Turn[], prices: readonly Price[] = PRICES): UsageRow[] {
  const groups = new Map<string, { row: UsageRow, buckets: Map<number, Bucket> }>();
  for (const turn of turns) {
    const at = new Date(turn.at).toISOString();
    const key = [at.slice(0, 13), turn.model, turn.agent ?? '', turn.speed, turn.serviceTier].join('\u0000');
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        row: {
          fromAt: at,
          toAt: at,
          model: turn.model,
          ...(turn.agent === undefined ? {} : { agent: turn.agent }),
          speed: turn.speed,
          serviceTier: turn.serviceTier,
          turns: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          costMicroUsd: 0,
          maxContext: 0,
          buckets: [],
        },
        buckets: new Map(),
      };
      groups.set(key, group);
    }
    const { row } = group;
    const cost = costMicroUsd(turn, prices);
    const context = contextOf(turn);
    if (at < row.fromAt) row.fromAt = at;
    if (at > row.toAt) row.toAt = at;
    row.turns += 1;
    row.inputTokens += turn.inputTokens;
    row.outputTokens += turn.outputTokens;
    row.cacheReadTokens += turn.cacheReadTokens;
    row.cacheWrite5mTokens += turn.cacheWrite5mTokens;
    row.cacheWrite1hTokens += turn.cacheWrite1hTokens;
    row.costMicroUsd += cost;
    row.maxContext = Math.max(row.maxContext, context);
    const n = bucketOf(context);
    const bucket = group.buckets.get(n) ?? { bucket: n, turns: 0, costMicroUsd: 0 };
    bucket.turns += 1;
    bucket.costMicroUsd += cost;
    group.buckets.set(n, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, { row, buckets }]) => ({ ...row, buckets: [...buckets.values()].sort((a, b) => a.bucket - b.bucket) }));
}

/**
 * 同じ席の行を足し合わせる時の決まり（castlist の数の表を読む側の決まり）: 数は足し、いちばん長い値は大きい方を取り、段は番号ごとに足す。
 * 区間は、いちばん早い始めと、いちばん遅い終わり。種類（model など）は見ない（呼ぶ側が、足したい行だけを渡す）。行が無ければ undefined。
 */
export function sumRows(rows: readonly UsageRow[]): Omit<UsageRow, 'model' | 'agent' | 'speed' | 'serviceTier'> | undefined {
  const [first] = rows;
  if (first === undefined) return undefined;
  const buckets = new Map<number, Bucket>();
  const total = {
    fromAt: first.fromAt,
    toAt: first.toAt,
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    costMicroUsd: 0,
    maxContext: 0,
  };
  for (const row of rows) {
    if (row.fromAt < total.fromAt) total.fromAt = row.fromAt;
    if (row.toAt > total.toAt) total.toAt = row.toAt;
    total.turns += row.turns;
    total.inputTokens += row.inputTokens;
    total.outputTokens += row.outputTokens;
    total.cacheReadTokens += row.cacheReadTokens;
    total.cacheWrite5mTokens += row.cacheWrite5mTokens;
    total.cacheWrite1hTokens += row.cacheWrite1hTokens;
    total.costMicroUsd += row.costMicroUsd;
    total.maxContext = Math.max(total.maxContext, row.maxContext);
    for (const b of row.buckets) {
      const sum = buckets.get(b.bucket) ?? { bucket: b.bucket, turns: 0, costMicroUsd: 0 };
      sum.turns += b.turns;
      sum.costMicroUsd += b.costMicroUsd;
      buckets.set(b.bucket, sum);
    }
  }
  return { ...total, buckets: [...buckets.values()].sort((a, b) => a.bucket - b.bucket) };
}
