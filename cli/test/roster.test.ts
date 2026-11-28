import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { missingCastlistWarning } from '../src/castlist.ts';
import { hello, inboxNow } from '../src/commands/role-side.ts';
import { assertRead } from '../src/commands/messages.ts';
import { assign, close, configLines, newKey, recordingTo, roles } from '../src/commands/tpm-side.ts';
import { createContext, type Context } from '../src/context.ts';
import { buildCommand } from '../src/command.ts';
import { modelLabel, modelStatus, ROLES, TPM_COLOR } from '../src/protocol.ts';
import { readRole, requireRole, writeRole } from '../src/roster.ts';
import { claudeArgs, roleEnv } from '../src/run-role.ts';
import { TpmError } from '../src/skill-sets.ts';
import { BRIEF, world } from './helpers.ts';

const SE = { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 } as const;

/** 席に付く、メッセージを渡す hook（guardSettings）。待つ命令は背景で動く。 */
const WAITING = { type: 'command', async: true, asyncRewake: true, timeout: 86400, command: '/r/cli/bin/roster mail wait' };
const GATE = [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/r/cli/bin/roster mail gate' }] }];
const MAIL_HOOKS = { PostToolUse: GATE, PostToolUseFailure: GATE, Stop: [{ hooks: [WAITING] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster mail prompt' }] }] };

describe('hello（TPM 担当）', () => {
  test('$ROSTER_KEY が無ければ TPM 担当として名乗る: 宛先を状態に書き、状態を出し、名簿を出す', async () => {
    const w = world();
    expect(await hello(w.tpm)).toEqual([...missingCastlistWarning(w.tpm), 'TPM 担当の宛先: file:tpm', `設定: ${w.project}/.claude/roles/config.jsonc`, '課題管理: none（既定）・連携: file', '名簿: 担当はいない']);
    expect(w.tpm.state.read('tpm.jsonc')).toEqual({ address: 'file:tpm' });
    expect(w.wire.status('file:tpm')).toEqual({ model: 'Opus 5.5 · medium', wait: '作業中: 起動' });
  });

  test('状態の model・effort は、同じ環境変数で roster start が出す 1 行と揃う', async () => {
    const env = { ROSTER_MODEL: 'claude-fable-5-2', ROSTER_EFFORT: 'high' };
    const w = world({}, env);
    await hello(w.tpm);
    const line = buildCommand('/w', w.tpm.root, [], env);
    expect(line).toContain(' --model claude-fable-5-2 --effort high ');
    expect(w.wire.status('file:tpm')?.model).toBe(modelStatus('claude-fable-5-2', 'high'));
  });

  test('effort は 旗 > $CLAUDE_EFFORT（実際の effort）> $ROSTER_EFFORT、model は 旗 > $ROSTER_MODEL', async () => {
    const w = world({}, { ROSTER_MODEL: 'claude-fable-5-2', ROSTER_EFFORT: 'high', CLAUDE_EFFORT: 'low' });
    await hello(w.tpm);
    expect(w.wire.status('file:tpm')?.model).toBe('Fable 5.2 · low');
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'max' });
    expect(w.wire.status('file:tpm')?.model).toBe('Opus 5.5 · max');
  });

  test('古い名（TPM_MODEL など）は読まず、残っていれば知らせる。起こしの印の古い名は、起こし直すよう知らせる', async () => {
    const w = world({}, { TPM_MODEL: 'claude-fable-5-2', TPM_PAGES_URL: 'http://old', TPM_LAUNCH: 'x' });
    const lines = await hello(w.tpm);
    expect(lines).toContain('環境変数の古い名は読みません。新しい名に替えてください: TPM_MODEL → ROSTER_MODEL・TPM_PAGES_URL → ROSTER_PAGES_URL（Product Manager に伝える）');
    expect(lines).toContain('この TPM 担当は、道具の名を替える前の roster start の 1 行で起きています（TPM_LAUNCH）。roster start の 1 行で起こし直してください（Product Manager に伝える）');
    expect(w.wire.status('file:tpm')?.model).toBe('Opus 5.5 · medium');
  });
});

/** setColor を差し替えた TPM 担当（自分の居場所は一覧に載らないので、file の連携では色を読めない）。 */
function painting(tpm: Context, setColor: (address: string, color: string) => void): Context {
  return { ...tpm, seats: Object.assign(Object.create(tpm.seats) as Context['seats'], { setColor }) };
}

describe('居場所の色', () => {
  test('どの役割も色を持ち、TPM 担当とも互いとも違う。選んだ居場所の地の青と紛れる色は使わない', () => {
    const colors = [TPM_COLOR, ...Object.values(ROLES).map(r => r.color)];
    expect(colors).toEqual(['Amber', 'Green', 'Red', 'Orange', 'Magenta', 'Purple', 'Olive']);
    expect(new Set(colors).size).toBe(colors.length);
    for (const blue of ['Blue', 'Navy', 'Indigo', 'Aqua', 'Teal', 'Charcoal']) expect(colors).not.toContain(blue);
  });

  test('roster assign は、起こした席に役割の色を付ける', async () => {
    const w = world();
    await assign(w.tpm, 't-x7k2', SE);
    await assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0 });
    await assign(w.tpm, 'gh#1', { role: 'sustaining-engineer', wait: 0 });
    expect(['file:1', 'file:2', 'file:3'].map(a => w.wire.look(a)?.color)).toEqual(['Green', 'Orange', 'Magenta']);
  });

  test('roster assign --role tech-lead は、題 Lead <Key>: <短い題> の席を起こし、名乗りは依頼書を返す', async () => {
    const w = world();
    await hello(w.tpm);
    const out = await assign(w.tpm, 'AI-36', { role: 'tech-lead', title: '3 つの repo', brief: BRIEF, wait: 0 });
    expect(out[0]).toBe('起こした: Lead AI-36: 3 つの repo（file:1・Opus 5.5 · medium）');
    expect(w.wire.look('file:1')?.color).toBe('Red');
    const said = await hello(w.role('AI-36', 'file:1'));
    expect(said).toContain('役割: Tech Lead');
    expect(said).toContain('課題の Key: AI-36');
    expect(said).toContain(`依頼書: ${BRIEF}`);
  });

  test('担当も、名乗る時に自分の居場所に役割の色を付け直す（起こす時に付けられなかった席・前から居る席）', async () => {
    const w = world();
    await hello(w.tpm);
    await assign(w.tpm, 't-x7k2', SE);
    w.wire.setColor('file:1', 'Red');
    await hello(w.role('t-x7k2', 'file:1'));
    expect(w.wire.look('file:1')?.color).toBe('Green');
  });

  test('TPM 担当は、名乗る時に自分の居場所に色を付ける。付けられなくても名乗りは止めず、1 行で知らせる', async () => {
    const w = world();
    const painted: string[][] = [];
    await hello(painting(w.tpm, (address, color) => painted.push([address, color])));
    expect(painted).toEqual([['file:tpm', 'Amber']]);
    const out = await hello(painting(w.tpm, () => {
      throw new Error('unknown color');
    }));
    expect(out).toContain('居場所の色（Amber）を付けられなかった: unknown color');
    expect(w.tpm.state.read('tpm.jsonc')).toEqual({ address: 'file:tpm' });
  });
});

