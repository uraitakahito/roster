import { describe, expect, test } from 'vitest';
import { answer, askDevops, askPm, askTpm, dismiss, doneKind, notify, reportDependabot, reportDocFix, reportDone, reportEnd, reportMerged, show, wait } from '../src/commands/messages.ts';
import { hello, inbox } from '../src/commands/role-side.ts';
import { assign, close, roles } from '../src/commands/tpm-side.ts';
import { requireRole } from '../src/roster.ts';
import { TpmError } from '../src/skill-sets.ts';
import { BRIEF, finish, world, type World } from './helpers.ts';

const OUT = 'https://claude.ai/artifact/o1';
const PR = 'https://github.com/o/r/pull/7';
const TPM = { model: 'claude-opus-5-5', effort: 'medium' };

/** TPM 担当が名乗り、t-x7k2 の Software Engineer 担当を起こして名乗らせた世界。 */
async function started(config: Record<string, unknown> = {}, issue?: string): Promise<World & { se: ReturnType<World['role']> }> {
  const w = world(config);
  await hello(w.tpm, TPM);
  await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, ...(issue === undefined ? {} : { issue }) });
  const se = w.role('t-x7k2', 'file:1');
  await hello(se);
  return { ...w, se };
}
const texts = (w: World, address: string): string[] => w.wire.inbox(address).map(m => m.text);
const waitOf = (w: World, address: string): string | undefined => w.wire.status(address)?.wait;

describe('1 つの課題の 1 周（課題管理なし）', () => {
  test('依頼 → 相談 → 完成 → 次の依頼 → 完成 → 片付け → 終わり → 閉じる', async () => {
    const w = await started();
    const FROM = 'SWE t-x7k2: 計画と実装';

    expect(await askTpm(w.se, { text: '案 A と B で迷う。お勧めは A', waitingFor: '案の選択' })).toEqual(['送った: 【ask-tpm】→ file:tpm（相手の手が空いた時に届く。送り直さない）', '状態: 回答待ち(TPM): 案の選択']);
    const asked = w.wire.inbox('file:tpm')[0];
    expect(asked).toMatchObject({ from: FROM, text: '【ask-tpm】案 A と B で迷う。お勧めは A' });
    notify(w.tpm, 't-x7k2', { text: 'A で進める', ...(asked ? { replyTo: asked.id } : {}) });
    expect(w.wire.inbox('file:1')[0]).toMatchObject({ from: 'Technical Program Manager', text: '【notify】A で進める', replyTo: asked?.id });

    expect(wait(w.se, 'work', '実装')).toEqual(['状態: 作業中: 実装']);
    reportMerged(w.se, { pr: PR, note: '段 1 を入れた' });
    expect(reportDone(w.se, { url: OUT, kind: 'plan', summary: 'PR 2 本の計画', remaining: 'なし', decisions: 'なし', points: [] })).toEqual([
      '送った: 【done】→ file:tpm（相手の手が空いた時に届く。送り直さない）',
      '状態: 回答待ち(TPM): 次の依頼（次の【brief】か【dismiss】を待つ。自分から【end】を送らない）',
    ]);
    expect(waitOf(w, 'file:1')).toBe('回答待ち(TPM): 次の依頼');

    // 同じ Key に振ると、起こさずに同じ担当へ【brief】が行く
    expect(await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', note: '計画の実装', wait: 0 })).toEqual(['送った: 【brief】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    expect(requireRole(w.tpm, 't-x7k2').brief).toBe('https://claude.ai/artifact/b2');
    expect(w.wire.seats()).toHaveLength(1);
    reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] });

    expect(() => reportEnd(w.se, { prs: [PR], removed: [], left: 'なし' })).toThrow(/【dismiss】がまだ来ていません/);
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    expect((await roles(w.tpm))[1]).toMatch(/dismiss 済み（終わり）/);
    expect(reportEnd(w.se, { url: OUT, prs: [PR], removed: ['skills-worktrees/t-x-impl'], left: 'なし' })).toEqual([
      '送った: 【end】→ file:tpm（相手の手が空いた時に届く。送り直さない）',
      '状態: 回答待ち(TPM): workspace を閉じる（居場所は自分で閉じない）',
    ]);
    await close(w.tpm, 't-x7k2');

    expect(texts(w, 'file:tpm')).toEqual([
      '【ask-tpm】案 A と B で迷う。お勧めは A',
      `【merged】${PR} 段 1 を入れた`,
      `【done】${OUT} 要点: PR 2 本の計画／残り: なし／決めてほしいこと: なし`,
      `【done】${OUT} 要点: 実装した／残り: なし／決めてほしいこと: なし`,
      `【end】成果: ${OUT}／merge した PR: ${PR}／消した worktree: skills-worktrees/t-x-impl／残っている物: なし`,
    ]);
    expect(texts(w, 'file:1')).toEqual([
      '【notify】A で進める',
      '【brief】https://claude.ai/artifact/b2 計画の実装',
      '【dismiss】この課題に続きは無い。worktree と課題を片付けて【end】を返す。',
    ]);
    expect(await roles(w.tpm)).toEqual(['名簿: 担当はいない']);
    // 外へ打つ命令は無く（課題管理には何も書かない）、置き場に頼むのは【dismiss】の時に返事待ちのページを、待ちの相手ごとに聞く物だけ。
    // Product Manager の分・レビュー待ち・上げた件の順。
    expect(w.calls).toEqual([]);
    expect(w.store.requests.map(r => [r.method, r.path, r.query.reply, r.query.on])).toEqual([['GET', '/api/pages', 'waiting', undefined], ['GET', '/api/pages', 'waiting', 'review'], ['GET', '/api/pages', 'waiting', 'tpm']]);
    // 送ったメッセージは log.jsonl に残る
    expect(w.tpm.state.lines<{ heading: string }>('log.jsonl').map(l => l.heading)).toEqual(['ask-tpm', 'notify', 'merged', 'done', 'brief', 'done', 'dismiss', 'end']);
  });
});

