// 送った記録を置き場に写す（commands/message-record.ts）: 送るたびに、log.jsonl の 1 行を PutMessage で 1 件置く。写せなくても、送りは止めない。
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { castlistIssuer } from '../src/castlist.ts';
import { pagetrayApi } from '../src/clients.ts';
import { copyMessageRecord, MESSAGE_RECORDS_FILE, messageRecordsSettled, type MessageRecordNote } from '../src/commands/message-record.ts';
import { askTpm, notify, TPM_PARTY, type Sent } from '../src/commands/messages.ts';
import { pagePut } from '../src/commands/page.ts';
import { hello } from '../src/commands/role-side.ts';
import { askReview } from '../src/commands/staff.ts';
import { DEFAULT_PAGES_URL, pagetrayClient } from '../src/commands/store.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { runProgram } from '../src/program.ts';
import { BRIEF, staffRoot, world, type FakeStore, type MessageRecord, type World } from './helpers.ts';
import { nextHandler } from './next-fake.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
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
  // 席を起こす時の頼みの行（launch）と、その写しを、ここで片付ける（下の試験は、送る命令 1 つの写しを見る。行そのものは、下の「席を起こす時の頼みの行」で見る）。
  await messageRecordsSettled();
  w.store.messages.clear();
  w.store.messagePuts.length = 0;
  rmSync(join(w.tpm.state.dir, 'log.jsonl'), { force: true });
  rmSync(join(w.tpm.state.dir, MESSAGE_RECORDS_FILE), { force: true });
  return { ...w, tpm, se, project: basename(w.tpm.state.dir) };
}

/** 写しが済むのを待ち、置き場のメッセージの記録を置いた順に返す。 */
async function records(store: FakeStore): Promise<MessageRecord[]> {
  await messageRecordsSettled();
  return [...store.messages.values()];
}
const log = (w: World): Sent[] => w.tpm.state.lines<Sent>('log.jsonl');
const notes = (w: World): MessageRecordNote[] => w.tpm.state.lines<MessageRecordNote>(MESSAGE_RECORDS_FILE);
/** castlist の設定と session の id を足した周り（送り手の付随する id が付く）。 */
const seated = (ctx: Context): Context => ({ ...ctx, env: { ...ctx.env, ROSTER_CASTLIST_URL: 'http://127.0.0.1:8802', CLAUDE_CODE_SESSION_ID: 's-1' } });

