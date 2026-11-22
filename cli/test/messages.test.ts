import { describe, expect, test } from 'vitest';
import { answer, askDevops, askPm, askTpm, dismiss, doneKind, notify, reportDependabot, reportDocFix, reportDone, reportEnd, reportMerged, show, wait } from '../src/commands/messages.ts';
import { hello, inbox } from '../src/commands/role-side.ts';
import { assign, close, roles } from '../src/commands/tpm-side.ts';
import { requireRole } from '../src/roster.ts';
import { BRIEF, finish, world, type World } from './helpers.ts';

const OUT = 'https://claude.ai/artifact/o1';
const PR = 'https://github.com/o/r/pull/7';
const TPM = { model: 'claude-opus-5-5', effort: 'medium' };

/** TPM 担当が名乗り、t-x7k2 の Software Engineer 担当を起こして名乗らせた世界。 */
function started(config: Record<string, unknown> = {}, issue?: string): World & { se: ReturnType<World['role']> } {
  const w = world(config);
  hello(w.tpm, TPM);
  assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, ...(issue === undefined ? {} : { issue }) });
  const se = w.role('t-x7k2', 'file:1');
  hello(se);
  return { ...w, se };
}
const texts = (w: World, address: string): string[] => w.wire.inbox(address).map(m => m.text);
const waitOf = (w: World, address: string): string | undefined => w.wire.status(address)?.wait;

describe('1 つの課題の 1 周（課題管理なし）', () => {
  test('依頼 → 相談 → 完成 → 次の依頼 → 完成 → 片付け → 終わり → 閉じる', () => {
    const w = started();
    const FROM = 'SWE t-x7k2: 計画と実装';

    expect(askTpm(w.se, { text: '案 A と B で迷う。お勧めは A', waitingFor: '案の選択' })).toEqual(['送った: 【ask-tpm】→ file:tpm（届いた）', '状態: 回答待ち(TPM): 案の選択']);
    const asked = w.wire.inbox('file:tpm')[0];
    expect(asked).toMatchObject({ from: FROM, text: '【ask-tpm】案 A と B で迷う。お勧めは A' });
    notify(w.tpm, 't-x7k2', { text: 'A で進める', ...(asked ? { replyTo: asked.id } : {}) });
    expect(w.wire.inbox('file:1')[0]).toMatchObject({ from: 'Technical Program Manager', text: '【notify】A で進める', replyTo: asked?.id });

    expect(wait(w.se, 'work', '実装')).toEqual(['状態: 作業中: 実装']);
    reportMerged(w.se, { pr: PR, note: '段 1 を入れた' });
    expect(reportDone(w.se, { url: OUT, kind: 'plan', summary: 'PR 2 本の計画', remaining: 'なし', decisions: 'なし', points: [] })).toEqual([
      '送った: 【done】→ file:tpm（届いた）',
      '状態: 回答待ち(TPM): 次の依頼（次の【brief】か【dismiss】を待つ。自分から【end】を送らない）',
    ]);
    expect(waitOf(w, 'file:1')).toBe('回答待ち(TPM): 次の依頼');

    // 同じ Key に振ると、起こさずに同じ担当へ【brief】が行く
    expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', note: '計画の実装', wait: 0 })).toEqual(['送った: 【brief】→ file:1（届いた）']);
    expect(requireRole(w.tpm, 't-x7k2').brief).toBe('https://claude.ai/artifact/b2');
    expect(w.wire.seats()).toHaveLength(1);
    reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] });

    expect(() => reportEnd(w.se, { prs: [PR], removed: [], left: 'なし' })).toThrow(/【dismiss】がまだ来ていません/);
    dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(roles(w.tpm)[1]).toMatch(/dismiss 済み（終わり）/);
    expect(reportEnd(w.se, { url: OUT, prs: [PR], removed: ['skills-worktrees/t-x-impl'], left: 'なし' })).toEqual([
      '送った: 【end】→ file:tpm（届いた）',
      '状態: 回答待ち(TPM): workspace を閉じる（居場所は自分で閉じない）',
    ]);
    close(w.tpm, 't-x7k2');

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
    expect(roles(w.tpm)).toEqual(['名簿: 担当はいない']);
    // 外へ打つ命令は、【dismiss】の時に置き場へ返事待ちのページを聞く 1 回だけ（課題管理には何も書かない）。
    expect(w.calls.map(c => [c.cmd, new URL(c.args.at(-1) ?? '').searchParams.get('reply')])).toEqual([['curl', 'waiting']]);
    // 送ったメッセージは log.jsonl に残る
    expect(w.tpm.state.lines<{ heading: string }>('log.jsonl').map(l => l.heading)).toEqual(['ask-tpm', 'notify', 'merged', 'done', 'brief', 'done', 'dismiss', 'end']);
  });
});

