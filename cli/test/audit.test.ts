import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readAudits } from '../src/audits.ts';
import { auditBegin, auditFresh, auditStart } from '../src/commands/audit.ts';
import { incidentAdd } from '../src/commands/incident.ts';
import { askPm, askTpm, dismiss, notify, reportAudit, reportDecided, reportDocFix, reportDone, reportEnd, reportIncident, reportMerged } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign, close, roles } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import type { GateStop } from '../src/evidence.ts';
import { BRIEF, world, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const PAGE = 'http://127.0.0.1:8801/-p/audit/audit-1.html';
const hook = (source: string): string => JSON.stringify({ hook_event_name: 'SessionStart', source });

/** skill /audit がある（か、無い）skills の repo に見立てた folder。 */
function fakeRoot(skill: boolean): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-root-')));
  const skills = join(root, 'skill-sets', 'core', '.claude', 'skills');
  mkdirSync(join(skills, 'audit'), { recursive: true });
  if (skill) writeFileSync(join(skills, 'audit', 'SKILL.md'), '# audit');
  return root;
}

/** Product Manager が Audit の席を起こし、Auditor が名乗った世界。tpm が false なら、TPM 担当は起きていない。 */
function seated(tpm = true): World & { root: string, pm: Context, auditor: Context, se: Context } {
  const w = world();
  if (tpm) hello(w.tpm, TPM);
  const root = fakeRoot(true);
  // Product Manager の手: 担当の環境変数（$TPM_KEY）を持たない。
  const pm = { ...w.tpm, root };
  auditStart(pm, { wait: 0 });
  const address = w.wire.seats().find(s => s.title === 'Audit')?.address ?? '';
  const base = w.role('audit', address);
  const auditor = { ...base, root, env: { ...base.env, TPM_ROLE: 'auditor' } };
  hello(auditor);
  const se = { ...w.role('t-x7k2', 'file:9'), env: { ...w.role('t-x7k2', 'file:9').env, TPM_ROLE: 'software-engineer' } };
  return { ...w, root, pm, auditor, se };
}

/** 時計を進める（TPM 担当と Auditor の両方）。 */
function at(w: { tpm: Context, auditor: Context }, iso: string): void {
  w.tpm.now = () => new Date(iso);
  w.auditor.now = w.tpm.now;
}

describe('この repo の skill', () => {
  test('tpm audit start が起こす skill /audit と、Auditor が読む規程・手順がある', () => {
    const skills = join(import.meta.dirname, '..', '..', 'skill-sets', 'core', '.claude', 'skills');
    for (const file of ['audit/SKILL.md', '_shared/audit-charter.md', '_shared/audit.md']) expect(existsSync(join(skills, file)), file).toBe(true);
  });
});