describe('課題への記録（GitHub の Issue）', () => {
  const bodies = (w: World): string[] => w.calls.filter(c => c.args[1] === 'comment').map(c => c.options?.input ?? '');

  test('--kind plan でも、記録は日本語の種類（【計画】）で書く', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    reportDone(w.se, { url: OUT, kind: 'plan', summary: 'PR 2 本の計画', remaining: 'なし', decisions: 'なし', points: [] });
    expect(bodies(w)).toEqual([`【計画】Software Engineer: PR 2 本の計画\n\n計画: ${OUT}`]);
  });

  test('--kind audit は、監査のページの URL を【監査】で書く', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    reportDone(w.se, { url: OUT, kind: 'audit', summary: '原因 2 つと改善案 3 つ', remaining: 'なし', decisions: 'どの改善をするか', points: [] });
    expect(bodies(w)).toEqual([`【監査】Software Engineer: 原因 2 つと改善案 3 つ\n\n監査: ${OUT}`]);
    expect(() => doneKind('監査')).toThrow('--kind 監査 は audit に替わりました（--kind audit）');
  });

  test('決まりの時に 1 件ずつ書き、【end】で課題を閉じる', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    await askPm(w.se, { url: 'https://claude.ai/artifact/c1', items: ['案の選択', '切り替えの単位'], waitingFor: '案と単位' });
    await answer(w.tpm, 't-x7k2', { text: '(1) 案 A (2) project ごと\n細かい事は依頼書に' });
    reportDocFix(w.se, { pr: PR, note: 'ひな形の surface を workspace に直した' });
    reportDone(w.se, { url: OUT, kind: 'proposal', summary: '3 案を比べた', remaining: 'なし', decisions: '案の選択', points: ['お勧めは案 A'] });
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    const out = reportEnd(w.se, { url: OUT, prs: [PR], removed: [], left: 'なし' });

    expect(bodies(w)).toEqual([
      '【確認】Software Engineer: Product Manager に確かめる（2 項）\n\n確認: https://claude.ai/artifact/c1\n\n案の選択\n\n切り替えの単位',
      '【決定】TPM: (1) 案 A (2) project ごと',
      `【文書の修正】Software Engineer: ひな形の surface を workspace に直した\n\nPR（merge 済み）: ${PR}`,
      `【提案】Software Engineer: 3 案を比べた\n\n提案: ${OUT}\n\nお勧めは案 A`,
      `【結果】Software Engineer: 片付けた（残っている物: なし）\n\n成果: ${OUT}\n\nPR（merge 済み）: ${PR}`,
    ]);
    expect(w.calls.at(-1)?.args).toEqual(['issue', 'close', '12', '--reason', 'completed']);
    // assign が課題の写しを作るとき、gh で読み（view）、curl で置き場を確かめる。ほかは記録の gh。
    const tools = w.calls.filter(c => c.cmd !== 'curl');
    expect(tools[0]?.args.slice(0, 2)).toEqual(['issue', 'view']);
    expect(tools.every(c => c.cmd === 'gh' && c.options?.cwd === w.project)).toBe(true);
    expect(out).toContain('課題を閉じた: gh-12');
    expect(texts(w, 'file:tpm')[0]).toBe('【ask-pm】https://claude.ai/artifact/c1 項目: (1) 案の選択 (2) 切り替えの単位');
    expect(texts(w, 'file:1')[0]).toBe('【answer】(1) 案 A (2) project ごと\n細かい事は依頼書に');
  });

  test('【ask-pm】は状態を回答待ち(PM) にする。確認のページは開かない（Product Manager は置き場の一覧の UI で見る）', async () => {
    const w = await started();
    await askPm(w.se, { url: 'https://claude.ai/artifact/c1', items: ['案の選択'], waitingFor: '案の選択' });
    expect(w.tpm.state.lines('file-transport/shown.jsonl')).toEqual([]);
    expect(waitOf(w, 'file:1')).toBe('回答待ち(PM): 案の選択');
    await expect(askPm(w.se, { url: 'u', items: [], waitingFor: 'x' })).rejects.toThrow(/--item/);
  });

  test('担当の交代の【dismiss】では、課題を閉じない', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    await finish(w, 't-x7k2', 'file:1');
    await dismiss(w.tpm, 't-x7k2', { handover: true });
    expect(texts(w, 'file:1')[0]).toMatch(/^【dismiss】担当の交代のため/);
    expect(reportEnd(w.se, { prs: [], removed: [], left: 'なし' })).toContain('課題は閉じない: gh-12（担当の交代。次の担当が引き継ぐ）');
    expect(w.calls.some(c => c.args[1] === 'close')).toBe(false);
  });

  test('新しい【brief】を受けた担当は、dismiss 済みでなくなる', async () => {
    const w = await started();
    await finish(w, 't-x7k2', 'file:1');
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', wait: 0 });
    expect(requireRole(w.tpm, 't-x7k2').dismissed).toBeUndefined();
  });
});

describe('roster report done --kind', () => {
  test('page put と同じ語（proposal・plan・result・audit）を受ける', () => {
    expect(['proposal', 'plan', 'result', 'audit'].map(doneKind)).toEqual(['proposal', 'plan', 'result', 'audit']);
  });

  test('前の値（提案・計画・結果）は誤りにして、替わりの値を案内する', () => {
    expect(() => doneKind('提案')).toThrow('--kind 提案 は proposal に替わりました（--kind proposal）');
    expect(() => doneKind('計画')).toThrow('--kind 計画 は plan に替わりました（--kind plan）');
    expect(() => doneKind('結果')).toThrow('--kind 結果 は result に替わりました（--kind result）');
  });

  test('ほかの値は誤りにする', () => {
    for (const value of ['brief', 'confirm', '確認', 'toString', '']) expect(() => doneKind(value)).toThrow('--kind は proposal・plan・result・audit のどれかにしてください');
  });
});

describe('【done】と【end】に要る欄', () => {
  test.each([
    ['残り', { decisions: 'なし' }, /--remaining（残り） を書いてください/],
    ['決めてほしいこと', { remaining: 'なし' }, /--decisions（決めてほしいこと） を書いてください/],
    ['空白だけの残り', { remaining: ' ', decisions: 'なし' }, /--remaining/],
  ])('%sが無ければ送らない', async (_, fields, message) => {
    const w = await started();
    expect(() => reportDone(w.se, { kind: 'result', summary: 's', points: [], ...fields })).toThrow(message);
    expect(texts(w, 'file:tpm')).toEqual([]);
  });

  test('成果の URL が無い【done】（DevOps Engineer 担当）は、要点から書く', async () => {
    const w = await started();
    reportDone(w.se, { kind: 'result', summary: 'container を作り直した', remaining: 'なし', decisions: 'なし', points: [] });
    expect(texts(w, 'file:tpm')).toEqual(['【done】要点: container を作り直した／残り: なし／決めてほしいこと: なし']);
  });

  test('記録の要点は 3 つまで', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    expect(() => reportDone(w.se, { kind: 'result', summary: 's', remaining: 'なし', decisions: 'なし', points: ['1', '2', '3', '4'] })).toThrow(/3 つまで/);
    expect(texts(w, 'file:tpm')).toEqual([]);
  });

  test('残っている物が無ければ【end】を送らない', async () => {
    const w = await started();
    await finish(w, 't-x7k2', 'file:1');
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(() => reportEnd(w.se, { prs: [], removed: [] })).toThrow(/--left/);
  });
});

