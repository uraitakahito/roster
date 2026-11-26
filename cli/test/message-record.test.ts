// 送った記録を置き場に写す（commands/message-record.ts）: 送るたびに、log.jsonl の 1 行を PutMessage で 1 件置く。写せなくても、送りは止めない。
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { castlistIssuer } from '../src/castlist.ts';
import { pagetrayApi } from '../src/clients.ts';
import { MESSAGE_RECORDS_FILE, messageRecordsSettled, type MessageRecordFailure } from '../src/commands/message-record.ts';
import { askTpm, notify, TPM_PARTY, type Sent } from '../src/commands/messages.ts';
import { pagePut } from '../src/commands/page.ts';
import { hello } from '../src/commands/role-side.ts';
import { askReview } from '../src/commands/staff.ts';
import { DEFAULT_PAGES_URL } from '../src/commands/store.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { BRIEF, staffRoot, world, type FakeStore, type MessageRecord, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const SE_TITLE = 'SWE t-x7k2: 計画と実装';
const NOW = '2026-11-20T12:00:00.000Z';

/** TPM 担当が名乗り、t-x7k2 の Software Engineer 担当（file:1）を起こして名乗らせた世界。 */
async function started(): Promise<World & { se: Context, project: string }> {
  const w = world();
  const tpm = { ...w.tpm, root: staffRoot() };
  await hello(tpm, TPM);
  await assign(tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
  const base = w.role('t-x7k2', 'file:1');
  const se = { ...base, root: staffRoot(), env: { ...base.env, ROSTER_ROLE: 'software-engineer' } };
  await hello(se);
  return { ...w, tpm, se, project: basename(w.tpm.state.dir) };
}

/** 写しが済むのを待ち、置き場のメッセージの記録を置いた順に返す。 */
async function records(store: FakeStore): Promise<MessageRecord[]> {
  await messageRecordsSettled();
  return [...store.messages.values()];
}
const log = (w: World): Sent[] => w.tpm.state.lines<Sent>('log.jsonl');
const failures = (w: World): MessageRecordFailure[] => w.tpm.state.lines<MessageRecordFailure>(MESSAGE_RECORDS_FILE);

describe('送った記録を置き場に写す', () => {
  test('TPM 担当 → 担当: 1 件を carried で置く。受け手は担当の Key、id と時刻は送った記録の物', async () => {
    const w = await started();
    notify(w.tpm, 't-x7k2', { text: 'A で進める' });
    const [sent] = log(w);
    expect(await records(w.store)).toEqual([{
      project: w.project,
      id: sent?.id,
      key: 't-x7k2',
      heading: 'notify',
      from: 'Technical Program Manager',
      to: 't-x7k2',
      text: '【notify】A で進める',
      sentAt: NOW,
      state: 'carried',
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    }]);
    expect(sent).toMatchObject({ heading: 'notify', at: NOW, recipient: { key: 't-x7k2' } });
    expect(w.store.messagePuts.map(r => [r.method, r.path, r.query.actorIssuer, r.query.actorRef])).toEqual([['PUT', `/api/projects/${w.project}/messages/${sent?.id ?? ''}`, undefined, undefined]]);
    // 写せた時は、写せなかった記録を残さない。
    expect(existsSync(join(w.tpm.state.dir, MESSAGE_RECORDS_FILE))).toBe(false);
  });

  test('担当 → TPM 担当: 受け手は TPM 担当の名（TPM_PARTY）、送り手は名簿の題。返事の先も写す', async () => {
    const w = await started();
    notify(w.tpm, 't-x7k2', { text: 'どちらにするか' });
    const asked = log(w)[0]?.id ?? '';
    await askTpm(w.se, { text: '案 A にする', waitingFor: '案の選択', replyTo: asked });
    expect((await records(w.store))[1]).toMatchObject({ key: 't-x7k2', heading: 'ask-tpm', from: SE_TITLE, to: TPM_PARTY, text: '【ask-tpm】案 A にする', state: 'carried', replyTo: asked });
  });

  test('担当 → 担当（レビューの頼み）: 受け手は Staff Engineer 担当の席の Key、Key は送った課題の担当', async () => {
    const w = await started();
    const html = join(realpathSync(mkdtempSync(join(tmpdir(), 'roster-record-'))), 'p.html');
    writeFileSync(html, '<title>試し</title>');
    const plan = (await pagePut(w.se, html, { kind: 'plan' })).find(l => l.startsWith('URL: '))?.slice(5) ?? '';
    await askReview(w.se, { url: plan, wait: 0 });
    const staff = w.role('t-x7k2.staff', 'file:2');
    await hello({ ...staff, env: { ...staff.env, ROSTER_ROLE: 'staff-engineer' } });
    expect((await askReview(w.se, { url: 'https://github.com/o/r/pull/7' }))[0]).toBe('送った: 【ask-review】→ file:2（相手の手が空いた時に届く。送り直さない）');
    const sent = log(w).at(-1);
    expect((await records(w.store)).at(-1)).toMatchObject({ id: sent?.id, key: 't-x7k2', heading: 'ask-review', from: SE_TITLE, to: 't-x7k2.staff', text: sent?.text, state: 'carried' });
  });

  test('castlist の設定と session の id があれば、ページを置く時と同じ送り手の付随する id を付ける', async () => {
    const w = await started();
    const tpm: Context = { ...w.tpm, env: { ...w.tpm.env, ROSTER_CASTLIST_URL: 'http://127.0.0.1:8802', CLAUDE_CODE_SESSION_ID: 's-1' } };
    notify(tpm, 't-x7k2', { text: '送り手を付ける' });
    expect((await records(w.store))[0]?.sender).toEqual({ issuer: castlistIssuer(w.tpm.state.dir), ref: 'claude.session:s-1' });
  });

  test('8000 字を超える本文は、頭の 7990 字に「…（長いので切った）」を付ける。log.jsonl の本文は切らない', async () => {
    const w = await started();
    const body = `${'あ'.repeat(7000)}${'😀'.repeat(2000)}`;
    notify(w.tpm, 't-x7k2', { text: body });
    const [record] = await records(w.store);
    const chars = [...record?.text ?? ''];
    expect(chars).toHaveLength(8000);
    expect(record?.text).toBe(`${[...`【notify】${body}`].slice(0, 7990).join('')}…（長いので切った）`);
    expect(log(w)[0]?.text).toBe(`【notify】${body}`);
    // ちょうど 8000 字は切らない。
    const fit = 'い'.repeat(8000 - '【notify】'.length);
    notify(w.tpm, 't-x7k2', { text: fit });
    expect((await records(w.store))[1]?.text).toBe(`【notify】${fit}`);
  });
});

describe('写せなくても、送りは止めない', () => {
  const SENT = ['送った: 【notify】→ file:1（相手の手が空いた時に届く。送り直さない）'];

  test.each([
    ['置き場が応えない', (s: FakeStore) => { s.down = true; }, /^置き場が応えない$/],
    ['置き場が古い版で、操作を持たない（404）', (s: FakeStore) => { s.noMessages = true; }, /^404 置き場が、この roster の呼ぶ操作を持たない/],
    ['置き場が castlist に聞けない（503）', (s: FakeStore) => { s.messageError = 503; }, /^503 castlist に送り手を聞けない$/],
    ['置き場が形の誤りで断る（400）', (s: FakeStore) => { s.messageError = 400; }, /^400 /],
  ])('%s: 今までどおり送り、log.jsonl に行があり、写せなかった記録が 1 行残る', async (_name, breakStore, reason) => {
    const w = await started();
    breakStore(w.store);
    expect(notify(w.tpm, 't-x7k2', { text: 'A で進める' })).toEqual(SENT);
    expect(w.wire.inbox('file:1').map(m => m.text)).toEqual(['【notify】A で進める']);
    const [sent] = log(w);
    expect(sent).toMatchObject({ heading: 'notify', text: '【notify】A で進める' });
    expect(await records(w.store)).toEqual([]);
    expect(w.store.messagePuts).toHaveLength(1);
    expect(failures(w)).toEqual([{ at: NOW, id: sent?.id, reason: expect.stringMatching(reason) as string }]);
  });

  test('id の形が置き場の決まりに合わない時は、字を替えずに、写さない（置き場には頼まない）', async () => {
    const w = await started();
    const messages = Object.assign(Object.create(w.tpm.messages) as Context['messages'], { send: () => ({ id: 'workspace:1/7' }) });
    expect(notify({ ...w.tpm, messages }, 't-x7k2', { text: 'A で進める' })).toEqual(SENT);
    expect(log(w).map(l => l.id)).toEqual(['workspace:1/7']);
    expect(await records(w.store)).toEqual([]);
    expect(w.store.messagePuts).toEqual([]);
    expect(failures(w)).toEqual([{ at: NOW, id: 'workspace:1/7', reason: 'id の形が、置き場の決まりに合わない（写していない）' }]);
  });
});

describe('偽の置き場のメッセージの記録（本物と同じ決まり）', () => {
  const base = { project: 'p', id: 'm-1', key: 'K-1', heading: 'brief', from: 'tpm', to: 'K-1', text: '初めの本文', sentAt: new Date(NOW), state: 'carried' };

  test('初めては 201、もうある id は 200 の書き足し: 状態は前へだけ進み、deliveries は大きい方、deliveredAt と本文は初めの値を保つ', async () => {
    const { store } = world();
    const api = pagetrayApi();
    const client = store.client(DEFAULT_PAGES_URL);
    const put = async (more: Record<string, unknown>) => client.send(new api.PutMessageCommand({ ...base, ...more }));
    expect((await put({})).status).toBe(201);
    const delivered = await put({ state: 'delivered', text: '違う本文', deliveredAt: new Date('2026-11-20T12:00:02.000Z'), via: 'prompt', deliveries: 2 });
    expect(delivered).toMatchObject({ status: 200, state: 'delivered', text: '初めの本文', via: 'prompt', deliveries: 2 });
    // 弱い状態・小さい回数・後の時刻では、替わらない。
    const late = await put({ state: 'expired', deliveredAt: new Date('2026-11-20T12:00:09.000Z'), via: 'later', deliveries: 1 });
    expect(late).toMatchObject({ status: 200, state: 'delivered', via: 'prompt', deliveries: 2 });
    expect(late.deliveredAt?.toISOString()).toBe('2026-11-20T12:00:02.000Z');
    expect(late.sentAt?.toISOString()).toBe(NOW);
    // waiting と carried は同じ強さ（替えない）。expired はそれより強い。
    await put({ id: 'm-2', state: 'waiting', sentAt: new Date('2026-11-20T12:00:01.000Z') });
    expect((await put({ id: 'm-2', state: 'carried' })).state).toBe('waiting');
    expect((await put({ id: 'm-2', state: 'undeliverable' })).state).toBe('undeliverable');
    expect((await put({ id: 'm-2', state: 'expired' })).state).toBe('undeliverable');
    await expect(put({ id: 'm-3', heading: 'Brief' })).rejects.toMatchObject({ name: 'ValidationException' });
    // 一覧は送った時刻の新しい順。条件で絞れる。
    const list = async (query: Record<string, string>) => ((await client.send(new api.ListMessagesCommand(query))).messages ?? []).map(m => m.id);
    expect(await list({ project: 'p' })).toEqual(['m-2', 'm-1']);
    expect(await list({ project: 'p', sort: 'sentAt' })).toEqual(['m-1', 'm-2']);
    expect(await list({ state: 'delivered' })).toEqual(['m-1']);
    expect(await list({ q: '初めの', to: 'K-1', from: 'tpm', heading: 'brief', key: 'K-1' })).toEqual(['m-2', 'm-1']);
    expect(await list({ project: 'other' })).toEqual([]);
  });
});
