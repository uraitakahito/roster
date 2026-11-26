// cli と本物の castlist（アクターの台帳）のつなぎの試験。$ROSTER_E2E_CASTLIST_URL に動いている castlist の URL がある時だけ流す
// （CI の pagetray-e2e.yml の next の job。手元では docs-site の開発のページの「生成した client」の「つなぎの試験（新しい API）」）。
// castlist にも pagetray にも、いつも生成した client（新しい API）で送る。
// $ROSTER_E2E_PAGES_URL もあれば、その置き場（この castlist に送り手を聞く物）に、送り手の付いたページと file を置く。
// ほかの試験は偽の castlist・偽の HTTP で流すので、API の形（道・欄の名・誤りの型）のずれはここで見つける。
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { castlistIssuer, PM_REF, projectPrefix } from '../src/castlist.ts';
import { castlistGuard, readSession, sessionEnd, sessionStart } from '../src/commands/castlist.ts';
import { castlistEvents, castlistFind, castlistSettings, castlistShow } from '../src/commands/castlist-read.ts';
import { fileList, filePut } from '../src/commands/file.ts';
import { pageList, pagePut } from '../src/commands/page.ts';
import { startTpm } from '../src/command.ts';
import type { Context } from '../src/context.ts';
import { pagetrayClient } from '../src/commands/store.ts';
import { exec } from '../src/exec.ts';
import { world } from './helpers.ts';

const CASTLIST = process.env.ROSTER_E2E_CASTLIST_URL ?? '';
const PAGES = process.env.ROSTER_E2E_PAGES_URL ?? '';
/** 置き場に新しい API で送るか（設定の api の pagetray を next にする）。 */
/** PNG の頭の 8 byte と、少しの中身。 */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('つなぎの試験の図')]);

/** 本物の castlist（と置き場）に向けた TPM 担当の周り。issuer（状態の folder の名）は world ごとに違うので、名の番号はいつも 1 から。時計は本物。 */
function setup() {
  const w = world({ castlist: CASTLIST });
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-e2e-castlist-')));
  const real = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, exec, clients: { ...ctx.clients, pagetray: url => pagetrayClient(url) }, now: () => new Date(), env: { ...ctx.env, ...(PAGES === '' ? {} : { ROSTER_PAGES_URL: PAGES }), ROSTER_PAGES_DIR: dir, ...env } });
  return { w, dir, real, tpm: real(w.tpm) };
}

/** roster start の 1 行が付ける起こしの印と、Claude Code の session を持つ TPM 担当の周り。 */
const launched = (s: ReturnType<typeof setup>, sid: string): Context => s.real(s.w.tpm, {
  CLAUDE_CODE_SESSION_ID: sid,
  ROSTER_LAUNCH: `launch-${sid.slice(0, 8)}`,
  ROSTER_LAUNCHED_BY: PM_REF,
  ROSTER_LAUNCH_MODEL: 'claude-opus-5-5',
  ROSTER_LAUNCH_EFFORT: 'medium',
  ROSTER_LAUNCH_FRESH: '1',
});

const startInput = (sid: string): string => JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup', transcript_path: '/nonexistent/transcript.jsonl' });

/** model の行を持つ写し（Claude Code の transcript の JSONL）。 */
function transcript(dir: string, model: string): string {
  const file = join(dir, `transcript-${randomUUID()}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { model } })}\n`);
  return file;
}

/** roster start（Product Manager の登録）と、TPM 担当の session の登録。控えた session の記録を返す。 */
async function enter(s: ReturnType<typeof setup>, sid: string): Promise<{ ctx: Context, id: string, name: string }> {
  await startTpm(s.tpm);
  const ctx = launched(s, sid);
  await sessionStart(ctx, startInput(sid));
  const record = readSession(ctx, sid);
  if (record === undefined) throw new Error('session を登録できなかった（stderr を見る）');
  return { ctx, id: record.id, name: record.name };
}

