import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Context } from '../src/context.ts';
import { answer, askTpm, notify, type Sent } from '../src/commands/messages.ts';
import { showReturned } from '../src/commands/returned.ts';
import { hello, inboxNow } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { requireRole, writeRole } from '../src/roster.ts';
import { BRIEF, world, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
/** 環境変数を替えた周り（同じ居場所で起きた別の session）。 */
const as = (ctx: Context, env: NodeJS.ProcessEnv): Context => ({ ...ctx, env: { ...ctx.env, ...env } });
/**
 * 今朝の形の世界: TPM 担当が t-8b6j の担当（起こし L1、居場所 file:1）を起こし、担当が手を動かしている間に 6 通を送った（待ちのまま）。
 */
async function morning(): Promise<World & { texts: string[] }> {
  const w = world();
  await hello(w.tpm, TPM);
  await assign(w.tpm, 't-8b6j', { role: 'software-engineer', title: 'castlist の小さな直し', brief: BRIEF, wait: 0 });
  writeRole(w.tpm, { ...requireRole(w.tpm, 't-8b6j'), launch: 'L1' });
  await hello(w.role('t-8b6j', 'file:1'));
  w.hold('file:1');
  const texts = ['db.md に型', 'confirm-1 (1) 済み', 'お勧めで', '受け取った（#83）', 'A: ?at= のまま', 'ER 図の案を 3 つ'];
  for (const text of texts) await notify(as(w.tpm, { ROSTER_LAUNCH: 'L0' }), 't-8b6j', { text });
  return { ...w, texts };
}

/** 送ったメッセージの行（席を起こす時の頼みの行は除く）。 */
const log = (w: World): Sent[] => w.tpm.state.lines<Sent>('log.jsonl').filter(l => l.launch !== true);

describe('送りの記録に、送り手と届く担当を書く', () => {
  test('TPM 担当 → 担当は名簿の Key と起こし、担当 → TPM 担当は tpm。箱は、届く担当の受け手の名（起こした回が入る）', async () => {
    const w = await morning();
    expect(log(w)[0]).toMatchObject({ sender: { key: 'tpm', launch: 'L0' }, recipient: { key: 't-8b6j', launch: 'L1' }, carrier: 'nats', box: 't-8b6j__L1' });
    await w.release('file:1');
    await askTpm(as(w.role('t-8b6j', 'file:1'), { ROSTER_LAUNCH: 'L1' }), { text: '聞きたい', waitingFor: '答え' });
    expect(log(w).at(-1)).toMatchObject({ sender: { key: 't-8b6j', launch: 'L1' }, recipient: { key: 'tpm' }, carrier: 'nats', box: 'tpm' });
  });

  test('前の session（別の起こし）宛ての物は、起こし直した担当の箱には入らない（受け手の名に、起こした回が入る）', async () => {
    const w = await morning();
    expect(w.posted('t-8b6j__L1')).toHaveLength(6);
    // 同じ居場所で、別の起こし（L2）の担当が起きても、自分宛ての箱は空（送る前の検査も止まらない）。
    const again = as(w.role('t-8b6j', 'file:1'), { ROSTER_LAUNCH: 'L2' });
    expect(await inboxNow(again)).toEqual(['まだ届いていないメッセージは無い']);
    expect((await askTpm(again, { text: '聞きたい', waitingFor: '答え' }))[0]).toMatch(/^送った: 【ask-tpm】/);
  });

  test('返事の形（--reply-to）でも、届く担当は、呼ぶ側が名指した担当のまま（元の行の送り手に替えない）。返事の先は、記録と置く物に残る', async () => {
    const w = world();
    await hello(w.tpm, TPM);
    await assign(w.tpm, 't-4q2b', { role: 'software-engineer', title: '直す', brief: BRIEF, wait: 0 });
    await hello(w.role('t-4q2b', 'file:1'));
    // Staff の席（別の Key・別の居場所）が TPM 担当に聞き、TPM 担当が t-4q2b の担当へ --reply-to を付けて送る
    writeRole(w.tpm, { ...requireRole(w.tpm, 't-4q2b'), key: 't-4q2b.staff', subject: 't-4q2b', role: 'staff-engineer', title: 'レビュー t-4q2b: 計画', address: 'file:2', launch: 'S1' });
    w.tpm.seats.spawn({ title: 'レビュー t-4q2b: 計画', cwd: w.project, command: 'claude' });
    const staff = as(w.role('t-4q2b.staff', 'file:2'), { ROSTER_LAUNCH: 'S1' });
    await hello(staff);
    await askTpm(staff, { text: '読めない', waitingFor: '答え' });
    const asked = log(w).at(-1);
    await answer(w.tpm, 't-4q2b', { text: 'こう読む', ...(asked ? { replyTo: asked.id } : {}) });
    expect(log(w).at(-1)).toMatchObject({ key: 't-4q2b', recipient: { key: 't-4q2b' }, box: 't-4q2b', replyTo: asked?.id });
    expect(w.posted('t-4q2b').at(-1)).toMatchObject({ text: '【answer】こう読む', replyTo: asked?.id });
    expect(w.posted('t-4q2b_2estaff__S1')).toEqual([]);
  });

  test('元の行が記録に無い返事（人が送った物・前の版の行への返事）でも、名指した担当へ届ける', async () => {
    const w = await morning();
    await notify(w.tpm, 't-8b6j', { text: '受け取った', replyTo: 'not-in-log' });
    expect(log(w).at(-1)).toMatchObject({ recipient: { key: 't-8b6j', launch: 'L1' }, box: 't-8b6j__L1', replyTo: 'not-in-log' });
  });
});

describe('届け違いの hook の命令（前の版が起こした席のために残す）と、返った物を読む命令', () => {
  test('roster returned check は、何もせず・何も出さずに 0 で終わる（設定が誤っていても・状態の folder も作らない）', () => {
    for (const config of [{ transport: 'file' }, { transport: 'file', messages: 'cmux' }]) {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-returned-cli-')));
      mkdirSync(join(dir, '.claude', 'roles'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'roles', 'config.jsonc'), JSON.stringify(config));
      // 試験を流す担当の居場所の ROSTER_* と cmux・Claude Code の変数を抜いた環境で動かす。
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, XDG_STATE_HOME: join(dir, 'state') };
      const r = spawnSync(join(import.meta.dirname, '..', 'bin', 'roster'), ['returned', 'check'], { cwd: dir, env, input: JSON.stringify({ session_id: 's-1', hook_event_name: 'SessionStart' }), encoding: 'utf8' });
      expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
      expect(readdirSync(dir)).toEqual(['.claude']);
    }
  });

  test('roster returned show が宛先と全文を出し、担当の session からは断る', async () => {
    const w = await morning();
    const id = log(w)[5]?.id ?? '';
    expect(showReturned(w.tpm, id)).toEqual([`id: ${id}`, expect.stringMatching(/Technical Program Manager から file:1 へ。課題の Key: t-8b6j/), '宛先の担当: t-8b6j の担当（起こし L1…）', '【notify】ER 図の案を 3 つ']);
    expect(() => showReturned(w.role('t-8b6j', 'file:1'), id)).toThrow(/TPM 担当の命令/);
  });
});
