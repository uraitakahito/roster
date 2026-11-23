// roster assign が課題の写しのページ（issue-<番号>.html）を作って担当に渡すこと。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { issuePage } from '../src/commands/issue.ts';
import { pageFolder } from '../src/commands/page.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign, roles } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import type { Exec } from '../src/exec.ts';
import { requireRole } from '../src/roster.ts';
import { BRIEF, finish, world } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const SE = { role: 'software-engineer', title: '提案', brief: BRIEF, wait: 0 } as const;

const JIRA = JSON.stringify({
  key: 'AI-14',
  fields: {
    summary: 'Artifact を見る <UI>',
    status: { name: '未着手' },
    description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文 <script>alert(1)</script>' }] }] },
    comment: { comments: [] },
  },
});

/** acli の答えを替え、ほかは world のまま（curl は 200）の TPM 担当の周り。 */
function withAcli(ctx: Context, acli: { status: number, stdout: string, stderr: string }): Context {
  const exec: Exec = (cmd, args, options) => (cmd === 'acli' ? acli : ctx.exec(cmd, args, options));
  return { ...ctx, exec };
}

describe('課題の写しのページ', () => {
  test('題・状態・本文・コメントを出し、課題の中の tag は escape する', () => {
    const html = issuePage({
      key: 'AI-14',
      tool: 'Jira',
      title: 'A <b>',
      status: '未着手',
      url: 'https://x.example/browse/AI-14',
      body: '<script>x</script>',
      comments: [{ id: '1', text: 'c & d', author: 'pm', created: '2026-11-20' }],
    }, new Date('2026-11-21T00:00:00.000Z'));
    expect(html).toContain('<h1>AI-14: A &lt;b&gt;</h1>');
    expect(html).toContain('<pre>&lt;script&gt;x&lt;/script&gt;</pre>');
    expect(html).toContain('<h3>コメント 1（pm・2026-11-20）</h3>\n<pre>c &amp; d</pre>');
    expect(html).toContain('写した時刻: 2026-11-21T00:00:00.000Z');
    expect(html).not.toContain('<script>');
  });
});

describe('roster assign が課題の写しを作る', () => {
  test('課題管理が none でも、Jira の Key なら写しを置き、名簿・担当の hello・roster roles に URL を出す', () => {
    const w = world();
    const tpm = withAcli(w.tpm, { status: 0, stdout: JIRA, stderr: '' });
    hello(tpm, TPM);
    assign(tpm, 'AI-14', SE);
    const file = join(pageFolder(tpm, 'AI-14'), 'issue-1.html');
    expect(readFileSync(file, 'utf8')).toContain('Artifact を見る &lt;UI&gt;');
    const page = requireRole(tpm, 'AI-14').issuePage;
    expect(page).toMatch(/\/AI-14\/issue-1\.html$/);
    expect(hello(w.role('AI-14', 'file:1'))).toContain(`課題の写し: ${page}`);
    expect(roles(tpm).join('\n')).toContain(`課題の写し: ${page}`);
  });

  test('続きの【brief】では写しを作り直し、【brief】に URL を載せる', () => {
    const w = world();
    const tpm = withAcli(w.tpm, { status: 0, stdout: JIRA, stderr: '' });
    hello(tpm, TPM);
    assign(tpm, 'AI-14', SE);
    finish(w, 'AI-14', 'file:1');
    assign(tpm, 'AI-14', { ...SE, brief: 'https://claude.ai/artifact/b2', note: '計画まで' });
    const page = requireRole(tpm, 'AI-14').issuePage ?? '';
    expect(page).toMatch(/\/AI-14\/issue-2\.html$/);
    expect(w.wire.inbox('file:1').map(m => m.text)).toEqual([`【brief】https://claude.ai/artifact/b2 課題の写し: ${page} 計画まで`]);
  });

  test('t- の Key と Dependabot の PR の Key では写しを作らず、道具も打たない', () => {
    const w = world();
    hello(w.tpm, TPM);
    assign(w.tpm, 't-x7k2', SE);
    assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 });
    expect(w.calls).toHaveLength(0);
    expect(requireRole(w.tpm, 't-x7k2').issuePage).toBeUndefined();
    expect(hello(w.role('t-x7k2', 'file:1')).join('\n')).not.toContain('課題の写し');
  });

  test('読めなければ、居場所を作らずに --no-issue-copy を添えて止まる', () => {
    const w = world();
    const tpm = withAcli(w.tpm, { status: 1, stdout: '', stderr: 'unauthorized' });
    hello(tpm, TPM);
    expect(() => assign(tpm, 'AI-14', SE)).toThrow(/AI-14 の課題の写しを作れませんでした: [\s\S]*unauthorized[\s\S]*acli jira auth status[\s\S]*--no-issue-copy "<訳>"/);
    expect(w.wire.seats()).toHaveLength(0);
    expect(existsSync(pageFolder(tpm, 'AI-14'))).toBe(false);
  });

  test('--no-issue-copy の訳を付ければ、写しなしで振り、訳が担当に届く', () => {
    const w = world();
    const tpm = withAcli(w.tpm, { status: 1, stdout: '', stderr: 'unauthorized' });
    hello(tpm, TPM);
    assign(tpm, 'AI-14', { ...SE, noIssueCopy: '認証切れ。中身は依頼書に写した' });
    expect(hello(w.role('AI-14', 'file:1'))).toContain('課題の写し: 無し（認証切れ。中身は依頼書に写した）');
    finish(w, 'AI-14', 'file:1');
    assign(tpm, 'AI-14', { ...SE, brief: 'https://claude.ai/artifact/b2', noIssueCopy: 'まだ認証切れ' });
    expect(w.wire.inbox('file:1').map(m => m.text)).toEqual(['【brief】https://claude.ai/artifact/b2 課題の写し: 無し（まだ認証切れ）']);
  });

  test('--no-issue-copy の訳が空なら止まる', () => {
    const w = world();
    hello(w.tpm, TPM);
    expect(() => assign(w.tpm, 'AI-14', { ...SE, noIssueCopy: ' ' })).toThrow(/--no-issue-copy には、写しを作らずに振る訳を書いてください/);
  });
});