describe('課題への記録（GitHub の Issue）', () => {
  const bodies = (w: World): string[] => w.calls.filter(c => c.args[1] === 'comment').map(c => c.options?.input ?? '');

  test('--kind plan でも、記録は日本語の種類（【計画】）で書く', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    reportDone(w.se, { url: OUT, kind: 'plan', summary: 'PR 2 本の計画', remaining: 'なし', decisions: 'なし', points: [] });
    expect(bodies(w)).toEqual([`【計画】Software Engineer: PR 2 本の計画\n\n計画: ${OUT}`]);
  });

  test('--kind audit は、監査のページの URL を【監査】で書く', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    reportDone(w.se, { url: OUT, kind: 'audit', summary: '原因 2 つと改善案 3 つ', remaining: 'なし', decisions: 'どの改善をするか', points: [] });
    expect(bodies(w)).toEqual([`【監査】Software Engineer: 原因 2 つと改善案 3 つ\n\n監査: ${OUT}`]);
    expect(() => doneKind('監査')).toThrow('--kind 監査 は audit に替わりました（--kind audit）');
  });

  test('決まりの時に 1 件ずつ書き、【end】で課題を閉じる', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    askPm(w.se, { url: 'https://claude.ai/artifact/c1', items: ['案の選択', '切り替えの単位'], waitingFor: '案と単位' });
    answer(w.tpm, 't-x7k2', { text: '(1) 案 A (2) project ごと\n細かい事は依頼書に' });
    reportDocFix(w.se, { pr: PR, note: 'ひな形の surface を workspace に直した' });
    reportDone(w.se, { url: OUT, kind: 'proposal', summary: '3 案を比べた', remaining: 'なし', decisions: '案の選択', points: ['お勧めは案 A'] });
    dismiss(w.tpm, 't-x7k2', { handover: false });
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

  test('【ask-pm】は状態を回答待ち(PM) にする。確認のページは開かない（Product Manager は置き場の一覧の UI で見る）', () => {
    const w = started();
    askPm(w.se, { url: 'https://claude.ai/artifact/c1', items: ['案の選択'], waitingFor: '案の選択' });
    expect(w.tpm.state.lines('file-transport/shown.jsonl')).toEqual([]);
    expect(waitOf(w, 'file:1')).toBe('回答待ち(PM): 案の選択');
    expect(() => askPm(w.se, { url: 'u', items: [], waitingFor: 'x' })).toThrow(/--item/);
  });

  test('担当の交代の【dismiss】では、課題を閉じない', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    finish(w, 't-x7k2', 'file:1');
    dismiss(w.tpm, 't-x7k2', { handover: true });
    expect(texts(w, 'file:1')[0]).toMatch(/^【dismiss】担当の交代のため/);
    expect(reportEnd(w.se, { prs: [], removed: [], left: 'なし' })).toContain('課題は閉じない: gh-12（担当の交代。次の担当が引き継ぐ）');
    expect(w.calls.some(c => c.args[1] === 'close')).toBe(false);
  });

  test('新しい【brief】を受けた担当は、dismiss 済みでなくなる', () => {
    const w = started();
    finish(w, 't-x7k2', 'file:1');
    dismiss(w.tpm, 't-x7k2', { handover: false });
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', wait: 0 });
    expect(requireRole(w.tpm, 't-x7k2').dismissed).toBeUndefined();
  });
});