describe('ほかのメッセージ', () => {
  test('【ask-devops】は何を・なぜ・急ぎかを並べる', async () => {
    const w = await started();
    askDevops(w.se, { what: 'windmill の worker を作り直す', why: '設定を変えた', urgent: false });
    expect(texts(w, 'file:tpm')).toEqual(['【ask-devops】何を: windmill の worker を作り直す／なぜ: 設定を変えた／急ぎ: いいえ']);
  });

  test('Dependabot の見出し。PR 1 本の担当は【dismiss】を待たずに終われる', async () => {
    const w = world({ 'skill-sets': ['dependabot'] });
    await hello(w.tpm, TPM);
    await assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    const su = w.role('app#12', 'file:1');
    await hello(su);
    expect(reportDependabot(su, 'recreated', { text: '旧 #12 → 新 #15', title: 'Sustaining app#15' })[0]).toBe('題を替えた: Sustaining app#15');
    reportDependabot(su, 'not-yet', { text: 'eligibleAt 2026-11-21T03:00:00Z' });
    reportDependabot(su, 'merge-request', { text: `${PR}／CI: 緑` });
    expect(waitOf(w, 'file:1')).toBe('回答待ち(TPM): merge');
    reportEnd(su, { prs: [PR], removed: [], left: 'なし' });
    expect(w.wire.seats()).toEqual([{ address: 'file:1', title: 'Sustaining app#15' }]);
    expect(texts(w, 'file:tpm')).toEqual([
      '【recreated】旧 #12 → 新 #15',
      '【not-yet】eligibleAt 2026-11-21T03:00:00Z',
      `【merge-request】${PR}／CI: 緑`,
      `【end】成果: なし／merge した PR: ${PR}／消した worktree: なし／残っている物: なし`,
    ]);
    expect(w.wire.inbox('file:tpm').at(-1)?.from).toBe('Sustaining app#15');
  });

  test('居場所が消えた担当には送らずに止まる', async () => {
    const w = await started();
    w.wire.close('file:1');
    expect(() => notify(w.tpm, 't-x7k2', { text: 'x' })).toThrow(/t-x7k2 の担当の居場所がありません/);
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/居場所がありません/);
    expect(requireRole(w.tpm, 't-x7k2').dismissed).toBeUndefined();
  });

  test('TPM 担当が名乗る前は、担当は送れない', async () => {
    const w = world();
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', wait: 0 });
    expect(() => reportMerged(w.role('t-x7k2', 'file:1'), { pr: PR, note: 'n' })).toThrow(/TPM 担当の宛先がありません/);
  });

  test('show は URL を自分の所で開く', async () => {
    const w = await started();
    expect(show(w.tpm, OUT)).toEqual([`開いた: ${OUT}`]);
    expect(w.tpm.state.lines('file-transport/shown.jsonl')).toEqual([{ at: 'file:tpm', url: OUT }]);
  });
});

describe('課題への記録（設定は直下の folder。上の folder から、下の repo を触る課題）', () => {
  /** project の folder に課題管理の設定は無く、直下の skills が jira、web が github の世界で、issue の担当を起こして名乗らせる。 */
  async function crossing(issue: string): Promise<World & { se: ReturnType<World['role']>, greeting: string[] }> {
    const w = world({}, {}, { skills: { tracker: 'jira' }, web: { tracker: 'github' } });
    await hello(w.tpm, TPM);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, issue, noIssueCopy: '試験' });
    const se = w.role('t-x7k2', 'file:1');
    return { ...w, se, greeting: await hello(se) };
  }
  const tools = (w: World): (string | undefined)[][] => w.calls.filter(c => c.cmd !== 'curl').map(c => [c.cmd, c.args[1], c.options?.cwd]);

  test('Jira の Key の課題は、直下の folder の jira の設定で Jira に記録し、【end】で済みにする', async () => {
    const w = await crossing('AI-20');
    expect(w.greeting).toContain('課題管理の課題: AI-20（道具: jira（skills の設定））');
    expect(reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] })[0]).toBe('記録を書いた: AI-20【結果】');
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(reportEnd(w.se, { url: OUT, prs: [PR], removed: [], left: 'なし' })).toContain('課題を閉じた: AI-20');
    expect(w.calls.filter(c => c.cmd !== 'curl').map(c => c.cmd)).toEqual(['acli', 'acli', 'acli']);
  });

  test('gh- の Key の課題は、github を宣言した folder で gh を打つ', async () => {
    const w = await crossing('gh-12');
    expect(w.greeting).toContain('課題管理の課題: gh-12（道具: github（web の設定））');
    reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] });
    expect(tools(w)).toEqual([['gh', 'comment', `${w.project}/web`]]);
  });
});

describe('入口の検査: PR が merge 済みか', () => {
  test.each([
    ['【merged】', (w: Awaited<ReturnType<typeof started>>, unchecked?: string) => reportMerged(w.se, { pr: PR, note: '入れた', ...(unchecked === undefined ? {} : { unchecked }) })],
    ['【doc-fix】', (w: Awaited<ReturnType<typeof started>>, unchecked?: string) => reportDocFix(w.se, { pr: PR, note: '直した', ...(unchecked === undefined ? {} : { unchecked }) })],
  ])('%s は、merge していない PR では送らない', async (_, send) => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    w.prs.set(PR, 'OPEN');
    expect(() => send(w)).toThrow(/PR はまだ merge されていません（state: OPEN）.*\n送っていません/);
    w.prs.set(PR, undefined);
    expect(() => send(w)).toThrow(/PR の状態を読めません.*\ngh: not logged in\n.*--unchecked/);
    // 止まった回は、メッセージも課題の記録も書かない
    expect(texts(w, 'file:tpm')).toEqual([]);
    expect(w.calls.filter(c => c.args[1] === 'comment')).toEqual([]);
    expect(() => send(w, ' ')).toThrow(/--unchecked には/);
    send(w, 'GitLab の画面で見た');
    expect(texts(w, 'file:tpm')[0]).toMatch(/（merge は確かめていない: GitLab の画面で見た）$/);
    w.prs.set(PR, 'MERGED');
    send(w);
    expect(texts(w, 'file:tpm')).toHaveLength(2);
  });

  test('【end】の --pr も見る。PR が無ければ gh を打たない', async () => {
    const w = await started();
    await finish(w, 't-x7k2', 'file:1');
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    w.prs.set(PR, 'CLOSED');
    expect(() => reportEnd(w.se, { prs: [PR], removed: [], left: 'なし' })).toThrow(/state: CLOSED/);
    expect(texts(w, 'file:tpm').filter(text => text.startsWith('【end】'))).toEqual([]);
    reportEnd(w.se, { prs: [], removed: [], left: 'なし', unchecked: '使わない' });
    expect(texts(w, 'file:tpm').filter(text => text.startsWith('【end】'))).toEqual(['【end】成果: なし／merge した PR: なし／消した worktree: なし／残っている物: なし']);
  });
});