describe('送った記録を置き場に写す', () => {
  test('席を起こす時の頼みの行: 「ほかの道具で運んだ」（carried）で置く。送り手は TPM 担当の名、受け手は起こした席の Key。届いたかは書かない', async () => {
    const w = world();
    await hello(w.tpm, TPM);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
    const [sent] = log(w);
    expect(sent).toMatchObject({ heading: 'brief', key: 't-x7k2', to: 'file:1', text: `【brief】${BRIEF}`, carrier: 'launch', launch: true, recipient: { key: 't-x7k2' } });
    expect(await records(w.store)).toMatchObject([{ id: sent?.id, key: 't-x7k2', heading: 'brief', from: TPM_PARTY, to: 't-x7k2', text: `【brief】${BRIEF}`, state: 'carried' }]);
    // 配りの口には置いていない。
    expect(w.posted('t-x7k2')).toEqual([]);
  });

  test('TPM 担当 → 担当: 1 件を waiting（届くのを待っている）で置く。送り手は TPM 担当の名（TPM_PARTY）、受け手は担当の Key、id と時刻は送った記録の物', async () => {
    const w = await started();
    await notify(w.tpm, 't-x7k2', { text: 'A で進める' });
    const [sent] = log(w);
    expect(await records(w.store)).toEqual([{
      project: w.project,
      id: sent?.id,
      key: 't-x7k2',
      heading: 'notify',
      from: TPM_PARTY,
      to: 't-x7k2',
      text: '【notify】A で進める',
      sentAt: NOW,
      state: 'waiting',
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    }]);
    expect(sent).toMatchObject({ heading: 'notify', at: NOW, recipient: { key: 't-x7k2' } });
    expect(w.store.messagePuts.map(r => [r.method, r.path, r.query.actorIssuer, r.query.actorRef])).toEqual([['PUT', `/api/projects/${w.project}/messages/${sent?.id ?? ''}`, undefined, undefined]]);
    // 写せた時は、写せなかった記録を残さない。
    expect(existsSync(join(w.tpm.state.dir, MESSAGE_RECORDS_FILE))).toBe(false);
  });

  test('担当 → TPM 担当: 送り手は担当の Key（居場所の題でない）、受け手は TPM 担当の名（TPM_PARTY）。返事の先も写す', async () => {
    const w = await started();
    await notify(w.tpm, 't-x7k2', { text: 'どちらにするか' });
    const asked = log(w)[0]?.id ?? '';
    await askTpm(w.se, { text: '案 A にする', waitingFor: '案の選択', replyTo: asked });
    expect((await records(w.store))[1]).toMatchObject({ key: 't-x7k2', heading: 'ask-tpm', from: 't-x7k2', to: TPM_PARTY, text: '【ask-tpm】案 A にする', state: 'waiting', replyTo: asked });
  });

  test('担当 → 担当（レビューの頼み）: 送り手は課題の担当の Key、受け手は Staff Engineer 担当の席の Key', async () => {
    const w = await started();
    const html = join(realpathSync(mkdtempSync(join(tmpdir(), 'roster-record-'))), 'p.html');
    writeFileSync(html, '<title>試し</title>');
    const plan = (await pagePut(w.se, html, { kind: 'plan' })).find(l => l.startsWith('URL: '))?.slice(5) ?? '';
    await askReview(w.se, { url: plan, wait: 0 });
    const staff = w.role('t-x7k2.staff', 'file:2');
    await hello({ ...staff, env: { ...staff.env, ROSTER_ROLE: 'staff-engineer' } });
    expect((await askReview(w.se, { url: 'https://github.com/o/r/pull/7' }))[0]).toBe('送った: 【ask-review】→ file:2（相手の手が空いた時に届く。送り直さない）');
    const sent = log(w).at(-1);
    expect((await records(w.store)).at(-1)).toMatchObject({ id: sent?.id, key: 't-x7k2', heading: 'ask-review', from: 't-x7k2', to: 't-x7k2.staff', text: sent?.text, state: 'waiting' });
  });

  test('castlist の設定と session の id があれば、ページを置く時と同じ送り手の付随する id を付ける', async () => {
    const w = await started();
    await notify(seated(w.tpm), 't-x7k2', { text: '送り手を付ける' });
    expect((await records(w.store))[0]?.sender).toEqual({ issuer: castlistIssuer(w.tpm.state.dir), ref: 'claude.session:s-1' });
  });

  test('8000 字を超える本文は、頭の 7990 字に「…（長いので切った）」を付ける。log.jsonl の本文は切らない', async () => {
    // 送る命令は、8000 字（UTF-16）を超える本文を置かない。超える行は、前の版の行と、絵文字の多い本文（符号位置では 8000 字に収まらない事は無い）だけ。
    const w = await started();
    const old = (id: string, text: string): Sent => ({ at: NOW, key: 't-x7k2', heading: 'notify', from: 'Technical Program Manager', to: 'file:1', text, id });
    const body = `${'あ'.repeat(7000)}${'😀'.repeat(2000)}`;
    copyMessageRecord(w.tpm, old('old-1', `【notify】${body}`));
    await messageRecordsSettled();
    const [record] = await records(w.store);
    const chars = [...record?.text ?? ''];
    expect(chars).toHaveLength(8000);
    expect(record?.text).toBe(`${[...`【notify】${body}`].slice(0, 7990).join('')}…（長いので切った）`);
    // ちょうど 8000 字は切らない。送る命令でも置ける。
    const fit = 'い'.repeat(8000 - '【notify】'.length);
    await notify(w.tpm, 't-x7k2', { text: fit });
    expect((await records(w.store))[1]?.text).toBe(`【notify】${fit}`);
    expect(log(w)[0]?.text).toBe(`【notify】${fit}`);
  });
});

