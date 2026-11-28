// Tech Lead 担当と repo の席が、じかに話す道（AI-45 の段 3）。repo の席の成果・merge の知らせ・片付けの終わり・問いは Tech Lead 担当へ、
// Tech Lead 担当の依頼書・知らせ・片付けの指示は repo の席へ届く。思わぬ出来事・共有の環境の頼み・相談は、TPM 担当へ届く。
import { describe, expect, test } from 'vitest';
import { askDevops, askLead, askTpm, reportDone, reportEnd, reportIncident, reportMerged, type DoneOptions } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { seatAdd, seatBrief, seatClose, seatDismiss, seatNotify } from '../src/commands/seat.ts';
import { collect } from '../src/commands/timeline.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { readRole, writeRole } from '../src/roster.ts';
import { BRIEF, world, type World, MAIN_PASSED } from './helpers.ts';

const BRIEF2 = BRIEF.replace('brief-1', 'brief-2');
const DONE: DoneOptions = { kind: 'result', summary: 'server を入れた', remaining: 'なし', decisions: 'なし', points: [] };
const PR = 'https://github.com/o/pagetray/pull/7';

type Ctx = World['tpm'];

/** Tech Lead 担当（AI-36・file:1）と、名乗った repo の席 pagetray（file:2）。 */
async function split(): Promise<World & { lead: Ctx, seat: Ctx, texts: (address: string) => string[] }> {
  const w = world();
  await hello(w.tpm);
  await assign(w.tpm, 'AI-36', { role: 'tech-lead', title: '3 つの repo', brief: BRIEF, wait: 0, seats: 2 });
  const lead = w.role('AI-36', 'file:1');
  await hello(lead);
  await seatAdd(lead, 'pagetray', { brief: BRIEF, wait: 0 });
  const seat = w.role('AI-36.pagetray', 'file:2');
  await hello(seat);
  return { ...w, lead, seat, texts: address => w.posted(address).map(m => m.text) };
}

describe('repo の席から上へ（Tech Lead 担当へ届く物）', () => {
  test('成果（【done】）・merge の知らせ（【merged】）は Tech Lead 担当へ届く。TPM 担当へは届かない。状態は 回答待ち(Lead)', async () => {
    const w = await split();
    const out = await reportDone(w.seat, DONE);
    expect(out[0]).toBe('送った: 【done】→ file:1（相手の手が空いた時に届く。送り直さない）');
    expect(out.at(-1)).toBe('状態: 回答待ち(Lead): 次の依頼（次の【brief】か【dismiss】を待つ。自分から【end】を送らない）');
    await reportMerged(w.seat, { pr: PR, note: 'server' });
    expect(w.texts('file:1')).toEqual(['【done】要点: server を入れた／残り: なし／決めてほしいこと: なし', `【merged】${PR} server${MAIN_PASSED}`]);
    expect(w.texts('file:tpm')).toEqual([]);
    expect(w.wire.status('file:2')?.wait).toBe('回答待ち(Lead): 次の依頼');
  });

  test('思わぬ出来事・共有の環境の頼み・相談は、repo の席からも TPM 担当へ届く', async () => {
    const w = await split();
    await reportIncident(w.seat, { text: '行き違い', type: 'reliability', tags: [], severe: false });
    await askDevops(w.seat, { what: 'builder', why: '落ちた', urgent: false });
    await askTpm(w.seat, { text: 'Tech Lead 担当の席が応えない', waitingFor: '答え' });
    expect(w.texts('file:tpm').map(t => /^【([^】]+)】/.exec(t)?.[1])).toEqual(['incident', 'ask-devops', 'ask-tpm']);
    expect(w.texts('file:1')).toEqual([]);
  });

  test('問い（roster ask lead）は Tech Lead 担当へ届き、状態が 回答待ち(Lead) になる。repo の席でない担当は打てない', async () => {
    const w = await split();
    expect(await askLead(w.seat, { text: '境の取り決めの欄の名は？', waitingFor: '欄の名' })).toEqual(['送った: 【ask-lead】→ file:1（相手の手が空いた時に届く。送り直さない）', '状態: 回答待ち(Lead): 欄の名']);
    expect(w.texts('file:1')).toEqual(['【ask-lead】境の取り決めの欄の名は？']);
    await expect(askLead(w.lead, { text: 'x', waitingFor: 'y' })).rejects.toThrow(/^roster ask lead は、Tech Lead 担当が起こした repo の席が打ちます/);
  });

  test('2 度送りは、Tech Lead 担当の宛先で止まる', async () => {
    const w = await split();
    await reportMerged(w.seat, { pr: PR, note: 'server' });
    await expect(reportMerged(w.seat, { pr: PR, note: 'server' })).rejects.toThrow(/^同じ【merged】を、.*もう送っています/);
    expect(w.texts('file:1')).toHaveLength(1);
  });

  test('TPM 担当の宛先が無くても、repo の席の成果は Tech Lead 担当へ送れる', async () => {
    const w = await split();
    w.tpm.state.remove('tpm.jsonc');
    expect((await reportDone(w.seat, DONE))[0]).toMatch(/^送った: 【done】→ file:1/);
  });

  test('Tech Lead 担当の席が無ければ、送らず・記録も書かずに止まる（TPM 担当への相談を案内する）', async () => {
    const w = await split();
    w.wire.close('file:1');
    await expect(reportDone(w.seat, DONE)).rejects.toThrow(/^AI-36 の Tech Lead 担当の席がありません。送っていません・記録も書いていません。roster ask tpm で TPM 担当に知らせてください/);
    await expect(askLead(w.seat, { text: 'x', waitingFor: 'y' })).rejects.toThrow(/Tech Lead 担当の席がありません/);
    expect((await askTpm(w.seat, { text: 'Tech Lead 担当の席が無い', waitingFor: '答え' }))[0]).toMatch(/^送った: 【ask-tpm】→ file:tpm/);
  });
});