describe('入口の検査: 送る前に、読んでいないメッセージを見せる', () => {
  test('担当: TPM 担当からのメッセージが届いていなければ、出して 1 度止まり、打ち直すと送る', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    w.wire.hold('file:1');
    expect(notify(w.tpm, 't-x7k2', { text: 'tag はまだ打たないで待つこと' })[0]).toMatch(/相手の手が空いた時に届く/);
    const done = (): string[] => reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] });
    expect(done).toThrow('相手から、まだ読んでいないメッセージが 1 件あります。送っていません。\n--- Technical Program Manager（id m1-file-1）\n【notify】tag はまだ打たないで待つこと\n--- ここまで\n読んだうえで、同じ命令を打ち直せば送ります（事情が変わっていたら、中身を変えて打つ）。');
    // 止まった回は、メッセージも課題の記録も書かない
    expect(texts(w, 'file:tpm')).toEqual([]);
    expect(w.calls.filter(c => c.args[1] === 'comment')).toEqual([]);
    expect(done()[1]).toBe('送った: 【done】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    // 新しいメッセージが来たら、また 1 度止まる（前に見せた物は出さない）
    notify(w.tpm, 't-x7k2', { text: '2 通目' });
    await expect(askTpm(w.se, { text: 'q', waitingFor: 'a' })).rejects.toThrow(/1 件あります[\s\S]*【notify】2 通目/);
    await askTpm(w.se, { text: 'q', waitingFor: 'a' });
  });

  test('担当: roster inbox で見た後は止まらない', async () => {
    const w = await started();
    w.wire.hold('file:1');
    notify(w.tpm, 't-x7k2', { text: '知らせ' });
    expect(inbox(w.se)).toEqual(['--- Technical Program Manager（id m1-file-1）', '【notify】知らせ']);
    reportMerged(w.se, { pr: PR, note: '入れた' });
    expect(texts(w, 'file:tpm')).toHaveLength(1);
  });

  test('TPM 担当: 送る相手からのメッセージだけで止まる。answer・notify・dismiss・続きの assign', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    await finish(w, 't-x7k2', 'file:1');
    await assign(w.tpm, 't-b2c3', { role: 'software-engineer', title: '別の課題', brief: BRIEF, wait: 0 });
    const other = w.role('t-b2c3', 'file:2');
    await hello(other);
    const comments = (): number => w.calls.filter(c => c.args[1] === 'comment').length;
    w.wire.hold('file:tpm');
    await askTpm(other, { text: '別の課題の問い', waitingFor: 'a' });
    // ほかの担当のメッセージでは止まらない
    notify(w.tpm, 't-x7k2', { text: '知らせ' });
    for (const [i, send] of [
      () => answer(w.tpm, 't-x7k2', { text: '案 A' }),
      () => notify(w.tpm, 't-x7k2', { text: '待つこと' }),
      () => dismiss(w.tpm, 't-x7k2', { handover: false }),
      () => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: BRIEF, wait: 0 }),
    ].entries()) {
      const before = { sent: texts(w, 'file:1').length, comments: comments(), dismissed: requireRole(w.tpm, 't-x7k2').dismissed, pages: w.store.pages.size };
      reportMerged(w.se, { pr: PR, note: `入れた ${i}` });
      await expect(async () => await send()).rejects.toThrow(/^t-x7k2 の担当から、まだ読んでいないメッセージが 1 件あります。[\s\S]*【merged】/);
      // 止まった回は、メッセージ・課題の記録・課題の写しを書かない
      expect({ sent: texts(w, 'file:1').length, comments: comments(), dismissed: requireRole(w.tpm, 't-x7k2').dismissed, pages: w.store.pages.size }).toEqual(before);
      await send();
      expect(texts(w, 'file:1')).toHaveLength(before.sent + 1);
    }
  });
});

describe('入口の検査: 同じメッセージの 2 度送り', () => {
  const at = (seconds: number) => (): Date => new Date(Date.parse('2026-11-20T12:00:00.000Z') + seconds * 1000);

  test('同じ【done】を 30 秒の内に 2 度送ると止まる。課題の記録も 2 件にならない', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    const comments = (): number => w.calls.filter(c => c.args[1] === 'comment').length;
    const done = (summary = '実装した'): string[] => reportDone(w.se, { url: OUT, kind: 'result', summary, remaining: 'なし', decisions: 'なし', points: [] });
    done();
    expect(comments()).toBe(1);
    w.se.now = at(2);
    expect(done).toThrow('同じ【done】を、2026-11-20T12:00:00.000Z にもう送っています（id m1-file-tpm）。2 度目は送っていません。\n打ち直しを ; や || で 1 行に続けて書いていないか確かめてください。もう 1 度送る必要があれば、30 秒待つか、中身を変えて打つ。');
    expect(comments()).toBe(1);
    expect(texts(w, 'file:tpm')).toHaveLength(1);
    expect(w.tpm.state.lines<{ gate: string, detail: string }>('gate.jsonl').map(l => [l.gate, l.detail])).toEqual([['repeat', 'm1-file-tpm']]);
    // 中身が違えば送る。30 秒を過ぎれば、同じ中身でも送る
    done('実装した（直した）');
    w.se.now = at(31);
    done();
    expect(comments()).toBe(3);
  });

  test('課題に記録を書くほかの命令（ask-pm・doc-fix・end・answer）も、記録の前に止まる', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    await finish(w, 't-x7k2', 'file:1');
    const comments = (): number => w.calls.filter(c => c.args[1] === 'comment').length;
    for (const send of [
      () => askPm(w.se, { url: OUT, items: ['案'], waitingFor: '案' }),
      () => reportDocFix(w.se, { pr: PR, note: '直した' }),
      () => answer(w.tpm, 't-x7k2', { text: '案 A' }),
      async () => (await dismiss(w.tpm, 't-x7k2', { handover: true }), reportEnd(w.se, { prs: [], removed: [], left: 'なし' })),
    ]) {
      await send();
      const before = comments();
      await expect(async () => await send()).rejects.toThrow(/^同じ【(ask-pm|doc-fix|answer|dismiss)】を/);
      expect(comments()).toBe(before);
    }
    expect(() => reportEnd(w.se, { prs: [], removed: [], left: 'なし' })).toThrow(/^同じ【end】を/);
  });

  test('返事の先が違えば、同じ本文でも送る（「受け取った」を続けて返す）', async () => {
    const w = await started();
    notify(w.tpm, 't-x7k2', { text: '受け取った', replyTo: 'a' });
    notify(w.tpm, 't-x7k2', { text: '受け取った', replyTo: 'b' });
    expect(() => notify(w.tpm, 't-x7k2', { text: '受け取った', replyTo: 'b' })).toThrow(/^同じ【notify】を/);
    expect(texts(w, 'file:1')).toHaveLength(2);
  });
});