describe('assign', () => {
  test('Auditor の席は、TPM 担当の roster assign では起こせない（役割でも Key でも）', async () => {
    const w = world();
    await expect(assign(w.tpm, 't-x7k2', { role: 'auditor', wait: 0 })).rejects.toThrow(/Auditor の席（Key audit）は、Product Manager が roster audit start で起こします/);
    await expect(assign(w.tpm, 'audit', { ...SE })).rejects.toThrow(/Auditor の席（Key audit）は、Product Manager が roster audit start で起こします/);
    expect(await roles(w.tpm)).toEqual(['名簿: 担当はいない']);
    expect(w.wire.seats()).toEqual([]);
  });

  test('名簿に書き、短い命令で居場所を作る', async () => {
    const w = world();
    const out = await assign(w.tpm, 't-x7k2', SE);
    const record = requireRole(w.tpm, 't-x7k2');
    expect(record).toEqual({
      key: 't-x7k2',
      role: 'software-engineer',
      title: 'SWE t-x7k2: 計画と実装',
      cwd: w.project,
      addDirs: [`${w.tpm.root}/skill-sets/core`],
      model: 'claude-opus-5-5',
      effort: 'medium',
      permissionMode: 'bypassPermissions',
      brief: BRIEF,
      firstBrief: BRIEF,
      address: 'file:1',
    });
    expect(w.wire.command('file:1')).toBe(`${w.tpm.root}/cli/bin/roster run-role t-x7k2 --project ${w.project} --state ${w.tpm.state.dir}`);
    expect(w.wire.seats()).toEqual([{ address: 'file:1', title: 'SWE t-x7k2: 計画と実装' }]);
    expect(out).toEqual(['起こした: SWE t-x7k2: 計画と実装（file:1・Opus 5.5 · medium）', `folder: ${w.project}`, '名乗り（roster hello）は待っていない']);
  });

  test('model などは 旗 > config.jsonc > 役割の既定 の順で決まる', async () => {
    const w = world({ 'skill-sets': ['dependabot'], 'devops-engineer': { model: 'claude-fable-5-2' } });
    await assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0, effort: 'high' });
    expect(requireRole(w.tpm, 'devops')).toMatchObject({
      title: 'DevOps',
      model: 'claude-fable-5-2',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      addDirs: [`${w.tpm.root}/skill-sets/core`, `${w.tpm.root}/skill-sets/dependabot`],
    });
  });

  test('担当の既定は、担当を起こす folder（--cwd）の設定 > project の folder の設定。直下の folder どうしは合わせない', async () => {
    const w = world({ 'software-engineer': { model: 'claude-fable-5-2', effort: 'low' } }, {}, {
      skills: { 'software-engineer': { effort: 'high' }, 'skill-sets': ['dependabot'] },
      web: { 'software-engineer': { effort: 'max', permissionMode: 'acceptEdits' } },
    });
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', wait: 0, cwd: join(w.project, 'skills') });
    // skill-sets は、どの folder で起こしても合わせた物
    expect(requireRole(w.tpm, 't-x7k2')).toMatchObject({ model: 'claude-fable-5-2', effort: 'high', permissionMode: 'bypassPermissions', cwd: join(w.project, 'skills'), addDirs: [`${w.tpm.root}/skill-sets/core`, `${w.tpm.root}/skill-sets/dependabot`] });
    await assign(w.tpm, 't-y8m3', { role: 'software-engineer', wait: 0 });
    expect(requireRole(w.tpm, 't-y8m3')).toMatchObject({ model: 'claude-fable-5-2', effort: 'low', permissionMode: 'bypassPermissions', cwd: w.project });
  });

  test('環境変数は config.jsonc の担当の欄に負け、役割の既定に勝つ', async () => {
    const env = { ROSTER_MODEL: 'claude-sonnet-5-5', ROSTER_EFFORT: 'high', ROSTER_PERMISSION_MODE: 'acceptEdits' };
    const w = world({ 'devops-engineer': { model: 'claude-fable-5-2' } }, env);
    await assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0 });
    expect(requireRole(w.tpm, 'devops')).toMatchObject({ model: 'claude-fable-5-2', effort: 'high', permissionMode: 'acceptEdits' });
    await assign(w.tpm, 'gh#1', { role: 'sustaining-engineer', wait: 0, effort: 'low' });
    expect(requireRole(w.tpm, 'gh#1')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low', permissionMode: 'acceptEdits' });
  });

  test('担当が名乗るまで待つ', async () => {
    const w = world();
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    let n = 0;
    const tpm = {
      ...w.tpm,
      sleep: async () => {
        n += 1;
        if (n === 2) await hello(w.role('t-x7k2', 'file:1'));
      },
    };
    expect((await assign(tpm, 't-x7k2', { ...SE, wait: 90 })).at(-1)).toBe('名乗った（roster hello が来た）');
    expect(n).toBe(2);
  });

  test('名乗らなければ、画面の終わりを添えて止まり、居場所は残す', async () => {
    const w = world();
    const tpm = { ...w.tpm, seats: Object.assign(w.wire, { screen: () => 'line 1\nError: something\n' }) };
    await expect(assign(tpm, 't-x7k2', { ...SE, wait: 4 })).rejects.toThrow(/4 秒たっても名乗りません。居場所は残してあります。画面の終わり:\nline 1\nError: something/);
    expect(w.slept()).toBe(2);
    expect(w.wire.seats()).toHaveLength(1);
  });

  test.each([
    ['信頼のダイアログ', 'Adding a new directory: /x\nIs this a directory you created or one you trust?', /信頼のダイアログで止まっていたので、Yes は押さずに閉じました/],
    ['命令の誤り', 'Unknown command: /software-engineer', /Unknown command でした/],
  ])('%sなら居場所を閉じてから止まる', async (_, screen, message) => {
    const w = world();
    const tpm = { ...w.tpm, seats: Object.assign(w.wire, { screen: () => screen }) };
    await expect(assign(tpm, 't-x7k2', { ...SE, wait: 2 })).rejects.toThrow(message);
    expect(w.wire.seats()).toEqual([]);
    expect(readRole(w.tpm, 't-x7k2')?.address).toBeUndefined();
  });

  test.each([Number.NaN, -1, Number.POSITIVE_INFINITY])('--wait が %s なら、起こす前に止まる', async (wait) => {
    const w = world();
    await expect(assign(w.tpm, 't-x7k2', { ...SE, wait })).rejects.toThrow(/--wait は 0 以上の数にしてください/);
    expect(w.wire.seats()).toEqual([]);
    expect(readRole(w.tpm, 't-x7k2')).toBeUndefined();
  });

  test('動いている担当の Key では起こさない。居場所が消えていれば起こし直す', async () => {
    const w = world();
    await assign(w.tpm, 't-x7k2', SE);
    await expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', wait: 0 })).rejects.toThrow(/t-x7k2 の担当はもう動いています（file:1）。新しい依頼書を --brief で/);
    expect(w.wire.seats()).toHaveLength(1);
    w.wire.close('file:1');
    expect((await assign(w.tpm, 't-x7k2', SE))[0]).toMatch(/^起こし直した: .*file:2/);
  });

  test('どの設定の課題管理の Key でもない課題は、読んだ設定を並べて断る', async () => {
    await expect(assign(world().tpm, 't-x7k2', { ...SE, issue: 'AI-12' })).rejects.toThrow(/AI-12 に記録を書く課題管理が、どの設定にもありません（読んだ設定: この folder＝none）/);
    await expect(assign(world({}, {}, { skills: { tracker: 'jira' } }).tpm, 'gh-12', { ...SE, issue: 'gh-12' })).rejects.toThrow(/読んだ設定: この folder＝none・skills＝jira/);
    const w = world({ tracker: 'github' });
    await assign(w.tpm, 'gh-12', { ...SE, issue: 'gh-12' });
    expect(requireRole(w.tpm, 'gh-12').issue).toBe('gh-12');
  });

  test('Key に空白などは使えない', async () => {
    await expect(assign(world().tpm, 't x', SE)).rejects.toThrow(TpmError);
  });

  test('t- の Key は t- と英小文字・数字 4 文字だけ。課題管理の Key・devops・<repo>#<PR> は問わない', async () => {
    for (const key of ['t-jsonc-check', 't-abc', 't-abcde', 't-AB12']) {
      await expect(assign(world().tpm, key, SE)).rejects.toThrow(/t- と英小文字・数字 4 文字にしてください（roster key で作る）/);
    }
    const w = world();
    expect((await assign(w.tpm, 't-0o1l', SE))[0]).toMatch(/^起こした: SWE t-0o1l: 計画と実装/);
    expect((await assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0 }))[0]).toMatch(/^起こした: DevOps（/);
    expect((await assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 }))[0]).toMatch(/^起こした: Sustaining app#12（/);
  });

  test('名簿にある前の決まりの長い Key は、そのまま【brief】を送れ、起こし直せる', async () => {
    const w = world();
    writeRole(w.tpm, { key: 't-jsonc-check', role: 'software-engineer', title: 'Software Engineer t-jsonc-check: JSONC', cwd: w.project, addDirs: [], model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'bypassPermissions' });
    expect((await assign(w.tpm, 't-jsonc-check', SE))[0]).toMatch(/^起こし直した: SWE t-jsonc-check: 計画と実装/);
    // 起こし直した担当はまだ名乗っていない（最初の依頼書が済んでいない）ので、済ませてからと添えて送る
    expect((await assign(w.tpm, 't-jsonc-check', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', wait: 0, after: true }))[0]).toMatch(/^送った: 【brief】/);
  });
});

describe('newKey', () => {
  /** TPM 担当の周りと、置き場の folder（world が一時の folder にしている）。 */
  function setup() {
    const w = world();
    return { w, tpm: w.tpm, pages: w.tpm.env.ROSTER_PAGES_DIR ?? '' };
  }
  /** 決めた並びの数を順に返す pick。 */
  const sequence = (...ns: number[]) => {
    let i = 0;
    return () => ns[i++ % ns.length] ?? 0;
  };

  test('t- と、読み違えやすい 0・o・1・l・i を除いた英小文字・数字 4 文字を作る', () => {
    const { tpm } = setup();
    for (let i = 0; i < 200; i++) expect(newKey(tpm)).toMatch(/^t-[2-9a-hjkmnp-z]{4}$/);
    expect(newKey(tpm, sequence(0, 7, 8, 30))).toBe('t-29az');
  });

  test('名簿の担当の Key と、置き場にページの folder がある Key は避ける', async () => {
    const { tpm, pages } = setup();
    await assign(tpm, 't-2222', SE);
    mkdirSync(join(pages, basename(tpm.state.dir), 't-3333'), { recursive: true });
    expect(newKey(tpm, sequence(0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2))).toBe('t-4444');
  });

  test('100 回ぶつかれば止める', async () => {
    const { tpm } = setup();
    await assign(tpm, 't-2222', SE);
    expect(() => newKey(tpm, () => 0)).toThrow(/使われていない Key を 100 回で作れませんでした/);
  });
});

describe('設定の出どころ（roster hello・roster assign）', () => {
  const config = (w: ReturnType<typeof world>): string[] => configLines(w.tpm);

  test('設定の file がどこにも無ければ、無いので既定と出す', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-bare-')));
    const ctx = createContext({ XDG_STATE_HOME: join(dir, 'state') }, dir);
    expect(configLines(ctx)).toEqual([`設定: ${dir}/.claude/roles/config.jsonc（無いので既定）`, '課題管理: none（既定）・連携: cmux（既定）']);
  });

  test('直下の folder の設定を合わせていなければ、設定の file と値。書いた値に「既定」は付けない', () => {
    const w = world({ tracker: 'jira' });
    expect(config(w)).toEqual([`設定: ${w.project}/.claude/roles/config.jsonc`, '課題管理: jira・連携: file']);
  });

  test('合わせていれば、設定ごとの中身と、Key の形ごとの記録の先を出す', () => {
    const w = world({}, {}, {
      skills: { tracker: 'jira', infra: { store: { guard: 'tpm', match: ['container stop store'] } } },
      web: { 'tracker': 'github', 'skill-sets': ['dependabot'], 'software-engineer': { effort: 'high' }, 'transport': 'cmux' },
      x: {},
    });
    expect(config(w)).toEqual([
      '設定（この folder と直下の folder を合わせた物）:',
      '- この folder  道具の欄は無い',
      '- skills  課題管理: jira・infra: store',
      '- web  課題管理: github・skill-sets: dependabot・担当の既定: software-engineer・連携: cmux（読まない。連携はこの folder の設定で決まる）',
      '- x  道具の欄は無い',
      '課題管理: Jira の Key（AI-12 の形）→ jira（skills）／gh- の Key → github（web）／t- の Key → 記録しない',
      '連携: file',
      'infra: store（skills）（手続きは roster infra list）',
    ]);
  });

  test('宣言した設定が無い道具と、github の設定が 2 つ以上のときは、そう出す（止まらない）', () => {
    const lines = config(world({}, {}, { api: { tracker: 'github' }, web: { tracker: 'github' } }));
    expect(lines[4]).toBe('課題管理: Jira の Key（AI-12 の形）→ 宣言した設定が無い（記録しない）／gh- の Key → 決まらない（github の設定が 2 つ以上: api・web。この folder の設定の folders で 1 つに絞る。Product Manager に伝える）／t- の Key → 記録しない');
  });

  test('roster assign は、担当を起こした folder と課題の記録の先を出す', async () => {
    const w = world({}, {}, { skills: { tracker: 'jira' } });
    expect(await assign(w.tpm, 'AI-20', { ...SE, issue: 'AI-20', noIssueCopy: '試験' })).toEqual([
      '起こした: SWE AI-20: 計画と実装（file:1・Opus 5.5 · medium）',
      `folder: ${w.project}`,
      '課題の記録: jira（skills の設定）',
      '名乗り（roster hello）は待っていない',
    ]);
    // project の folder 自身の設定なら、道具の名だけ
    const own = world({ tracker: 'jira' });
    expect((await assign(own.tpm, 'AI-20', { ...SE, issue: 'AI-20', noIssueCopy: '試験', cwd: join(own.project, 'sub') }))[1]).toBe(`folder: ${join(own.project, 'sub')}`);
    expect(recordingTo(own.tpm, 'AI-20')).toBe('jira');
  });
});