describe('tpm audit start', () => {
  test('Product Manager が打つと、名簿に Auditor の行を書き、居場所を作る。記録に残る', () => {
    const w = world();
    hello(w.tpm, TPM);
    const pm = { ...w.tpm, root: fakeRoot(true) };
    expect(auditStart(pm, { wait: 0 })).toEqual([
      '起こした: Audit（file:1・Fable 5.2 · high）',
      `folder: ${w.project}`,
      'この席で /audit（定期の監査）か /audit <件の番号…>（臨時の監査）を呼ぶ。2 度目からは、先に /clear を打つ',
      '名乗り（tpm hello）は待っていない',
    ]);
    expect(w.wire.command('file:1')).toBe(`${pm.root}/cli/bin/tpm run-role audit --project ${w.project} --state ${w.tpm.state.dir}`);
    expect(w.wire.seats()).toEqual([{ address: 'file:1', title: 'Audit' }]);
    expect(readAudits(w.tpm)).toEqual([{ at: '2026-11-20T12:00:00.000Z', kind: 'start', address: 'file:1' }]);
  });

  test('model などは 旗 > config.jsonc の auditor の欄 > 役割の既定', () => {
    const w = world({ auditor: { effort: 'medium' } });
    const pm = { ...w.tpm, root: fakeRoot(true) };
    expect(auditStart(pm, { wait: 0, model: 'claude-opus-5-5' })[0]).toBe('起こした: Audit（file:1・Opus 5.5 · medium）');
  });

  test('席は 1 つ。もうあれば断り、居場所が消えていれば起こし直す', () => {
    const w = seated();
    expect(() => auditStart(w.pm, { wait: 0 })).toThrow(/Audit の席はもうあります（file:1）。その席で \/clear を打ってから、\/audit を呼んでください/);
    w.wire.close('file:1');
    expect(roles(w.tpm)).toContain('- audit  Audit  消えた（居場所が無い。起こし直すのは Product Manager: tpm audit start）');
    expect(auditStart(w.pm, { wait: 0 })[0]).toBe('起こし直した: Audit（file:2・Fable 5.2 · high）');
  });

  test('担当の居場所からは起こせない。skill /audit が無ければ起こさない', () => {
    const w = seated();
    expect(() => auditStart({ ...w.se, root: w.root }, { wait: 0 })).toThrow(/Audit の席を起こすのは Product Manager です/);
    expect(() => auditStart({ ...world().tpm, root: fakeRoot(false) }, { wait: 0 })).toThrow(/skill \/audit がまだありません/);
  });

  test('TPM 担当は、Auditor の席を起こせない・依頼書を送れない・【dismiss】を送れない・閉じられない。答えは返せる', () => {
    const w = seated();
    expect(() => assign(w.tpm, 'audit', { role: 'auditor', brief: BRIEF, wait: 0 })).toThrow(/Product Manager が tpm audit start で起こします/);
    expect(() => dismiss(w.tpm, 'audit', { handover: false })).toThrow(/Auditor の席に【dismiss】は送れません/);
    expect(() => dismiss(w.tpm, 'audit', { handover: true })).toThrow(/Auditor の席に【dismiss】は送れません/);
    expect(() => close(w.tpm, 'audit')).toThrow(/tpm close では閉じられません/);
    expect(w.wire.seats()).toEqual([{ address: 'file:1', title: 'Audit' }]);
    expect(notify(w.tpm, 'audit', { text: '受け取った' })).toEqual(['送った: 【notify】→ file:1（届いた）']);
  });
});

describe('Auditor の tpm hello', () => {
  test('題と状態を出し、監査の材料を返す', () => {
    const w = seated();
    expect(hello(w.auditor)).toEqual([
      '役割: Auditor',
      '課題の Key: audit',
      `監査の規程: 無い（${w.root}/skill-sets/core/.claude/skills/_shared/audit-charter.md）`,
      `監査の手順: 無い（${w.root}/skill-sets/core/.claude/skills/_shared/audit.md）`,
      '前の監査: まだ無い（次が最初の監査）',
      'TPM 担当の宛先: file:tpm',
      '自分の宛先: file:1',
    ]);
    expect(w.wire.status('file:1')).toEqual({ model: 'Fable 5.2 · high', wait: '回答待ち(PM): /audit' });
  });

  test('Product Manager が手で起こした席でも、名乗る時に題と色を付ける', () => {
    const w = seated();
    w.auditor.transport.setColor('file:1', 'Red');
    hello(w.auditor);
    expect(w.wire.look('file:1')).toEqual({ title: 'Audit', color: 'Olive' });
  });

  test('TPM 担当が起きていなくても名乗れる', () => {
    const w = seated(false);
    expect(hello(w.auditor)).toContain('TPM 担当の宛先: 無い（TPM 担当が起きていない）');
  });
});