describe('tpm report done --kind', () => {
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
  ])('%sが無ければ送らない', (_, fields, message) => {
    const w = started();
    expect(() => reportDone(w.se, { kind: 'result', summary: 's', points: [], ...fields })).toThrow(message);
    expect(texts(w, 'file:tpm')).toEqual([]);
  });

  test('成果の URL が無い【done】（DevOps Engineer 担当）は、要点から書く', () => {
    const w = started();
    reportDone(w.se, { kind: 'result', summary: 'container を作り直した', remaining: 'なし', decisions: 'なし', points: [] });
    expect(texts(w, 'file:tpm')).toEqual(['【done】要点: container を作り直した／残り: なし／決めてほしいこと: なし']);
  });

  test('記録の要点は 3 つまで', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    expect(() => reportDone(w.se, { kind: 'result', summary: 's', remaining: 'なし', decisions: 'なし', points: ['1', '2', '3', '4'] })).toThrow(/3 つまで/);
    expect(texts(w, 'file:tpm')).toEqual([]);
  });

  test('残っている物が無ければ【end】を送らない', () => {
    const w = started();
    finish(w, 't-x7k2', 'file:1');
    dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(() => reportEnd(w.se, { prs: [], removed: [] })).toThrow(/--left/);
  });
});

describe('ほかのメッセージ', () => {
  test('【ask-devops】は何を・なぜ・急ぎかを並べる', () => {
    const w = started();
    askDevops(w.se, { what: 'windmill の worker を作り直す', why: '設定を変えた', urgent: false });
    expect(texts(w, 'file:tpm')).toEqual(['【ask-devops】何を: windmill の worker を作り直す／なぜ: 設定を変えた／急ぎ: いいえ']);
  });

  test('Dependabot の見出し。PR 1 本の担当は【dismiss】を待たずに終われる', () => {
    const w = world({ 'skill-sets': ['dependabot'] });
    hello(w.tpm, TPM);
    assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    const su = w.role('app#12', 'file:1');
    hello(su);
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

  test('居場所が消えた担当には送らずに止まる', () => {
    const w = started();
    w.wire.close('file:1');
    expect(() => notify(w.tpm, 't-x7k2', { text: 'x' })).toThrow(/t-x7k2 の担当の居場所がありません/);
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false })).toThrow(/居場所がありません/);
    expect(requireRole(w.tpm, 't-x7k2').dismissed).toBeUndefined();
  });

  test('TPM 担当が名乗る前は、担当は送れない', () => {
    const w = world();
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', wait: 0 });
    expect(() => reportMerged(w.role('t-x7k2', 'file:1'), { pr: PR, note: 'n' })).toThrow(/TPM 担当の宛先がありません/);
  });

  test('show は URL を自分の所で開く', () => {
    const w = started();
    expect(show(w.tpm, OUT)).toEqual([`開いた: ${OUT}`]);
    expect(w.tpm.state.lines('file-transport/shown.jsonl')).toEqual([{ at: 'file:tpm', url: OUT }]);
  });
});