describe('hello', () => {
  test('状態を出し、名簿に宛先と時刻を書き、受け持ちを返す', async () => {
    const w = world();
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    await assign(w.tpm, 't-x7k2', { ...SE, model: 'claude-fable-5-2' });
    expect(await hello(w.role('t-x7k2', 'file:1'))).toEqual([
      ...missingCastlistWarning(w.tpm),
      '役割: Software Engineer',
      '課題の Key: t-x7k2',
      `依頼書: ${BRIEF}`,
      '課題管理の課題: 無し（記録しない）',
      'TPM 担当の宛先: file:tpm',
      '自分の宛先: file:1',
    ]);
    expect(requireRole(w.tpm, 't-x7k2').helloAt).toBe('2026-11-20T12:00:00.000Z');
    expect(w.wire.status('file:1')).toEqual({ model: 'Fable 5.2 · medium', wait: '作業中: 依頼書を読む' });
  });

  test('課題の Key が Jira の形なら、課題管理が none でも中身の読み方を返す', async () => {
    const w = world();
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    await assign(w.tpm, 'AI-14', SE);
    expect(await hello(w.role('AI-14', 'file:1'))).toContain('課題の中身: roster issue view AI-14');
  });

  test('名簿にいない Key なら止まる', async () => {
    await expect(hello(world().role('t-nope', 'file:9'))).rejects.toThrow(/名簿に担当がいません: t-nope/);
  });

  test('担当が --model・--effort を付けたら止まり、名簿も状態も書かない', async () => {
    const w = world();
    await hello(w.tpm);
    await assign(w.tpm, 't-x7k2', SE);
    const se = w.role('t-x7k2', 'file:1');
    await expect(hello(se, { model: 'claude-fable-5-2' })).rejects.toThrow(/--model・--effort は TPM 担当が名乗るときだけ使う/);
    await expect(hello(se, { effort: 'high' })).rejects.toThrow(TpmError);
    expect(requireRole(w.tpm, 't-x7k2').helloAt).toBeUndefined();
    expect(w.wire.status('file:1')).toBeUndefined();
  });
});

