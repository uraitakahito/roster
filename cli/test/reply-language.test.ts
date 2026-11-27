// 返事の言葉を数える（reply-language.ts）と、TPM 担当の席の Stop の hook（roster reply-language check）の試験。t-jen6 の plan-2 の PR 2。
import { describe, expect, test } from 'vitest';
import { LOG_FILE, MARK_FOLDER, MARK_MINUTES, replyLanguageCheck, rewriteReason, type LogLine } from '../src/commands/reply-language.ts';
import { countJapanese, isEnglish, stripAllowed } from '../src/reply-language.ts';
import { world } from './helpers.ts';

// 11-27 の TPM 担当の英語の返事（plan-2 の「調べたこと」）に似せた字。
const ENGLISH = 'I\'ve sent AI-32 to stage 3 with the brief. Renaming the pagetray package happens in stage 4, as you asked, and I\'ll tell you when the worker reports back.';
const JAPANESE = 'AI-32 を段 3 に進めました。pagetray の名の付け直しは、お話のとおり段 4 で一緒にします。担当から報告が来たら、お知らせします。';

describe('数える', () => {
  test('英語の返事は 2 割より少ない', () => {
    expect(isEnglish(countJapanese(ENGLISH))).toBe(true);
  });

  test('日本語の返事は 2 割以上', () => {
    expect(isEnglish(countJapanese(JAPANESE))).toBe(false);
  });

  test('コードの枠の長い命令は数えない（11-27 の container run の返事）', () => {
    const text = `castlist が止まりました。続けて、残りの 2 行を打ってください。\n\n\`\`\`sh\ncontainer rm castlist.box\ncontainer run -d --name castlist.box -p 127.0.0.1:8802:8080 -v castlist-data-v1:/data -m 200M -c 1 ghcr.io/uraitakahito/castlist:v1.0.0\n\`\`\``;
    expect(isEnglish(countJapanese(text))).toBe(false);
  });

  test('> で写した英語の誤りの文と、`…` の中と URL は数えない', () => {
    const text = `命令が止まりました。誤りの文は次のとおりです。\n\n> Error: the operation could not be completed because the remote repository rejected the push request with status 403\n\n\`gh pr merge --squash --delete-branch\` を打ち直します。https://github.com/example/repo/pull/1 を見てください。`;
    expect(isEnglish(countJapanese(text))).toBe(false);
  });

  test('path を除いても、path にじかに続く日本語は残す（review-2 の指摘 3）', () => {
    expect(stripAllowed('/data/castlist.db」です。データは')).toBe('」です。データは');
    expect(stripAllowed('~/dotfiles を使う')).toBe(' を使う');
    const text = 'DB は /data/castlist.db」です。データは数も多くないので、/Users/me/projects/ai/roster/cli/src/guard.ts と cli/src/run-role.ts を直せば足ります。';
    expect(isEnglish(countJapanese(text))).toBe(false);
  });

  test('URL を除いても、URL にじかに続く日本語は残す（review-6 の指摘 2）', () => {
    expect(stripAllowed('PR は https://github.com/example/repo/pull/272を見てください。')).toBe('PR は を見てください。');
    expect(isEnglish(countJapanese('PR は https://github.com/example/repo/pull/272を見てください。残りは段 2 で一緒にします。'))).toBe(false);
  });

  test('々・ー・〆・半角カタカナも、仮名と漢字に数える（review-6 の指摘 6）', () => {
    expect(countJapanese('人々様々ーー〆ｶﾀｶﾅ漢字ひらがなカタカナ日本語です')).toMatchObject({ share: 1 });
  });

  test('20 字に満たない返事は数えない', () => {
    expect(countJapanese('OK, done.')).toEqual({ share: undefined, letters: 6 });
    expect(isEnglish(countJapanese('OK, done.'))).toBe(false);
  });
});

/** Stop の hook の入力。 */
function stop(text: string | undefined, more: Record<string, unknown> = {}): string {
  return JSON.stringify({ session_id: 's-1', hook_event_name: 'Stop', ...(text === undefined ? {} : { last_assistant_message: text }), ...more });
}

/** 時計を進められる TPM 担当の周り。 */
function clocked() {
  const w = world();
  let now = new Date('2026-11-28T00:00:00Z');
  const ctx = { ...w.tpm, now: () => now };
  const advance = (minutes: number): void => {
    now = new Date(now.getTime() + minutes * 60_000);
  };
  return { ctx, advance, log: () => ctx.state.lines<LogLine>(LOG_FILE).map(l => l.way) };
}