describe('Tech Lead 担当から下へ（roster seat brief・notify・dismiss）', () => {
  test('次の依頼書（【brief】）: 前の依頼書が済んでいなければ止まり、--after・--supersede で進む。送り手は Tech Lead 担当', async () => {
    const w = await split();
    await expect(seatBrief(w.lead, 'pagetray', { brief: BRIEF2 })).rejects.toThrow(/^AI-36\.pagetray の担当に、まだ済んでいない物があります。送っていません。[\s\S]*【done】が返っていない依頼書: brief-1[\s\S]*させてから進むなら --after、取り消すなら --supersede/);
    expect(await seatBrief(w.lead, 'pagetray', { brief: BRIEF2, after: true })).toEqual(['送った: 【brief】→ file:2（相手の手が空いた時に届く。送り直さない）']);
    const [sent] = w.posted('file:2');
    expect(sent?.from).toBe('Lead AI-36: 3 つの repo');
    // 課題の写し（親の課題の folder に置いた物）の行が間に入る。
    expect(sent?.text).toMatch(new RegExp(`^【brief】${BRIEF2} 課題の写し: \\S+/AI-36/issue-\\d+\\.html brief-1（${BRIEF}）を済ませてから、これをする$`));
    expect(readRole(w.tpm, 'AI-36.pagetray')?.brief).toBe(BRIEF2);
  });

  test('repo の席の【done】は、Tech Lead 担当の渡した依頼書を、古い順に 1 つずつ済ませる', async () => {
    const w = await split();
    await seatBrief(w.lead, 'pagetray', { brief: BRIEF2, after: true });
    await reportDone(w.seat, DONE);
    // brief-1 だけが済み、brief-2 が残る。
    await expect(seatDismiss(w.lead, 'pagetray', {})).rejects.toThrow(/【done】が返っていない依頼書: brief-2[\s\S]*済ませてもらうか取り消すかを決めてください。取り消すなら --supersede/);
    w.pass(31_000);
    await reportDone(w.seat, { ...DONE, summary: '試験を足した' });
    expect(await seatDismiss(w.lead, 'pagetray', {})).toEqual(['送った: 【dismiss】→ file:2（相手の手が空いた時に届く。送り直さない）']);
  });

  test('Tech Lead 担当の題が替わった後の【done】も、前に渡した依頼書を済ませる（送り手を、題の字でなく担当の Key で見分ける）', async () => {
    const w = await split();
    await reportDone(w.seat, DONE);
    await seatBrief(w.lead, 'pagetray', { brief: BRIEF2 });
    writeRole(w.tpm, { ...readRole(w.tpm, 'AI-36')!, title: 'Lead AI-36: 題を替えた' });
    w.pass(31_000);
    await reportDone(w.seat, { ...DONE, summary: '試験を足した' });
    expect((await seatDismiss(w.lead, 'pagetray', {}))[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('知らせ（【notify】）と、片付け: 【dismiss】→ repo の席の【end】が Tech Lead 担当へ → roster seat close', async () => {
    const w = await split();
    await reportDone(w.seat, DONE);
    expect(await seatNotify(w.lead, 'pagetray', { text: '欄の名は actorRef' })).toEqual(['送った: 【notify】→ file:2（相手の手が空いた時に届く。送り直さない）']);
    await seatDismiss(w.lead, 'pagetray', {});
    expect(w.posted('file:2').map(m => m.text)).toEqual(['【notify】欄の名は actorRef', '【dismiss】この席の仕事に続きは無い。worktree を片付けて【end】を返す（課題は済みにならない。済みにするのは Tech Lead 担当の片付けの時）。']);
    const ended = await reportEnd(w.seat, { prs: [], removed: [], left: 'なし' });
    expect(ended.at(-1)).toBe('状態: 回答待ち(Lead): 席を閉じる（居場所は自分で閉じない）');
    expect(w.texts('file:1').at(-1)).toBe('【end】成果: なし／merge した PR: なし／消した worktree: なし／残っている物: なし');
    expect(w.texts('file:tpm')).toEqual([]);
    expect(await seatClose(w.lead, 'pagetray')).toEqual(['閉じた: SWE AI-36 pagetray: 課題（file:2）']);
  });

  test('送る前の検査は、Tech Lead 担当でも効く: repo の席からまだ読んでいない物があれば、1 度止まる', async () => {
    const w = await split();
    w.hold('file:1');
    await reportDone(w.seat, DONE);
    await expect(seatBrief(w.lead, 'pagetray', { brief: BRIEF2 })).rejects.toThrow(/^AI-36\.pagetray の担当から、まだ読んでいないメッセージが 1 件あります。送っていません。/);
    expect((await seatBrief(w.lead, 'pagetray', { brief: BRIEF2 }))[0]).toMatch(/^送った: 【brief】/);
  });

  test('居場所の無い席には送らず、Tech Lead 担当の打てる手（起こし直す・閉じる）を案内する', async () => {
    const w = await split();
    w.wire.close('file:2');
    for (const send of [() => seatBrief(w.lead, 'pagetray', { brief: BRIEF2 }), () => seatNotify(w.lead, 'pagetray', { text: 'x' }), () => seatDismiss(w.lead, 'pagetray', {})]) {
      await expect(send()).rejects.toThrow(/^AI-36\.pagetray の席の居場所がありません（落ちた・名乗らなかった）。送っていません。起こし直すなら roster seat add pagetray --brief <URL>、要らなければ roster seat close pagetray で名簿から消す/);
    }
  });

  test('続きの依頼書には、Tech Lead 担当が今持っている課題の写しを渡す', async () => {
    const w = await split();
    await reportDone(w.seat, DONE);
    writeRole(w.tpm, { ...readRole(w.tpm, 'AI-36')!, issuePage: 'http://127.0.0.1:8801/p/AI-36/issue-9.html' });
    await seatBrief({ ...w.lead }, 'pagetray', { brief: BRIEF2 });
    expect(readRole(w.tpm, 'AI-36.pagetray')?.issuePage).toBe('http://127.0.0.1:8801/p/AI-36/issue-9.html');
    expect(w.posted('file:2').at(-1)?.text).toBe(`【brief】${BRIEF2} 課題の写し: http://127.0.0.1:8801/p/AI-36/issue-9.html`);
  });

  test('席のまだ応えていない【ask-lead】が 1 つなら、Tech Lead 担当の【notify】がそれを返事の先にする（--no-reply なら付けない）', async () => {
    const w = await split();
    const rows = (): { id: string, heading: string, replyTo?: string }[] => w.tpm.state.lines('log.jsonl');
    w.pass(60_000);
    await askLead(w.seat, { text: '境の取り決めの欄の名は？', waitingFor: '欄の名' });
    const asked = rows().findLast(l => l.heading === 'ask-lead')?.id ?? 'no-ask';
    w.pass(60_000);
    expect(await seatNotify(w.lead, 'pagetray', { text: '別の知らせ', noReply: true })).toEqual(['送った: 【notify】→ file:2（相手の手が空いた時に届く。送り直さない）']);
    expect(rows().findLast(l => l.heading === 'notify')?.replyTo).toBeUndefined();
    w.pass(60_000);
    await askLead(w.seat, { text: 'もう 1 度: 欄の名は？', waitingFor: '欄の名' });
    const again = rows().findLast(l => l.heading === 'ask-lead')?.id ?? 'no-ask';
    w.pass(60_000);
    expect(await seatNotify(w.lead, 'pagetray', { text: '欄の名は actorRef' })).toEqual(['送った: 【notify】→ file:2（相手の手が空いた時に届く。送り直さない）', `返事の先: 【ask-lead】もう 1 度: 欄の名は？（id ${again}）を付けた`]);
    expect(rows().findLast(l => l.heading === 'notify')?.replyTo).toBe(again);
    expect(again).not.toBe(asked);
  });

  test('席を起こす時の依頼書は、印の行で残り（送り手は Tech Lead 担当）、席の最初の【done】がそれを先にする', async () => {
    const w = await split();
    const rows = (): { id: string, heading: string, key: string, from: string, launch?: true, replyTo?: string, sender?: { key: string } }[] => w.tpm.state.lines('log.jsonl');
    const launched = rows().find(l => l.launch === true && l.key === 'AI-36.pagetray');
    expect(launched).toMatchObject({ heading: 'brief', sender: { key: 'AI-36' } });
    await reportDone(w.seat, DONE);
    expect(rows().findLast(l => l.heading === 'done')?.replyTo).toBe(launched?.id ?? 'no-launch-row');
  });

  test('時系列の列は、送った担当で決まる（Tech Lead 担当の【brief】は Tech Lead 担当の列。TPM 担当の列に入らない）', async () => {
    const w = await split();
    await reportDone(w.seat, DONE);
    await seatBrief(w.lead, 'pagetray', { brief: BRIEF2 });
    const events = collect(w.tpm, 'AI-36').filter(e => e.kind === 'メッセージ');
    // 頭の【brief】（TPM 担当が Tech Lead 担当を起こした時の依頼書の行）は TPM 担当の列。Tech Lead 担当が席へ送った物（起こす時の行も）は Tech Lead 担当の列
    expect(events.filter(e => e.what.startsWith('【brief】')).map(e => e.seat)).toEqual(['tpm', 'AI-36', 'AI-36']);
    expect(events.find(e => e.what.startsWith('【done】'))?.seat).toBe('AI-36.pagetray');
    expect(events.filter(e => e.seat === 'tpm').map(e => e.what.slice(0, 7))).toEqual(['【brief】']);
  });

  test('断る: 自分の課題の repo の席でない相手・Tech Lead 担当でない者', async () => {
    const w = await split();
    await expect(seatBrief(w.lead, 'castlist', { brief: BRIEF2 })).rejects.toThrow(/^AI-36\.castlist の席が名簿にいません/);
    await expect(seatNotify(w.seat, 'pagetray', { text: 'x' })).rejects.toThrow(/^roster seat notify は Tech Lead 担当が打ちます/);
    await expect(seatDismiss(w.tpm, 'pagetray', {})).rejects.toThrow(/\$ROSTER_KEY がありません/);
  });
});