describe('inbox', () => {
  test('まだ届いていないメッセージを、差出人と id を添えて出す', async () => {
    const w = world();
    expect(await inboxNow(w.tpm)).toEqual(['まだ届いていないメッセージは無い']);
    w.hold('tpm');
    await w.send('tpm', 'Technical Program Manager', '【brief】u');
    // TPM 担当が名乗る前（roster の席でない session）は、出すだけ（見せたとは覚えない）。
    const peeked = ['--- Technical Program Manager（id m1）', '【brief】u', '--- ここまで（出しただけ。届いたとは記録していない。hook が、この後で渡す）'];
    expect(await inboxNow(w.tpm)).toEqual(peeked);
    expect(await inboxNow(w.tpm)).toEqual(peeked);
    // 名乗った TPM 担当の居場所（渡す hook は持たない）では、出して、見せたと覚える。
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    expect(await inboxNow(w.tpm)).toEqual(['--- Technical Program Manager（id m1）', '【brief】u', '--- ここまで']);
    expect(await inboxNow(w.tpm)).toEqual(['まだ届いていないメッセージは無い']);
  });

  test('roster の席でない session（TPM 担当が名乗っていない居場所）では、送る前の検査をしない（TPM 担当宛ての物に、見せたの印を付けない）', async () => {
    const w = world();
    w.hold('tpm');
    await w.send('tpm', 'SWE t-a3b4: x', '【ask-tpm】読んでほしい事');
    await assertRead(w.tpm, '相手');
    expect(w.tpm.state.lines('delivered.jsonl')).toEqual([]);
    // 名乗った TPM 担当の居場所では、本文を出して 1 度止まる。
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    await expect(assertRead(w.tpm, '相手')).rejects.toThrow(/まだ読んでいないメッセージが 1 件あります/);
  });

  test('配りの口が応えない時は、決まりの字で止まり、席の状態に出す', async () => {
    const w = world();
    const down = { ...w.tpm, mailroom: () => Promise.reject(new Error('timeout')) };
    await expect(inboxNow(down)).rejects.toThrow(/^メッセージキューが応えません。見ていません（timeout）/);
    expect(w.wire.status('file:tpm')?.wait).toBe('メッセージキューが応えません');
  });
});