describe('入口の検査: TPM 担当が送って済んでいない物（dismiss・続きの assign）', () => {
  const B4 = 'http://127.0.0.1:8801/p/t-x7k2/brief-4.html';
  const B5 = 'http://127.0.0.1:8801/p/t-x7k2/brief-5.html';
  /** 1 つ目の依頼書を済ませ、brief-4 を送った世界。held なら担当は手を動かしていて、brief-4 は届いていない。 */
  async function sentBrief4(held: boolean): Promise<World & { se: ReturnType<World['role']> }> {
    const w = await started();
    reportDone(w.se, { kind: 'result', summary: '1 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    if (held) w.wire.hold('file:1');
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0 });
    return w;
  }
  const at = (seconds: number) => (): Date => new Date(Date.parse('2026-11-20T12:00:00.000Z') + seconds * 1000);
  const gates = (w: World): string[][] => w.tpm.state.lines<{ gate: string, detail: string }>('gate.jsonl').map(l => [l.gate, l.detail]);

  test('#17 の形: 届いていない brief-4 があるのに交代の dismiss を打つと、出して止まる', async () => {
    const w = await sentBrief4(true);
    const sent = texts(w, 'file:1').length;
    await expect(dismiss(w.tpm, 't-x7k2', { handover: true })).rejects.toThrow([
      't-x7k2 の担当に、まだ済んでいない物があります。送っていません。',
      '--- まだ見ていない（届いておらず、roster も見せていない。2026-11-20T12:00:00.000Z に送った。id m1-file-1）',
      `【brief】${B4}`,
      `--- 【done】が返っていない依頼書: brief-4（${B4}）`,
      '--- ここまで',
      'この依頼書・メッセージをどうするかを Product Manager に確かめてください。取り消すなら --supersede を付けて打ち直す（本文に「取り消す: …」と載る）。',
    ].join('\n'));
    // 止まった回は送らず、名簿も変えない。gate.jsonl に残す
    expect(texts(w, 'file:1')).toHaveLength(sent);
    expect(requireRole(w.tpm, 't-x7k2').dismissed).toBeUndefined();
    expect(gates(w)).toEqual([['unsettled', `t-x7k2: m1-file-1 ${B4}`]]);
  });

  test('--supersede を付ければ送り、本文に取り消す依頼書が載る', async () => {
    const w = await sentBrief4(true);
    await dismiss(w.tpm, 't-x7k2', { handover: true, supersede: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【dismiss】担当の交代のため（課題は続くので、課題は閉じない）。worktree を片付けて【end】を返す。取り消す: brief-4（${B4}）`);
    expect(requireRole(w.tpm, 't-x7k2').dismissed).toBe('handover');
  });

  test('届いた依頼書でも、【done】が返っていなければ dismiss も続きの assign も止まる', async () => {
    const w = await sentBrief4(false);
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/^t-x7k2 の担当に、まだ済んでいない物があります。[\s\S]*【done】が返っていない依頼書: brief-4/);
    await expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0 })).rejects.toThrow(/【done】が返っていない依頼書: brief-4[\s\S]*--after、取り消すなら --supersede/);
    // 止まる訳は「済んでいない物がある」の方で、「依頼書が届いていない」の文は出ない（reject はする）。
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.not.toThrow(/届いていない/);
  });

  test('#110 の形: 配られていなくても、担当に見せた物では止まらない（見せていない物では今までどおり止まる）', async () => {
    const w = await started();
    reportDone(w.se, { kind: 'result', summary: '1 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    // 担当は手を動かし続けていて、cmux は配らない。TPM 担当の【notify】2 通は queued のまま
    w.wire.hold('file:1');
    notify(w.tpm, 't-x7k2', { text: '受け取った' });
    notify(w.tpm, 't-x7k2', { text: 'お勧めのとおりで' });
    // 担当が roster inbox で 2 通を見た（shown/ に入る）。cmux はまだ配っていない
    expect(inbox(w.se)).toHaveLength(4);
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(gates(w)).toEqual([]);
  });

  test('届け違いで返した【brief】（returned.jsonl）は、配られていても、まだ見ていない・済んでいない物として止まる（t-4q2b）', async () => {
    const w = await started();
    reportDone(w.se, { kind: 'result', summary: '1 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0 });
    w.tpm.state.append('returned.jsonl', { at: '2026-11-20T12:00:01.000Z', id: 'm1-file-1', incident: 1 });
    // 担当が【done】を送っても、返した依頼書の分には数えない
    reportDone(w.se, { kind: 'result', summary: '別の物', remaining: 'なし', decisions: 'なし', points: [] });
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(`--- 【done】が返っていない依頼書: brief-4（${B4}）`);
  });

  test('返した【notify】を送り直した後の dismiss は、「届け違いで返した」と字を分けて止まり、--supersede の本文も同じ字にする', async () => {
    const w = await started();
    reportDone(w.se, { kind: 'result', summary: '1 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    notify(w.tpm, 't-x7k2', { text: '前の担当への知らせ' });
    w.tpm.state.append('returned.jsonl', { at: '2026-11-20T12:00:01.000Z', id: 'm1-file-1', incident: 1 });
    // TPM 担当が【returned】を扱い、今の担当に送り直した
    notify(w.tpm, 't-x7k2', { text: '今の担当への知らせ' });
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow([
      't-x7k2 の担当に、まだ済んでいない物があります。送っていません。',
      '--- 届け違いで返した（2026-11-20T12:00:00.000Z に送った。id m1-file-1。roster returned show m1-file-1。送り直したか、要らないと決めたなら --supersede）',
      '【notify】前の担当への知らせ',
      '--- ここまで',
    ].join('\n'));
    await dismiss(w.tpm, 't-x7k2', { handover: false, supersede: true });
    expect(texts(w, 'file:1').at(-1)).toMatch(/取り消す: 届け違いで返した【notify】（2026-11-20T12:00:00\.000Z に送った。id m1-file-1）$/);
  });

  test('見せていない queued の物は「まだ見ていない」として出して止まり、--supersede の本文も同じ字にする', async () => {
    const w = await started();
    reportDone(w.se, { kind: 'result', summary: '1 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    w.wire.hold('file:1');
    notify(w.tpm, 't-x7k2', { text: '受け取った' });
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow([
      't-x7k2 の担当に、まだ済んでいない物があります。送っていません。',
      '--- まだ見ていない（届いておらず、roster も見せていない。2026-11-20T12:00:00.000Z に送った。id m1-file-1）',
      '【notify】受け取った',
      '--- ここまで',
    ].join('\n'));
    await dismiss(w.tpm, 't-x7k2', { handover: false, supersede: true });
    expect(texts(w, 'file:1').at(-1)).toMatch(/取り消す: まだ見ていない【notify】（2026-11-20T12:00:00\.000Z に送った。id m1-file-1）$/);
  });

  test('ふつうの流れ（依頼書 → 【done】 → dismiss・続きの assign）では止まらない', async () => {
    const w = await sentBrief4(false);
    reportDone(w.se, { kind: 'result', summary: '2 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    expect(await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0 })).toEqual(['送った: 【brief】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    reportDone(w.se, { kind: 'result', summary: '3 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    await dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(gates(w)).toEqual([]);
  });

  test('brief-4 が済む前の続きの assign は、--after で「済ませてから」、--supersede で「取り消す」と載せて送る', async () => {
    const w = await sentBrief4(false);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B5} brief-4（${B4}）を済ませてから、これをする`);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4.replace('brief-4', 'brief-6'), wait: 0, supersede: true });
    // --after で積んだ brief-4 も、まだ済んでいないので一緒に取り消す
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B4.replace('brief-4', 'brief-6')} 取り消す: brief-4（${B4}）・brief-5（${B5}）`);
    expect(w.tpm.state.lines<{ heading: string, settle?: string }>('log.jsonl').filter(l => l.heading === 'brief').map(l => l.settle)).toEqual(['none', 'after', 'supersede']);
    // 取り消した後は、brief-6 だけが済んでいない
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/【done】が返っていない依頼書: brief-6（[^）]*）\n/);
  });

  test('--after で積んだ依頼書は、1 つずつ【done】が返るまで済んでいない（t-aj3v の形）', async () => {
    const w = await started();
    const B2 = B4.replace('brief-4', 'brief-2');
    const B3 = B4.replace('brief-4', 'brief-3');
    // brief-1 が済む前に、brief-2・brief-3 を --after で積む。どちらも届いている
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B2, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B2} brief-1（${BRIEF}）を済ませてから、これをする`);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B3, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B3} brief-1（${BRIEF}）・brief-2（${B2}）を済ませてから、これをする`);
    // brief-1 の【done】は、brief-1 だけを済ませる（いちばん新しい brief-3 の分に数えない）
    reportDone(w.se, { kind: 'result', summary: 'brief-1', remaining: 'なし', decisions: 'なし', points: [] });
    await expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0 })).rejects.toThrow(`--- 【done】が返っていない依頼書: brief-2（${B2}）・brief-3（${B3}）\n`);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B4} brief-2（${B2}）・brief-3（${B3}）を済ませてから、これをする`);
    for (const summary of ['brief-2', 'brief-3']) reportDone(w.se, { kind: 'result', summary, remaining: 'なし', decisions: 'なし', points: [] });
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(`--- 【done】が返っていない依頼書: brief-4（${B4}）\n`);
    reportDone(w.se, { kind: 'result', summary: 'brief-4', remaining: 'なし', decisions: 'なし', points: [] });
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('#110 の形: 1 通の【done】で --briefs に名指した依頼書は、みな済む（名指さなければ今までどおり古い 1 つ）', async () => {
    const B2 = B4.replace('brief-4', 'brief-2');
    const B3 = B4.replace('brief-4', 'brief-3');
    const build = async (): Promise<World & { se: ReturnType<World['role']> }> => {
      const w = await started();
      await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B2, wait: 0, after: true });
      await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B3, wait: 0, after: true });
      return w;
    };
    const w = await build();
    // 名でも URL でも名指せる
    const out = reportDone(w.se, { kind: 'result', summary: '1〜3 を済ませた', remaining: 'なし', decisions: 'なし', points: [], briefs: ['brief-1', B2, 'brief-3'] });
    expect(out).toContain('送った: 【done】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    expect(texts(w, 'file:tpm').at(-1)).toBe('【done】要点: 1〜3 を済ませた／残り: なし／決めてほしいこと: なし／済ませた依頼書: brief-1・brief-2・brief-3');
    expect(w.tpm.state.lines<{ heading: string, briefs?: string[] }>('log.jsonl').findLast(l => l.heading === 'done')?.briefs).toEqual([BRIEF, B2, B3]);
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
    // 名指さなければ、brief-1 だけが済み、まだ見て済んでいない依頼書があることを 1 行で知らせる
    const v = await build();
    expect(reportDone(v.se, { kind: 'result', summary: '1〜3 を済ませた', remaining: 'なし', decisions: 'なし', points: [] })).toContain(
      '済ませた依頼書がいくつもあれば --briefs で名指す（今は brief-1 だけを済ませた。済んでいない: brief-2・brief-3）',
    );
    await expect(dismiss(v.tpm, 't-x7k2', { handover: false })).rejects.toThrow(`--- 【done】が返っていない依頼書: brief-2（${B2}）・brief-3（${B3}）\n`);
  });

  test('--briefs: 渡していない・済んだ依頼書を名指すと、送らずに止まる。名が 2 つ当たれば URL を求める', async () => {
    const w = await started();
    const B2 = B4.replace('brief-4', 'brief-2');
    const done = (briefs: string[]) => (): string[] => reportDone(w.se, { kind: 'result', summary: 'x', remaining: 'なし', decisions: 'なし', points: [], briefs });
    expect(done(['brief-9'])).toThrow([
      '--briefs の brief-9 は、渡されていて済んでいない依頼書にありません。送っていません。',
      `済んでいない依頼書: brief-1（${BRIEF}）`,
    ].join('\n'));
    done(['brief-1'])();
    expect(done(['brief-1'])).toThrow(/^--briefs の brief-1 は、渡されていて済んでいない依頼書にありません。送っていません。\n済んでいない依頼書: 無し$/);
    // 別の Key の folder の同じ名の依頼書も渡されていれば、名では決めない
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B2, wait: 0 });
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B2.replace('/t-x7k2/', '/t-other/'), wait: 0, after: true });
    expect(done(['brief-2'])).toThrow(/^--briefs の brief-2 に当たる依頼書が 2 つあります。URL で名指してください。送っていません。/);
    expect(texts(w, 'file:tpm').filter(t => t.startsWith('【done】'))).toHaveLength(1);
    // URL なら通り、名が 2 つに当たる依頼書は本文に URL を添える。名と URL で同じ物を 2 度名指しても 1 つ
    done([B2])();
    expect(texts(w, 'file:tpm').at(-1)).toBe(`【done】要点: x／残り: なし／決めてほしいこと: なし／済ませた依頼書: brief-2（${B2}）`);
  });

  test('--briefs: 名と URL で同じ依頼書を名指しても 1 つ。同じ依頼書を送り直していても、URL で名指せばみな済む', async () => {
    const w = await started();
    const B2 = B4.replace('brief-4', 'brief-2');
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B2, wait: 0, after: true });
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B2, wait: 0, after: true });
    reportDone(w.se, { kind: 'result', summary: 'x', remaining: 'なし', decisions: 'なし', points: [], briefs: ['brief-1', BRIEF, 'brief-2'] });
    expect(texts(w, 'file:tpm').at(-1)).toBe('【done】要点: x／残り: なし／決めてほしいこと: なし／済ませた依頼書: brief-1・brief-2');
    expect(w.tpm.state.lines<{ heading: string, briefs?: string[] }>('log.jsonl').findLast(l => l.heading === 'done')?.briefs).toEqual([BRIEF, B2]);
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('--briefs が無い【done】は、連携の道具が受信箱を読めなくても送る（案内の数えだけを飛ばす）', async () => {
    const w = await started();
    const queued = w.se.transport.queued.bind(w.se.transport);
    w.se.transport.queued = () => {
      throw new TpmError('cmux agent inbox が失敗しました');
    };
    expect(reportDone(w.se, { kind: 'result', summary: 'x', remaining: 'なし', decisions: 'なし', points: [] })).toContain('送った: 【done】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    w.se.transport.queued = queued;
  });

  test('答えが届く前に続きの assign を打っても止まらない（答え → すぐ続きの依頼書）', async () => {
    const w = await started();
    reportDone(w.se, { kind: 'plan', summary: '計画', remaining: 'なし', decisions: 'なし', points: [] });
    w.wire.hold('file:1');
    await answer(w.tpm, 't-x7k2', { text: '確認の 1 は案 A。続けて依頼書を送る' });
    expect((await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0 }))[0]).toMatch(/^送った: 【brief】/);
  });

  test('済んでいない物があっても、answer と notify は止めない', async () => {
    const w = await sentBrief4(true);
    expect((await answer(w.tpm, 't-x7k2', { text: '案 A' }))[0]).toMatch(/^送った: 【answer】/);
    expect(notify(w.tpm, 't-x7k2', { text: '知らせ' })[0]).toMatch(/^送った: 【notify】/);
  });

  test('#3 の形（担当が手を動かす間に「待て」を送る）は、送る側では止めない（A1 の外）', async () => {
    const w = await started();
    reportDone(w.se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
    w.wire.hold('file:1');
    expect(notify(w.tpm, 't-x7k2', { text: 'tag はまだ打たないで待つこと' })[0]).toMatch(/相手の手が空いた時に届く/);
    expect(gates(w)).toEqual([]);
  });

  test('#36 の形: 画面に届く前に roster inbox で読んで済ませた依頼書は、済んだと数える', async () => {
    const w = await sentBrief4(true);
    w.se.now = at(60);
    expect(inbox(w.se)).toEqual(['--- Technical Program Manager（id m1-file-1）', `【brief】${B4}`]);
    w.se.now = at(150);
    reportDone(w.se, { kind: 'proposal', summary: 'brief-4', remaining: 'なし', decisions: 'なし', points: [] });
    // 連携の道具は【done】の 8 秒後に画面へ届けた
    w.wire.release('file:1', '2026-11-20T12:02:38.000Z');
    // 見せた時刻は、初めて見せた時のまま（後で見せ直しても進まない）
    w.se.now = at(200);
    inbox(w.se);
    expect(w.tpm.state.read('shown/file-1.jsonc')).toEqual([{ id: 'm1-file-1', at: '2026-11-20T12:01:00.000Z' }]);
    w.tpm.now = at(300);
    expect(await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0 })).toEqual(['送った: 【brief】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    expect(gates(w)).toEqual([]);
  });

  test('#36 の形: 送る前の検査が見せた依頼書も、見せた時刻から済ませられる', async () => {
    const w = await sentBrief4(true);
    w.se.now = at(60);
    const done = (): string[] => reportDone(w.se, { kind: 'proposal', summary: 'brief-4', remaining: 'なし', decisions: 'なし', points: [] });
    expect(done).toThrow(/まだ読んでいないメッセージが 1 件あります[\s\S]*brief-4/);
    w.se.now = at(150);
    done();
    w.wire.release('file:1', '2026-11-20T12:02:38.000Z');
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('見せていない依頼書は、画面に届く前の【done】で済まない（行き違い）', async () => {
    const w = await sentBrief4(true);
    // 担当が brief-4 を見る前に【done】が出た（送る命令と依頼書が行き違った）。送る前の検査を通らない形を、log に直に書いて作る
    w.se.state.append('log.jsonl', { at: '2026-11-20T12:00:03.000Z', key: 't-x7k2', heading: 'done', from: 'SWE t-x7k2: 計画と実装', to: 'file:tpm', text: '【done】前の分', id: 'd-race', delivered: true });
    w.wire.release('file:1', '2026-11-20T12:00:08.000Z');
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/【done】が返っていない依頼書: brief-4/);
  });

  test('#58 の形: 前の版が時刻を書かずに覚えた依頼書は、送った時刻に見せた物として、画面に届く前の【done】で済む', async () => {
    const w = await sentBrief4(true);
    w.tpm.state.write('shown/file-1.jsonc', ['m1-file-1']);
    // 送る前の検査は、前の形で覚えた物でも止まらない
    w.se.now = at(60);
    reportDone(w.se, { kind: 'result', summary: 'brief-4', remaining: 'なし', decisions: 'なし', points: [] });
    // 新しい版が書き直しても、時刻の無い項目は時刻の無いまま
    w.se.now = at(90);
    w.wire.send('file:1', 'Technical Program Manager', '【notify】受け取った');
    inbox(w.se);
    expect(w.tpm.state.read('shown/file-1.jsonc')).toEqual([{ id: 'm1-file-1' }, { id: 'm2-file-1', at: '2026-11-20T12:01:30.000Z' }]);
    w.wire.release('file:1', '2026-11-20T12:05:00.000Z');
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('--supersede と --after を両方付けるか、済んでいない物が無いのに付けたら止まる', async () => {
    const w = await sentBrief4(false);
    await expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0, supersede: true, after: true })).rejects.toThrow('--supersede と --after は、どちらか 1 つにしてください');
    reportDone(w.se, { kind: 'result', summary: '2 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false, supersede: true })).rejects.toThrow('t-x7k2 の担当に、済んでいない物はありません。--supersede を付けずに打ってください');
    await expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0, after: true })).rejects.toThrow(/済んでいない物はありません。--after/);
  });

  test('最初の依頼書（roster hello で受けた物）も、【done】が無ければ dismiss は止まり、あれば通る', async () => {
    const w = await started();
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/【done】が返っていない依頼書: brief-1/);
    reportDone(w.se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
  });
});

