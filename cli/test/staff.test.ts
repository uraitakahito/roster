// Staff Engineer 担当（課題ごとの、読むだけの席）: 名簿の Key・起こし方・閉じ方・打てない命令・ページの置き先・castlist の名。
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { seatOf, seatPrefix } from '../src/castlist.ts';
import { askPm, askTpm, dismiss, notify, reportDocFix, reportDone, reportEnd, reportIncident, reportMerged } from '../src/commands/messages.ts';
import { pagePut } from '../src/commands/page.ts';
import { hello } from '../src/commands/role-side.ts';
import { collect } from '../src/commands/timeline.ts';
import { assign, close, roles } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { ROLES } from '../src/protocol.ts';
import { addReview } from '../src/reviews.ts';
import { requireRole, staffKey, subjectOf } from '../src/roster.ts';
import { claudeArgs } from '../src/run-role.ts';
import { BRIEF, staffRoot, world, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const SE = { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 } as const;
const STAFF = { role: 'staff-engineer', wait: 0 } as const;
/** 見てもらう物（課題の担当が置いた計画のページ）。 */
const PLAN = 'http://127.0.0.1:8801/p/AI-8/plan-1.html';
const PR = 'https://github.com/o/r/pull/7';

/** TPM 担当と AI-8 の Software Engineer 担当（file:1）が名乗った世界。tpm は、Staff Engineer 担当の skill が在る root の TPM 担当。 */
function started(config: Record<string, unknown> = {}, issue?: string): World & { se: Context } {
  const w = world(config);
  const tpm = { ...w.tpm, root: staffRoot() };
  hello(tpm, TPM);
  assign(tpm, 'AI-8', { ...SE, ...(issue === undefined ? {} : { issue }) });
  const se = w.role('AI-8', 'file:1');
  hello(se);
  // 返っていないレビューの頼みが 1 つある（席はまだ無い。TPM 担当の tpm assign --role staff-engineer は、この形の席を起こす）。
  addReview(tpm, { key: 'AI-8', url: PLAN, by: 'SWE AI-8: 計画と実装' });
  return { ...w, tpm, se };
}

/** started に、AI-8 の Staff Engineer 担当（file:2）を起こして名乗らせた世界。 */
function reviewed(config: Record<string, unknown> = {}, issue?: string): World & { se: Context, staff: Context } {
  const w = started(config, issue);
  assign(w.tpm, 'AI-8', STAFF);
  const base = w.role('AI-8.staff', 'file:2');
  const staff = { ...base, env: { ...base.env, TPM_ROLE: 'staff-engineer' } };
  hello(staff);
  return { ...w, staff };
}

describe('名簿の Key', () => {
  test('Staff の席の Key は <課題の Key>.staff。課題の Key は subject に持つ', () => {
    expect(staffKey('AI-8')).toBe('AI-8.staff');
    expect(subjectOf({ key: 'AI-8.staff', subject: 'AI-8' })).toBe('AI-8');
    expect(subjectOf({ key: 'AI-8' })).toBe('AI-8');
  });
});

describe('tpm assign --role staff-engineer', () => {
  test('課題の担当の隣に、別の名簿の行で起こす。題は レビュー <課題の Key>: <見る物>、既定は Opus 5.5・high', () => {
    const w = started({ tracker: 'jira' }, 'AI-8');
    const out = assign(w.tpm, 'AI-8', STAFF);
    expect(out[0]).toBe('起こした: レビュー AI-8: 計画 plan-1（file:2・Opus 5.5 · high）');
    expect(requireRole(w.tpm, 'AI-8.staff')).toMatchObject({ key: 'AI-8.staff', subject: 'AI-8', role: 'staff-engineer', title: 'レビュー AI-8: 計画 plan-1', issue: 'AI-8', model: 'claude-opus-5-5', effort: 'high', permissionMode: 'bypassPermissions', address: 'file:2' });
    // 課題の担当の行は変わらない
    expect(requireRole(w.tpm, 'AI-8')).toMatchObject({ role: 'software-engineer', address: 'file:1' });
    expect(roles(w.tpm).filter(l => l.startsWith('- ')).map(l => l.split('  ').slice(0, 2).join('  '))).toEqual(['- AI-8  SWE AI-8: 計画と実装', '- AI-8.staff  レビュー AI-8: 計画 plan-1']);
    // Staff の席は紫の帯、課題の担当は緑の帯。見てほしい所の無い頼みは、説明を付けない
    expect(w.wire.look('file:2')).toEqual({ title: 'レビュー AI-8: 計画 plan-1', color: 'Purple' });
    expect(w.wire.look('file:1')).toEqual({ title: 'SWE AI-8: 計画と実装', color: 'Green' });
  });

  test('色を付けられなくても止めない。宛先は名簿に書き、1 行で知らせる', () => {
    const w = started();
    const setColor = (): never => {
      throw new Error('unknown color');
    };
    const tpm = { ...w.tpm, transport: Object.assign(Object.create(w.tpm.transport) as Context['transport'], { setColor }) };
    const out = assign(tpm, 'AI-8', STAFF);
    expect(out[0]).toBe('起こした: レビュー AI-8: 計画 plan-1（file:2・Opus 5.5 · high）');
    expect(out).toContain('居場所の色（Purple）を付けられなかった: unknown color');
    expect(requireRole(w.tpm, 'AI-8.staff').address).toBe('file:2');
  });

  test('Staff の席の題は命令が作るので、--title は止める（黙って捨てない）', () => {
    const w = started();
    expect(() => assign(w.tpm, 'AI-8', { ...STAFF, title: 'レビュー' })).toThrow(/Staff Engineer 担当の席の題は、レビューの頼みから命令が作ります。--title は書かないでください/);
    expect(w.wire.seats().map(s => s.address)).toEqual(['file:1']);
  });

  test('model などは 旗 > config.jsonc の staff-engineer の欄 > 役割の既定', () => {
    const w = started({ 'staff-engineer': { model: 'claude-fable-5-2' } });
    assign(w.tpm, 'AI-8', { ...STAFF, effort: 'max' });
    expect(requireRole(w.tpm, 'AI-8.staff')).toMatchObject({ model: 'claude-fable-5-2', effort: 'max' });
  });

  test('課題の担当が名簿に居なければ止まる。Staff の席の Key を手で書いても止まる', () => {
    const w = started();
    expect(() => assign(w.tpm, 'AI-9', STAFF)).toThrow(/AI-9 の担当が名簿にいません。Staff Engineer 担当は、課題の担当の隣に起こします/);
    expect(() => assign(w.tpm, 'AI-8.staff', STAFF)).toThrow(/tpm assign <課題の Key> --role staff-engineer/);
    expect(() => assign(w.tpm, 'AI-8.staff', SE)).toThrow(/tpm assign <課題の Key> --role staff-engineer/);
    expect(w.wire.seats().map(s => s.address)).toEqual(['file:1']);
  });

  test('skill がまだ無ければ、起こす前に止まる', () => {
    const w = started();
    const bare = { ...w.tpm, root: realpathSync(mkdtempSync(join(tmpdir(), 'tpm-root-'))) };
    expect(() => assign(bare, 'AI-8', STAFF)).toThrow(/skill \/staff-engineer がまだありません/);
    expect(w.wire.seats().map(s => s.address)).toEqual(['file:1']);
  });

  test('席の hook は、file を書き替える道具も見る。audit fresh は呼ばない。最初の入力は /staff-engineer', () => {
    const args = claudeArgs({ key: 'AI-8.staff', subject: 'AI-8', role: 'staff-engineer', title: 'Staff AI-8', cwd: '/p', addDirs: ['/r/skill-sets/core'], ...ROLES['staff-engineer'].defaults }, '/r');
    expect(JSON.parse(args[1] ?? '')).toEqual({
      hooks: {
        PreToolUse: [{ matcher: 'Bash|Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: '/r/cli/bin/tpm guard' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/r/cli/bin/tpm castlist session-start' }, { type: 'command', command: '/r/cli/bin/tpm returned check' }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: '/r/cli/bin/tpm castlist session-end' }] }],
      },
    });
    expect(args.slice(2, 8)).toEqual(['--model', 'claude-opus-5-5', '--effort', 'high', '--permission-mode', 'bypassPermissions']);
    expect(args.slice(-2)).toEqual(['--', '/staff-engineer']);
  });
});

