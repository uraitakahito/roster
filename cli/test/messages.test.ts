import { describe, expect, test } from 'vitest';
import { answer, askDevops, askPm, askTpm, dismiss, doneKind, notify, reportDependabot, reportDocFix, reportDone, reportEnd, reportMerged, show, wait } from '../src/commands/messages.ts';
import { hello, inbox } from '../src/commands/role-side.ts';
import { assign, close, roles } from '../src/commands/tpm-side.ts';
import { requireRole } from '../src/roster.ts';
import { BRIEF, world, type World } from './helpers.ts';

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
    expect(w.calls).toEqual([]);
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
    dismiss(w.tpm, 't-x7k2', { handover: true });
    expect(texts(w, 'file:1')[0]).toMatch(/^【dismiss】担当の交代のため/);
    expect(reportEnd(w.se, { prs: [], removed: [], left: 'なし' })).toContain('課題は閉じない: gh-12（担当の交代。次の担当が引き継ぐ）');
    expect(w.calls.some(c => c.args[1] === 'close')).toBe(false);
  });

  test('新しい【brief】を受けた担当は、dismiss 済みでなくなる', () => {
    const w = started();
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
    dismiss(w.tpm, 't-x7k2', { handover: false });
    w.prs.set(PR, 'CLOSED');
    expect(() => reportEnd(w.se, { prs: [PR], removed: [], left: 'なし' })).toThrow(/state: CLOSED/);
    expect(texts(w, 'file:tpm')).toEqual([]);
    reportEnd(w.se, { prs: [], removed: [], left: 'なし', unchecked: '使わない' });
    expect(texts(w, 'file:tpm')).toEqual(['【end】成果: なし／merge した PR: なし／消した worktree: なし／残っている物: なし']);
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