describe('roles と close', () => {
  test('動いている担当は状態を、消えた担当は消えたと出す', async () => {
    const w = world();
    await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
    await assign(w.tpm, 't-a3b4', SE);
    await assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    await hello(w.role('t-a3b4', 'file:1'));
    w.wire.close('file:2');
    expect(await roles(w.tpm)).toEqual([
      '名簿:',
      '- app#12  Sustaining app#12  消えた（居場所が無い。roster assign で起こし直すか、roster close で名簿から消す）',
      `- t-a3b4  SWE t-a3b4: 計画と実装  file:1（作業中: 依頼書を読む）  依頼書: ${BRIEF}`,
    ]);
  });

  test('close は居場所を閉じて名簿から消す。居場所が無くても名簿からは消す', async () => {
    const w = world();
    await assign(w.tpm, 't-a3b4', SE);
    await assign(w.tpm, 't-b5c6', SE);
    w.wire.close('file:2');
    expect(await close(w.tpm, 't-a3b4')).toEqual(['閉じた: SWE t-a3b4: 計画と実装（file:1）']);
    expect(await close(w.tpm, 't-b5c6')).toEqual(['閉じた: SWE t-b5c6: 計画と実装（居場所はもう無かった）']);
    expect(w.wire.seats()).toEqual([]);
    expect(await roles(w.tpm)).toEqual(['名簿: 担当はいない']);
    await expect(close(w.tpm, 't-a3b4')).rejects.toThrow(/名簿に担当がいません/);
  });
});

