import { describe, expect, test } from 'vitest';
import { incidentAdd, incidentAssign, incidentClose, incidentDrop, incidentFollow, incidentReview, incidentTag } from '../src/commands/incident.ts';
import { dismiss, reportDone, reportEnd, reportIncident, wait } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign, roles } from '../src/commands/tpm-side.ts';
import { addIncident, incidentType, readIncidents } from '../src/incidents.ts';
import { BRIEF, world, type World } from './helpers.ts';

function started(config: Record<string, unknown> = {}, issue?: string): World & { se: ReturnType<World['role']> } {
  const w = world(config);
  hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
  assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, ...(issue === undefined ? {} : { issue }) });
  const se = w.role('t-x7k2', 'file:1');
  hello(se);
  return { ...w, se };
}
/** Auditor の居場所から打つ周り。 */
const auditorOf = (w: World): ReturnType<World['role']> => ({ ...w.role('audit', 'file:9'), env: { ROSTER_KEY: 'audit', ROSTER_ROLE: 'auditor' } });
const add = (w: World, key: string, text: string, more: Partial<Parameters<typeof incidentAdd>[2]> = {}): string[] =>
  incidentAdd(w.tpm, key, { text, type: 'efficiency', tags: [], severe: false, ...more });

describe('台帳に書く', () => {
  test('TPM 担当: roster incident add。tag があれば、同じ tag の前の件を返す', () => {
    const w = started();
    expect(add(w, 't-8zuk', 'gh api の書き込みが断られた', { tags: ['権限'] })).toEqual(['台帳に書いた: #1 効率性 t-8zuk 11-20 12:00「gh api の書き込みが断られた」 tag: 権限', '権限: 初めて']);
    add(w, 't-3m36', 'acli でコンポーネントを付けられない', { tags: ['権限'] });
    expect(add(w, 'AI-21', '画面の操作を頼んだ', { tags: ['権限', 'pm-hand'], msg: 'm-1', severe: true, type: 'safety' })).toEqual([
      '台帳に書いた: #3 [重い] 安全性 AI-21 11-20 12:00「画面の操作を頼んだ」 tag: 権限・pm-hand msg: m-1',
      '権限: これで 3 件目（前: #1 t-8zuk・#2 t-3m36）',
      'pm-hand: 初めて',
      '重い件: すぐ Product Manager に伝える（監査を呼ぶなら、Audit の席で /audit <番号>）',
    ]);
    expect(readIncidents(w.tpm)[2]).toEqual({ n: 3, at: '2026-11-20T12:00:00.000Z', key: 'AI-21', by: 'tpm', role: 'tpm', source: 'add', type: 'safety', text: '画面の操作を頼んだ', tags: ['権限', 'pm-hand'], msg: 'm-1', severe: true, status: 'open' });
  });

  test('種類は英語で書く。日本語なら替わりの値を案内する。事実と tag の形も見る', () => {
    expect(incidentType('reliability')).toBe('reliability');
    expect(() => incidentType('信頼性')).toThrow('--type 信頼性 は reliability と書いてください（--type reliability）');
    expect(() => incidentType('x')).toThrow('--type は reliability（信頼性）・safety（安全性）・efficiency（効率性） のどれかにしてください');
    const w = started();
    expect(() => add(w, 't-x7k2', ' ')).toThrow(/起きた事実/);
    expect(() => add(w, 't-x7k2', 'x', { tags: ['a b'] })).toThrow(/tag は/);
    expect(() => add(w, 'bad key', 'x')).toThrow(/課題の Key/);
    expect(readIncidents(w.tpm)).toEqual([]);
  });

  test('担当: roster report incident は台帳に書き、【incident】を送る。課題管理には書かない', () => {
    const w = started({ tracker: 'github' }, 'gh-12');
    const comments = w.calls.filter(c => c.args[1] === 'comment').length;
    expect(reportIncident(w.se, { text: 'merge が断られたのに【merged】を送った', type: 'reliability', tags: [], severe: false })).toEqual([
      '台帳に書いた: #1 信頼性 t-x7k2 11-20 12:00「merge が断られたのに【merged】を送った」',
      '送った: 【incident】→ file:tpm（相手の手が空いた時に届く。送り直さない）',
    ]);
    expect(w.wire.inbox('file:tpm').at(-1)?.text).toBe('【incident】#1 信頼性: merge が断られたのに【merged】を送った');
    reportIncident(w.se, { text: 'image が public だった', type: 'safety', tags: ['公開'], severe: true });
    expect(w.wire.inbox('file:tpm').at(-1)?.text).toBe('【incident】#2 [重い] 安全性: image が public だった（tag: 公開）');
    expect(readIncidents(w.tpm).map(i => [i.by, i.source])).toEqual([['t-x7k2', 'report'], ['t-x7k2', 'report']]);
    expect(w.calls.filter(c => c.args[1] === 'comment')).toHaveLength(comments);
    // 種類の誤りは、送る前の検査より先に見る（何も書かない）
    expect(() => reportIncident(w.se, { text: 'x', type: '安全性', tags: [], severe: false })).toThrow(/safety と書いて/);
    expect(readIncidents(w.tpm)).toHaveLength(2);
  });

  test('【done】の「残り」と【end】の「残っている物」は、「なし」で始まらなければ台帳に入る', () => {
    const w = started();
    const done = (remaining: string): string[] => reportDone(w.se, { kind: 'result', summary: 's', remaining, decisions: 'なし', points: [] });
    done('なし');
    done('なし（提案まで。repo は変えていない）');
    expect(readIncidents(w.tpm)).toEqual([]);
    expect(done('本体の checkout が main より古い')).toContain('台帳に入れた（TPM 担当が、振るか捨てるかを決める）: #1');
    dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(reportEnd(w.se, { prs: [], removed: [], left: '古い image が 1 つ残っている' })).toContain('台帳の #1（【done】の残り）に寄せた（TPM 担当が、振るか捨てるかを決める）');
    expect(readIncidents(w.tpm).map(i => [i.source, i.type, i.text])).toEqual([
      ['remaining', undefined, '【done】の残り: 本体の checkout が main より古い ／ 【end】の残り: 古い image が 1 つ残っている'],
    ]);
    // 【done】の「残り」が無ければ、【end】の「残っている物」は新しい件
    const v = started();
    reportDone(v.se, { kind: 'result', summary: 's', remaining: 'なし', decisions: 'なし', points: [] });
    dismiss(v.tpm, 't-x7k2', { handover: false });
    expect(reportEnd(v.se, { prs: [], removed: [], left: '古い image が 1 つ残っている' })).toContain('台帳に入れた（TPM 担当が、振るか捨てるかを決める）: #1');
    expect(readIncidents(v.tpm).map(i => i.text)).toEqual(['【end】の残り: 古い image が 1 つ残っている']);
  });

  test('【end】の「残っている物」は、同じ Key の未決の【done】の「残り」の、いちばん新しい件に寄せる', () => {
    const w = started();
    const done = (remaining: string): string[] => reportDone(w.se, { kind: 'result', summary: 's', remaining, decisions: 'なし', points: [] });
    add(w, 't-x7k2', 'merge の前に main が動いた');
    done('古い image が 1 つ残っている');
    done('proposal-3 は古い版');
    dismiss(w.tpm, 't-x7k2', { handover: false });
    // 中身が【done】の「残り」と同じなら、足さない
    expect(reportEnd(w.se, { prs: [], removed: [], left: 'proposal-3 は古い版' })).toContain('台帳の #3（【done】の残り）に寄せた（TPM 担当が、振るか捨てるかを決める）');
    expect(readIncidents(w.tpm).map(i => i.text)).toEqual([
      'merge の前に main が動いた',
      '【done】の残り: 古い image が 1 つ残っている',
      '【done】の残り: proposal-3 は古い版',
    ]);
  });

  test('寄せる先は未決の件だけ。違う中身は後ろに足す。決めた件と、ほかの Key の件には寄せない', () => {
    const w = started();
    const done = (remaining: string): string[] => reportDone(w.se, { kind: 'result', summary: 's', remaining, decisions: 'なし', points: [] });
    done('古い image が 1 つ残っている');
    incidentDrop(w.tpm, ['1'], { why: '次の release で消える' });
    done('proposal-3 は古い版');
    addIncident(w.tpm, { key: 't-other', source: 'remaining', text: '【done】の残り: ほかの課題の残り' });
    dismiss(w.tpm, 't-x7k2', { handover: false });
    expect(reportEnd(w.se, { prs: [], removed: [], left: 'proposal-3 は古い版。置いたままのページ: brief-2' })).toContain('台帳の #2（【done】の残り）に寄せた（TPM 担当が、振るか捨てるかを決める）');
    expect(readIncidents(w.tpm).map(i => [i.n, i.status, i.text])).toEqual([
      [1, 'dropped', '【done】の残り: 古い image が 1 つ残っている'],
      [2, 'open', '【done】の残り: proposal-3 は古い版 ／ 【end】の残り: proposal-3 は古い版。置いたままのページ: brief-2'],
      [3, 'open', '【done】の残り: ほかの課題の残り'],
    ]);
  });

  test('roster wait pm --hand は、頼んだ手を pm-hand の件として数える。wait pm のほかには付けられない', () => {
    const w = started();
    expect(wait(w.tpm, 'pm', 'Jira の画面でコンポーネントを付ける', { hand: true })).toEqual([
      '状態: 回答待ち(PM): Jira の画面でコンポーネントを付ける',
      '台帳に入れた: #1 PM の手 tpm 11-20 12:00「Jira の画面でコンポーネントを付ける」 tag: pm-hand',
      'pm-hand: 初めて',
    ]);
    wait(w.tpm, 'pm', '指示');
    expect(wait(w.tpm, 'pm', '! の 1 行', { hand: true }).at(-1)).toBe('pm-hand: これで 2 件目（前: #1 tpm）');
    expect(() => wait(w.tpm, 'work', '実装', { hand: true })).toThrow(/--hand は roster wait pm だけ/);
    expect(readIncidents(w.tpm)).toHaveLength(2);
  });

  test('roster wait pm --hand の打ち直しは、前の wait がその頼みのままなら、同じ件に寄せる', () => {
    const w = started();
    wait(w.tpm, 'pm', '/tpm の呼び直しと最初の監査', { hand: true });
    // 同じ字の打ち直しは、件の字も変えない
    expect(wait(w.tpm, 'pm', '/tpm の呼び直しと最初の監査', { hand: true })).toEqual([
      '状態: 回答待ち(PM): /tpm の呼び直しと最初の監査',
      '台帳の件に寄せた（打ち直し。新しい件にしない）: #1 PM の手 tpm 11-20 12:00「/tpm の呼び直しと最初の監査」 tag: pm-hand',
    ]);
    // 言い替えた打ち直しは、後ろに足す。もう 1 度でも同じ件
    wait(w.tpm, 'pm', '最初の監査（Audit の席で /audit）', { hand: true });
    wait(w.tpm, 'pm', '最初の監査（Audit の席で /audit）', { hand: true });
    expect(readIncidents(w.tpm).map(i => i.text)).toEqual(['/tpm の呼び直しと最初の監査 ／ 打ち直し: 最初の監査（Audit の席で /audit）']);
    // 間に別の wait を挟んだら、新しい頼み
    wait(w.tpm, 'work', '答えを担当に送る');
    wait(w.tpm, 'pm', 'GitHub の画面で設定を替える', { hand: true });
    // 前の件を決めた後の --hand も、新しい頼み
    incidentDrop(w.tpm, ['2'], { why: '済んだ' });
    expect(wait(w.tpm, 'pm', 'GitHub の画面で設定を替える', { hand: true })[1]).toMatch(/^台帳に入れた: #3 /);
    expect(readIncidents(w.tpm).map(i => [i.n, i.status])).toEqual([[1, 'open'], [2, 'dropped'], [3, 'open']]);
  });

  test('同時に書いても、同じ番号にならない（在る番号は飛ばす）', () => {
    const w = started();
    // 別の担当が、番号を数えた後・書く前に #1 を作った、という順を作る。
    w.tpm.state.write('incidents/1.jsonc', { n: 1, tags: [], status: 'open' });
    const list = w.tpm.state.list.bind(w.tpm.state);
    w.tpm.state.list = folder => folder === 'incidents' ? [] : list(folder);
    expect(addIncident(w.tpm, { key: 't-x7k2', source: 'add', text: 'x' }).n).toBe(2);
  });
});

describe('台帳を見直す・扱いを決める', () => {
  function ledger(): World & { se: ReturnType<World['role']> } {
    const w = started();
    add(w, 't-8zuk', '権限 1', { tags: ['権限'] });
    add(w, 'AI-22', 'うその【merged】', { type: 'reliability' });
    add(w, 't-8zuk', 'image が public', { type: 'safety', severe: true });
    wait(w.tpm, 'pm', 'Jira の画面', { hand: true });
    return w;
  }

  test('review は未決の件を、重い物・種類の順に並べ、tag ごとの件数を出す', () => {
    const w = ledger();
    expect(incidentReview(w.tpm)).toEqual([
      '台帳: 未決 4',
      '#3 [重い] 安全性 t-8zuk 11-20 12:00「image が public」',
      '#2 信頼性 AI-22 11-20 12:00「うその【merged】」',
      '#1 効率性 t-8zuk 11-20 12:00「権限 1」 tag: 権限',
      '#4 PM の手 tpm 11-20 12:00「Jira の画面」 tag: pm-hand',
      'tag ごと（全件）: 権限 1・pm-hand 1',
    ]);
    expect(incidentReview(w.tpm, { tag: '権限' })).toHaveLength(3);
    expect(JSON.parse(incidentReview(w.tpm, { json: true })[0] ?? '')).toHaveLength(4);
    expect(incidentReview(started().tpm)).toEqual(['台帳: 未決の件は無い']);
  });

  test('tag・assign・drop・close。決めた件は review から消え、--all には扱いと一緒に出る', () => {
    const w = ledger();
    expect(incidentTag(w.tpm, '#2', ['行き違い', '行き違い'])).toEqual(['tag を付けた: #2 信頼性 AI-22 11-20 12:00「うその【merged】」 tag: 行き違い', '行き違い: 初めて']);
    expect(incidentAssign(w.tpm, ['3', '#2'], { to: 't-k4wd' })).toEqual([
      '振った: #3 [重い] 安全性 t-8zuk 11-20 12:00「image が public」 振った: t-k4wd',
      '振った: #2 信頼性 AI-22 11-20 12:00「うその【merged】」 tag: 行き違い 振った: t-k4wd',
    ]);
    incidentDrop(w.tpm, ['4'], { why: '1 度きり' });
    expect(incidentClose(auditorOf(w), ['1'], { pr: 'https://github.com/o/r/pull/9' })[0]).toMatch(/^済み: #1 .* 済み: https:\/\/github.com\/o\/r\/pull\/9$/);
    expect(incidentReview(w.tpm)).toEqual(['台帳: 未決の件は無い']);
    expect(incidentReview(w.tpm, { all: true })[0]).toBe('台帳: 振った 2・調べない 1・済み 1');
    expect(readIncidents(w.tpm).map(i => [i.status, i.to ?? i.why ?? i.pr, i.decidedAt])).toEqual([
      ['closed', 'https://github.com/o/r/pull/9', '2026-11-20T12:00:00.000Z'],
      ['assigned', 't-k4wd', '2026-11-20T12:00:00.000Z'],
      ['assigned', 't-k4wd', '2026-11-20T12:00:00.000Z'],
      ['dropped', '1 度きり', '2026-11-20T12:00:00.000Z'],
    ]);
  });

  test('出来事（種類のある件）を「調べない」「済み」にできるのは Auditor だけ。「残り」と「PM の手」は TPM 担当も決められる', () => {
    const w = ledger();
    reportDone(w.se, { kind: 'result', summary: 's', remaining: '古い image が残っている', decisions: 'なし', points: [] });
    expect(() => incidentDrop(w.tpm, ['1'], { why: '1 度きり' })).toThrow('出来事（種類のある件）を「調べない」にできるのは Auditor だけです: #1。どれも書き替えていません');
    expect(() => incidentClose(w.tpm, ['2', '3'], { pr: 'https://github.com/o/r/pull/9' })).toThrow('を「済み」にできるのは Auditor だけです: #2・#3');
    // 出来事が 1 つでも混じっていれば、「残り」も書き替えない。
    expect(() => incidentDrop(w.tpm, ['4', '1', '5'], { why: 'x' })).toThrow(/Auditor だけです: #1。/);
    expect(readIncidents(w.tpm).every(i => i.status === 'open')).toBe(true);
    // tag と振り先は、TPM 担当も付けられる（通った改善を課題にして振った時）。
    incidentTag(w.tpm, '1', ['権限']);
    incidentAssign(w.tpm, ['1'], { to: 't-k4wd' });
    incidentDrop(w.tpm, ['4'], { why: 'Product Manager が見送った' });
    incidentClose(w.tpm, ['5'], { why: '消した' });
    incidentDrop(auditorOf(w), ['2'], { why: '訂正済み' });
    incidentClose(auditorOf(w), ['3'], { pr: 'https://github.com/o/r/pull/9' });
    expect(readIncidents(w.tpm).map(i => [i.type ?? i.source, i.status, i.decidedBy?.role])).toEqual([
      ['efficiency', 'assigned', 'tpm'],
      ['reliability', 'dropped', 'auditor'],
      ['safety', 'closed', 'auditor'],
      ['pm-hand', 'dropped', 'tpm'],
      ['remaining', 'closed', 'tpm'],
    ]);
  });

  test('要る旗が無い・番号が無いときは、どれも書き替えない', () => {
    const w = ledger();
    expect(() => incidentAssign(w.tpm, ['1'], {})).toThrow(/--to/);
    expect(() => incidentDrop(w.tpm, ['4'], { why: ' ' })).toThrow(/--why/);
    expect(() => incidentClose(w.tpm, ['4'], {})).toThrow(/--pr .*--lesson .*--why/);
    expect(() => incidentDrop(w.tpm, ['4', '9'], { why: 'x' })).toThrow('台帳に #9 はありません');
    expect(() => incidentDrop(w.tpm, ['x'], { why: 'x' })).toThrow(/件の番号/);
    expect(() => incidentDrop(w.tpm, [], { why: 'x' })).toThrow(/1 つ以上/);
    expect(readIncidents(w.tpm).every(i => i.status === 'open')).toBe(true);
  });

  test('担当は、見直す・扱いを決める命令を打てない（書くのは roster report incident）', () => {
    const w = ledger();
    for (const run of [
      () => incidentReview(w.se),
      () => incidentTag(w.se, '1', ['x']),
      () => incidentAssign(w.se, ['1'], { to: 't-k4wd' }),
      () => incidentDrop(w.se, ['1'], { why: 'x' }),
      () => incidentClose(w.se, ['1'], { why: 'x' }),
      () => incidentFollow(w.se),
    ]) expect(run).toThrow(/TPM 担当と Auditor です。担当は roster report incident/);
    expect(() => incidentAdd(w.se, 't-x7k2', { text: 'x', type: 'safety', tags: [], severe: false })).toThrow(/roster incident add で書くのは TPM 担当です。担当は roster report incident/);
    expect(readIncidents(w.tpm).every(i => i.status === 'open')).toBe(true);
  });

  test('Auditor は、見直す・扱いを決める命令を打てる。誰が決めたかが件に残る', () => {
    const w = ledger();
    const auditor = auditorOf(w);
    expect(incidentReview(auditor)[0]).toBe('台帳: 未決 4');
    expect(incidentTag(auditor, '2', ['うその知らせ'])[0]).toMatch(/^tag を付けた: #2 /);
    incidentAssign(auditor, ['3'], { to: 'audit' });
    incidentDrop(auditor, ['2'], { why: 'Product Manager が受け入れた（audit-1 の R2）' });
    incidentClose(auditor, ['1'], { pr: 'https://github.com/o/r/pull/9' });
    incidentDrop(w.tpm, ['4'], { why: '1 度きり' });
    expect(readIncidents(w.tpm).map(i => [i.status, i.decidedBy])).toEqual([
      ['closed', { by: 'audit', role: 'auditor' }],
      ['dropped', { by: 'audit', role: 'auditor' }],
      ['assigned', { by: 'audit', role: 'auditor' }],
      ['dropped', { by: 'tpm', role: 'tpm' }],
    ]);
    // 書くのは、ほかの担当と同じく roster report incident。
    expect(() => incidentAdd(auditor, 'audit', { text: 'x', type: 'safety', tags: [], severe: false })).toThrow(/roster incident add で書くのは TPM 担当です/);
  });

  test('未決の件があれば、名簿の終わりに 1 行出す', () => {
    const w = ledger();
    expect(roles(w.tpm).at(-1)).toBe('台帳: 未決 4 件（重い 1）。roster incident review で見る');
    incidentDrop(auditorOf(w), ['1', '2', '3', '4'], { why: '試し' });
    expect(roles(w.tpm).at(-1)).toMatch(/^- t-x7k2/);
  });
});

describe('追いかけの一覧（roster incident follow）', () => {
  const at = (w: World, iso: string): void => {
    w.tpm.now = () => new Date(iso);
  };

  test('振ったまま・済みの後の再発・古い残り・TPM 担当の決め、を出す', () => {
    const w = started();
    at(w, '2026-11-20T12:00:00.000Z');
    add(w, 't-8zuk', '権限 1', { tags: ['権限'] });
    add(w, 'AI-22', '行き違い 1', { type: 'reliability', tags: ['行き違い'] });
    add(w, 't-3m36', '行き違い 2', { tags: ['行き違い'] });
    wait(w.tpm, 'pm', 'Jira の画面', { hand: true });
    w.se.now = w.tpm.now;
    reportDone(w.se, { kind: 'result', summary: 's', remaining: '本体の checkout が main より古い', decisions: 'なし', points: [] });
    at(w, '2026-11-21T00:00:00.000Z');
    // 振り先の 1 つは名簿に居ない担当、もう 1 つは動いていて【done】を返した担当。
    incidentAssign(w.tpm, ['1'], { to: 't-k4wd' });
    add(w, 't-x7k2', '振る件', { type: 'safety' });
    incidentAssign(w.tpm, ['6'], { to: 't-x7k2' });
    // #2 は、誰が決めたかの欄ができる前に TPM 担当が済みにした件（欄が無い）。#3 は Auditor が済みにした件。
    w.tpm.state.write('incidents/2.jsonc', { ...readIncidents(w.tpm)[1], status: 'closed', pr: 'https://github.com/o/r/pull/9', decidedAt: '2026-11-21T00:00:00.000Z' });
    incidentClose({ ...auditorOf(w), now: w.tpm.now }, ['3'], { pr: 'https://github.com/o/r/pull/9' });
    incidentDrop(w.tpm, ['4'], { why: '1 度きり' });
    at(w, '2026-11-22T06:00:00.000Z');
    add(w, 'AI-24', '行き違い 3', { tags: ['行き違い'] });
    at(w, '2026-11-23T12:00:00.000Z');
    expect(incidentFollow(auditorOf({ ...w, role: (key, address) => ({ ...w.role(key, address), now: w.tpm.now }) }))).toEqual([
      '振ったまま: 2 件',
      '- #1 効率性 t-8zuk 11-20 12:00「権限 1」 tag: 権限 振った: t-k4wd（2 日前に振った。振り先: 名簿に居ない・【done】【end】【merged】は無い）',
      '- #6 安全性 t-x7k2 11-21 00:00「振る件」 振った: t-x7k2（2 日前に振った。振り先: 動いている・最後の【done】 11-20 12:00）',
      '済みの後の再発（tag）: 1 件',
      '- 行き違い: 済み 2 件（#2・#3）の後に 1 件（#7）',
      '古い残り（未決の「残り」と「PM の手」。古い順）: 1 件',
      '- #5 残り t-x7k2 11-20 12:00「【done】の残り: 本体の checkout が main より古い」（3 日）',
      'TPM 担当の決め（調べない・済み）: 2 件',
      '- #2 信頼性 AI-22 11-20 12:00「行き違い 1」 tag: 行き違い 済み: https://github.com/o/r/pull/9（決めた: 11-21 00:00）',
      '- #4 PM の手 tpm 11-20 12:00「Jira の画面」 tag: pm-hand 調べない: 1 度きり（決めた: 11-21 00:00）',
    ]);
    // --since より後に決めた件だけ。Auditor が決めた件は「TPM 担当の決め」に出ない。
    incidentDrop(auditorOf(w), ['7'], { why: '訂正済み' });
    expect(incidentFollow(w.tpm, { since: '2026-11-21' }).at(-1)).toBe('TPM 担当の決め（調べない・済み。2026-11-21 より後）: 無い');
    expect(incidentFollow(w.tpm, { since: '2026-11-20' }).filter(l => l.startsWith('- #')).slice(-2).map(l => l.slice(2, 4))).toEqual(['#2', '#4']);
    expect(() => incidentFollow(w.tpm, { since: 'きのう' })).toThrow(/--since は日付/);
    const json = JSON.parse(incidentFollow(w.tpm, { json: true })[0] ?? '') as { assigned: unknown[], recurred: { tag: string }[], remaining: unknown[], decided: unknown[] };
    // 後で「調べない」にした件も、済みの後に起きた事には変わりないので、再発に数える。
    expect([json.assigned.length, json.recurred.length, json.remaining.length, json.decided.length]).toEqual([2, 1, 1, 2]);
  });

  test('何も無ければ、段ごとに「無い」と出す。扱いは変えない', () => {
    const w = started();
    add(w, 't-8zuk', '権限 1', { tags: ['権限'] });
    expect(incidentFollow(w.tpm)).toEqual(['振ったまま: 無い', '済みの後の再発（tag）: 無い', '古い残り（未決の「残り」と「PM の手」。古い順）: 無い', 'TPM 担当の決め（調べない・済み）: 無い']);
    expect(readIncidents(w.tpm).map(i => i.status)).toEqual(['open']);
  });
});
