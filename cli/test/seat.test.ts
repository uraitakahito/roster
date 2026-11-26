import { describe, expect, test } from 'vitest';
import { dismiss, reportEnd } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { seatAdd, seatClose } from '../src/commands/seat.ts';
import { assign, close } from '../src/commands/tpm-side.ts';
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

  test('上限を超える分は断る。数えるのは今の名簿に居る repo の席で、落ちた席を同じ名で起こし直すのは数えない', async () => {
    const w = await led(1);
    await seatAdd(w.lead, 'pagetray', SEAT);
    await expect(seatAdd(w.lead, 'castlist', SEAT)).rejects.toThrow(/^repo の席は 1 つまでです（今: AI-36\.pagetray）。起こしていません/);
    expect(repoSeats(w.tpm, 'AI-36').map(r => r.key)).toEqual(['AI-36.pagetray']);
    w.wire.close('file:2');
    expect((await seatAdd(w.lead, 'pagetray', SEAT))[0]).toMatch(/^起こし直した: SWE AI-36 pagetray: 課題（file:3/);
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