describe('送り手・受け手の名と、返事の先の形', () => {
  const line = (more: Partial<Sent>): Sent => ({ at: NOW, key: 'K-1', heading: 'notify', from: '居場所の題', to: 'file:9', text: '【notify】x', id: 'old-1', ...more });

  test('送り手の組の無い前の版の行は居場所の題、届く担当の分からない行は宛先の字。200 字（符号位置）を超える名は、頭の 200 字に切る', async () => {
    const w = await started();
    copyMessageRecord(w.tpm, line({}));
    copyMessageRecord(w.tpm, line({ id: 'old-2', from: `${'題'.repeat(150)}${'😀'.repeat(100)}`, to: 'w'.repeat(201) }));
    const [short, long] = await records(w.store);
    expect([short?.from, short?.to]).toEqual(['居場所の題', 'file:9']);
    expect(long?.from).toBe(`${'題'.repeat(150)}${'😀'.repeat(50)}`);
    expect(long?.to).toBe('w'.repeat(200));
    expect(notes(w)).toEqual([]);
  });

  test('名が空になる時は写さずに、訳を残す', async () => {
    const w = await started();
    copyMessageRecord(w.tpm, line({ from: '' }));
    copyMessageRecord(w.tpm, line({ id: 'old-2', sender: { key: 'K-1' }, recipient: { key: '' } }));
    expect(await records(w.store)).toEqual([]);
    expect(w.store.messagePuts).toEqual([]);
    expect(notes(w).map(n => [n.id, n.reason])).toEqual([['old-1', '送り手か受け手の名が空（写していない）'], ['old-2', '送り手か受け手の名が空（写していない）']]);
  });

  test('返事の先は、id と同じ形の時だけ付ける（. と .. も付けない）', async () => {
    const w = await started();
    for (const [id, replyTo] of [['r-1', 'm-0'], ['r-2', '..'], ['r-3', '.'], ['r-4', 'a b']] as const) copyMessageRecord(w.tpm, line({ id, replyTo }));
    expect((await records(w.store)).map(r => [r.id, r.replyTo])).toEqual([['r-1', 'm-0'], ['r-2', undefined], ['r-3', undefined], ['r-4', undefined]]);
  });
});