describe('道具の名を替えた後（t-6ydg）', () => {
  test('起こす命令の --state は symlink を解いた path（古い在り処を通って起きた担当が起こす席も、新しい path を持つ）', async () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'roster-real-state-')));
    const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'roster-link-'))), 'old-state');
    symlinkSync(real, link);
    const w = world({}, { ROSTER_STATE: link });
    await assign(w.tpm, 't-x7k2', SE);
    expect(w.wire.command('file:1')).toBe(`${w.tpm.root}/cli/bin/roster run-role t-x7k2 --project ${w.project} --state ${real}`);
  });

  test('担当に渡す project・状態の folder・Key・役割は、受け継いだ物を書き替える', async () => {
    const w = world();
    await assign(w.tpm, 't-x7k2', SE);
    const env = roleEnv(requireRole(w.tpm, 't-x7k2'), '/p', '/s', '/r', { PATH: '/usr/bin', ROSTER_PROJECT: '/old', ROSTER_STATE: '/old-state', ROSTER_KEY: 't-old', ROSTER_ROLE: 'devops-engineer', ROSTER_MODEL: 'claude-x' });
    expect(env).toMatchObject({ ROSTER_PROJECT: '/p', ROSTER_STATE: '/s', ROSTER_KEY: 't-x7k2', ROSTER_ROLE: 'software-engineer', ROSTER_MODEL: 'claude-x' });
  });
});