describe('課題への記録（設定は直下の folder。上の folder から、下の repo を触る課題）', () => {
  /** project の folder に課題管理の設定は無く、直下の skills が jira、web が github の世界で、issue の担当を起こして名乗らせる。 */
  function crossing(issue: string): World & { se: ReturnType<World['role']>, greeting: string[] } {
    const w = world({}, {}, { skills: { tracker: 'jira' }, web: { tracker: 'github' } });
    hello(w.tpm, TPM);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, issue, noIssueCopy: '試験' });
    const se = w.role('t-x7k2', 'file:1');
    return { ...w, se, greeting: hello(se) };
  }
  const tools = (w: World): (string | undefined)[][] => w.calls.filter(c => c.cmd !== 'curl').map(c => [c.cmd, c.args[1], c.options?.cwd]);

  test('Jira の Key の課題は、直下の folder の jira の設定で Jira に記録し、【end】で済みにする', () => {
    const w = crossing('AI-20');
    expect(w.greeting).toContain('課題管理の課題: AI-20（道具: jira（skills の設定））');
    expect(reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] })[0]).toBe('記録を書いた: AI-20【結果】');
    dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(reportEnd(w.se, { url: OUT, prs: [PR], removed: [], left: 'なし' })).toContain('課題を閉じた: AI-20');
    expect(w.calls.filter(c => c.cmd !== 'curl').map(c => c.cmd)).toEqual(['acli', 'acli', 'acli']);
  });

  test('gh- の Key の課題は、github を宣言した folder で gh を打つ', () => {
    const w = crossing('gh-12');
    expect(w.greeting).toContain('課題管理の課題: gh-12（道具: github（web の設定））');
    reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] });
    expect(tools(w)).toEqual([['gh', 'comment', `${w.project}/web`]]);
  });
});

describe('入口の検査: PR が merge 済みか', () => {
  test.each([
    ['【merged】', (w: ReturnType<typeof started>, unchecked?: string) => reportMerged(w.se, { pr: PR, note: '入れた', ...(unchecked === undefined ? {} : { unchecked }) })],
    ['【doc-fix】', (w: ReturnType<typeof started>, unchecked?: string) => reportDocFix(w.se, { pr: PR, note: '直した', ...(unchecked === undefined ? {} : { unchecked }) })],
  ])('%s は、merge していない PR では送らない', (_, send) => {
    const w = started({ tracker: 'github' }, 'gh-12');
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

  test('【end】の --pr も見る。PR が無ければ gh を打たない', () => {
    const w = started();
    finish(w, 't-x7k2', 'file:1');
    dismiss(w.tpm, 't-x7k2', { handover: false });
    w.prs.set(PR, 'CLOSED');
    expect(() => reportEnd(w.se, { prs: [PR], removed: [], left: 'なし' })).toThrow(/state: CLOSED/);
    expect(texts(w, 'file:tpm').filter(text => text.startsWith('【end】'))).toEqual([]);
    reportEnd(w.se, { prs: [], removed: [], left: 'なし', unchecked: '使わない' });
    expect(texts(w, 'file:tpm').filter(text => text.startsWith('【end】'))).toEqual(['【end】成果: なし／merge した PR: なし／消した worktree: なし／残っている物: なし']);
  });
});

describe('入口の検査: 送る前に、読んでいないメッセージを見せる', () => {
  test('担当: TPM 担当からのメッセージが届いていなければ、出して 1 度止まり、打ち直すと送る', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    w.wire.hold('file:1');
    expect(notify(w.tpm, 't-x7k2', { text: 'tag はまだ打たないで待つこと' })[0]).toMatch(/まだ届いていない/);
    const done = (): string[] => reportDone(w.se, { url: OUT, kind: 'result', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] });
    expect(done).toThrow('TPM 担当から、まだ読んでいないメッセージが 1 件あります。送っていません。\n--- Technical Program Manager（id m1-file-1）\n【notify】tag はまだ打たないで待つこと\n--- ここまで\n読んだうえで、同じ命令を打ち直せば送ります（事情が変わっていたら、中身を変えて打つ）。');
    // 止まった回は、メッセージも課題の記録も書かない
    expect(texts(w, 'file:tpm')).toEqual([]);
    expect(w.calls.filter(c => c.args[1] === 'comment')).toEqual([]);
    expect(done()[1]).toBe('送った: 【done】→ file:tpm（届いた）');
    // 新しいメッセージが来たら、また 1 度止まる（前に見せた物は出さない）
    notify(w.tpm, 't-x7k2', { text: '2 通目' });
    expect(() => askTpm(w.se, { text: 'q', waitingFor: 'a' })).toThrow(/1 件あります[\s\S]*【notify】2 通目/);
    askTpm(w.se, { text: 'q', waitingFor: 'a' });
  });

  test('担当: tpm inbox で見た後は止まらない', () => {
    const w = started();
    w.wire.hold('file:1');
    notify(w.tpm, 't-x7k2', { text: '知らせ' });
    expect(inbox(w.se)).toEqual(['--- Technical Program Manager（id m1-file-1）', '【notify】知らせ']);
    reportMerged(w.se, { pr: PR, note: '入れた' });
    expect(texts(w, 'file:tpm')).toHaveLength(1);
  });

  test('TPM 担当: 送る相手からのメッセージだけで止まる。answer・notify・dismiss・続きの assign', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    finish(w, 't-x7k2', 'file:1');
    assign(w.tpm, 't-b2c3', { role: 'software-engineer', title: '別の課題', brief: BRIEF, wait: 0 });
    const other = w.role('t-b2c3', 'file:2');
    hello(other);
    const comments = (): number => w.calls.filter(c => c.args[1] === 'comment').length;
    w.wire.hold('file:tpm');
    askTpm(other, { text: '別の課題の問い', waitingFor: 'a' });
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
      expect(send).toThrow(/^t-x7k2 の担当から、まだ読んでいないメッセージが 1 件あります。[\s\S]*【merged】/);
      // 止まった回は、メッセージ・課題の記録・課題の写しを書かない
      expect({ sent: texts(w, 'file:1').length, comments: comments(), dismissed: requireRole(w.tpm, 't-x7k2').dismissed, pages: w.store.pages.size }).toEqual(before);
      send();
      expect(texts(w, 'file:1')).toHaveLength(before.sent + 1);
    }
  });
});

