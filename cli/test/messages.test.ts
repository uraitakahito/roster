import { describe, expect, test } from 'vitest';
import { answer, askDevops, askPm, askTpm, dismiss, notify, reportDependabot, reportDocFix, reportDone, reportEnd, reportMerged, show, wait } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign, close, init, roles } from '../src/commands/tpm-side.ts';
import { requireRole } from '../src/roster.ts';
import { world, type World } from './helpers.ts';

const BRIEF = 'https://claude.ai/artifact/b1';
const OUT = 'https://claude.ai/artifact/o1';
const PR = 'https://github.com/o/r/pull/7';
const TPM = { model: 'claude-opus-5-5', effort: 'medium' };

/** TPM 担当が名乗り、t-x の Software Engineer 担当を起こして名乗らせた世界。 */
function started(config: Record<string, unknown> = {}, issue?: string): World & { se: ReturnType<World['role']> } {
  const w = world(config);
  init(w.tpm, TPM);
  assign(w.tpm, 't-x', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, ...(issue === undefined ? {} : { issue }) });
  const se = w.role('t-x', 'file:1');
  hello(se);
  return { ...w, se };
}
const texts = (w: World, address: string): string[] => w.wire.inbox(address).map(m => m.text);
const waitOf = (w: World, address: string): string | undefined => w.wire.status(address)?.wait;

