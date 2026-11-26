// 打つ前に止める守り（roster guard）への足しの試験（設定の messages が nats の席だけ）。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { guard } from '../src/commands/infra.ts';
import { GUARD_SKIPS_FILE, mailPrompt, toolUseLine } from '../src/commands/mail.ts';
import { notify } from '../src/commands/messages.ts';
import { sendsMessage } from '../src/guard.ts';
import { claim, natsWorld } from './mail-helpers.ts';

/** 会話の記録を作る。rows は、行ごとの「道具の呼び出しの id（あれば）」。 */
function transcript(rows: (string | undefined)[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'roster-transcript-')), 't.jsonl');
  const row = (id: string | undefined): unknown => id === undefined
    ? { type: 'user', message: { role: 'user', content: 'toolu_text ではない行' } }
    : { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '送る' }, { type: 'tool_use', id, name: 'Bash', input: {} }] } };
  writeFileSync(file, rows.map(id => `${JSON.stringify(row(id))}\n`).join('\n'));
  return file;
}

const bash = (command: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ session_id: 's-200', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra });
const SEND = 'roster ask tpm --text "案" --waiting-for "案"';

describe('送る命令の見分け', () => {
  test('roster の送る命令とページを置く命令を、単純な命令の頭で見分ける', () => {
    for (const c of ['roster ask tpm --text a', 'roster report done --kind result', 'roster notify t-1 --text a', 'roster answer t-1 --text a', 'roster dismiss t-1', 'roster assign t-1 --role software-engineer', 'roster page put /tmp/a.html --kind result', 'cd /w && X=1 /r/cli/bin/roster ask pm --url u', 'cli/bin/roster report done --kind result', './roster notify t-1 --text a', 'git status; roster report merged --pr u']) {
      expect(sendsMessage(c), c).toBe(true);
    }
    for (const c of ['roster inbox', 'roster page path http://x', 'roster page list', 'roster wait work "実装"', 'roster hello', 'echo roster ask tpm', 'git commit -m "roster ask tpm を直す"', 'roster-old ask tpm']) {
      expect(sendsMessage(c), c).toBe(false);
    }
  });

  test('会話の記録から、道具の呼び出しを書いた返答の行を引く', () => {
    const file = transcript([undefined, 'toolu_A', undefined, 'toolu_B']);
    expect(toolUseLine(file, 'toolu_A')).toBe(2);
    expect(toolUseLine(file, 'toolu_B')).toBe(4);
    expect(toolUseLine(file, 'toolu_text')).toBeUndefined();
    expect(toolUseLine(file, 'toolu_none')).toBeUndefined();
    expect(toolUseLine('/nonexistent/t.jsonl', 'toolu_A')).toBeUndefined();
    expect(toolUseLine(undefined, 'toolu_A')).toBeUndefined();
  });
});

describe('手伝いの中からの送る命令', () => {
  test('設定が nats の席では、手伝い（agent_id がある）の中からの送る命令を止める。ほかの命令は通す', async () => {
    const w = await natsWorld();
    const stopped = await guard(w.se, bash(SEND, { agent_id: 'agent-1', agent_type: 'general-purpose' }));
    expect(stopped).toEqual({ allow: false, reason: expect.stringMatching(/^送る命令（.*）は、手伝い（subagent）でなく担当が打ちます/) as string });
    expect(w.se.state.lines<{ command: string }>('guard.jsonl').at(-1)?.command).toBe(SEND);
    expect(await guard(w.se, bash('roster page put /tmp/a.html --kind result', { agent_id: 'agent-1' }))).toMatchObject({ allow: false });
    expect(await guard(w.se, bash('roster page path http://127.0.0.1:8801/x', { agent_id: 'agent-1' }))).toEqual({ allow: true });
    expect(await guard(w.se, bash(SEND))).toEqual({ allow: true });
  });

  test('設定が cmux の席では、今までどおり通す', async () => {
    const w = await natsWorld({});
    expect(await guard(w.se, bash(SEND, { agent_id: 'agent-1' }))).toEqual({ allow: true });
  });
});

describe('同じ返答の中で渡した物がある時', () => {
  /** 担当が名乗り、会話の記録が lines 行の時に、hook が 1 通渡した世界。 */
  const delivered = async (file: string) => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '返答の途中で渡った物' });
    expect(await mailPrompt(w.role('t-x7k2', 'file:1'), JSON.stringify({ session_id: 's-200', transcript_path: file }))).toContain('返答の途中で渡った物');
    return w;
  };

  test('送る命令を書いた返答より後に渡した記録があれば、1 度止める。打ち直し（後の返答）は通る', async () => {
    // 2 行目の返答が送る命令を書いた。渡したのは、記録が 3 行の時（その返答より後）。
    const file = transcript([undefined, 'toolu_SEND', undefined]);
    const w = await delivered(file);
    const first = await guard(w.se, bash(SEND, { tool_use_id: 'toolu_SEND', transcript_path: file }));
    expect(first).toEqual({ allow: false, reason: 'この命令を書いた後に、メッセージが 1 件渡されています（同じ返答の中）。渡された物を読んでから、同じ命令を打ち直してください（事情が変わっていたら、中身を変えて打つ）。' });
    // 同じ渡した記録では、2 度止めない。
    expect(await guard(w.se, bash(SEND, { tool_use_id: 'toolu_SEND', transcript_path: file }))).toEqual({ allow: true });
    // 送る命令でなければ、見ない。
    expect(await guard(w.se, bash('git status', { tool_use_id: 'toolu_SEND', transcript_path: file }))).toEqual({ allow: true });
  });

  test('渡した後に書いた返答の送る命令は、止めない', async () => {
    const before = transcript([undefined, 'toolu_OLD', undefined]);
    const w = await delivered(before);
    const after = transcript([undefined, 'toolu_OLD', undefined, undefined, 'toolu_NEW']);
    expect(await guard(w.se, bash(SEND, { tool_use_id: 'toolu_NEW', transcript_path: after }))).toEqual({ allow: true });
  });

  test('会話の記録に、その道具の呼び出しの行が見つからない時は、止めずに記録に残す', async () => {
    const file = transcript([undefined, 'toolu_OTHER', undefined]);
    const w = await delivered(file);
    expect(await guard(w.se, bash(SEND, { tool_use_id: 'toolu_SEND', transcript_path: file }))).toEqual({ allow: true });
    expect(w.se.state.lines<{ tool: string, to: string }>(GUARD_SKIPS_FILE)).toMatchObject([{ tool: 'toolu_SEND', to: 't-x7k2' }]);
    expect(await guard(w.se, bash(SEND, { tool_use_id: 'toolu_SEND' }))).toEqual({ allow: true });
  });

  test('別の session の渡した記録・ほかの受け手の記録・命令の結果に出した記録では、止めない', async () => {
    const file = transcript([undefined, 'toolu_SEND', undefined]);
    const w = await delivered(file);
    expect(await guard(w.se, bash(SEND, { session_id: 's-other', tool_use_id: 'toolu_SEND', transcript_path: file }))).toEqual({ allow: true });
    expect(await guard(w.tpm, bash('roster notify t-x7k2 --text a', { tool_use_id: 'toolu_SEND', transcript_path: file }))).toEqual({ allow: true });
  });
});