describe('入口の検査: 同じメッセージの 2 度送り', () => {
  const at = (seconds: number) => (): Date => new Date(Date.parse('2026-11-20T12:00:00.000Z') + seconds * 1000);

  test('同じ【done】を 30 秒の内に 2 度送ると止まる。課題の記録も 2 件にならない', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
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

  test('課題に記録を書くほかの命令（ask-pm・doc-fix・end・answer）も、記録の前に止まる', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    finish(w, 't-x7k2', 'file:1');
    const comments = (): number => w.calls.filter(c => c.args[1] === 'comment').length;
    for (const send of [
      () => askPm(w.se, { url: OUT, items: ['案'], waitingFor: '案' }),
      () => reportDocFix(w.se, { pr: PR, note: '直した' }),
      () => answer(w.tpm, 't-x7k2', { text: '案 A' }),
      () => (dismiss(w.tpm, 't-x7k2', { handover: true }), reportEnd(w.se, { prs: [], removed: [], left: 'なし' })),
    ]) {
      send();
      const before = comments();
      expect(send).toThrow(/^同じ【(ask-pm|doc-fix|answer|dismiss)】を/);
      expect(comments()).toBe(before);
    }
    expect(() => reportEnd(w.se, { prs: [], removed: [], left: 'なし' })).toThrow(/^同じ【end】を/);
  });

  test('返事の先が違えば、同じ本文でも送る（「受け取った」を続けて返す）', () => {
    const w = started();
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
  function sentBrief4(held: boolean): World & { se: ReturnType<World['role']> } {
    const w = started();
    reportDone(w.se, { kind: 'result', summary: '1 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    if (held) w.wire.hold('file:1');
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0 });
    return w;
  }
  const at = (seconds: number) => (): Date => new Date(Date.parse('2026-11-20T12:00:00.000Z') + seconds * 1000);
  const gates = (w: World): string[][] => w.tpm.state.lines<{ gate: string, detail: string }>('gate.jsonl').map(l => [l.gate, l.detail]);

  test('#17 の形: 届いていない brief-4 があるのに交代の dismiss を打つと、出して止まる', () => {
    const w = sentBrief4(true);
    const sent = texts(w, 'file:1').length;
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: true })).toThrow([
      't-x7k2 の担当に、まだ済んでいない物があります。送っていません。',
      '--- 届いていない（2026-11-20T12:00:00.000Z に送った。id m1-file-1）',
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

  test('--supersede を付ければ送り、本文に取り消す依頼書が載る', () => {
    const w = sentBrief4(true);
    dismiss(w.tpm, 't-x7k2', { handover: true, supersede: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【dismiss】担当の交代のため（課題は続くので、課題は閉じない）。worktree を片付けて【end】を返す。取り消す: brief-4（${B4}）`);
    expect(requireRole(w.tpm, 't-x7k2').dismissed).toBe('handover');
  });

  test('届いた依頼書でも、【done】が返っていなければ dismiss も続きの assign も止まる', () => {
    const w = sentBrief4(false);
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false })).toThrow(/^t-x7k2 の担当に、まだ済んでいない物があります。[\s\S]*【done】が返っていない依頼書: brief-4/);
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0 })).toThrow(/【done】が返っていない依頼書: brief-4[\s\S]*--after、取り消すなら --supersede/);
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false })).not.toThrow(/届いていない/);
  });

  test('ふつうの流れ（依頼書 → 【done】 → dismiss・続きの assign）では止まらない', () => {
    const w = sentBrief4(false);
    reportDone(w.se, { kind: 'result', summary: '2 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0 })).toEqual(['送った: 【brief】→ file:1（届いた）']);
    reportDone(w.se, { kind: 'result', summary: '3 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(gates(w)).toEqual([]);
  });

  test('brief-4 が済む前の続きの assign は、--after で「済ませてから」、--supersede で「取り消す」と載せて送る', () => {
    const w = sentBrief4(false);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B5} brief-4（${B4}）を済ませてから、これをする`);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4.replace('brief-4', 'brief-6'), wait: 0, supersede: true });
    // --after で積んだ brief-4 も、まだ済んでいないので一緒に取り消す
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B4.replace('brief-4', 'brief-6')} 取り消す: brief-4（${B4}）・brief-5（${B5}）`);
    expect(w.tpm.state.lines<{ heading: string, settle?: string }>('log.jsonl').filter(l => l.heading === 'brief').map(l => l.settle)).toEqual(['none', 'after', 'supersede']);
    // 取り消した後は、brief-6 だけが済んでいない
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false })).toThrow(/【done】が返っていない依頼書: brief-6（[^）]*）\n/);
  });

  test('--after で積んだ依頼書は、1 つずつ【done】が返るまで済んでいない（t-aj3v の形）', () => {
    const w = started();
    const B2 = B4.replace('brief-4', 'brief-2');
    const B3 = B4.replace('brief-4', 'brief-3');
    // brief-1 が済む前に、brief-2・brief-3 を --after で積む。どちらも届いている
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B2, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B2} brief-1（${BRIEF}）を済ませてから、これをする`);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B3, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B3} brief-1（${BRIEF}）・brief-2（${B2}）を済ませてから、これをする`);
    // brief-1 の【done】は、brief-1 だけを済ませる（いちばん新しい brief-3 の分に数えない）
    reportDone(w.se, { kind: 'result', summary: 'brief-1', remaining: 'なし', decisions: 'なし', points: [] });
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0 })).toThrow(`--- 【done】が返っていない依頼書: brief-2（${B2}）・brief-3（${B3}）\n`);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0, after: true });
    expect(texts(w, 'file:1').at(-1)).toBe(`【brief】${B4} brief-2（${B2}）・brief-3（${B3}）を済ませてから、これをする`);
    for (const summary of ['brief-2', 'brief-3']) reportDone(w.se, { kind: 'result', summary, remaining: 'なし', decisions: 'なし', points: [] });
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false })).toThrow(`--- 【done】が返っていない依頼書: brief-4（${B4}）\n`);
    reportDone(w.se, { kind: 'result', summary: 'brief-4', remaining: 'なし', decisions: 'なし', points: [] });
    expect(dismiss(w.tpm, 't-x7k2', { handover: false })[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('答えが届く前に続きの assign を打っても止まらない（答え → すぐ続きの依頼書）', () => {
    const w = started();
    reportDone(w.se, { kind: 'plan', summary: '計画', remaining: 'なし', decisions: 'なし', points: [] });
    w.wire.hold('file:1');
    answer(w.tpm, 't-x7k2', { text: '確認の 1 は案 A。続けて依頼書を送る' });
    expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B4, wait: 0 })[0]).toMatch(/^送った: 【brief】/);
  });

  test('済んでいない物があっても、answer と notify は止めない', () => {
    const w = sentBrief4(true);
    expect(answer(w.tpm, 't-x7k2', { text: '案 A' })[0]).toMatch(/^送った: 【answer】/);
    expect(notify(w.tpm, 't-x7k2', { text: '知らせ' })[0]).toMatch(/^送った: 【notify】/);
  });

  test('#3 の形（担当が手を動かす間に「待て」を送る）は、送る側では止めない（A1 の外）', () => {
    const w = started();
    reportDone(w.se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
    w.wire.hold('file:1');
    expect(notify(w.tpm, 't-x7k2', { text: 'tag はまだ打たないで待つこと' })[0]).toMatch(/まだ届いていない/);
    expect(gates(w)).toEqual([]);
  });

  test('#36 の形: 画面に届く前に tpm inbox で読んで済ませた依頼書は、済んだと数える', () => {
    const w = sentBrief4(true);
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
    expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0 })).toEqual(['送った: 【brief】→ file:1（届いた）']);
    expect(gates(w)).toEqual([]);
  });

  test('#36 の形: 送る前の検査が見せた依頼書も、見せた時刻から済ませられる', () => {
    const w = sentBrief4(true);
    w.se.now = at(60);
    const done = (): string[] => reportDone(w.se, { kind: 'proposal', summary: 'brief-4', remaining: 'なし', decisions: 'なし', points: [] });
    expect(done).toThrow(/まだ読んでいないメッセージが 1 件あります[\s\S]*brief-4/);
    w.se.now = at(150);
    done();
    w.wire.release('file:1', '2026-11-20T12:02:38.000Z');
    expect(dismiss(w.tpm, 't-x7k2', { handover: false })[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('見せていない依頼書は、画面に届く前の【done】で済まない（行き違い）', () => {
    const w = sentBrief4(true);
    // 担当が brief-4 を見る前に【done】が出た（送る命令と依頼書が行き違った）。送る前の検査を通らない形を、log に直に書いて作る
    w.se.state.append('log.jsonl', { at: '2026-11-20T12:00:03.000Z', key: 't-x7k2', heading: 'done', from: 'SWE t-x7k2: 計画と実装', to: 'file:tpm', text: '【done】前の分', id: 'd-race', delivered: true });
    w.wire.release('file:1', '2026-11-20T12:00:08.000Z');
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false })).toThrow(/【done】が返っていない依頼書: brief-4/);
  });

  test('#58 の形: 前の版が時刻を書かずに覚えた依頼書は、送った時刻に見せた物として、画面に届く前の【done】で済む', () => {
    const w = sentBrief4(true);
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
    expect(dismiss(w.tpm, 't-x7k2', { handover: false })[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('--supersede と --after を両方付けるか、済んでいない物が無いのに付けたら止まる', () => {
    const w = sentBrief4(false);
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0, supersede: true, after: true })).toThrow('--supersede と --after は、どちらか 1 つにしてください');
    reportDone(w.se, { kind: 'result', summary: '2 つ目', remaining: 'なし', decisions: 'なし', points: [] });
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false, supersede: true })).toThrow('t-x7k2 の担当に、済んでいない物はありません。--supersede を付けずに打ってください');
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: B5, wait: 0, after: true })).toThrow(/済んでいない物はありません。--after/);
  });

  test('最初の依頼書（tpm hello で受けた物）も、【done】が無ければ dismiss は止まり、あれば通る', () => {
    const w = started();
    expect(() => dismiss(w.tpm, 't-x7k2', { handover: false })).toThrow(/【done】が返っていない依頼書: brief-1/);
    reportDone(w.se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
    expect(dismiss(w.tpm, 't-x7k2', { handover: false })[0]).toMatch(/^送った: 【dismiss】/);
  });
});

describe('入口の検査: TPM 担当だけの命令は、担当の session から打てない', () => {
  test('担当が notify・answer・dismiss・assign・close を打つと断り、何も送らず・書かない', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    assign(w.tpm, 't-b2c3', { role: 'software-engineer', title: '別の課題', brief: BRIEF, wait: 0 });
    hello(w.role('t-b2c3', 'file:2'));
    const state = (): unknown => ({
      sent: texts(w, 'file:2'),
      comments: w.calls.filter(c => c.args[1] === 'comment').length,
      seats: w.wire.seats().length,
      role: requireRole(w.tpm, 't-b2c3'),
      pages: w.store.pages.size,
    });
    const before = state();
    for (const [command, send] of [
      ['tpm notify', () => notify(w.se, 't-b2c3', { text: 'TPM 担当の名で届く字' })],
      ['tpm answer', () => answer(w.se, 't-b2c3', { text: '案 A' })],
      ['tpm dismiss', () => dismiss(w.se, 't-b2c3', { handover: false })],
      ['tpm assign', () => assign(w.se, 't-b2c3', { role: 'software-engineer', brief: BRIEF, wait: 0 })],
      ['tpm close', () => close(w.se, 't-b2c3')],
    ] as const) {
      expect(send).toThrow(`${command} は TPM 担当の命令です。担当の session（t-x7k2）からは打てません。TPM 担当に頼むことは、tpm ask tpm で送ってください`);
      expect(state()).toEqual(before);
    }
    // 止めた回は、入口の検査の記録に残る
    expect(w.tpm.state.lines<{ gate: string, by: string, detail: string }>('gate.jsonl').filter(l => l.gate === 'tpm-only').map(l => `${l.by} ${l.detail}`)).toEqual(['t-x7k2 tpm notify', 't-x7k2 tpm answer', 't-x7k2 tpm dismiss', 't-x7k2 tpm assign', 't-x7k2 tpm close']);
  });
});

describe('入口の検査: 自分が送った物は、未読に数えない（台帳 #97・#100）', () => {
  // 連携の道具（cmux）は、自分の受信箱の「まだ届いていない物」に、自分が送ってまだ届いていない物も返す。
  test('担当: 自分が送ってまだ届いていない物では止まらない。相手からの未読では、今のとおり止まる', () => {
    const w = started();
    w.wire.hold('file:tpm');
    askTpm(w.se, { text: '1 通目', waitingFor: 'a' });
    const mine = w.wire.inbox('file:tpm').map(m => ({ id: m.id, from: m.from, text: m.text }));
    expect(mine).toHaveLength(1);
    const real = w.se.transport.pending.bind(w.se.transport);
    w.se.transport.pending = () => [...mine, ...real()];
    expect(reportMerged(w.se, { pr: PR, note: '入れた' })[0]).toMatch(/^送った: 【merged】/);
    w.wire.release('file:tpm');
    w.wire.hold('file:1');
    notify(w.tpm, 't-x7k2', { text: '待つこと' });
    expect(() => askTpm(w.se, { text: '2 通目', waitingFor: 'a' })).toThrow(/まだ読んでいないメッセージが 1 件あります[\s\S]*【notify】待つこと/);
  });
});
