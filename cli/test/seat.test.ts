import { describe, expect, test } from 'vitest';
import { seatOf } from '../src/castlist.ts';
import { askPm, dismiss, reportDone, reportEnd } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { seatAdd, seatClose } from '../src/commands/seat.ts';
import { collect } from '../src/commands/timeline.ts';
import { assign, close, roles } from '../src/commands/tpm-side.ts';
import { sendsMessage } from '../src/guard.ts';
import { allRoles, readRole, repoSeats, writeRole } from '../src/roster.ts';
import { BRIEF, world, type World } from './helpers.ts';

const SEAT = { brief: BRIEF, wait: 0 } as const;

/** Tech Lead 担当（AI-36・file:1）が名乗った所まで。seats は、渡す席の数の上限（無ければ渡さない）。 */
async function led(seats?: number): Promise<World & { lead: World['tpm'] }> {
  const w = world();
  await hello(w.tpm);
  await assign(w.tpm, 'AI-36', { role: 'tech-lead', title: '3 つの repo', brief: BRIEF, wait: 0, ...(seats === undefined ? {} : { seats }) });
  const lead = w.role('AI-36', 'file:1');
  await hello(lead);
  return { ...w, lead };
}

describe('roster seat add（Tech Lead 担当が repo の席を起こす）', () => {
  test('名簿に <課題の Key>.<名> の行（Software Engineer 担当・親の課題つき）を書き、席を起こす。席は名乗りで依頼書を受ける', async () => {
    const w = await led(2);
    const out = await seatAdd(w.lead, 'pagetray', { ...SEAT, title: 'server' });
    expect(out).toEqual(['起こした: SWE AI-36 pagetray: server（file:2・Opus 5.5 · medium）', `folder: ${w.project}`, '名簿の Key: AI-36.pagetray', '名乗り（roster hello）は待っていない']);
    expect(readRole(w.tpm, 'AI-36.pagetray')).toMatchObject({ key: 'AI-36.pagetray', subject: 'AI-36', role: 'software-engineer', brief: BRIEF, firstBrief: BRIEF, address: 'file:2' });
    expect(w.wire.look('file:2')?.color).toBe('Green');
    // 席を起こす所は、TPM 担当の roster assign と同じ関数を通る（同じ run-role の命令。hook は run-role が付ける）。
    expect(w.wire.command('file:2')).toBe(`${w.tpm.root}/cli/bin/roster run-role AI-36.pagetray --project ${w.project} --state ${w.tpm.state.dir}`);
    const said = await hello(w.role('AI-36.pagetray', 'file:2'));
    expect(said).toContain('役割: Software Engineer');
    expect(said).toContain('課題の Key: AI-36');
    expect(said).toContain('名簿の Key: AI-36.pagetray');
    expect(said).toContain('Tech Lead 担当の席: Lead AI-36: 3 つの repo（この席を起こし、依頼書を渡した担当）');
    expect(said).toContain(`依頼書: ${BRIEF}`);
  });

  test('課題管理の課題は親と同じ。--cwd で受け持つ repo の folder に起こす', async () => {
    const w = world({ tracker: 'jira' });
    await hello(w.tpm);
    await assign(w.tpm, 'AI-36', { role: 'tech-lead', brief: BRIEF, issue: 'AI-36', noIssueCopy: '試験', wait: 0, seats: 1 });
    const lead = w.role('AI-36', 'file:1');
    await hello(lead);
    await seatAdd(lead, 'roster', { ...SEAT, cwd: '/tmp' });
    expect(readRole(w.tpm, 'AI-36.roster')).toMatchObject({ issue: 'AI-36', cwd: '/tmp' });
  });

  test('課題の写しは、Tech Lead 担当が受けた物（か、作らなかった訳）をそのまま渡す。席ごとに写し直さない', async () => {
    const w = await led(2);
    const page = readRole(w.tpm, 'AI-36')?.issuePage;
    expect(page).toMatch(/\/AI-36\/issue-1\.html$/);
    const before = w.asked().length;
    await seatAdd(w.lead, 'pagetray', SEAT);
    expect(readRole(w.tpm, 'AI-36.pagetray')?.issuePage).toBe(page);
    // 置き場には、依頼書の概要の節を読む 1 度しか頼まない（写しを置き直さない）。
    expect(w.asked().slice(before).filter(a => a.startsWith('PUT') || a.startsWith('POST'))).toEqual([]);
    const skipped = world({ tracker: 'jira' });
    await hello(skipped.tpm);
    await assign(skipped.tpm, 'AI-36', { role: 'tech-lead', brief: BRIEF, issue: 'AI-36', noIssueCopy: 'Jira の認証が切れている', wait: 0, seats: 1 });
    const lead = skipped.role('AI-36', 'file:1');
    await hello(lead);
    await seatAdd(lead, 'pagetray', SEAT);
    expect(readRole(skipped.tpm, 'AI-36.pagetray')).toMatchObject({ issueCopySkipped: 'Jira の認証が切れている' });
    expect(await hello(skipped.role('AI-36.pagetray', 'file:2'))).toContain('課題の写し: 無し（Jira の認証が切れている）');
  });

  test('上限を超える分は断る。数えるのは今の名簿に居る repo の席で、落ちた席を同じ名で起こし直すのは数えない', async () => {
    const w = await led(1);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await expect(seatAdd(w.lead, 'castlist', SEAT)).rejects.toThrow(/^repo の席は 1 つまでです（今: AI-36\.pagetray）。起こしていません/);
    expect(repoSeats(w.tpm, 'AI-36').map(r => r.key)).toEqual(['AI-36.pagetray']);
    w.wire.close('file:2');
    expect((await seatAdd(w.lead, 'pagetray', SEAT))[0]).toMatch(/^起こし直した: SWE AI-36 pagetray: 課題（file:3/);
  });

  test('Tech Lead 担当を起こし直す時、--seats が無ければ前の上限を受け継ぐ', async () => {
    const w = await led(2);
    w.wire.close('file:1');
    await assign(w.tpm, 'AI-36', { role: 'tech-lead', brief: BRIEF, wait: 0 });
    expect(readRole(w.tpm, 'AI-36')?.seats).toBe(2);
    await assign(w.tpm, 'AI-36', { role: 'tech-lead', brief: BRIEF, wait: 0, seats: 3, supersede: true });
    expect(readRole(w.tpm, 'AI-36')?.seats).toBe(3);
  });

  test('上限は、続きの依頼書でも替えられる', async () => {
    const w = await led(1);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await assign(w.tpm, 'AI-36', { role: 'tech-lead', brief: BRIEF, wait: 0, seats: 2, supersede: true });
    expect((await seatAdd(w.lead, 'castlist', SEAT))[0]).toMatch(/^起こした: SWE AI-36 castlist/);
  });

  test('断る: 上限が渡されていない・もう居る席・名の形・名 staff・Tech Lead 担当でない者', async () => {
    const bare = await led();
    await expect(seatAdd(bare.lead, 'pagetray', SEAT)).rejects.toThrow(/上限が、まだ渡されていません。起こしていません。roster ask tpm/);
    const w = await led(3);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await expect(seatAdd(w.lead, 'pagetray', SEAT)).rejects.toThrow(/^AI-36\.pagetray の席は、もう居ます（file:2）。起こしていません/);
    await expect(seatAdd(w.lead, 'Page Tray', SEAT)).rejects.toThrow(/席の名は、英小文字・数字・- だけ/);
    await expect(seatAdd(w.lead, 'staff', SEAT)).rejects.toThrow(/席の名 staff は使えません/);
    await expect(seatAdd(w.role('AI-36.pagetray', 'file:2'), 'x', SEAT)).rejects.toThrow(/^roster seat add は Tech Lead 担当が打ちます.*Software Engineer 担当の session（AI-36\.pagetray）/);
    await expect(seatAdd(w.tpm, 'x', SEAT)).rejects.toThrow(/\$ROSTER_KEY がありません/);
    expect(allRoles(w.tpm).map(r => r.key).sort()).toEqual(['AI-36', 'AI-36.pagetray']);
  });

  test('--seats は --role tech-lead だけ・1 以上の整数', async () => {
    const w = world();
    await hello(w.tpm);
    await expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: BRIEF, wait: 0, seats: 2 })).rejects.toThrow(/--seats は --role tech-lead だけ/);
    await expect(assign(w.tpm, 'AI-36', { role: 'tech-lead', brief: BRIEF, wait: 0, seats: 0 })).rejects.toThrow(/--seats は 1 以上の整数/);
  });

  test('guard は roster seat を送る命令と見る（手伝いに打たせない守りが見分ける）', () => {
    expect(sendsMessage('roster seat add pagetray --brief http://x')).toBe(true);
    expect(sendsMessage('roster seat close pagetray')).toBe(true);
  });
});

