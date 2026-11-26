import { describe, expect, test } from 'vitest';
import { hello } from '../src/commands/role-side.ts';
import { time } from '../src/commands/time.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { noteRepoSeat } from '../src/roster.ts';
import { BRIEF, world } from './helpers.ts';

/** 11-20 の時刻（UTC）の ISO。 */
const at = (hm: string): string => `2026-11-20T${hm}:00.000Z`;

/** 状態の移りを 1 行足す。 */
function waited(ctx: Context, hm: string, by: string, text: string, role = 'software-engineer'): void {
  ctx.state.append('waits.jsonl', { at: at(hm), by, role, address: `file:${by}`, text });
}

describe('roster time', () => {
  test('席ごとに、状態の種類ごとの時間を出す。足した時間が合う。最後の状態は、課題の最後の記録まで続く', () => {
    const w = world();
    waited(w.tpm, '10:00', 't-x7k2', '作業中: 計画');
    waited(w.tpm, '10:30', 't-x7k2', '回答待ち(レビュー): 計画 plan-1');
    waited(w.tpm, '10:30', 't-x7k2.staff', '作業中: 読む', 'staff-engineer');
    waited(w.tpm, '10:45', 't-x7k2.staff', '回答待ち(レビュー): 次の頼み', 'staff-engineer');
    waited(w.tpm, '10:45', 't-x7k2', '作業中: 実装');
    waited(w.tpm, '11:15', 't-x7k2', '回答待ち(PM): 案の選択');
    waited(w.tpm, '11:45', 't-x7k2', '回答待ち(TPM): 次の依頼');
    // 別の課題と TPM 担当の行は入らない。
    waited(w.tpm, '09:00', 't-0ther', '作業中: 別の課題');
    waited(w.tpm, '12:30', 'tpm', '回答待ち(PM): 指示', 'tpm');
    w.tpm.state.append('log.jsonl', { at: at('12:00'), key: 't-x7k2', heading: 'notify', from: 'Technical Program Manager', to: 'file:1', text: '【notify】x', id: 'm1' });
    expect(time(w.tpm, 't-x7k2')).toEqual([
      't-x7k2 の時間の分け（2026-11-20T10:00Z 〜 2026-11-20T12:00Z。席 2 つ。最後の記録: メッセージ【notify】（t-x7k2））',
      '始めから終わりまで: 2.0 時間',
      'どれかの席が作業中: 1.3 時間（うち、長い空きに重なる分 0.0 時間。状態が作業中のまま、どの席の記録も動かなかった間）',
      '長い空き（どの席の記録も 60 分以上動かなかった間）: 0 回・合わせて 0.0 時間',
      '席ごと（状態は、次に替えるまで続いたとして数える。席を足すと、始めから終わりまでより長くなる）:',
      '- t-x7k2（Software Engineer）  作業中 1.0 時間・PM 待ち 0.5 時間・TPM 待ち 0.3 時間・レビュー待ち 0.3 時間',
      '- t-x7k2.staff（Staff Engineer）  作業中 0.3 時間・次の頼み待ち 1.3 時間',
    ]);
  });

  test('長い空き: どの席の記録も動かなかった間を挙げ、作業中のまま止まっていた分を出す', () => {
    const w = world();
    waited(w.tpm, '01:00', 't-x7k2', '作業中: 実装');
    waited(w.tpm, '06:00', 't-x7k2', '作業中: 続き');
    waited(w.tpm, '06:30', 't-x7k2', '回答待ち(TPM): 次の依頼');
    const out = time(w.tpm, 't-x7k2');
    expect(out[1]).toBe('始めから終わりまで: 5.5 時間');
    expect(out[2]).toMatch(/^どれかの席が作業中: 5\.5 時間（うち、長い空きに重なる分 5\.0 時間。/);
    expect(out.slice(3, 5)).toEqual(['長い空き（どの席の記録も 60 分以上動かなかった間）: 1 回・合わせて 5.0 時間', '  2026-11-20T01:00Z → 2026-11-20T06:00Z  5.0 時間（その間の状態: t-x7k2 作業中）']);
    // 空きの長さは --gap で替えられる。
    expect(time(w.tpm, 't-x7k2', { gapMinutes: 20 })[3]).toBe('長い空き（どの席の記録も 20 分以上動かなかった間）: 2 回・合わせて 5.5 時間');
  });

  test('分けた課題は、repo の席を束ねる。重なった作業中は 1 度だけ数える', () => {
    const w = world();
    noteRepoSeat(w.tpm, 'AI-36', 'AI-36.pagetray');
    noteRepoSeat(w.tpm, 'AI-36', 'AI-36.castlist');
    waited(w.tpm, '10:00', 'AI-36', '作業中: 計画', 'tech-lead');
    waited(w.tpm, '10:30', 'AI-36.pagetray', '作業中: server');
    waited(w.tpm, '10:30', 'AI-36.castlist', '作業中: server');
    waited(w.tpm, '11:00', 'AI-36.castlist', '回答待ち(Lead): 欄の名');
    waited(w.tpm, '11:30', 'AI-36.pagetray', '回答待ち(Lead): 次の依頼');
    waited(w.tpm, '11:30', 'AI-36', '回答待ち(TPM): 次の依頼', 'tech-lead');
    // 点を含む別の課題は入らない（repo の席は、起こした時の控えで見分ける）。
    waited(w.tpm, '10:00', 'AI-36.other', '作業中: 別の課題');
    const out = time(w.tpm, 'AI-36');
    expect(out[0]).toBe('AI-36 の時間の分け（2026-11-20T10:00Z 〜 2026-11-20T11:30Z。席 3 つ。最後の記録: 状態の移り（AI-36））');
    expect(out[2]).toMatch(/^どれかの席が作業中: 1\.5 時間/);
    expect(out.slice(5)).toEqual([
      '- AI-36（Tech Lead）  作業中 1.5 時間',
      '- AI-36.pagetray（Software Engineer）  作業中 1.0 時間',
      '- AI-36.castlist（Software Engineer）  作業中 0.5 時間・Lead 待ち 0.5 時間',
    ]);
  });

  test('決まった字に当たらない状態は、: の前の字を名にして数える（後から足された状態の字も、その名で出る）', () => {
    const w = world();
    waited(w.tpm, '10:00', 't-x7k2', '作業中: 実装');
    waited(w.tpm, '10:30', 't-x7k2', '上限で止まった: 14 時に戻る');
    waited(w.tpm, '12:00', 't-x7k2', 'メッセージキューが応えません');
    waited(w.tpm, '12:30', 't-x7k2', '作業中: 続き');
    waited(w.tpm, '13:00', 't-x7k2', '回答待ち(TPM): 次の依頼');
    const out = time(w.tpm, 't-x7k2', { gapMinutes: 60 });
    expect(out.at(-1)).toBe('- t-x7k2（Software Engineer）  作業中 1.0 時間・上限で止まった 1.5 時間・メッセージキューが応えません 0.5 時間');
    expect(out[4]).toBe('  2026-11-20T10:30Z → 2026-11-20T12:00Z  1.5 時間（その間の状態: t-x7k2 上限で止まった）');
  });

  test('片付けの終わり（【end】）を送った席は、そこで終える。空きの間の状態にも出さない', () => {
    const w = world();
    waited(w.tpm, '10:00', 't-x7k2', '作業中: 実装');
    waited(w.tpm, '10:00', 't-x7k2.staff', '回答待ち(レビュー): 次の頼み', 'staff-engineer');
    waited(w.tpm, '11:00', 't-x7k2', '回答待ち(TPM): workspace を閉じる');
    w.tpm.state.append('log.jsonl', { at: at('11:00'), key: 't-x7k2', heading: 'end', from: 'SWE t-x7k2: 題', to: 'file:tpm', text: '【end】x', id: 'm1', sender: { key: 't-x7k2' } });
    // 3 時間後に、TPM 担当が Staff の席へ 1 通送った（課題の最後の記録）。
    w.tpm.state.append('log.jsonl', { at: at('14:00'), key: 't-x7k2.staff', heading: 'notify', from: 'Technical Program Manager', to: 'file:2', text: '【notify】x', id: 'm2', sender: { key: 'tpm' } });
    const out = time(w.tpm, 't-x7k2');
    expect(out.slice(4, 6)).toEqual([
      '  2026-11-20T10:00Z → 2026-11-20T11:00Z  1.0 時間（その間の状態: t-x7k2 作業中・t-x7k2.staff 次の頼み待ち）',
      '  2026-11-20T11:00Z → 2026-11-20T14:00Z  3.0 時間（その間の状態: t-x7k2.staff 次の頼み待ち）',
    ]);
    expect(out.slice(-2)).toEqual(['- t-x7k2（Software Engineer）  作業中 1.0 時間', '- t-x7k2.staff（Staff Engineer）  次の頼み待ち 4.0 時間']);
  });

  test('担当の名乗り（roster hello）と、メッセージキューの止まりは、状態の移りに残る', async () => {
    const w = world();
    await hello(w.tpm);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: BRIEF, wait: 0 });
    await hello(w.role('t-x7k2', 'file:1'));
    expect(w.tpm.state.lines<{ by: string, text: string }>('waits.jsonl').filter(l => l.by === 't-x7k2').map(l => l.text)).toEqual(['作業中: 依頼書を読む']);
    expect(time(w.tpm, 't-x7k2')[0]).toMatch(/^t-x7k2 の時間の分け/);
  });

  test('記録が無い課題と、誤った --gap', () => {
    const w = world();
    expect(time(w.tpm, 't-n0ne')).toEqual(['t-n0ne の状態の記録がありません（waits.jsonl。roster hello・roster wait・送る命令が書く）']);
    expect(() => time(w.tpm, 't-n0ne', { gapMinutes: 0 })).toThrow(/--gap は 0 より大きい数/);
  });
});