describe('置き場が送り手を確かめられない時は、送り手を外して 1 度だけ置き直す', () => {
  test.each([
    ['castlist に聞けない（503）', 'unreachable', /^送り手を付けずに置いた（503 castlist に送り手を聞けない）$/],
    ['castlist に登録が無い（400 の /actorRef）', 'unregistered', /^送り手を付けずに置いた（400 castlist に登録の無い送り手）$/],
  ] as const)('%s: 送り手が空の記録が置かれ、その事が 1 行残る', async (_name, how, reason) => {
    const w = await started();
    w.store.sender = how;
    await notify(seated(w.tpm), 't-x7k2', { text: 'A で進める' });
    const [sent] = log(w);
    const [record, ...rest] = await records(w.store);
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ id: sent?.id, from: TPM_PARTY, to: 't-x7k2', text: '【notify】A で進める', sentAt: NOW, state: 'waiting' });
    expect(record?.sender).toBeUndefined();
    expect(w.store.messagePuts.map(r => r.query.actorRef)).toEqual(['claude.session:s-1', undefined]);
    expect(notes(w)).toEqual([{ at: NOW, id: sent?.id, reason: expect.stringMatching(reason) as string, placed: 'without-sender' }]);
  });

  test('外しても落ちれば、写せなかった行（置き直しは 1 度だけ）', async () => {
    const w = await started();
    w.store.messageError = 503;
    await notify(seated(w.tpm), 't-x7k2', { text: 'A で進める' });
    expect(await records(w.store)).toEqual([]);
    expect(w.store.messagePuts).toHaveLength(2);
    expect(notes(w)).toEqual([{ at: NOW, id: log(w)[0]?.id, reason: '503 castlist に送り手を聞けない。送り手を外しても置けない（503 castlist に送り手を聞けない）' }]);
  });

  test('送り手を付けていない時の 503 と、送り手のほかの訳の 400 では、置き直さない', async () => {
    const w = await started();
    w.store.messageError = 503;
    await notify(w.tpm, 't-x7k2', { text: '付けていない' });
    await messageRecordsSettled();
    w.store.messageError = 400;
    await notify(seated(w.tpm), 't-x7k2', { text: '形の誤り' });
    await messageRecordsSettled();
    expect(w.store.messagePuts).toHaveLength(2);
    expect(notes(w).map(n => n.placed)).toEqual([undefined, undefined]);
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
    expect(await notify(w.tpm, 't-x7k2', { text: 'A で進める' })).toEqual(SENT);
    expect(w.posted('file:1').map(m => m.text)).toEqual(['【notify】A で進める']);
    const [sent] = log(w);
    expect(sent).toMatchObject({ heading: 'notify', text: '【notify】A で進める' });
    expect(await records(w.store)).toEqual([]);
    expect(w.store.messagePuts).toHaveLength(1);
    expect(notes(w)).toEqual([{ at: NOW, id: sent?.id, reason: expect.stringMatching(reason) as string }]);
  });

  test('置き場が 2xx を返したのに答えを読めない時は、応えない時と分けて残す（置けたかは分からない）', async () => {
    const w = await started();
    const { handler } = nextHandler(() => ({ status: 200, raw: '<html>別の物</html>' }));
    const tpm: Context = { ...w.tpm, clients: { ...w.tpm.clients, pagetray: url => pagetrayClient(url, handler) } };
    expect(await notify(tpm, 't-x7k2', { text: 'A で進める' })).toEqual(SENT);
    await messageRecordsSettled();
    expect(notes(w)).toEqual([{ at: NOW, id: log(w)[0]?.id, reason: '置き場が 200 を返したが、答えを読めない（置けたかは分からない）' }]);
  });

  test('命令が決まりの誤りでない誤りで落ちる時も、命令の入口（runProgram）は、始めた写しが済むのを待ってから落ちる', async () => {
    const w = await started();
    w.store.down = true;
    const program = new Command().name('roster');
    program.command('boom').action(async () => {
      await notify(w.tpm, 't-x7k2', { text: 'A で進める' });
      throw new Error('思わぬ誤り');
    });
    await expect(runProgram(['node', 'roster', 'boom'], program)).rejects.toThrow('思わぬ誤り');
    // 待たずに落ちていれば、この時にはまだ残っていない。
    expect(notes(w).map(n => n.reason)).toEqual(['置き場が応えない']);
  });

  test('id の形が置き場の決まりに合わない時は、字を替えずに、写さない（置き場には頼まない）', async () => {
    // 今の版が作る id は、いつも UUID。前の版（連携の道具が id を作った頃）の行を写す時の守り。
    const w = await started();
    copyMessageRecord(w.tpm, { at: NOW, key: 't-x7k2', heading: 'notify', from: 'Technical Program Manager', to: 'file:1', text: '【notify】A で進める', id: 'workspace:1/7' });
    await messageRecordsSettled();
    expect(await records(w.store)).toEqual([]);
    expect(w.store.messagePuts).toEqual([]);
    expect(notes(w)).toEqual([{ at: NOW, id: 'workspace:1/7', reason: 'id の形が、置き場の決まりに合わない（写していない）' }]);
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
    // createdAt は置いた時のまま、updatedAt は書き足すたびに進む。
    const [first, second] = [late, await put({})];
    expect(second.createdAt?.toISOString()).toBe(first.createdAt?.toISOString());
    expect((second.updatedAt?.getTime() ?? 0) > (first.updatedAt?.getTime() ?? 0)).toBe(true);
    expect((first.updatedAt?.getTime() ?? 0) > (first.createdAt?.getTime() ?? 0)).toBe(true);
    // 一覧は送った時刻の新しい順。条件で絞れる。
    const list = async (query: Record<string, string>) => ((await client.send(new api.ListMessagesCommand(query))).messages ?? []).map(m => m.id);
    expect(await list({ project: 'p' })).toEqual(['m-2', 'm-1']);
    expect(await list({ project: 'p', sort: 'sentAt' })).toEqual(['m-1', 'm-2']);
    expect(await list({ state: 'delivered' })).toEqual(['m-1']);
    expect(await list({ q: '初めの', to: 'K-1', from: 'tpm', heading: 'brief', key: 'K-1' })).toEqual(['m-2', 'm-1']);
    expect(await list({ project: 'other' })).toEqual([]);
  });
});