describe('監査の 1 周（始める → 報告 → 決定）', () => {
  test('始める・報告する・決定を渡す。報告と決定が記録に残る', () => {
    const w = seated();
    auditFresh(w.auditor, hook('startup'));
    incidentAdd(w.tpm, 't-8zuk', { text: '権限 1', type: 'efficiency', tags: [], severe: false });
    expect(auditBegin(w.auditor, [])).toEqual([
      '監査を始めた: 定期',
      `監査の規程: 無い（${w.root}/skill-sets/core/.claude/skills/_shared/audit-charter.md）`,
      `監査の手順: 無い（${w.root}/skill-sets/core/.claude/skills/_shared/audit.md）`,
      '前の監査: まだ無い（次が最初の監査）',
      '台帳: 未決 1（出来事 1・残りと PM の手 0）・振った 0',
      '見直す: tpm incident review／追いかける: tpm incident follow',
    ]);
    expect(reportAudit(w.auditor, { url: PAGE, summary: '権限の件は仕組みが止めていない', items: ['R1 をするか', 'R2 を受け入れるか'] })).toEqual([
      '送った: 【audit】→ file:tpm（届いた）',
      '状態: 回答待ち(PM): 監査の報告',
      'この席に、要点と決めてほしいことを書いて、Product Manager の答えを待つ',
    ]);
    expect(w.wire.inbox('file:tpm').at(-1)).toMatchObject({ from: 'Audit', text: `【audit】${PAGE} 要点: 権限の件は仕組みが止めていない／決めてほしいこと: (1) R1 をするか (2) R2 を受け入れるか（写し。Product Manager には Audit の席でじかに報告した。伝え直さなくてよい）` });
    expect(reportDecided(w.auditor, { url: PAGE, adopted: ['R1'], accepted: ['R2'], later: [] })).toEqual(['送った: 【decided】→ file:tpm（届いた）', '状態: 回答待ち(PM): 次の /audit']);
    expect(w.wire.inbox('file:tpm').at(-1)?.text).toBe(`【decided】${PAGE} する: R1／受け入れる: R2`);
    expect(readAudits(w.tpm).map(e => e.kind)).toEqual(['start', 'fresh', 'begin', 'report', 'decided']);
    expect(readAudits(w.tpm).at(-2)).toMatchObject({ kind: 'report', url: PAGE, items: ['R1 をするか', 'R2 を受け入れるか'], copied: true });
  });

  test('前の報告の後に /clear していなければ、始めずに止まる。/clear の後は通り、前の監査と、答えの出ていない報告を出す', () => {
    const w = seated();
    auditFresh(w.auditor, hook('startup'));
    auditBegin(w.auditor, []);
    reportAudit(w.auditor, { url: PAGE, summary: '要点', items: ['R1 をするか'] });
    at(w, '2026-11-23T12:00:00.000Z');
    expect(() => auditBegin(w.auditor, [])).toThrow(new RegExp(`前の監査の報告（${PAGE}・11-20 12:00）の後に、/clear していません。監査は始めていません`));
    // 文脈の要約と、続きから開いた時は、新しい文脈に数えない。
    auditFresh(w.auditor, hook('compact'));
    auditFresh(w.auditor, hook('resume'));
    expect(() => auditBegin(w.auditor, [])).toThrow(/\/clear していません/);
    expect(w.tpm.state.lines<GateStop>('gate.jsonl').map(g => [g.by, g.role, g.gate, g.detail])).toEqual([['audit', 'auditor', 'stale-context', PAGE], ['audit', 'auditor', 'stale-context', PAGE]]);
    auditFresh(w.auditor, hook('clear'));
    expect(auditBegin(w.auditor, []).slice(3)).toEqual([
      `前の監査: ${PAGE}（11-20 12:00 に報告。3 日前）`,
      `答えの出ていない報告: ${PAGE}（11-20 12:00 に報告。決めてほしいこと: R1 をするか）。Product Manager に聞き直す`,
      '台帳: 未決 0（出来事 0・残りと PM の手 0）・振った 0',
      '見直す: tpm incident review／追いかける: tpm incident follow --since 2026-11-20T12:00:00.000Z',
    ]);
    expect(readAudits(w.tpm).filter(e => e.kind === 'fresh').map(e => e.source)).toEqual(['startup', 'clear']);
  });

  test('臨時の監査は、名指した件を記録する。無い番号なら始めない', () => {
    const w = seated();
    incidentAdd(w.tpm, 't-8zuk', { text: '権限 1', type: 'efficiency', tags: [], severe: false });
    incidentAdd(w.tpm, 'AI-21', { text: '権限 2', type: 'efficiency', tags: [], severe: false });
    expect(() => auditBegin(w.auditor, ['1', '9'])).toThrow('台帳に #9 はありません');
    expect(auditBegin(w.auditor, ['#2', '1'])[0]).toBe('監査を始めた: 臨時（#2・#1）');
    expect(readAudits(w.tpm).at(-1)).toMatchObject({ kind: 'begin', incidents: [2, 1] });
  });

  test('TPM 担当が起きていなくても報告はできる（写しは送らない）。決定は、起きるまで送らない', () => {
    const w = seated(false);
    expect(reportAudit(w.auditor, { url: PAGE, summary: '要点', items: [] })[0]).toBe('TPM 担当が起きていないので、写しは送っていない（報告は、この席とページで Product Manager に出す）');
    expect(readAudits(w.tpm).at(-1)).toMatchObject({ kind: 'report', copied: false });
    expect(() => reportDecided(w.auditor, { url: PAGE, adopted: ['R1'], accepted: [], later: [] })).toThrow(/TPM 担当が起きていません。決定は送っていません・記録していません/);
    expect(readAudits(w.tpm).some(e => e.kind === 'decided')).toBe(false);
  });

  test('旗の誤り: 置き場の外の URL・決定が 1 つも無い', () => {
    const w = seated();
    expect(() => reportAudit(w.auditor, { url: 'https://example.com/a.html', summary: 's', items: [] })).toThrow(/監査のページの URL/);
    expect(() => reportDecided(w.auditor, { url: PAGE, adopted: [], accepted: [], later: [] })).toThrow(/--do・--accept・--later のどれか/);
    expect(readAudits(w.tpm).map(e => e.kind)).toEqual(['start']);
  });
});

