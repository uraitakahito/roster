import { describe, expect, test } from 'vitest';
import { BUCKET_WIDTH, LAST_BUCKET, bucketOf, contextOf, costMicroUsd, priceOf, readTurns, sumRows, toRows, unpricedModels, type Price, type Turn } from '../src/usage.ts';

/** 写しの assistant の行（見本）。usage は、要る欄だけ上書きする。 */
function line(id: string, at: string, usage: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: at,
    sessionId: 's-1',
    message: {
      id,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, speed: 'standard', service_tier: 'standard', ...usage },
    },
    ...extra,
  });
}

function turn(over: Partial<Turn> = {}): Turn {
  return {
    id: 'm',
    at: '2026-11-27T01:10:00.000Z',
    model: 'claude-opus-5-5',
    speed: 'standard',
    serviceTier: 'standard',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    ...over,
  };
}

describe('readTurns: 写しから回を読む', () => {
  test('usage の数と、cache の書きの 5 分と 1 時間の分けを読む', () => {
    const { turns } = readTurns([line('m1', '2026-11-27T01:00:00.000Z', {
      input_tokens: 3,
      output_tokens: 5,
      cache_read_input_tokens: 7,
      cache_creation_input_tokens: 110,
      cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 100 },
    })]);
    expect(turns).toEqual([turn({
      id: 'm1',
      at: '2026-11-27T01:00:00.000Z',
      inputTokens: 3,
      outputTokens: 5,
      cacheReadTokens: 7,
      cacheWrite5mTokens: 10,
      cacheWrite1hTokens: 100,
    })]);
  });

  test('書きの分けが無い行は、みな 5 分の書きに数える', () => {
    const { turns } = readTurns([line('m1', '2026-11-27T01:00:00.000Z', { cache_creation_input_tokens: 50 })]);
    expect(turns[0]).toMatchObject({ cacheWrite5mTokens: 50, cacheWrite1hTokens: 0 });
  });

  test('同じ応答が、別の行を挟んで何行にも分かれても、1 度だけ数える', () => {
    const { turns, ids } = readTurns([
      line('m1', '2026-11-27T01:00:00.000Z'),
      JSON.stringify({ type: 'user', timestamp: '2026-11-27T01:00:01.000Z', message: { content: 'x' } }),
      line('m1', '2026-11-27T01:00:02.000Z'),
      line('m2', '2026-11-27T01:00:03.000Z'),
    ]);
    expect(turns.map(t => t.id)).toEqual(['m1', 'm2']);
    expect(ids).toEqual(['m1', 'm2']);
  });

  test('読みを間で切って 2 回で読んでも、前の回の id を渡せば 2 度数えない', () => {
    const all = [
      line('m1', '2026-11-27T01:00:00.000Z'),
      line('m2', '2026-11-27T01:00:01.000Z'),
      JSON.stringify({ type: 'user', timestamp: '2026-11-27T01:00:02.000Z' }),
      line('m2', '2026-11-27T01:00:03.000Z'),
      line('m3', '2026-11-27T01:00:04.000Z'),
    ];
    const first = readTurns(all.slice(0, 3));
    const second = readTurns(all.slice(3), { skip: new Set(first.ids) });
    expect([...first.turns, ...second.turns].map(t => t.id)).toEqual(readTurns(all).turns.map(t => t.id));
    expect(second.turns.map(t => t.id)).toEqual(['m3']);
  });

  test('Claude Code が自分で足す行・usage の無い行・JSON でない行・時刻の無い行は数えない', () => {
    const { turns } = readTurns([
      JSON.stringify({ type: 'assistant', timestamp: '2026-11-27T01:00:00.000Z', message: { id: 'x', model: '<synthetic>', usage: {} } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-11-27T01:00:00.000Z', message: { id: 'y', model: 'claude-opus-5-5' } }),
      JSON.stringify({ type: 'assistant', message: { id: 'z', model: 'claude-opus-5-5', usage: {} } }),
      '{ 壊れた行',
      '',
      'null',
    ]);
    expect(turns).toEqual([]);
  });

  test('同じ席のほかの写しで数えた応答（resume・fork の写し）は、id を渡せば、行の形に依らずに除ける', () => {
    const old = readTurns([line('m1', '2026-11-26T01:00:00.000Z'), line('m2', '2026-11-26T01:10:00.000Z')]);
    // 写された行の session の id が、元のままでも、新しい id に書き替わっていても、同じ。
    const copied = [
      line('m1', '2026-11-26T01:00:00.000Z', {}, { sessionId: 's-0' }),
      line('m2', '2026-11-26T01:10:00.000Z', {}, { sessionId: 's-2' }),
      line('m3', '2026-11-27T01:00:00.000Z', {}, { sessionId: 's-2' }),
    ];
    expect(readTurns(copied, { skip: new Set(old.ids) }).turns.map(t => t.id)).toEqual(['m3']);
  });

  test('読めない時刻の行は飛ばし、時刻は UTC の字に揃える', () => {
    const { turns } = readTurns([
      line('bad', 'きのう'),
      line('jst', '2026-11-27T10:30:00+09:00'),
    ]);
    expect(turns.map(t => [t.id, t.at])).toEqual([['jst', '2026-11-27T01:30:00.000Z']]);
    expect(() => toRows(turns)).not.toThrow();
  });

  test('web の検索と取得の回数を読む', () => {
    const { turns } = readTurns([line('m1', '2026-11-27T01:00:00.000Z', { server_tool_use: { web_search_requests: 5, web_fetch_requests: 2 } })]);
    expect(turns[0]).toMatchObject({ webSearchRequests: 5, webFetchRequests: 2 });
    expect(toRows(turns)[0]).toMatchObject({ webSearchRequests: 5, webFetchRequests: 2 });
  });

  test('手伝いの写しは、種類を回に付ける', () => {
    const { turns } = readTurns([line('a1', '2026-11-27T01:00:00.000Z', {}, { sessionId: 'agent-x', isSidechain: true })], { agent: 'Explore' });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.agent).toBe('Explore');
  });

  test('圧縮の印は、写しの欄をそのまま読む', () => {
    const { compactions, turns } = readTurns([JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2026-11-27T02:00:00.000Z',
      sessionId: 's-1',
      compactMetadata: { trigger: 'auto', preTokens: 300000, postTokens: 60000, durationMs: 1 },
    })]);
    expect(turns).toEqual([]);
    expect(compactions).toEqual([{ at: '2026-11-27T02:00:00.000Z', trigger: 'auto', preTokens: 300000, postTokens: 60000 }]);
  });
});