describe('repo の席と、TPM 担当の命令', () => {
  test('roster assign・roster dismiss は、repo の席を断る（名簿の行で見分ける）', async () => {
    const w = await led(1);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await expect(assign(w.tpm, 'AI-36.pagetray', { role: 'software-engineer', brief: BRIEF, wait: 0 })).rejects.toThrow(/^AI-36\.pagetray は、AI-36 の Tech Lead 担当が起こした repo の席です/);
    await expect(dismiss(w.tpm, 'AI-36.pagetray', { handover: false })).rejects.toThrow(/^AI-36\.pagetray は、AI-36 の Tech Lead 担当が起こした repo の席です。片付けの指示は Tech Lead 担当が送ります/);
    // 点を含む Key でも、名簿に親の課題を持つ行が無ければ、いつもの課題の Key として振れる。
    expect((await assign(w.tpm, 'web.app', { role: 'software-engineer', brief: BRIEF, wait: 0 }))[0]).toMatch(/^起こした: SWE web\.app/);
  });

  test('roster assign は、動いている席と違う役割では振れない（依頼書が、役割を替えたつもりで今の席に届くのを止める）', async () => {
    const w = await led(1);
    await expect(assign(w.tpm, 'AI-36', { role: 'software-engineer', brief: BRIEF, wait: 0 })).rejects.toThrow(/^AI-36 には、Tech Lead 担当がもう動いています（file:1）。--role software-engineer では起こせません・依頼書も送っていません/);
    expect(w.posted('file:1')).toEqual([]);
  });

  test('roster roles は、居場所の無い repo の席に、Tech Lead 担当の命令を案内する', async () => {
    const w = await led(1);
    await seatAdd(w.lead, 'pagetray', SEAT);
    w.wire.close('file:2');
    expect((await roles(w.tpm)).find(l => l.startsWith('- AI-36.pagetray'))).toContain('消えた（居場所が無い。AI-36 の Tech Lead 担当が roster seat add で起こし直すか、roster seat close で名簿から消す）');
  });

  test('roster close <課題の Key> は、残った repo の席も一緒に閉じる', async () => {
    const w = await led(2);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await seatAdd(w.lead, 'castlist', SEAT);
    const out = await close(w.tpm, 'AI-36');
    expect(out).toEqual(['閉じた: Lead AI-36: 3 つの repo（file:1）', '閉じた: SWE AI-36 castlist: 課題（file:3）', '閉じた: SWE AI-36 pagetray: 課題（file:2）']);
    expect(allRoles(w.tpm)).toEqual([]);
    expect(w.wire.seats()).toEqual([]);
  });
});