describe.skipIf(CASTLIST === '')('cli と castlist のつなぎ', () => {
  test('roster start と session の hook が、Product Manager と session を登録し、出来事・線・頼んだ model と effort を残す。guard が見た model と effort を送る', async () => {
    const s = setup();
    const sid = randomUUID();
    const { ctx, id, name } = await enter(s, sid);
    expect(name).toBe(`${projectPrefix(s.w.project, 'tpm')}.1`);
    // 同じ session をもう 1 度登録しても、同じアクター（鍵が同じ）。
    await sessionStart(ctx, startInput(sid));
    expect(readSession(ctx, sid)?.id).toBe(id);
    const bash = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: sid, transcript_path: transcript(s.dir, 'claude-sonnet-5'), effort: { level: 'high' } });
    expect(await castlistGuard(ctx, bash)).toEqual({ allow: true });

    // find: この project のラベルで、Product Manager と TPM 担当が引ける（今の道の形の --json）。
    const [text = ''] = await castlistFind(s.tpm, { label: [`tpm.project:${s.w.project}`], json: true });
    const found = JSON.parse(text) as { as_of: string, actors: { id: string, name: string, kind: string, present: boolean }[], next: unknown };
    expect(found.actors.map(a => [a.name, a.kind]).sort()).toEqual([[name, 'ai'], ['product-manager.1', 'human']].sort());
    expect(found.actors.find(a => a.id === id)?.present).toBe(true);

    // show: 名でも引け、今の状態・最新の model と effort・鍵・Product Manager からの線を出す。
    const shown = (await castlistShow(s.tpm, name, {})).join('\n');
    expect(shown).toContain(`id: ${id}`);
    expect(shown).toContain('今: 稼働中（entered');
    expect(shown).toContain('model と effort: claude-sonnet-5・high（observed');
    expect(shown).toContain(`claude.session:${sid}（鍵）`);
    expect(shown).toContain(`product-manager.1 → ${name}（launched`);

    // events と settings: 登場の出来事、頼んだ物と見た物の 2 行、頼んだ物と違う見た物（mismatch）。
    const [events = ''] = await castlistEvents(s.tpm, { actor: id, json: true });
    expect((JSON.parse(events) as { events: { type: string }[] }).events.map(e => e.type)).toEqual(['entered']);
    const settings = await castlistSettings(s.tpm, { actor: name });
    expect(settings.slice(1).map(l => l.split('  ')[2])).toEqual(['claude-opus-5-5・medium（requested）', 'claude-sonnet-5・high（observed）']);
    const [mismatch = ''] = await castlistSettings(s.tpm, { mismatch: true, json: true });
    expect((JSON.parse(mismatch) as { settings: { actor_id: string, model: string }[] }).settings.filter(r => r.actor_id === id).map(r => r.model)).toEqual(['claude-sonnet-5']);

    // session の終わりで、停止（exited）になる。
    await sessionEnd(ctx, JSON.stringify({ hook_event_name: 'SessionEnd', session_id: sid, reason: 'other', transcript_path: '/nonexistent/transcript.jsonl' }));
    expect((await castlistShow(s.tpm, name, {})).join('\n')).toContain('今: 停止（exited');
  });

  test('知らない名・id は、castlist の訳と find を勧める文で止まる', async () => {
    const s = setup();
    await expect(castlistShow(s.tpm, '019abcde-0000-7000-8000-00000000dead', {})).rejects.toThrow('roster castlist find');
  });
});

describe.skipIf(CASTLIST === '' || PAGES === '')('cli と castlist と pagetray のつなぎ（送り手）', () => {
  test('登録した session の送り手を付けてページと file を置くと、置き場が castlist に聞いて、アクターの id と名を残す', async () => {
    const s = setup();
    const sid = randomUUID();
    const { ctx, id, name } = await enter(s, sid);
    const sender = { issuer: castlistIssuer(s.w.tpm.state.dir), ref: `claude.session:${sid}`, actor: { id, name, kind: 'ai' } };
    const html = join(s.dir, 'src.html');
    writeFileSync(html, '<title>送り手のある結果</title><p>つなぎの試験</p>');
    const url = (await pagePut(ctx, html, { kind: 'result', key: 'K-E2E' }))[1]?.replace('URL: ', '') ?? '';
    const [pages = ''] = await pageList(s.tpm, { key: 'K-E2E', json: true });
    const page = (JSON.parse(pages) as { url: string, sender?: Record<string, unknown> }[])[0];
    expect(page?.url).toBe(url);
    expect(page?.sender).toMatchObject(sender);
    expect(typeof page?.sender?.resolved_at).toBe('string');

    const png = join(s.dir, 'src.png');
    writeFileSync(png, PNG);
    await filePut(ctx, png, { reviewed: true, key: 'K-E2E' });
    const [files = ''] = await fileList(s.tpm, { key: 'K-E2E', json: true });
    expect((JSON.parse(files) as { sender?: unknown }[])[0]?.sender).toMatchObject(sender);
  });

  test('castlist に登録の無い session の送り手は、置き場が断り、何も置かない', async () => {
    const s = setup();
    const ctx = s.real(s.w.tpm, { CLAUDE_CODE_SESSION_ID: randomUUID() });
    const html = join(s.dir, 'src.html');
    writeFileSync(html, '<title>登録の無い送り手</title>');
    await expect(pagePut(ctx, html, { kind: 'result', key: 'K-E2E-X' })).rejects.toThrow(/castlist に登録が無いと、置き場が答えました（(400|422)）/);
    expect(await pageList(s.tpm, { key: 'K-E2E-X' })).toEqual(['合うページは無い']);
  });
});