describe('値段', () => {
  test('値段は 100 万トークンあたりのドルで、額は 100 万分の 1 ドルの整数', () => {
    // Opus 5.5: 入力 4・出力 20・読み 0.2・書き 5（5 分）と 8（1 時間）。
    expect(costMicroUsd(turn({ inputTokens: 1_000_000 }))).toBe(4_000_000);
    expect(costMicroUsd(turn({ outputTokens: 1_000_000 }))).toBe(20_000_000);
    expect(costMicroUsd(turn({ cacheReadTokens: 1_000_000 }))).toBe(200_000);
    expect(costMicroUsd(turn({ cacheWrite5mTokens: 1_000_000 }))).toBe(5_000_000);
    expect(costMicroUsd(turn({ cacheWrite1hTokens: 1_000_000 }))).toBe(8_000_000);
    expect(costMicroUsd(turn({ model: 'claude-fable-5-2', inputTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 }))).toBe(24_000_000);
  });

  test('速い回（fast）は、Opus 5.5 と Fable 5.2 が 2 倍。倍の無い model は、そのまま', () => {
    expect(costMicroUsd(turn({ speed: 'fast', inputTokens: 1_000_000, outputTokens: 1_000_000 }))).toBe(48_000_000);
    expect(costMicroUsd(turn({ speed: 'fast', model: 'claude-fable-5-2', inputTokens: 1_000_000, outputTokens: 1_000_000 }))).toBe(96_000_000);
    expect(costMicroUsd(turn({ speed: 'fast', model: 'claude-sonnet-5-5', inputTokens: 1_000_000 }))).toBe(2_000_000);
  });

  test('値段の表に無い model の名を知らせる', () => {
    expect(unpricedModels([turn(), turn({ model: 'claude-zzz-1' }), turn({ model: 'claude-aaa-1' }), turn({ model: 'claude-zzz-1' })])).toEqual(['claude-aaa-1', 'claude-zzz-1']);
    expect(unpricedModels([turn()])).toEqual([]);
  });

  test('Haiku 5.5 は、文脈が 10 万を越えた回だけ 5 倍', () => {
    const short = turn({ model: 'claude-haiku-5-5', inputTokens: 100_000 });
    const long = turn({ model: 'claude-haiku-5-5', inputTokens: 100_001 });
    expect(costMicroUsd(short)).toBe(10_000);
    expect(costMicroUsd(long)).toBe(Math.round(5 * 100_001 * 0.1));
  });

  test('日付の付いた model の名にも当たり、表に無い model は額が 0', () => {
    expect(priceOf('claude-opus-5-5-20260101', '2026-11-27T00:00:00Z')?.model).toBe('claude-opus-5-5');
    expect(priceOf('claude-unknown-9', '2026-11-27T00:00:00Z')).toBeUndefined();
    expect(costMicroUsd(turn({ model: 'claude-unknown-9', inputTokens: 1_000_000 }))).toBe(0);
  });

  test('値段が替わった後も、前の日の回は前の値段で数える', () => {
    const prices: Price[] = [
      { model: 'claude-x', from: '2026-01-01', input: 1, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      { model: 'claude-x', from: '2026-12-01', input: 2, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    ];
    expect(costMicroUsd(turn({ model: 'claude-x', at: '2026-11-30T23:59:59.000Z', inputTokens: 1000 }), prices)).toBe(1000);
    expect(costMicroUsd(turn({ model: 'claude-x', at: '2026-12-01T00:00:00.000Z', inputTokens: 1000 }), prices)).toBe(2000);
    expect(priceOf('claude-x', '2025-12-31T00:00:00Z', prices)).toBeUndefined();
  });
});

describe('文脈の長さと段', () => {
  test('文脈の長さは、入力 + cache の読み + cache の書き', () => {
    expect(contextOf(turn({ inputTokens: 1, outputTokens: 100, cacheReadTokens: 2, cacheWrite5mTokens: 3, cacheWrite1hTokens: 4 }))).toBe(10);
  });

  test('段は 2.5 万刻みで、100 万以上は最後の段', () => {
    expect(BUCKET_WIDTH).toBe(25_000);
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(24_999)).toBe(0);
    expect(bucketOf(25_000)).toBe(1);
    expect(bucketOf(199_999)).toBe(7);
    expect(bucketOf(200_000)).toBe(8);
    expect(bucketOf(999_999)).toBe(39);
    expect(bucketOf(1_000_000)).toBe(LAST_BUCKET);
    expect(bucketOf(5_000_000)).toBe(LAST_BUCKET);
  });
});

describe('toRows: 時計の 10 分の枠と種類ごとに 1 行', () => {
  test('同じ 10 分の枠・同じ種類の回は 1 行にまとめ、段ごとの数と額の和が行と合う', () => {
    const rows = toRows([
      turn({ id: 'a', at: '2026-11-27T01:12:00.000Z', inputTokens: 10_000, outputTokens: 100 }),
      turn({ id: 'b', at: '2026-11-27T01:19:59.999Z', inputTokens: 30_000, cacheReadTokens: 200_000 }),
      turn({ id: 'c', at: '2026-11-27T01:10:00.000Z', inputTokens: 20_000 }),
    ]);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      fromAt: '2026-11-27T01:10:00.000Z',
      toAt: '2026-11-27T01:19:59.999Z',
      model: 'claude-opus-5-5',
      speed: 'standard',
      serviceTier: 'standard',
      turns: 3,
      inputTokens: 60_000,
      outputTokens: 100,
      cacheReadTokens: 200_000,
      maxContext: 230_000,
    });
    expect(row?.agent).toBeUndefined();
    expect(row?.buckets.map(b => [b.bucket, b.turns])).toEqual([[0, 2], [9, 1]]);
    expect(row?.buckets.reduce((n, b) => n + b.turns, 0)).toBe(row?.turns);
    expect(row?.buckets.reduce((n, b) => n + b.costMicroUsd, 0)).toBe(row?.costMicroUsd);
  });

  test('10 分の境をまたぐ回は別の行になり、どの行も 1 つの 10 分の枠（UTC）に収まる', () => {
    const rows = toRows([
      turn({ id: 'a', at: '2026-11-27T01:09:59.999Z' }),
      turn({ id: 'b', at: '2026-11-27T01:10:00.000Z' }),
      turn({ id: 'c', at: '2026-11-27T01:50:00.000Z' }),
      turn({ id: 'd', at: '2026-11-27T01:05:00.000Z' }),
    ]);
    expect(rows.map(r => [r.fromAt, r.toAt, r.turns])).toEqual([
      ['2026-11-27T01:05:00.000Z', '2026-11-27T01:09:59.999Z', 2],
      ['2026-11-27T01:10:00.000Z', '2026-11-27T01:10:00.000Z', 1],
      ['2026-11-27T01:50:00.000Z', '2026-11-27T01:50:00.000Z', 1],
    ]);
    // 枠は、分の十の位まで（`2026-11-27T01:0`）が同じ。枠は時の内に収まるので、castlist の検査（同じ UTC の時）も通る。
    for (const r of rows) expect(r.fromAt.slice(0, 15)).toBe(r.toAt.slice(0, 15));
  });

  test('時の境をまたぐ回は別の行になり、どの行も 1 つの時の内に収まる', () => {
    const rows = toRows([
      turn({ id: 'a', at: '2026-11-27T01:59:59.999Z' }),
      turn({ id: 'b', at: '2026-11-27T02:00:00.000Z' }),
    ]);
    expect(rows.map(r => [r.fromAt, r.toAt])).toEqual([
      ['2026-11-27T01:59:59.999Z', '2026-11-27T01:59:59.999Z'],
      ['2026-11-27T02:00:00.000Z', '2026-11-27T02:00:00.000Z'],
    ]);
    for (const r of rows) expect(r.fromAt.slice(0, 13)).toBe(r.toAt.slice(0, 13));
  });

  test('model・手伝いの種類・speed・service tier が違えば、別の行', () => {
    const rows = toRows([
      turn({ id: 'a' }),
      turn({ id: 'b', model: 'claude-fable-5-2' }),
      turn({ id: 'c', agent: 'Explore' }),
      turn({ id: 'd', speed: 'fast' }),
      turn({ id: 'e', serviceTier: 'priority' }),
      turn({ id: 'f' }),
    ]);
    expect(rows).toHaveLength(5);
    expect(rows.reduce((n, r) => n + r.turns, 0)).toBe(6);
    expect(rows.filter(r => r.agent === 'Explore')).toHaveLength(1);
  });

  test('並びは、回の順に依らない', () => {
    const a = turn({ id: 'a', at: '2026-11-27T01:30:00.000Z' });
    const b = turn({ id: 'b', at: '2026-11-27T01:35:00.000Z' });
    const c = turn({ id: 'c', at: '2026-11-27T03:00:00.000Z', model: 'claude-fable-5-2' });
    expect(toRows([a, b, c])).toEqual(toRows([c, b, a]));
    expect(toRows([a, b])).toHaveLength(1);
  });

  test('回が無ければ、行も無い', () => {
    expect(toRows([])).toEqual([]);
  });
});