describe('入口の検査: TPM 担当だけの命令は、担当の session から打てない', () => {
  test('担当が notify・answer・dismiss・assign・close を打つと断り、何も送らず・書かない', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    await assign(w.tpm, 't-b2c3', { role: 'software-engineer', title: '別の課題', brief: BRIEF, wait: 0 });
    await hello(w.role('t-b2c3', 'file:2'));
    const state = (): unknown => ({
      sent: texts(w, 'file:2'),
      comments: w.calls.filter(c => c.args[1] === 'comment').length,
      seats: w.wire.seats().length,
      role: requireRole(w.tpm, 't-b2c3'),
      pages: w.store.pages.size,
    });
    const before = state();
    for (const [command, send] of [
      ['roster notify', () => notify(w.se, 't-b2c3', { text: 'TPM 担当の名で届く字' })],
      ['roster answer', () => answer(w.se, 't-b2c3', { text: '案 A' })],
      ['roster dismiss', () => dismiss(w.se, 't-b2c3', { handover: false })],
      ['roster assign', () => assign(w.se, 't-b2c3', { role: 'software-engineer', brief: BRIEF, wait: 0 })],
      ['roster close', () => close(w.se, 't-b2c3')],
    ] as const) {
      await expect(async () => await send()).rejects.toThrow(`${command} は TPM 担当の命令です。担当の session（t-x7k2）からは打てません。TPM 担当に頼むことは、roster ask tpm で送ってください`);
      expect(state()).toEqual(before);
    }
    // 止めた回は、入口の検査の記録に残る
    expect(w.tpm.state.lines<{ gate: string, by: string, detail: string }>('gate.jsonl').filter(l => l.gate === 'tpm-only').map(l => `${l.by} ${l.detail}`)).toEqual(['t-x7k2 roster notify', 't-x7k2 roster answer', 't-x7k2 roster dismiss', 't-x7k2 roster assign', 't-x7k2 roster close']);
  });
});

