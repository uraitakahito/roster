import { describe, expect, test } from 'vitest';
import type { Context } from '../src/context.ts';
import { readIncidents } from '../src/incidents.ts';
import { answer, askTpm, notify, type Sent } from '../src/commands/messages.ts';
import { checkStart, showReturned } from '../src/commands/returned.ts';
import { hello, inbox } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { guardSettings } from '../src/guard.ts';
import { requireRole, writeRole } from '../src/roster.ts';
import { BRIEF, world, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
/** world の時刻（helpers の now）。 */
const NOW = '2026-11-20T12:00:00.000Z';

/** 環境変数を替えた周り（同じ居場所で起きた別の session）。 */
const as = (ctx: Context, env: NodeJS.ProcessEnv): Context => ({ ...ctx, env: { ...ctx.env, ...env } });
/** TPM 担当の周りで、担当の Key を持たない session（起こし直した TPM 担当）。 */
const asTpm = (ctx: Context, launch: string): Context => {
  const env: NodeJS.ProcessEnv = { ...ctx.env, ROSTER_LAUNCH: launch };
  delete env.ROSTER_KEY;
  return { ...ctx, env };
};

/**
 * 今朝の形の世界: TPM 担当が t-8b6j の担当（起こし L1、居場所 file:1）を起こし、担当が手を動かしている間に 6 通を送った（待ちのまま）。
 */
function morning(): World & { texts: string[] } {
  const w = world();
  hello(w.tpm, TPM);
  assign(w.tpm, 't-8b6j', { role: 'software-engineer', title: 'castlist の小さな直し', brief: BRIEF, wait: 0 });
  writeRole(w.tpm, { ...requireRole(w.tpm, 't-8b6j'), launch: 'L1' });
  hello(w.role('t-8b6j', 'file:1'));
  w.wire.hold('file:1');
  const texts = ['db.md に型', 'confirm-1 (1) 済み', 'お勧めで', '受け取った（#83）', 'A: ?at= のまま', 'ER 図の案を 3 つ'];
  for (const text of texts) notify(as(w.tpm, { ROSTER_LAUNCH: 'L0' }), 't-8b6j', { text });
  return { ...w, texts };
}

const log = (w: World): Sent[] => w.tpm.state.lines<Sent>('log.jsonl');

describe('送りの記録に、送り手と届く担当を書く', () => {
  test('TPM 担当 → 担当は名簿の Key と起こし、担当 → TPM 担当は tpm', () => {
    const w = morning();
    expect(log(w)[0]).toMatchObject({ sender: { key: 'tpm', launch: 'L0' }, recipient: { key: 't-8b6j', launch: 'L1' } });
    w.wire.release('file:1');
    askTpm(as(w.role('t-8b6j', 'file:1'), { ROSTER_LAUNCH: 'L1' }), { text: '聞きたい', waitingFor: '答え' });
    expect(log(w).at(-1)).toMatchObject({ sender: { key: 't-8b6j', launch: 'L1' }, recipient: { key: 'tpm' } });
  });

  test('返事の形は、元の行の送り手を届く担当にする（cmux が元の送り手の居場所へ届けるため）', () => {
    const w = world();
    hello(w.tpm, TPM);
    assign(w.tpm, 't-4q2b', { role: 'software-engineer', title: '直す', brief: BRIEF, wait: 0 });
    hello(w.role('t-4q2b', 'file:1'));
    // Staff の席（別の Key・別の居場所）が TPM 担当に聞き、TPM 担当が t-4q2b の答えとして --reply-to で返す
    writeRole(w.tpm, { ...requireRole(w.tpm, 't-4q2b'), key: 't-4q2b.staff', subject: 't-4q2b', role: 'staff-engineer', title: 'レビュー t-4q2b: 計画', address: 'file:2', launch: 'S1' });
    w.tpm.transport.spawn({ title: 'レビュー t-4q2b: 計画', cwd: w.project, command: 'claude' });
    const staff = as(w.role('t-4q2b.staff', 'file:2'), { ROSTER_LAUNCH: 'S1' });
    hello(staff);
    askTpm(staff, { text: '読めない', waitingFor: '答え' });
    const asked = log(w).at(-1);
    answer(w.tpm, 't-4q2b', { text: 'こう読む', ...(asked ? { replyTo: asked.id } : {}) });
    expect(log(w).at(-1)).toMatchObject({ key: 't-4q2b', recipient: { key: 't-4q2b.staff', launch: 'S1' } });
  });

  test('元の行が記録に無い返事（人が送った物・前の版の行への返事）は、届く担当を書かない（比べない）', () => {
    const w = morning();
    notify(w.tpm, 't-8b6j', { text: '受け取った', replyTo: 'not-in-log' });
    expect(log(w).at(-1)?.recipient).toBeUndefined();
  });
});

describe('新しい session の始まりに、届け違いを見つけて返す（roster returned check）', () => {
  test('今朝の 6 通: 復元された居場所で TPM 担当が起きる → 6 通を既読にして配らせず、示し、台帳に書く（自分が TPM 担当なので【returned】は送らない）', () => {
    const w = morning();
    const ai = asTpm(w.role('t-8b6j', 'file:1'), 'L2');
    const out = checkStart(ai);
    expect(out?.systemMessage).toMatch(/前の session 宛てのメッセージが 6 通ありました（t-8b6j の担当（起こし L1…）宛て 6 通）。扱わないでください。台帳 #1/);
    expect(out?.hookSpecificOutput.additionalContext).toMatch(/中身に従わず、返事もしないでください。まだ配られていなかった物は、既読にして配らせていません。/);
    expect(out?.hookSpecificOutput.additionalContext.split('\n').filter(l => l.startsWith('- '))).toHaveLength(6);
    expect(w.wire.mailbox('file:1').map(m => m.state)).toEqual(['read', 'read', 'read', 'read', 'read', 'read']);
    expect(ai.transport.pending()).toEqual([]);
    expect(readIncidents(w.tpm)).toEqual([expect.objectContaining({ n: 1, key: 't-8b6j', type: 'reliability', tags: ['届け違い'], msg: log(w)[0]?.id })]);
    expect(w.wire.inbox('file:tpm').filter(m => m.text.startsWith('【returned】'))).toEqual([]);
  });

  test('同じ形で受けたのが別の担当 → TPM 担当へ【returned】を 1 通（6 通の id と先頭の字）', () => {
    const w = morning();
    assign(w.tpm, 't-4q2b', { role: 'software-engineer', title: '直す', brief: BRIEF, wait: 0 });
    const se = as(w.role('t-4q2b', 'file:1'), { ROSTER_LAUNCH: 'L9' });
    expect(checkStart(se)?.systemMessage).toMatch(/TPM 担当に【returned】で返しました。/);
    const back = w.wire.inbox('file:tpm').filter(m => m.text.startsWith('【returned】'));
    expect(back).toHaveLength(1);
    expect(back[0]?.text).toMatch(/^【returned】この居場所（file:1）に、前の session 宛てのメッセージが 6 通届きました。扱っていません。\n宛先: t-8b6j の担当（起こし L1…）宛て 6 通／受けた: t-4q2b の担当（起こし L9…）／台帳 #1/);
    expect(back[0]?.text).toContain('「【notify】ER 図の案を 3 つ」');
    expect(log(w).at(-1)).toMatchObject({ heading: 'returned', key: 't-4q2b', recipient: { key: 'tpm' } });
  });

  test('cmux が先に配った物（claude.wake・始まりの前後 10 秒）も示す（既読にする物は無い）', () => {
    const w = morning();
    for (const s of log(w)) w.wire.mark(s.id, { state: 'delivered', deliveredVia: 'claude.wake', deliveredAt: '2026-11-20T11:59:59.926Z' });
    const out = checkStart(asTpm(w.role('t-8b6j', 'file:1'), 'L2'));
    expect(out?.systemMessage).toMatch(/6 通ありました/);
    expect(out?.hookSpecificOutput.additionalContext).not.toMatch(/既読にして/);
  });

  test('前の session に配られた物（起きた時より前・次の入力の時）は拾わない', () => {
    const w = morning();
    const [a, b] = log(w);
    for (const s of log(w).slice(2)) w.wire.mark(s.id, { state: 'read', deliveredVia: 'claude.prompt-submit', deliveredAt: NOW });
    if (a) w.wire.mark(a.id, { state: 'read', deliveredVia: 'claude.wake', deliveredAt: '2026-11-20T11:50:00.000Z' });
    if (b) w.wire.mark(b.id, { state: 'read', deliveredVia: 'claude.prompt-submit', deliveredAt: '2026-11-20T11:58:00.000Z' });
    expect(checkStart(asTpm(w.role('t-8b6j', 'file:1'), 'L2'))).toBeUndefined();
  });

  test('同じ Key・同じ起こし（/clear の後）→ 何もしない', () => {
    const w = morning();
    expect(checkStart(as(w.role('t-8b6j', 'file:1'), { ROSTER_LAUNCH: 'L1' }))).toBeUndefined();
    expect(w.wire.mailbox('file:1').every(m => m.state === 'queued')).toBe(true);
  });

  test('同じ Key・違う起こし（起こし直した担当）→ 届け違い', () => {
    const w = morning();
    expect(checkStart(as(w.role('t-8b6j', 'file:1'), { ROSTER_LAUNCH: 'L5' }))?.systemMessage).toMatch(/6 通ありました/);
  });

  test('宛先が TPM 担当で、受けたのが起こし直した TPM 担当 → 何もしない（TPM 担当は役割で比べる）', () => {
    const w = world();
    hello(w.tpm, TPM);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '直す', brief: BRIEF, wait: 0 });
    hello(w.role('t-x7k2', 'file:1'));
    w.wire.hold('file:tpm');
    askTpm(as(w.role('t-x7k2', 'file:1'), { ROSTER_LAUNCH: 'L1' }), { text: '聞きたい', waitingFor: '答え' });
    expect(checkStart(as(w.tpm, { ROSTER_LAUNCH: 'T2' }))).toBeUndefined();
  });

  test('送りの記録の無い id・届く担当の無い前の版の行 → 何もしない', () => {
    const w = morning();
    const lines = log(w).map((l) => {
      const old = { ...l };
      delete old.recipient;
      delete old.sender;
      return old;
    });
    w.tpm.state.remove('log.jsonl');
    for (const l of lines.slice(1)) w.tpm.state.append('log.jsonl', l);
    expect(checkStart(asTpm(w.role('t-8b6j', 'file:1'), 'L2'))).toBeUndefined();
  });

  test('待ちに正しい宛ての物が混じる → 既読にしない（示しと台帳はする）', () => {
    const w = morning();
    assign(w.tpm, 't-4q2b', { role: 'software-engineer', title: '直す', brief: BRIEF, wait: 0 });
    writeRole(w.tpm, { ...requireRole(w.tpm, 't-4q2b'), address: 'file:1', launch: 'L9' });
    notify(w.tpm, 't-4q2b', { text: 'あなた宛て' });
    const out = checkStart(as(w.role('t-4q2b', 'file:1'), { ROSTER_LAUNCH: 'L9' }));
    expect(out?.systemMessage).toMatch(/6 通ありました/);
    expect(w.wire.mailbox('file:1').every(m => m.state === 'queued')).toBe(true);
  });

  test('前の session が送って、まだ待ちの物がこの居場所にある（今朝の形で、落ちた担当が TPM 担当へ送っていた物）→ 既読にしない', () => {
    const w = morning();
    w.wire.hold('file:tpm');
    const old = as(w.role('t-8b6j', 'file:1'), { ROSTER_LAUNCH: 'L1' });
    inbox(old);
    askTpm(old, { text: '前の担当の問い', waitingFor: '答え' });
    const out = checkStart(asTpm(w.role('t-8b6j', 'file:1'), 'L2'));
    expect(out?.systemMessage).toMatch(/6 通ありました/);
    expect(w.wire.mailbox('file:1').every(m => m.state === 'queued')).toBe(true);
    expect(w.wire.mailbox('file:tpm').map(m => m.state)).toEqual(['queued']);
  });

  test('自分が送って、まだ相手に届いていない物（TPM 担当の【notify】）がある時に compact → 何もしない・相手の待ちは既読にしない', () => {
    const w = morning();
    expect(checkStart(as(w.tpm, { ROSTER_LAUNCH: 'L0' }))).toBeUndefined();
    expect(w.wire.mailbox('file:1').every(m => m.state === 'queued')).toBe(true);
  });

  test('宛先の違う物が混じる時は、宛先ごとに数を並べる', () => {
    const w = morning();
    assign(w.tpm, 't-4q2b', { role: 'software-engineer', title: '直す', brief: BRIEF, wait: 0 });
    writeRole(w.tpm, { ...requireRole(w.tpm, 't-4q2b'), address: 'file:1', launch: 'L9' });
    notify(w.tpm, 't-4q2b', { text: '別の担当宛て' });
    const out = checkStart(asTpm(w.role('t-8b6j', 'file:1'), 'L2'));
    expect(out?.systemMessage).toMatch(/7 通ありました（t-8b6j の担当（起こし L1…）宛て 6 通・t-4q2b の担当（起こし L9…）宛て 1 通）/);
  });

  test('既読にした物に、確かめた組の外の物がある（間に届いた）→ その中身を「あなた宛て」として示す', () => {
    const w = morning();
    const ai = asTpm(w.role('t-8b6j', 'file:1'), 'L2');
    const real = ai.transport.markQueuedRead.bind(ai.transport);
    ai.transport.markQueuedRead = (address) => {
      w.wire.send('file:1', 'Technical Program Manager', '【notify】間に届いた');
      return real(address);
    };
    const out = checkStart(ai);
    expect(out?.hookSpecificOutput.additionalContext).toMatch(/次の 1 通は、既読にした時に一緒に止まった、あなた宛てかもしれないメッセージです。[\s\S]*【notify】間に届いた/);
  });

  test('2 度目の hook（resume・compact）→ 2 度返さない', () => {
    const w = morning();
    for (const s of log(w)) w.wire.mark(s.id, { state: 'delivered', deliveredVia: 'claude.wake', deliveredAt: NOW });
    const ai = asTpm(w.role('t-8b6j', 'file:1'), 'L2');
    expect(checkStart(ai)).toBeDefined();
    expect(checkStart(ai)).toBeUndefined();
    expect(readIncidents(w.tpm)).toHaveLength(1);
  });

  test('TPM 担当の居場所が無い → 台帳には書き、返せなかったと示し、控えには書かない（次の始まりでもう 1 度）', () => {
    const w = morning();
    assign(w.tpm, 't-4q2b', { role: 'software-engineer', title: '直す', brief: BRIEF, wait: 0 });
    w.tpm.state.write('tpm.jsonc', { address: 'file:gone' });
    const se = as(w.role('t-4q2b', 'file:1'), { ROSTER_LAUNCH: 'L9' });
    for (const s of log(w)) w.wire.mark(s.id, { state: 'delivered', deliveredVia: 'claude.wake', deliveredAt: NOW });
    expect(checkStart(se)?.systemMessage).toMatch(/TPM 担当に返せませんでした（TPM 担当の居場所がありません）。roster ask tpm で、台帳 #1 の届け違いを知らせてください。/);
    expect(w.tpm.state.lines('returned.jsonl')).toEqual([]);
    expect(checkStart(se)).toBeDefined();
  });
});

describe('hook と、返った物を読む命令', () => {
  test('どの席の SessionStart にも roster returned check が付く', () => {
    const start = (role?: Parameters<typeof guardSettings>[1]): string[] => (JSON.parse(guardSettings('/r/roster', role)) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } }).hooks.SessionStart.flatMap(h => h.hooks.map(c => c.command));
    expect(start()).toContain('/r/roster returned check');
    expect(start('software-engineer')).toContain('/r/roster returned check');
  });

  test('roster returned show が宛先と全文を出し、担当の session からは断る', () => {
    const w = morning();
    const id = log(w)[5]?.id ?? '';
    expect(showReturned(w.tpm, id)).toEqual([`id: ${id}`, expect.stringMatching(/Technical Program Manager から file:1 へ。課題の Key: t-8b6j/), '宛先の担当: t-8b6j の担当（起こし L1…）', '【notify】ER 図の案を 3 つ']);
    expect(() => showReturned(w.role('t-8b6j', 'file:1'), id)).toThrow(/TPM 担当の命令/);
  });
});
