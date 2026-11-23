// castlist の監査の検索を読む命令（roster castlist find・show・lineage・events・settings）と、roster incident timeline のアクターの欄。
// 試験は偽の castlist（castlist-fake.ts）に直に書いて下ごしらえし、roster の命令が送る GET と、出す字を見る。本物の castlist（8802）には触らない。
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { castlistIssuer, PM_REF } from '../src/castlist.ts';
import { sessionStart } from '../src/commands/castlist.ts';
import { castlistEvents, castlistFind, castlistLineage, castlistSettings, castlistShow } from '../src/commands/castlist-read.ts';
import { incidentTimeline } from '../src/commands/timeline.ts';
import { startTpm } from '../src/command.ts';
import type { Context } from '../src/context.ts';
import { buildProgram, commandPaths } from '../src/program.ts';
import { COMMANDS } from '../src/protocol.ts';
import { deadUrl, startFakeCastlist, type CastlistRequest, type FakeCastlist } from './castlist-fake.ts';
import { world, type World } from './helpers.ts';

const READS = ['castlist find', 'castlist show', 'castlist lineage', 'castlist events', 'castlist settings'];
const tpmBin = join(realpathSync(join(import.meta.dirname, '..')), 'bin', 'roster');

let fake: FakeCastlist;
let dead: string;

beforeAll(async () => {
  fake = await startFakeCastlist();
  dead = await deadUrl();
});

afterAll(async () => {
  await fake.stop();
});

/** この後に偽の castlist が受けた要求を返す関数。 */
function mark(): () => CastlistRequest[] {
  const since = fake.requests().length;
  return () => fake.requests().slice(since);
}

/** 要求の path の引数（名と値の並び）。 */
const query = (r: CastlistRequest | undefined): [string, string][] => [...new URL(r?.path ?? '/', 'http://x').searchParams.entries()];
const pathname = (r: CastlistRequest | undefined): string => new URL(r?.path ?? '/', 'http://x').pathname;

/** 投げた誤りの字（投げなければ空）。 */
function thrown(run: () => unknown): string {
  try {
    run();
  }
  catch (e) {
    return (e as Error).message;
  }
  return '';
}

/** 下ごしらえで登録したアクター。 */
interface Seeded {
  id: string
  name: string
  sid: string
}

let sids = 0;

/**
 * 偽の castlist にアクターを 1 つ登録し、entered に登場、exited があれば退場を送る（受けた時刻は、その時刻にする）。
 * labels は tpm.project を自分で書く。model と effort は登録の時に頼んだ物。
 */
async function seed(w: World, prefix: string, labels: Record<string, string>, entered: string | undefined, exited?: string, options: { workspace?: string, model?: string, effort?: string, kind?: 'ai' | 'human' } = {}): Promise<Seeded> {
  const issuer = castlistIssuer(w.tpm.state.dir);
  const sid = `seed-${String(sids += 1).padStart(4, '0')}`;
  fake.setNow(entered ?? '2026-11-20T11:00:00.000Z');
  const a = await fake.send('POST', '/v1/actors', {
    issuer,
    kind: options.kind ?? 'ai',
    name_prefix: prefix,
    labels,
    bindings: [{ type: 'claude.session', value: sid }, ...(options.workspace === undefined ? [] : [{ type: 'cmux.workspace.ref', value: options.workspace }])],
    sent_at: entered ?? '2026-11-20T11:00:00.000Z',
    settings: { model: options.model ?? 'claude-opus-5-5', effort: options.effort ?? 'high' },
  }) as { id: string, name: string };
  if (entered !== undefined) await fake.send('PUT', `/v1/events/${sid}-in`, { issuer, by: `claude.session:${sid}`, type: 'entered', detail: {}, sent_at: entered });
  if (exited !== undefined) {
    fake.setNow(exited);
    await fake.send('PUT', `/v1/events/${sid}-out`, { issuer, by: `claude.session:${sid}`, type: 'exited', detail: { reason: 'other' }, sent_at: exited });
  }
  fake.setNow('2026-11-20T12:00:00.000Z');
  return { id: a.id, name: a.name, sid };
}