const blocked = (out: string | undefined): boolean => out !== undefined && (JSON.parse(out) as { decision?: string }).decision === 'block';

describe('roster reply-language check', () => {
  test('英語なら止めて、日本語で書き直す訳を返す', () => {
    const { ctx, log } = clocked();
    const out = replyLanguageCheck(ctx, stop(ENGLISH));
    expect(blocked(out)).toBe(true);
    expect((JSON.parse(out ?? '{}') as { reason: string }).reason).toBe(rewriteReason(countJapanese(ENGLISH).share ?? 0));
    expect(log()).toEqual(['block']);
  });

  test('書き直しの頼みの割合は切り捨てる（2 割に届かない 0.199 を 20% と書かない。review-6 の指摘 5）', () => {
    expect(rewriteReason(0.199)).toContain('字の 19%');
  });

  test('日本語・短い返事は通して、記録に書く', () => {
    const { ctx, log } = clocked();
    expect(replyLanguageCheck(ctx, stop(JAPANESE))).toBeUndefined();
    expect(replyLanguageCheck(ctx, stop('OK.'))).toBeUndefined();
    expect(log()).toEqual(['ok', 'short']);
  });

  test('止めた直後の書き直しの回（印あり・stop_hook_active）は、英語のままでも止めない（1 回に限る）', () => {
    const { ctx, log } = clocked();
    expect(blocked(replyLanguageCheck(ctx, stop(ENGLISH)))).toBe(true);
    expect(replyLanguageCheck(ctx, stop(ENGLISH, { stop_hook_active: true }))).toBeUndefined();
    expect(log()).toEqual(['block', 'rewritten']);
    expect(ctx.state.list(MARK_FOLDER)).toEqual([]);
  });

  test('印があっても、人が書いた回（stop_hook_active が false）の英語は止める（review-2 の指摘 1）', () => {
    const { ctx, log } = clocked();
    expect(blocked(replyLanguageCheck(ctx, stop(ENGLISH)))).toBe(true);
    expect(blocked(replyLanguageCheck(ctx, stop(ENGLISH, { stop_hook_active: false })))).toBe(true);
    expect(log()).toEqual(['block', 'block']);
  });

  test('メッセージで起こされた回（印なし・stop_hook_active）の英語も止める（review-1 の指摘 2）', () => {
    const { ctx, log } = clocked();
    expect(blocked(replyLanguageCheck(ctx, stop(ENGLISH, { stop_hook_active: true })))).toBe(true);
    expect(log()).toEqual(['block']);
  });

  test(`${MARK_MINUTES} 分を過ぎた印は効かず、消える（ほかの session の印も）`, () => {
    const { ctx, advance, log } = clocked();
    expect(blocked(replyLanguageCheck(ctx, stop(ENGLISH)))).toBe(true);
    expect(blocked(replyLanguageCheck(ctx, stop(ENGLISH, { session_id: 's-2' })))).toBe(true);
    advance(MARK_MINUTES + 1);
    expect(blocked(replyLanguageCheck(ctx, stop(ENGLISH, { stop_hook_active: true })))).toBe(true);
    expect(ctx.state.list(MARK_FOLDER)).toEqual(['s-1']);
    expect(log()).toEqual(['block', 'block', 'block']);
  });

  test('記録の行に、割合・数えた字・stop_hook_active を書き、返事の字は書かない', () => {
    const { ctx } = clocked();
    replyLanguageCheck(ctx, stop(JAPANESE, { stop_hook_active: true }));
    const [line] = ctx.state.lines<LogLine>(LOG_FILE);
    expect(line).toMatchObject({ at: '2026-11-28T00:00:00.000Z', session: 's-1', way: 'ok', continued: true });
    expect(line?.share).toBeGreaterThan(0.2);
    expect(JSON.stringify(line)).not.toContain('pagetray');
  });

  test('手伝い（agent_id）の中・最後の返事が無い・壊れた入力では何もしない', () => {
    const { ctx, log } = clocked();
    expect(replyLanguageCheck(ctx, stop(ENGLISH, { agent_id: 'a-1' }))).toBeUndefined();
    expect(replyLanguageCheck(ctx, stop(undefined))).toBeUndefined();
    expect(replyLanguageCheck(ctx, '{not json')).toBeUndefined();
    expect(log()).toEqual([]);
  });

  test('session の id の字は、印の file の名に使える字にする', () => {
    const { ctx } = clocked();
    replyLanguageCheck(ctx, stop(ENGLISH, { session_id: '../x y' }));
    expect(ctx.state.list(MARK_FOLDER)).toEqual(['---x-y']);
  });
});