describe('入口の検査: 自分が送った物は、未読に数えない（台帳 #97・#100）', () => {
  // 連携の道具（cmux）は、自分の受信箱の「まだ届いていない物」に、自分が送ってまだ届いていない物も返す。
  test('担当: 自分が送ってまだ届いていない物では止まらない。相手からの未読では、今のとおり止まる', async () => {
    const w = await started();
    w.wire.hold('file:tpm');
    await askTpm(w.se, { text: '1 通目', waitingFor: 'a' });
    const mine = w.wire.inbox('file:tpm').map(m => ({ id: m.id, from: m.from, text: m.text }));
    expect(mine).toHaveLength(1);
    const real = w.se.transport.pending.bind(w.se.transport);
    w.se.transport.pending = () => [...mine, ...real()];
    expect(reportMerged(w.se, { pr: PR, note: '入れた' })[0]).toMatch(/^送った: 【merged】/);
    w.wire.release('file:tpm');
    w.wire.hold('file:1');
    notify(w.tpm, 't-x7k2', { text: '待つこと' });
    await expect(askTpm(w.se, { text: '2 通目', waitingFor: 'a' })).rejects.toThrow(/まだ読んでいないメッセージが 1 件あります[\s\S]*【notify】待つこと/);
  });

  test('返事の形で、記録の宛先とずれて自分に届いた物は、除かない（送り手で見分ける）', async () => {
    const w = await started();
    await assign(w.tpm, 't-b2c3', { role: 'software-engineer', title: '別の課題', brief: BRIEF, wait: 0 });
    await hello(w.role('t-b2c3', 'file:2'));
    // TPM 担当が別の担当（file:2）宛てに送った物が、返事の先の取り違えで、この担当に届いた形（記録の宛先は file:2 のまま）
    w.wire.hold('file:2');
    notify(w.tpm, 't-b2c3', { text: '取り違えた返事' });
    const stray = w.wire.inbox('file:2').map(m => ({ id: m.id, from: m.from, text: m.text }));
    w.se.transport.pending = () => stray;
    await expect(askTpm(w.se, { text: 'q', waitingFor: 'a' })).rejects.toThrow(/まだ読んでいないメッセージが 1 件あります[\s\S]*【notify】取り違えた返事/);
  });
});