describe('Staff の席の名乗り', () => {
  test('課題の Key と、名簿の Key を返す', () => {
    const w = started();
    assign(w.tpm, 'AI-8', STAFF);
    const out = hello(w.role('AI-8.staff', 'file:2'));
    expect(out).toContain('役割: Staff Engineer');
    expect(out).toContain('課題の Key: AI-8');
    expect(out).toContain('名簿の Key: AI-8.staff');
    expect(out.find(l => l.startsWith('依頼書: '))).toMatch(/\/AI-8\/brief-1\.html$/);
    // 課題の担当の名乗りには、名簿の Key の行は出ない
    expect(hello(w.se).some(l => l.startsWith('名簿の Key'))).toBe(false);
  });
});

describe('tpm close', () => {
  test('課題の席を閉じると、Staff の席も閉じる。Staff の席だけを先に閉じることもできる', () => {
    const w = reviewed();
    expect(close(w.tpm, 'AI-8')).toEqual(['閉じた: SWE AI-8: 計画と実装（file:1）', '閉じた: レビュー AI-8: 計画 plan-1（file:2）']);
    expect(roles(w.tpm)[0]).toBe('名簿: 担当はいない');
    expect(w.wire.seats()).toEqual([]);

    const again = reviewed();
    expect(close(again.tpm, 'AI-8.staff')).toEqual(['閉じた: レビュー AI-8: 計画 plan-1（file:2）']);
    expect(close(again.tpm, 'AI-8')).toEqual(['閉じた: SWE AI-8: 計画と実装（file:1）']);
  });
});