describe('誰が打てるか', () => {
  test('監査の命令は Auditor だけ。hook の印も、Auditor の席でだけ書く', () => {
    const w = seated();
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '題', brief: BRIEF, wait: 0 });
    hello(w.se);
    expect(() => auditBegin(w.se, [])).toThrow(/tpm audit begin は Auditor（Audit の席）が打ちます/);
    expect(() => auditBegin(w.tpm, [])).toThrow(/Auditor（Audit の席）が打ちます/);
    expect(() => reportAudit(w.se, { url: PAGE, summary: 's', items: [] })).toThrow(/tpm report audit は Auditor（Audit の席）が打ちます/);
    expect(() => reportDecided(w.se, { url: PAGE, adopted: ['R1'], accepted: [], later: [] })).toThrow(/tpm report decided は Auditor/);
    auditFresh(w.se, hook('clear'));
    auditFresh(w.tpm, hook('startup'));
    expect(readAudits(w.tpm).map(e => e.kind)).toEqual(['start']);
  });

  test('Auditor は、PR や【done】の命令を打たない。問いと【incident】は打てる', () => {
    const w = seated();
    for (const [command, run] of [
      ['tpm report done', () => reportDone(w.auditor, { kind: 'audit', summary: 's', remaining: 'なし', decisions: 'なし', points: [] })],
      ['tpm report end', () => reportEnd(w.auditor, { prs: [], removed: [], left: 'なし' })],
      ['tpm report merged', () => reportMerged(w.auditor, { pr: 'https://github.com/o/r/pull/7', note: 'x' })],
      ['tpm report doc-fix', () => reportDocFix(w.auditor, { pr: 'https://github.com/o/r/pull/7', note: 'x' })],
      ['tpm ask pm', () => askPm(w.auditor, { url: PAGE, items: ['x'], waitingFor: 'x' })],
    ] as const) expect(run, command).toThrow(`Auditor は ${command} を打ちません`);
    expect(w.wire.inbox('file:tpm')).toEqual([]);
    expect(askTpm(w.auditor, { text: 'この件の依頼書の URL を教えてほしい', waitingFor: '依頼書の URL' })[0]).toBe('送った: 【ask-tpm】→ file:tpm（届いた）');
    expect(reportIncident(w.auditor, { text: '監査のページに誤りを書いた', type: 'reliability', tags: ['監査の誤り'], severe: false })[0]).toMatch(/^台帳に書いた: #1 信頼性 audit /);
  });
});

describe('TPM 担当の名簿の「前の監査」の 1 行', () => {
  test('Auditor の席を 1 度も起こしていなければ出さない。起こした後は、前の報告の日と日数を出す', () => {
    const fresh = world();
    hello(fresh.tpm, TPM);
    expect(roles(fresh.tpm)).toEqual(['名簿: 担当はいない']);
    const w = seated();
    expect(roles(w.tpm).at(-1)).toBe('前の監査: まだ無い（目安は週 1。Product Manager が Audit の席で /audit を呼ぶ）');
    reportAudit(w.auditor, { url: PAGE, summary: '要点', items: [] });
    at(w, '2026-11-26T11:59:00.000Z');
    expect(roles(w.tpm).at(-1)).toBe('前の監査: 2026-11-20（5 日前。目安は週 1）');
    at(w, '2026-11-28T12:00:00.000Z');
    expect(roles(w.tpm).at(-1)).toBe('前の監査: 2026-11-20（8 日前。目安は週 1。目安を過ぎているので、Product Manager に一言伝える）');
    expect(hello(w.tpm, TPM).at(-1)).toMatch(/^前の監査: 2026-11-20（8 日前/);
  });
});