describe('1 つの課題の 1 周（課題管理なし）', () => {
  test('依頼 → 相談 → 完成 → 次の依頼 → 完成 → 片付け → 終わり → 閉じる', () => {
    const w = started();
    const FROM = 'Software Engineer t-x: 計画と実装';

    expect(askTpm(w.se, { text: '案 A と B で迷う。お勧めは A', waitingFor: '案の選択' })).toEqual(['送った: 【相談(TPM)】→ file:tpm（届いた）', '状態: 回答待ち(TPM): 案の選択']);
    const asked = w.wire.inbox('file:tpm')[0];
    expect(asked).toMatchObject({ from: FROM, text: '【相談(TPM)】案 A と B で迷う。お勧めは A' });
    notify(w.tpm, 't-x', { text: 'A で進める', ...(asked ? { replyTo: asked.id } : {}) });
    expect(w.wire.inbox('file:1')[0]).toMatchObject({ from: 'Technical Program Manager', text: '【連絡】A で進める', replyTo: asked?.id });

    expect(wait(w.se, 'work', '実装')).toEqual(['状態: 作業中: 実装']);
    reportMerged(w.se, { pr: PR, note: '段 1 を入れた' });
    expect(reportDone(w.se, { url: OUT, kind: '計画', summary: 'PR 2 本の計画', remaining: 'なし', decisions: 'なし', points: [] })).toEqual([
      '送った: 【完成】→ file:tpm（届いた）',
      '状態: 回答待ち(TPM): 次の依頼（次の【依頼】か【片付け】を待つ。自分から【終わり】を送らない）',
    ]);
    expect(waitOf(w, 'file:1')).toBe('回答待ち(TPM): 次の依頼');

    // 同じ鍵に振ると、起こさずに同じ担当へ【依頼】が行く
    expect(assign(w.tpm, 't-x', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', note: '計画の実装', wait: 0 })).toEqual(['送った: 【依頼】→ file:1（届いた）']);
    expect(requireRole(w.tpm, 't-x').brief).toBe('https://claude.ai/artifact/b2');
    expect(w.wire.seats()).toHaveLength(1);
    reportDone(w.se, { url: OUT, kind: '結果', summary: '実装した', remaining: 'なし', decisions: 'なし', points: [] });

    expect(() => reportEnd(w.se, { prs: [PR], removed: [], left: 'なし' })).toThrow(/【片付け】がまだ来ていません/);
    dismiss(w.tpm, 't-x', { handover: false });
    expect(roles(w.tpm)[1]).toMatch(/片付け済み（終わり）/);
    expect(reportEnd(w.se, { url: OUT, prs: [PR], removed: ['skills-worktrees/t-x-impl'], left: 'なし' })).toEqual([
      '送った: 【終わり】→ file:tpm（届いた）',
      '状態: 回答待ち(TPM): workspace を閉じる（居場所は自分で閉じない）',
    ]);
    close(w.tpm, 't-x');

    expect(texts(w, 'file:tpm')).toEqual([
      '【相談(TPM)】案 A と B で迷う。お勧めは A',
      `【merge 済み】${PR} 段 1 を入れた`,
      `【完成】${OUT} 要点: PR 2 本の計画／残り: なし／決めてほしいこと: なし`,
      `【完成】${OUT} 要点: 実装した／残り: なし／決めてほしいこと: なし`,
      `【終わり】成果: ${OUT}／merge した PR: ${PR}／消した worktree: skills-worktrees/t-x-impl／残っている物: なし`,
    ]);
    expect(texts(w, 'file:1')).toEqual([
      '【連絡】A で進める',
      '【依頼】https://claude.ai/artifact/b2 計画の実装',
      '【片付け】この課題に続きは無い。worktree と課題を片付けて【終わり】を返す。',
    ]);
    expect(roles(w.tpm)).toEqual(['名簿: 担当はいない']);
    expect(w.calls).toEqual([]);
    // 送った知らせは log.jsonl に残る
    expect(w.tpm.state.lines<{ heading: string }>('log.jsonl').map(l => l.heading)).toEqual(['相談(TPM)', '連絡', 'merge 済み', '完成', '依頼', '完成', '片付け', '終わり']);
  });
});

describe('課題への記録（GitHub の Issue）', () => {
  const bodies = (w: World): string[] => w.calls.filter(c => c.args[1] === 'comment').map(c => c.options?.input ?? '');

  test('決まりの時に 1 件ずつ書き、【終わり】で課題を閉じる', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    askPm(w.se, { url: 'https://claude.ai/artifact/c1', items: ['案の選択', '切り替えの単位'], waitingFor: '案と単位' });
    answer(w.tpm, 't-x', { text: '(1) 案 A (2) project ごと\n細かい事は依頼書に' });
    reportDocFix(w.se, { pr: PR, note: 'ひな形の surface を workspace に直した' });
    reportDone(w.se, { url: OUT, kind: '提案', summary: '3 案を比べた', remaining: 'なし', decisions: '案の選択', points: ['お勧めは案 A'] });
    dismiss(w.tpm, 't-x', { handover: false });
    const out = reportEnd(w.se, { url: OUT, prs: [PR], removed: [], left: 'なし' });

    expect(bodies(w)).toEqual([
      '【確認】Software Engineer: Product Manager に確かめる（2 項）\n\n確認: https://claude.ai/artifact/c1\n\n案の選択\n\n切り替えの単位',
      '【決定】TPM: (1) 案 A (2) project ごと',
      `【文書の修正】Software Engineer: ひな形の surface を workspace に直した\n\nPR（merge 済み）: ${PR}`,
      `【提案】Software Engineer: 3 案を比べた\n\n提案: ${OUT}\n\nお勧めは案 A`,
      `【結果】Software Engineer: 片付けた（残っている物: なし）\n\n成果: ${OUT}\n\nPR（merge 済み）: ${PR}`,
    ]);
    expect(w.calls.at(-1)?.args).toEqual(['issue', 'close', '12', '--reason', 'completed']);
    expect(w.calls.every(c => c.cmd === 'gh' && c.options?.cwd === w.project)).toBe(true);
    expect(out).toContain('課題を閉じた: gh-12');
    expect(texts(w, 'file:tpm')[0]).toBe('【PM への依頼】https://claude.ai/artifact/c1 項目: (1) 案の選択 (2) 切り替えの単位');
    expect(texts(w, 'file:1')[0]).toBe('【PM の回答】(1) 案 A (2) project ごと\n細かい事は依頼書に');
  });

  test('【PM への依頼】は確認の Artifact を自分の所で開き、状態を回答待ち(PM) にする', () => {
    const w = started();
    askPm(w.se, { url: 'https://claude.ai/artifact/c1', items: ['案の選択'], waitingFor: '案の選択' });
    expect(w.tpm.state.lines('file-transport/shown.jsonl')).toEqual([{ at: 'file:1', url: 'https://claude.ai/artifact/c1' }]);
    expect(waitOf(w, 'file:1')).toBe('回答待ち(PM): 案の選択');
    expect(() => askPm(w.se, { url: 'u', items: [], waitingFor: 'x' })).toThrow(/--item/);
  });

  test('担当の交代の【片付け】では、課題を閉じない', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    dismiss(w.tpm, 't-x', { handover: true });
    expect(texts(w, 'file:1')[0]).toMatch(/^【片付け】担当の交代のため/);
    expect(reportEnd(w.se, { prs: [], removed: [], left: 'なし' })).toContain('課題は閉じない: gh-12（担当の交代。次の担当が引き継ぐ）');
    expect(w.calls.some(c => c.args[1] === 'close')).toBe(false);
  });

  test('新しい【依頼】を受けた担当は、片付け済みでなくなる', () => {
    const w = started();
    dismiss(w.tpm, 't-x', { handover: false });
    assign(w.tpm, 't-x', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', wait: 0 });
    expect(requireRole(w.tpm, 't-x').dismissed).toBeUndefined();
  });
});

describe('【完成】と【終わり】に要る欄', () => {
  test.each([
    ['残り', { decisions: 'なし' }, /--remaining（残り） を書いてください/],
    ['決めてほしいこと', { remaining: 'なし' }, /--decisions（決めてほしいこと） を書いてください/],
    ['空白だけの残り', { remaining: ' ', decisions: 'なし' }, /--remaining/],
  ])('%sが無ければ送らない', (_, fields, message) => {
    const w = started();
    expect(() => reportDone(w.se, { kind: '結果', summary: 's', points: [], ...fields })).toThrow(message);
    expect(texts(w, 'file:tpm')).toEqual([]);
  });

  test('成果の URL が無い【完成】（DevOps Engineer 担当）は、要点から書く', () => {
    const w = started();
    reportDone(w.se, { kind: '結果', summary: 'container を作り直した', remaining: 'なし', decisions: 'なし', points: [] });
    expect(texts(w, 'file:tpm')).toEqual(['【完成】要点: container を作り直した／残り: なし／決めてほしいこと: なし']);
  });

  test('記録の要点は 3 つまで', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    expect(() => reportDone(w.se, { kind: '結果', summary: 's', remaining: 'なし', decisions: 'なし', points: ['1', '2', '3', '4'] })).toThrow(/3 つまで/);
    expect(texts(w, 'file:tpm')).toEqual([]);
  });

  test('残っている物が無ければ【終わり】を送らない', () => {
    const w = started();
    dismiss(w.tpm, 't-x', { handover: false });
    expect(() => reportEnd(w.se, { prs: [], removed: [] })).toThrow(/--left/);
  });
});