describe('Staff が打たない命令', () => {
  test('【done】【end】【merged】【doc-fix】【ask-pm】は断る。課題も閉じない', () => {
    const w = reviewed({ tracker: 'jira' }, 'AI-8');
    const before = w.calls.length;
    const no = /Staff Engineer 担当は tpm .+ を打ちません。レビューの結果は tpm report review で返してください/;
    expect(() => reportDone(w.staff, { kind: 'result', summary: 'x', remaining: 'なし', decisions: 'なし', points: [] })).toThrow(no);
    expect(() => reportEnd(w.staff, { prs: [], removed: [], left: 'なし' })).toThrow(no);
    expect(() => reportMerged(w.staff, { pr: PR, note: 'x' })).toThrow(no);
    expect(() => reportDocFix(w.staff, { pr: PR, note: 'x' })).toThrow(no);
    expect(() => askPm(w.staff, { url: 'http://127.0.0.1:8801/p/AI-8/confirm-1.html', items: ['x'], waitingFor: 'x' })).toThrow(no);
    // 課題管理（acli）には何も打っていない
    expect(w.calls.slice(before).filter(c => c.cmd === 'acli')).toEqual([]);
  });

  test('【ask-tpm】と【incident】は送れる。TPM 担当は名簿の Key で答える', () => {
    const w = reviewed();
    expect(askTpm(w.staff, { text: '見る物が読めない', waitingFor: '見る物' })[0]).toBe('送った: 【ask-tpm】→ file:tpm（届いた）');
    expect(reportIncident(w.staff, { text: '依頼書の URL が 404', type: 'reliability', tags: [], severe: false }).at(-1)).toBe('送った: 【incident】→ file:tpm（届いた）');
    w.wire.inbox('file:tpm');
    expect(notify(w.tpm, 'AI-8.staff', { text: 'URL を直した' })).toEqual(['送った: 【notify】→ file:2（届いた）']);
  });

  test('Staff の席に【dismiss】は送れない（tpm close で閉じる）', () => {
    const w = reviewed();
    expect(() => dismiss(w.tpm, 'AI-8.staff', { handover: false })).toThrow(/Staff Engineer 担当の席に【dismiss】は送りません。tpm close AI-8\.staff で閉じます/);
    expect(requireRole(w.tpm, 'AI-8.staff').dismissed).toBeUndefined();
  });
});

describe('Staff の席のページ', () => {
  test('tpm page put は、課題の Key の folder に置く', () => {
    const w = reviewed();
    const html = join(realpathSync(mkdtempSync(join(tmpdir(), 'tpm-staff-'))), 'r.html');
    writeFileSync(html, '<title>レビュー</title>');
    const out = pagePut(w.staff, html, { kind: 'result' });
    expect(out.find(l => l.startsWith('URL: '))).toBe(`URL: http://127.0.0.1:8801/${basename(w.tpm.state.dir)}/AI-8/result-1.html`);
    expect([...w.store.pages.values()].map(p => [p.record.key, p.record.role])).toContainEqual(['AI-8', 'staff-engineer']);
  });
});

describe('castlist の名', () => {
  test('接頭辞は <課題の Key>-staff。ラベルの Key は名簿の Key（席を 1 つに決めるため）', () => {
    expect(seatPrefix('AI-8', 'staff-engineer')).toBe('ai-8-staff');
    const w = reviewed();
    expect(seatOf(w.staff)).toEqual({ prefix: 'ai-8-staff', role: 'staff-engineer', key: 'AI-8.staff', subject: 'AI-8' });
    expect(seatOf({ ...w.se, env: { ...w.se.env, TPM_ROLE: 'software-engineer' } })).toEqual({ prefix: 'ai-8-swe', role: 'software-engineer', key: 'AI-8' });
  });
});

describe('時系列のページ', () => {
  test('課題の Key で集めると、Staff の席の行も入る。Staff の席の Key でも集められる', () => {
    const w = reviewed();
    askTpm(w.se, { text: '案で迷う', waitingFor: '案' });
    askTpm(w.staff, { text: '見る物が読めない', waitingFor: '見る物' });
    const whats = (key: string): string[] => collect(w.tpm, key).filter(e => e.kind === 'メッセージ').map(e => `${e.who}: ${e.what.split('（id')[0] ?? ''}（席 ${e.seat ?? ''}）`);
    expect(whats('AI-8').filter(l => !l.includes('【ask-review】') && !l.includes('【brief】'))).toEqual(['SWE AI-8: 計画と実装: 【ask-tpm】案で迷う（席 AI-8）', 'レビュー AI-8: 計画 plan-1: 【ask-tpm】見る物が読めない（席 AI-8.staff）']);
    expect(whats('AI-8.staff')).toEqual(['レビュー AI-8: 計画 plan-1: 【ask-tpm】見る物が読めない（席 AI-8.staff）']);
  });
});