describe('roster seat close（Tech Lead 担当が repo の席を閉じる）', () => {
  test('片付けの終わり（【end】）を送っていない、居る席は閉じない。居場所の無い席は閉じる', async () => {
    const w = await led(2);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await expect(seatClose(w.lead, 'pagetray')).rejects.toThrow(/まだ片付けの終わり（【end】）を送っていません。閉じていません/);
    expect(readRole(w.tpm, 'AI-36.pagetray')).toBeDefined();
    w.wire.close('file:2');
    expect(await seatClose(w.lead, 'pagetray')).toEqual(['閉じた: SWE AI-36 pagetray: 課題（居場所はもう無かった）']);
    expect(readRole(w.tpm, 'AI-36.pagetray')).toBeUndefined();
  });

  test('起こし直して、まだ名乗っていない席は、前の席の【end】では閉じない', async () => {
    const w = await led(2);
    await seatAdd(w.lead, 'pagetray', SEAT);
    const old = w.role('AI-36.pagetray', 'file:2');
    await hello(old);
    writeRole(w.tpm, { ...readRole(w.tpm, 'AI-36.pagetray')!, dismissed: 'done' });
    await reportEnd(old, { prs: [], removed: [], left: 'なし' });
    w.wire.close('file:2');
    await seatAdd(w.lead, 'pagetray', SEAT);
    await expect(seatClose(w.lead, 'pagetray')).rejects.toThrow(/まだ片付けの終わり（【end】）を送っていません/);
  });

  test('その席の Staff Engineer 担当の席が残っていれば、一緒に閉じる', async () => {
    const w = await led(2);
    await seatAdd(w.lead, 'pagetray', SEAT);
    const seat = readRole(w.tpm, 'AI-36.pagetray')!;
    writeRole(w.tpm, { ...seat, key: 'AI-36.pagetray.staff', subject: 'AI-36.pagetray', role: 'staff-engineer', title: 'レビュー AI-36.pagetray: PR #1', address: 'file:9' });
    w.wire.close('file:2');
    expect(await seatClose(w.lead, 'pagetray')).toEqual(['閉じた: SWE AI-36 pagetray: 課題（居場所はもう無かった）', '閉じた: レビュー AI-36.pagetray: PR #1（居場所はもう無かった）']);
    expect(allRoles(w.tpm).map(r => r.key)).toEqual(['AI-36']);
  });

  test('【end】を送った席は閉じる', async () => {
    const w = await led(2);
    await seatAdd(w.lead, 'pagetray', SEAT);
    const seat = w.role('AI-36.pagetray', 'file:2');
    await hello(seat);
    // 片付けの指示（【dismiss】）を受けた席にする（指示を送る命令は、後の段で足す）。
    writeRole(w.tpm, { ...readRole(w.tpm, 'AI-36.pagetray')!, dismissed: 'done' });
    await reportEnd(seat, { prs: [], removed: [], left: 'なし' });
    expect(await seatClose(w.lead, 'pagetray')).toEqual(['閉じた: SWE AI-36 pagetray: 課題（file:2）']);
    expect(w.wire.seats().map(s => s.address)).toEqual(['file:1']);
  });

  test('断る: 名簿に無い席・別の課題の席・Tech Lead 担当でない者', async () => {
    const w = await led(2);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await expect(seatClose(w.lead, 'castlist')).rejects.toThrow(/^AI-36\.castlist の席が名簿にいません/);
    await expect(seatClose(w.role('AI-36.pagetray', 'file:2'), 'pagetray')).rejects.toThrow(/^roster seat close は Tech Lead 担当が打ちます/);
  });
});