/** a が b を起こした線（launched）か、継いだ線（continued）を送る。 */
async function link(w: World, type: 'launched' | 'continued', from: Seeded, to: Seeded): Promise<void> {
  await fake.send('PUT', `/v1/links/${from.sid}-${to.sid}`, { issuer: castlistIssuer(w.tpm.state.dir), type, from: `claude.session:${from.sid}`, to: `claude.session:${to.sid}`, sent_at: '2026-11-20T11:00:00.000Z' });
}

/** castlist を設定した世界と、Auditor の席の周り（$ROSTER_ROLE=auditor）。 */
function auditorWorld(url = fake.url): { w: World, auditor: Context } {
  const w = world({ castlist: url });
  const base = w.role('audit', 'file:9');
  return { w, auditor: { ...base, env: { ...base.env, ROSTER_KEY: 'audit', ROSTER_ROLE: 'auditor' } } };
}

const page = (url: string): string => `${fake.url}${url}`;

describe('命令の一覧', () => {
  test('roster castlist find・show・lineage・events・settings が命令の木と COMMANDS に在る', () => {
    const paths = commandPaths(buildProgram());
    for (const c of READS) {
      expect(paths).toContain(c);
      expect(COMMANDS).toContain(c);
    }
  });
});

describe('roster castlist find', () => {
  test('旗を GET /v1/actors の引数にする（--label は何度でも）。行ごとにプロフィールの画面の URL を出す', async () => {
    const { w, auditor } = auditorWorld();
    const p = w.project;
    const a = await seed(w, 't-f1nd-swe', { 'tpm.project': p, 'tpm.key': 't-f1nd', 'tpm.role': 'software-engineer' }, '2026-11-20T11:10:00.000Z', '2026-11-20T11:40:00.000Z');
    const b = await seed(w, 't-f1nd-swe', { 'tpm.project': p, 'tpm.key': 't-f1nd', 'tpm.role': 'software-engineer' }, '2026-11-20T11:41:00.000Z');
    await seed(w, 't-0ther-swe', { 'tpm.project': p, 'tpm.key': 't-0ther', 'tpm.role': 'software-engineer' }, '2026-11-20T11:10:00.000Z');
    const since = mark();
    const out = castlistFind(auditor, { label: ['tpm.key:t-f1nd', 'tpm.role:software-engineer'] });
    const sent = since();
    expect(sent.map(r => [r.method, pathname(r)])).toEqual([['GET', '/v1/actors']]);
    expect(query(sent[0])).toEqual([['label', 'tpm.key:t-f1nd'], ['label', 'tpm.role:software-engineer']]);
    const rows = out.filter(l => l.includes('/actors/'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(new RegExp(`^${a.name.replaceAll('.', '\\.')}\\b`));
    expect(rows[0]?.endsWith(page(`/actors/${a.id}`))).toBe(true);
    expect(rows[1]?.endsWith(page(`/actors/${b.id}`))).toBe(true);
    // 状態（稼働中・停止。castlist の画面と同じ字）・退き方・model と effort も 1 行に出る
    expect(rows[0]).toContain('停止');
    expect(rows[0]).toContain('exited');
    expect(rows[1]).toContain('稼働中');
    expect(rows[1]).toContain('claude-opus-5-5');
    expect(rows[1]).toContain('high');
  });

  test('ほかの旗も、castlist の引数の名にそのまま写す', () => {
    const { auditor } = auditorWorld();
    const since = mark();
    castlistFind(auditor, {
      label: ['tpm.key:t-zz01'],
      binding: 'cmux.workspace.ref:workspace:3',
      at: '2026-11-20T11:30:00+09:00',
      activeFrom: '2026-11-20T11:00:00+09:00',
      activeTo: '2026-11-20T12:00:00+09:00',
      active: 'false',
      model: 'claude-sonnet-5',
      effort: 'max',
      launchedBy: 'act-1',
      skewed: true,
      kind: 'ai',
      sort: 'exited',
      order: 'desc',
      limit: '5',
    });
    expect(query(since()[0])).toEqual([
      ['label', 'tpm.key:t-zz01'],
      ['binding', 'cmux.workspace.ref:workspace:3'],
      ['at', '2026-11-20T11:30:00+09:00'],
      ['active_from', '2026-11-20T11:00:00+09:00'],
      ['active_to', '2026-11-20T12:00:00+09:00'],
      ['active', 'false'],
      ['model', 'claude-sonnet-5'],
      ['effort', 'max'],
      ['launched_by', 'act-1'],
      ['skewed', 'true'],
      ['kind', 'ai'],
      ['sort', 'exited'],
      ['order', 'desc'],
      ['limit', '5'],
    ]);
  });

  test('続きがあれば next を出し、--after に渡すと次の頁を読む。当たらなければそう言う', async () => {
    const { w, auditor } = auditorWorld();
    const labels = { 'tpm.project': w.project, 'tpm.key': 't-pg01' };
    const a = await seed(w, 't-pg01-swe', labels, '2026-11-20T11:00:00.000Z');
    const b = await seed(w, 't-pg01-swe', labels, '2026-11-20T11:05:00.000Z');
    const first = castlistFind(auditor, { label: ['tpm.key:t-pg01'], limit: '1' });
    expect(first.some(l => l.endsWith(page(`/actors/${a.id}`)))).toBe(true);
    const next = /--after (\S+)/.exec(first.join('\n'))?.[1] ?? '';
    expect(next).not.toBe('');
    const second = castlistFind(auditor, { label: ['tpm.key:t-pg01'], limit: '1', after: next });
    expect(second.some(l => l.endsWith(page(`/actors/${b.id}`)))).toBe(true);
    expect(second.join('\n')).not.toContain('--after');
    const none = castlistFind(auditor, { label: ['tpm.key:t-none'] });
    expect(none.some(l => l.includes('/actors/'))).toBe(false);
    expect(none.join('\n')).toContain('当たるアクターは無い');
  });

  test('--json は castlist の答えをそのまま出す', async () => {
    const { w, auditor } = auditorWorld();
    const a = await seed(w, 't-js01-swe', { 'tpm.project': w.project, 'tpm.key': 't-js01' }, '2026-11-20T11:00:00.000Z');
    const out = castlistFind(auditor, { label: ['tpm.key:t-js01'], json: true });
    expect(out).toHaveLength(1);
    const asIs = await (await fetch(`${fake.url}/v1/actors?label=tpm.key%3At-js01`)).text();
    expect(out[0]).toBe(asIs);
    expect((JSON.parse(out[0] ?? '{}') as { actors: { id: string }[] }).actors.map(x => x.id)).toEqual([a.id]);
  });

  test('castlist が断った（400）ら、castlist の訳をそのまま出して止まる', () => {
    const { auditor } = auditorWorld();
    expect(thrown(() => castlistFind(auditor, {}))).toBe('絞る条件を 1 つ以上付ける（label・binding・active_from・active_to・active=true・model・effort・launched_by・skewed のどれか）');
    expect(thrown(() => castlistFind(auditor, { label: ['tpm.key:t-x'], activeFrom: 'きのう' }))).toBe('active_from は RFC 3339 の時刻（例 2026-11-22T13:00:00+09:00）');
  });

  test('castlist が止まっていれば「castlist に聞けない」の 1 行で止まり、何も書かない', () => {
    const { w, auditor } = auditorWorld(dead);
    const message = thrown(() => castlistFind(auditor, { label: ['tpm.key:t-x'] }));
    expect(message).toBe(`castlist に聞けない（${dead} が応えない）`);
    expect(w.tpm.state.list('sessions')).toEqual([]);
    expect(w.calls.filter(c => c.cmd === 'container')).toEqual([]);
  });

  test('castlist を設定していなければ、そう言う 1 行で止まる（castlist に聞かない）', () => {
    const w = world();
    const message = thrown(() => castlistFind(w.tpm, { label: ['tpm.key:t-x'] }));
    expect(message).toMatch(/^castlist を設定していない/);
    expect(message).not.toContain('\n');
    expect(w.calls.filter(c => c.cmd === 'curl')).toEqual([]);
  });
});

describe('roster castlist show', () => {
  test('id で 1 つのアクター: ラベル・付随する id・今の状態・最新の model と effort・線の要約・プロフィールの URL', async () => {
    const { w, auditor } = auditorWorld();
    const pm = await seed(w, 'product-manager', { 'tpm.project': w.project }, undefined, undefined, { kind: 'human' });
    const tpm = await seed(w, 'project-tpm', { 'tpm.project': w.project, 'tpm.role': 'tpm' }, '2026-11-20T11:00:00.000Z');
    const se = await seed(w, 't-sh01-swe', { 'tpm.project': w.project, 'tpm.key': 't-sh01', 'tpm.role': 'software-engineer' }, '2026-11-20T11:10:00.000Z', '2026-11-20T11:20:00.000Z', { workspace: 'workspace:3', model: 'claude-sonnet-5', effort: 'max' });
    await link(w, 'launched', pm, tpm);
    await link(w, 'launched', tpm, se);
    const since = mark();
    const out = castlistShow(auditor, se.id, {});
    const text = out.join('\n');
    expect(since().every(r => r.method === 'GET')).toBe(true);
    expect(out[0] ?? '').toContain(se.name);
    expect(text).toContain(page(`/actors/${se.id}`));
    expect(text).toContain('tpm.key=t-sh01');
    expect(text).toContain('tpm.role=software-engineer');
    expect(text).toContain(`claude.session:${se.sid}`);
    expect(text).toContain('cmux.workspace.ref:workspace:3');
    expect(text).toContain('停止');
    expect(text).toContain('exited');
    expect(text).toContain('claude-sonnet-5');
    expect(text).toContain('max');
    // 線の要約: 誰に起こされたか（人の Product Manager まで上る）
    expect(text).toContain(`${tpm.name} → ${se.name}（launched`);
    expect(text).toContain(`${pm.name} → ${tpm.name}（launched`);
  });

  test('名でも引ける（この project の roster が登録して控えたアクター）。castlist には名で引く道が無いので、無い名は id とみなし、無ければ find を勧める', () => {
    const w = world({ castlist: fake.url });
    startTpm(w.tpm);
    const sid = 'cccccccc-0000-4000-8000-000000000001';
    const tpm = { ...w.tpm, env: { ...w.tpm.env, ROSTER_LAUNCH: 'launch-show', ROSTER_LAUNCHED_BY: PM_REF, ROSTER_LAUNCH_MODEL: 'claude-opus-5-5', ROSTER_LAUNCH_EFFORT: 'medium', ROSTER_LAUNCH_FRESH: '1' } };
    sessionStart(tpm, JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup', transcript_path: '/nonexistent/t.jsonl' }));
    const record = w.tpm.state.read<{ id: string, name: string }>(`sessions/${sid}.jsonc`);
    expect(record?.name).toBe('project-tpm.1');
    const since = mark();
    const out = castlistShow(w.tpm, 'project-tpm.1', {});
    expect(pathname(since()[0])).toBe(`/v1/actors/${record?.id ?? ''}`);
    const text = out.join('\n');
    expect(text).toContain(page(`/actors/${record?.id ?? ''}`));
    expect(text).toContain('product-manager.1 → project-tpm.1（launched');
    expect(text).toContain('claude-opus-5-5');
    const missing = thrown(() => castlistShow(w.tpm, 'nobody.1', {}));
    expect(missing).toMatch(/^そのアクターは無い/);
    expect(missing).toContain('roster castlist find');
  });

  test('--json は GET /v1/actors/{id} の答えをそのまま出す', async () => {
    const { w, auditor } = auditorWorld();
    const a = await seed(w, 't-sj01-swe', { 'tpm.project': w.project }, '2026-11-20T11:00:00.000Z');
    const out = castlistShow(auditor, a.id, { json: true });
    expect(out).toEqual([await (await fetch(`${fake.url}/v1/actors/${a.id}`)).text()]);
  });
});

describe('roster castlist lineage', () => {
  test('GET /v1/actors/{id}/lineage の旗を写し、点（名と URL）と線を出す', async () => {
    const { w, auditor } = auditorWorld();
    const pm = await seed(w, 'product-manager', { 'tpm.project': w.project }, undefined, undefined, { kind: 'human' });
    const tpm = await seed(w, 'project-tpm', { 'tpm.project': w.project }, '2026-11-20T11:00:00.000Z');
    const se = await seed(w, 't-ln01-swe', { 'tpm.project': w.project }, '2026-11-20T11:10:00.000Z');
    await link(w, 'launched', pm, tpm);
    await link(w, 'launched', tpm, se);
    const since = mark();
    const out = castlistLineage(auditor, se.id, { direction: 'up', depth: '5', type: 'launched' });
    const sent = since();
    expect(sent.map(r => [r.method, pathname(r)])).toEqual([['GET', `/v1/actors/${se.id}/lineage`]]);
    expect(query(sent[0])).toEqual([['direction', 'up'], ['depth', '5'], ['type', 'launched']]);
    const text = out.join('\n');
    for (const a of [pm, tpm, se]) expect(text).toContain(page(`/actors/${a.id}`));
    expect(text).toContain(`${pm.name} → ${tpm.name}（launched`);
    expect(text).toContain(`${tpm.name} → ${se.name}（launched`);
    expect(thrown(() => castlistLineage(auditor, se.id, { depth: '99' }))).toBe('depth は 1 から 20 までの数');
    expect(castlistLineage(auditor, se.id, { json: true })[0]).toBe(await (await fetch(`${fake.url}/v1/actors/${se.id}/lineage`)).text());
  });
});

describe('roster castlist events', () => {
  test('旗を GET /v1/events の引数にし（--type は何度でも）、行ごとに出来事とアクターの名と URL を出す', async () => {
    const { w, auditor } = auditorWorld();
    const a = await seed(w, 't-ev01-swe', { 'tpm.project': w.project }, '2026-11-20T11:00:00.000Z', '2026-11-20T11:30:00.000Z');
    const since = mark();
    const out = castlistEvents(auditor, { type: ['exited', 'cleared'], actor: a.id, from: '2026-11-20T11:00:00Z', to: '2026-11-20T12:00:00Z', limit: '10' });
    const sent = since();
    expect(sent.map(r => [r.method, pathname(r)])).toEqual([['GET', '/v1/events']]);
    expect(query(sent[0])).toEqual([['type', 'exited'], ['type', 'cleared'], ['actor', a.id], ['from', '2026-11-20T11:00:00Z'], ['to', '2026-11-20T12:00:00Z'], ['limit', '10']]);
    const rows = out.filter(l => l.includes('/actors/'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('2026-11-20T11:30:00.000Z');
    expect(rows[0]).toContain(a.name);
    expect(rows[0]).toContain('exited');
    expect(rows[0]?.endsWith(page(`/actors/${a.id}`))).toBe(true);
    expect(thrown(() => castlistEvents(auditor, { type: ['left'] }))).toMatch(/^type は entered・/);
  });
});

describe('roster castlist settings', () => {
  test('--mismatch などは GET /v1/settings に、--actor は GET /v1/actors/{id}/settings（--at）にする', async () => {
    const { w, auditor } = auditorWorld();
    const a = await seed(w, 't-st01-swe', { 'tpm.project': w.project }, '2026-11-20T11:00:00.000Z', undefined, { model: 'claude-opus-5-5', effort: 'high' });
    fake.setNow('2026-11-20T11:20:00.000Z');
    await fake.send('PUT', `/v1/settings/${a.sid}-seen`, { issuer: castlistIssuer(w.tpm.state.dir), by: `claude.session:${a.sid}`, model: 'claude-sonnet-5', effort: 'high', source: 'observed', sent_at: '2026-11-20T11:20:00.000Z' });
    fake.setNow('2026-11-20T12:00:00.000Z');
    const since = mark();
    const out = castlistSettings(auditor, { mismatch: true, source: 'observed' });
    const sent = since();
    expect(sent.map(r => [r.method, pathname(r)])).toEqual([['GET', '/v1/settings']]);
    expect(query(sent[0])).toEqual([['source', 'observed'], ['mismatch', 'true']]);
    const row = out.find(l => l.includes(a.name)) ?? '';
    expect(row).toContain('claude-sonnet-5');
    expect(row).toContain('observed');
    expect(row.endsWith(page(`/actors/${a.id}`))).toBe(true);

    const at = mark();
    const then = castlistSettings(auditor, { actor: a.id, at: '2026-11-20T11:10:00Z' });
    expect(at().map(r => [r.method, pathname(r), query(r)])).toEqual([['GET', `/v1/actors/${a.id}/settings`, [['at', '2026-11-20T11:10:00Z']]]]);
    expect(then.join('\n')).toContain('claude-opus-5-5');
    expect(then.join('\n')).not.toContain('claude-sonnet-5');
    expect(castlistSettings(auditor, { actor: a.id, at: '2026-11-20T10:00:00Z' }).join('\n')).toContain('まだ無い');
  });
});

describe('読むだけ', () => {
  test('どの命令も GET だけを送り、状態の folder に書かない', async () => {
    const { w, auditor } = auditorWorld();
    const a = await seed(w, 't-ro01-swe', { 'tpm.project': w.project, 'tpm.key': 't-ro01' }, '2026-11-20T11:00:00.000Z');
    const since = mark();
    castlistFind(auditor, { label: ['tpm.key:t-ro01'] });
    castlistShow(auditor, a.id, {});
    castlistLineage(auditor, a.id, {});
    castlistEvents(auditor, { actor: a.id });
    castlistSettings(auditor, { skewed: true });
    castlistSettings(auditor, { actor: a.id });
    const sent = since();
    expect(sent.length).toBeGreaterThanOrEqual(6);
    expect(sent.filter(r => r.method !== 'GET')).toEqual([]);
    expect(w.tpm.state.list('sessions')).toEqual([]);
  });

  test('roster の命令として打つ: 止まっていれば exit 1 で 1 行、断られれば castlist の訳、--json は答えのまま', async () => {
    const w = world({ castlist: fake.url });
    await seed(w, 't-cl01-swe', { 'tpm.project': w.project, 'tpm.key': 't-cl01' }, '2026-11-20T11:00:00.000Z');
    const env = (url: string): NodeJS.ProcessEnv => ({
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('TPM_') && !k.startsWith('CMUX_'))),
      ROSTER_PROJECT: w.project,
      ROSTER_ROLE: 'auditor',
      ROSTER_KEY: 'audit',
      ROSTER_CASTLIST_URL: url,
      XDG_STATE_HOME: join(w.project, '..', 'state'),
    });
    const run = (args: string[], url = fake.url) => spawnSync(tpmBin, ['castlist', ...args], { cwd: w.project, encoding: 'utf8', env: env(url) });
    const down = run(['find', '--label', 'tpm.key:t-cl01'], dead);
    expect(down.status).toBe(1);
    expect(down.stderr).toBe(`roster: castlist に聞けない（${dead} が応えない）\n`);
    const refused = run(['find']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toBe('roster: 絞る条件を 1 つ以上付ける（label・binding・active_from・active_to・active=true・model・effort・launched_by・skewed のどれか）\n');
    const json = run(['find', '--label', 'tpm.key:t-cl01', '--label', `tpm.project:${w.project}`, '--json']);
    expect(json.status).toBe(0);
    expect((JSON.parse(json.stdout) as { actors: unknown[] }).actors).toHaveLength(1);
    const events = run(['events', '--type', 'entered', '--type', 'exited', '--limit', '1']);
    expect(events.status).toBe(0);
    expect(events.stdout).toContain('/actors/');
  });
});

describe('roster incident timeline のアクターの欄', () => {
  /** t-tl01 の記録: 担当の問い（12:00:10）・wait（12:00:20）・TPM 担当の知らせ（12:01:00）・/clear の後の担当の wait（12:02:30）・登場の前の guard（11:58:00）。 */
  function records(w: World): void {
    const s = w.tpm.state;
    s.append('log.jsonl', { at: '2026-11-20T12:00:10.000Z', key: 't-tl01', heading: 'ask-tpm', from: 't-tl01 計画と実装', to: 'file:tpm', text: '【ask-tpm】打ってよいか', id: 'm1', delivered: true });
    s.append('waits.jsonl', { at: '2026-11-20T12:00:20.000Z', by: 't-tl01', role: 'software-engineer', address: 'file:1', text: '回答待ち(TPM): 答え' });
    s.append('log.jsonl', { at: '2026-11-20T12:01:00.000Z', key: 't-tl01', heading: 'notify', from: 'Technical Program Manager', to: 'file:1', text: '【notify】待つこと', id: 'm2', delivered: true });
    s.append('waits.jsonl', { at: '2026-11-20T12:02:30.000Z', by: 't-tl01', role: 'software-engineer', address: 'file:1', text: '作業中: 続き' });
    s.append('guard.jsonl', { at: '2026-11-20T11:58:00.000Z', by: 't-tl01', role: 'software-engineer', command: 'cmux agent message', reason: '直に打たない' });
  }

  /** 時系列のページの、時刻 hms の行。 */
  function row(w: World, hms: string): string {
    const html = [...w.store.pages.values()].filter(p => p.record.kind === 'timeline').at(-1)?.body.toString() ?? '';
    return html.split('<tr').find(r => r.includes(`<br>${hms}</td>`)) ?? '';
  }

  test('行ごとに、その時刻にその席に居た castlist のアクターを、プロフィールの画面への link で出す', async () => {
    const w = world({ castlist: fake.url });
    const labels = { 'tpm.project': w.project, 'tpm.key': 't-tl01', 'tpm.role': 'software-engineer' };
    const before = await seed(w, 't-tl01-swe', labels, '2026-11-20T11:59:00.000Z', '2026-11-20T12:01:30.000Z');
    const after = await seed(w, 't-tl01-swe', labels, '2026-11-20T12:01:40.000Z');
    const tpm = await seed(w, 'project-tpm', { 'tpm.project': w.project, 'tpm.role': 'tpm' }, '2026-11-20T11:00:00.000Z');
    records(w);
    const since = mark();
    expect(incidentTimeline(w.tpm, 't-tl01')[0]).toMatch(/^時系列を置いた（5 行）/);
    expect(since().filter(r => r.method !== 'GET')).toEqual([]);
    const html = [...w.store.pages.values()].find(p => p.record.kind === 'timeline')?.body.toString() ?? '';
    expect(html).toContain('<th>アクター</th>');
    expect(html).toContain(`castlist（${fake.url}）`);
    const linked = (a: Seeded) => `<a href="${page(`/actors/${a.id}`)}">${a.name}</a>`;
    expect(row(w, '12:00:10')).toContain(linked(before));
    expect(row(w, '12:00:20')).toContain(linked(before));
    expect(row(w, '12:01:00')).toContain(linked(tpm));
    expect(row(w, '12:02:30')).toContain(linked(after));
    expect(row(w, '12:02:30')).not.toContain(linked(before));
    // 登場の前の行は、居た者が無い
    expect(row(w, '11:58:00')).toContain('castlist に無い');
    expect(row(w, '11:58:00')).not.toContain('<a href');
  });

  test('castlist が止まっていれば、欄に「castlist に聞けない」と書き、ページは置く', () => {
    const w = world({ castlist: dead });
    records(w);
    expect(incidentTimeline(w.tpm, 't-tl01')[0]).toMatch(/^時系列を置いた（5 行）/);
    expect(row(w, '12:00:10')).toContain('castlist に聞けない');
    expect(row(w, '12:01:00')).toContain('castlist に聞けない');
  });

  test('castlist を設定していなければ、欄は無い（今までどおり）', () => {
    const w = world();
    records(w);
    incidentTimeline(w.tpm, 't-tl01');
    const html = [...w.store.pages.values()].find(p => p.record.kind === 'timeline')?.body.toString() ?? '';
    expect(html).not.toContain('アクター');
    expect(html).not.toContain('castlist');
    expect(w.calls.filter(c => c.cmd === 'curl' && !c.args.some(a => a.includes('/api/')))).toEqual([]);
  });
});