describe('sumRows: 読む側の決まり', () => {
  test('同じ 10 分の枠を 2 回に分けて送った行は、数を足し、いちばん長い値は大きい方を取る', () => {
    const turns = [
      turn({ id: 'a', at: '2026-11-27T01:05:00.000Z', inputTokens: 300_000, outputTokens: 10 }),
      turn({ id: 'b', at: '2026-11-27T01:07:00.000Z', inputTokens: 10_000 }),
      turn({ id: 'c', at: '2026-11-27T01:09:00.000Z', inputTokens: 12_000, cacheWrite1hTokens: 5 }),
    ];
    const whole = toRows(turns);
    const parts = [...toRows(turns.slice(0, 2)), ...toRows(turns.slice(2))];
    expect(parts).toHaveLength(2);
    const { model, speed, serviceTier, ...rest } = whole[0] as NonNullable<typeof whole[0]>;
    expect([model, speed, serviceTier]).toEqual(['claude-opus-5-5', 'standard', 'standard']);
    expect(sumRows(parts)).toEqual(rest);
    expect(sumRows(parts)?.maxContext).toBe(300_000);
  });

  test('和は、行の切り方に依らない（10 分の枠ごとの行を足すと、回をみな足した数になる）', () => {
    const turns = [
      turn({ id: 'a', at: '2026-11-27T01:05:00.000Z', inputTokens: 300_000, outputTokens: 10 }),
      turn({ id: 'b', at: '2026-11-27T01:20:00.000Z', inputTokens: 10_000 }),
      turn({ id: 'c', at: '2026-11-27T01:40:00.000Z', inputTokens: 12_000, cacheWrite1hTokens: 5 }),
    ];
    const rows = toRows(turns);
    expect(rows).toHaveLength(3);
    expect(sumRows(rows)).toMatchObject({
      fromAt: '2026-11-27T01:05:00.000Z',
      toAt: '2026-11-27T01:40:00.000Z',
      turns: 3,
      inputTokens: 322_000,
      outputTokens: 10,
      cacheWrite1hTokens: 5,
      maxContext: 300_000,
      costMicroUsd: rows.reduce((n, r) => n + r.costMicroUsd, 0),
    });
  });

  test('行が無ければ undefined', () => {
    expect(sumRows([])).toBeUndefined();
  });
});