describe('repo の席の後始末', () => {
  /** github の課題 gh-12 を受け持つ Tech Lead 担当（file:1）と、repo の席 pagetray（file:2）。どちらも【dismiss】を受けた事にしてある。 */
  async function tracked(): Promise<World & { lead: World['tpm'], seat: World['tpm'] }> {
    const w = world({ tracker: 'github' });
    await hello(w.tpm);
    await assign(w.tpm, 'gh-12', { role: 'tech-lead', brief: BRIEF, issue: 'gh-12', noIssueCopy: '試験', wait: 0, seats: 1 });
    const lead = w.role('gh-12', 'file:1');
    await hello(lead);
    await seatAdd(lead, 'pagetray', SEAT);
    const seat = w.role('gh-12.pagetray', 'file:2');
    await hello(seat);
    for (const key of ['gh-12', 'gh-12.pagetray']) writeRole(w.tpm, { ...readRole(w.tpm, key)!, dismissed: 'done' });
    return { ...w, lead, seat };
  }
  const bodies = (w: World): string[] => w.calls.filter(c => c.args[1] === 'comment').map(c => c.options?.input ?? '');
  const closes = (w: World): number => w.calls.filter(c => c.args[1] === 'close').length;

  test('repo の席の【end】は課題を済みにしない。Tech Lead 担当の【end】で済みになる。repo の席の記録の 1 行目には席の名が入る', async () => {
    const w = await tracked();
    await reportDone(w.seat, { kind: 'result', summary: 'server を入れた', remaining: 'なし', decisions: 'なし', points: [] });
    const ended = await reportEnd(w.seat, { prs: [], removed: [], left: 'なし' });
    expect(ended).toContain('課題は閉じない: gh-12（repo の席。課題を済みにするのは、Tech Lead 担当の片付けの時）');
    expect(closes(w)).toBe(0);
    // Tech Lead 担当は、repo の席が名簿に残っている間は終えられない。
    await expect(reportEnd(w.lead, { prs: [], removed: [], left: 'なし' })).rejects.toThrow(/^repo の席が名簿に残っています（gh-12\.pagetray）。【end】は送っていません/);
    await seatClose(w.lead, 'pagetray');
    expect(await reportEnd(w.lead, { prs: [], removed: [], left: 'なし' })).toContain('課題を閉じた: gh-12');
    expect(closes(w)).toBe(1);
    expect(bodies(w)).toEqual([
      '【結果】Software Engineer（pagetray）: server を入れた',
      '【結果】Software Engineer（pagetray）: 片付けた（残っている物: なし）',
      '【結果】Tech Lead: 片付けた（残っている物: なし）',
    ]);
  });

  test('repo の席は roster ask pm を打てない（確認は Tech Lead 担当がまとめる）', async () => {
    const w = await tracked();
    await expect(askPm(w.seat, { url: 'https://claude.ai/artifact/c1', items: ['案'], waitingFor: '案' })).rejects.toThrow(/^repo の席（gh-12\.pagetray）は roster ask pm を打ちません.*roster ask lead で Tech Lead 担当（gh-12）に送ってください/);
    expect(bodies(w)).toEqual([]);
    expect(w.posted('file:tpm')).toEqual([]);
  });

  test('出来事の時系列は、課題の Key で集めると repo の席の行も入る（別の課題は入らない）', async () => {
    const w = await tracked();
    await reportDone(w.seat, { kind: 'result', summary: 'server を入れた', remaining: 'なし', decisions: 'なし', points: [] });
    expect(collect(w.tpm, 'gh-12').some(e => e.what.includes('【done】') && e.what.includes('server を入れた'))).toBe(true);
    expect(collect(w.tpm, 'gh-1').some(e => e.what.includes('【done】'))).toBe(false);
    // 点を含む別の課題（Key の頭が同じ）は混ぜない。閉じた repo の席の記録は、控えで集め続ける。
    await assign(w.tpm, 'gh-12.other', { role: 'software-engineer', brief: BRIEF, noIssueCopy: '試験', wait: 0 });
    const other = w.role('gh-12.other', 'file:3');
    await hello(other);
    await reportDone(other, { kind: 'result', summary: '別の課題の成果', remaining: 'なし', decisions: 'なし', points: [] });
    w.wire.close('file:2');
    await seatClose(w.lead, 'pagetray');
    const whats = collect(w.tpm, 'gh-12').map(e => e.what);
    expect(whats.some(t => t.includes('別の課題の成果'))).toBe(false);
    expect(whats.some(t => t.includes('server を入れた'))).toBe(true);
  });

  test('台帳での名は席ごと（<課題の Key>-<名>-swe）。親の課題の Key を subject に持つ', async () => {
    const w = await tracked();
    expect(seatOf(w.seat)).toEqual({ prefix: 'gh-12-pagetray-swe', role: 'software-engineer', key: 'gh-12.pagetray', subject: 'gh-12' });
    expect(seatOf(w.lead)).toEqual({ prefix: 'gh-12-lead', role: 'tech-lead', key: 'gh-12' });
  });
});