describe('ほかの知らせ', () => {
  test('【DevOps への依頼】は何を・なぜ・急ぎかを並べる', () => {
    const w = started();
    askDevops(w.se, { what: 'windmill の worker を作り直す', why: '設定を変えた', urgent: false });
    expect(texts(w, 'file:tpm')).toEqual(['【DevOps への依頼】何を: windmill の worker を作り直す／なぜ: 設定を変えた／急ぎ: いいえ']);
  });

  test('Dependabot の見出し。PR 1 本の担当は【片付け】を待たずに終われる', () => {
    const w = world({ 'skill-sets': ['dependabot'] });
    init(w.tpm, TPM);
    assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    const su = w.role('app#12', 'file:1');
    hello(su);
    expect(reportDependabot(su, 'recreated', { text: '旧 #12 → 新 #15', title: 'Sustaining Engineer app#15' })[0]).toBe('題を替えた: Sustaining Engineer app#15');
    reportDependabot(su, 'not-yet', { text: 'eligibleAt 2026-11-21T03:00:00Z' });
    reportDependabot(su, 'merge-request', { text: `${PR}／CI: 緑` });
    expect(waitOf(w, 'file:1')).toBe('回答待ち(TPM): merge');
    reportEnd(su, { prs: [PR], removed: [], left: 'なし' });
    expect(w.wire.seats()).toEqual([{ address: 'file:1', title: 'Sustaining Engineer app#15' }]);
    expect(texts(w, 'file:tpm')).toEqual([
      '【作り直し】旧 #12 → 新 #15',
      '【まだ】eligibleAt 2026-11-21T03:00:00Z',
      `【merge の依頼】${PR}／CI: 緑`,
      `【終わり】成果: なし／merge した PR: ${PR}／消した worktree: なし／残っている物: なし`,
    ]);
    expect(w.wire.inbox('file:tpm').at(-1)?.from).toBe('Sustaining Engineer app#15');
  });

  test('居場所が消えた担当には送らずに止まる', () => {
    const w = started();
    w.wire.close('file:1');
    expect(() => notify(w.tpm, 't-x', { text: 'x' })).toThrow(/t-x の担当の居場所がありません/);
    expect(() => dismiss(w.tpm, 't-x', { handover: false })).toThrow(/居場所がありません/);
    expect(requireRole(w.tpm, 't-x').dismissed).toBeUndefined();
  });

  test('TPM 担当が名乗る前は、担当は送れない', () => {
    const w = world();
    assign(w.tpm, 't-x', { role: 'software-engineer', wait: 0 });
    expect(() => reportMerged(w.role('t-x', 'file:1'), { pr: PR, note: 'n' })).toThrow(/TPM 担当の宛先がありません/);
  });

  test('show は URL を自分の所で開く', () => {
    const w = started();
    expect(show(w.tpm, OUT)).toEqual([`開いた: ${OUT}`]);
    expect(w.tpm.state.lines('file-transport/shown.jsonl')).toEqual([{ at: 'file:tpm', url: OUT }]);
  });
});