describe('run-role', () => {
  test('claude の引数は、guard の hook を付け、最初の入力の前に -- を置く', async () => {
    const w = world({ 'skill-sets': ['dependabot'] });
    await assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    expect(claudeArgs(requireRole(w.tpm, 'app#12'), '/r')).toEqual([
      '--settings',
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash|Monitor', hooks: [{ type: 'command', command: '/r/cli/bin/roster guard' }] }],
          SessionStart: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster castlist session-start' }, { type: 'command', command: '/r/cli/bin/roster mail claim' }, WAITING] }],
          SessionEnd: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster castlist session-end' }, { type: 'command', command: '/r/cli/bin/roster mail release' }] }],
          ...MAIL_HOOKS,
        },
      }),
      '--model',
      'claude-opus-5-5',
      '--effort',
      'medium',
      '--permission-mode',
      'bypassPermissions',
      '--add-dir',
      `${w.tpm.root}/skill-sets/core`,
      `${w.tpm.root}/skill-sets/dependabot`,
      '--',
      '/sustaining-engineer',
    ]);
  });

  test('Auditor の席の hook は、file を書き替える道具も見て、session の始まりに印を書く。最初の入力は名乗るだけ', () => {
    const args = claudeArgs({ key: 'audit', role: 'auditor', title: 'Audit', cwd: '/p', addDirs: ['/r/skill-sets/core'], ...ROLES.auditor.defaults }, '/r');
    expect(JSON.parse(args[1] ?? '')).toEqual({
      hooks: {
        PreToolUse: [{ matcher: 'Bash|Monitor|Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: '/r/cli/bin/roster guard' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster audit fresh' }, { type: 'command', command: '/r/cli/bin/roster castlist session-start' }, { type: 'command', command: '/r/cli/bin/roster mail claim' }, WAITING] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster castlist session-end' }, { type: 'command', command: '/r/cli/bin/roster mail release' }] }],
        ...MAIL_HOOKS,
      },
    });
    expect(args.slice(2, 8)).toEqual(['--model', 'claude-fable-5-2', '--effort', 'high', '--permission-mode', 'bypassPermissions']);
    expect(args.slice(-2)).toEqual(['--', '/audit hello']);
  });

  test('担当に project・状態の folder・Key・役割と、roster の在り処を渡し、置き場の CLI に消させない', async () => {
    const w = world();
    await assign(w.tpm, 't-x7k2', SE);
    expect(roleEnv(requireRole(w.tpm, 't-x7k2'), '/p', '/s', '/r', { PATH: '/usr/bin', HOME: '/h' })).toEqual({
      HOME: '/h',
      ROSTER_PROJECT: '/p',
      ROSTER_STATE: '/s',
      ROSTER_KEY: 't-x7k2',
      ROSTER_ROLE: 'software-engineer',
      PAGETRAY_NO_DELETE: '1',
      PAGETRAY_LANG: 'ja',
      PATH: '/r/cli/bin:/usr/bin',
    });
  });
});

describe('modelLabel', () => {
  test.each([['claude-opus-5-5', 'Opus 5.5'], ['claude-fable-5-2', 'Fable 5.2'], ['claude-haiku-5-5-20261001', 'Haiku 5.5'], ['my-model', 'my-model']])('%s → %s', (model, label) => {
    expect(modelLabel(model)).toBe(label);
  });
});
