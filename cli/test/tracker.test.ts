import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { ConfigSource, Tracker as TrackerName } from '../src/config.ts';
import type { Exec, ExecOptions, ExecResult } from '../src/exec.ts';
import { TpmError } from '../src/skill-sets.ts';
import { adfToText, noteToAdf } from '../src/tracker/adf.ts';
import { GithubTracker, noteToMarkdown } from '../src/tracker/github.ts';
import { JiraTracker } from '../src/tracker/jira.ts';
import { route, RoutedTracker } from '../src/tracker/routed.ts';
import type { Note } from '../src/tracker/types.ts';

const URL = 'https://claude.ai/artifact/abc';
const note: Note = {
  kind: '計画',
  role: 'Software Engineer',
  summary: '案 B の計画（PR 2 本）',
  links: [{ label: '計画', url: URL }],
  points: ['<要点>'],
};

/** 打たれた命令を覚える偽の exec。seen は、命令が打たれた時にその引数のファイルを読んだ中身。 */
function fake(result: Partial<ExecResult> = {}) {
  const calls: { cmd: string, args: string[], options?: ExecOptions }[] = [];
  const seen: string[] = [];
  const exec: Exec = (cmd, args, options) => {
    calls.push({ cmd, args, ...(options === undefined ? {} : { options }) });
    const file = args.at(-1);
    if (file !== undefined && file.startsWith('/') && existsSync(file)) seen.push(readFileSync(file, 'utf8'));
    return { status: 0, stdout: '', stderr: '', ...result };
  };
  return { exec, calls, seen };
}

describe('ADF', () => {
  test('記録は段落だけの ADF になり、リンクは字も href も URL', () => {
    expect(noteToAdf(note)).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '【計画】Software Engineer: 案 B の計画（PR 2 本）' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '計画: ' },
            { type: 'text', text: URL, marks: [{ type: 'link', attrs: { href: URL } }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '<要点>' }] },
      ],
    });
  });

  test('ADF を、段落を改行でつないだ字に戻せる', () => {
    expect(adfToText(noteToAdf(note))).toBe(`【計画】Software Engineer: 案 B の計画（PR 2 本）\n計画: ${URL}\n<要点>`);
    expect(adfToText(null)).toBe('');
  });

  test('リストは「- 」「1. 」の行にし、入れ子は字下げし、字が URL でないリンクは URL を添える', () => {
    const p = (...content: unknown[]) => ({ type: 'paragraph', content });
    const t = (text: string) => ({ type: 'text', text });
    const item = (...content: unknown[]) => ({ type: 'listItem', content });
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [t('条件')] },
        p(t('次のもの。'), { type: 'hardBreak' }, t('二行目')),
        {
          type: 'orderedList',
          attrs: { order: 1 },
          content: [
            item(p(t('軽い'))),
            item(p(t('並べる')), { type: 'bulletList', content: [item(p(t('時系列')))] }),
          ],
        },
        p({ type: 'text', text: '依頼書', marks: [{ type: 'link', attrs: { href: 'http://x/b.html' } }] }, t(' と '), { type: 'mention', attrs: { text: '@PM' } }),
      ],
    };
    expect(adfToText(doc)).toBe('## 条件\n次のもの。\n二行目\n1. 軽い\n2. 並べる\n   - 時系列\n依頼書（http://x/b.html） と @PM');
  });
});

describe('JiraTracker', () => {
  test('Jira の Key だけを自分の物とする', () => {
    const jira = new JiraTracker(fake().exec);
    expect(['AI-12', 'AB2-1'].map(k => jira.owns(k))).toEqual([true, true]);
    expect(['t-same-se', 'gh-12', 'ai-12', '12'].map(k => jira.owns(k))).toEqual([false, false, false, false]);
  });

  test('comment は ADF をファイルで渡し、後でファイルを消す', () => {
    const { exec, calls, seen } = fake();
    new JiraTracker(exec).comment('AI-12', note);
    expect(calls[0]?.cmd).toBe('acli');
    expect(calls[0]?.args.slice(0, 7)).toEqual(['jira', 'workitem', 'comment', 'create', '--key', 'AI-12', '--body-file']);
    expect(JSON.parse(seen[0] ?? '')).toEqual(noteToAdf(note));
    expect(existsSync(calls[0]?.args.at(-1) ?? '')).toBe(false);
  });

  test('view は題・状態・本文・コメントを、ADF を字にして返す', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }] };
    const { exec, calls } = fake({
      stdout: JSON.stringify({
        key: 'AI-14',
        fields: {
          summary: 'Artifact を見る UI',
          status: { name: '未着手' },
          description: body,
          comment: { comments: [{ id: '1', body, author: { displayName: 'PM' }, created: '2026-11-20T10:00:00.000+0900' }] },
        },
      }),
    });
    expect(new JiraTracker(exec).view('AI-14')).toEqual({
      key: 'AI-14',
      tool: 'Jira',
      title: 'Artifact を見る UI',
      status: '未着手',
      body: '本文',
      comments: [{ id: '1', text: '本文', author: 'PM', created: '2026-11-20T10:00:00.000+0900' }],
    });
    expect(calls[0]?.args).toEqual(['jira', 'workitem', 'view', 'AI-14', '--fields', 'summary,status,description,comment', '--json']);
  });

  test('close は状態を 完了 に進める', () => {
    const { exec, calls } = fake();
    new JiraTracker(exec).close('AI-12');
    expect(calls[0]?.args).toEqual(['jira', 'workitem', 'transition', '--key', 'AI-12', '--status', '完了', '--yes']);
  });

  test('acli が失敗したら TpmError', () => {
    expect(() => new JiraTracker(fake({ status: 1, stderr: 'not found\n' }).exec).close('AI-999')).toThrow(TpmError);
  });
});

describe('GithubTracker', () => {
  test('記録は段落を空行で分けた Markdown', () => {
    expect(noteToMarkdown(note)).toBe(`【計画】Software Engineer: 案 B の計画（PR 2 本）\n\n計画: ${URL}\n\n<要点>`);
  });

  test('gh-12・#12・12 を自分の Key とする', () => {
    const github = new GithubTracker(fake().exec, '/w');
    expect(['gh-12', 'GH-12', '#12', '12'].map(k => github.owns(k))).toEqual([true, true, true, true]);
    expect(['AI-12', 't-x7k2', 'gh-'].map(k => github.owns(k))).toEqual([false, false, false]);
  });

  test('comment は project の folder で、本文を標準入力で渡す', () => {
    const { exec, calls } = fake();
    new GithubTracker(exec, '/w').comment('gh-12', note);
    expect(calls[0]).toEqual({ cmd: 'gh', args: ['issue', 'comment', '12', '--body-file', '-'], options: { cwd: '/w', input: noteToMarkdown(note) } });
  });

  test('view は題・状態・URL・本文・コメントを返す', () => {
    const { exec, calls } = fake({
      stdout: JSON.stringify({ title: 'T', state: 'OPEN', url: 'https://github.com/o/r/issues/12', body: 'B', comments: [{ id: 'IC_1', body: 'c', author: { login: 'pm' }, createdAt: '2026-11-20T01:00:00Z' }] }),
    });
    expect(new GithubTracker(exec, '/w').view('#12')).toEqual({
      key: 'gh-12',
      tool: 'GitHub の Issue',
      title: 'T',
      status: 'OPEN',
      url: 'https://github.com/o/r/issues/12',
      body: 'B',
      comments: [{ id: 'IC_1', text: 'c', author: 'pm', created: '2026-11-20T01:00:00Z' }],
    });
    expect(calls[0]).toEqual({ cmd: 'gh', args: ['issue', 'view', '12', '--json', 'title,state,url,body,comments'], options: { cwd: '/w' } });
  });

  test('close は completed で閉じる', () => {
    const { exec, calls } = fake();
    new GithubTracker(exec, '/w').close('12');
    expect(calls[0]?.args).toEqual(['issue', 'close', '12', '--reason', 'completed']);
  });

  test('Key の形が違えば gh を打たずに TpmError', () => {
    const { exec, calls } = fake();
    expect(() => new GithubTracker(exec, '/w').close('AI-12')).toThrow(/gh-12 の形/);
    expect(calls).toHaveLength(0);
  });
});

/** tracker を宣言した設定（/w/<name> の folder）。 */
const source = (name: string, tracker: TrackerName): ConfigSource =>
  ({ name, dir: `/w/${name}`, file: `/w/${name}/.claude/roles/config.jsonc`, exists: true, written: ['tracker'], config: { tracker, transport: 'cmux', infra: {}, roles: {} } });

describe('route・RoutedTracker', () => {
  const jira = source('skills', 'jira');
  const web = source('web', 'github');

  test('Key の形で道具を選ぶ。gh は、github を宣言した設定の folder で打つ', () => {
    const { exec, calls } = fake();
    const trackers = { jira: [jira], github: [web] };
    expect(route(trackers, exec, 'AI-12')).toEqual({ tool: 'jira', source: jira });
    expect(route(trackers, exec, 'gh-12')).toEqual({ tool: 'github', source: web });
    expect(route(trackers, exec, 't-x7k2')).toBeUndefined();
    const tracker = new RoutedTracker(trackers, exec);
    tracker.comment('gh-12', note);
    tracker.close('AI-12');
    expect(calls.map(c => [c.cmd, c.options?.cwd])).toEqual([['gh', '/w/web'], ['acli', undefined]]);
  });

  test('宣言した設定が無い道具の Key は持たず、何も打たない', () => {
    const { exec, calls } = fake();
    const onlyJira = new RoutedTracker({ jira: [jira], github: [] }, exec);
    expect(onlyJira.owns('AI-12')).toBe(true);
    expect(onlyJira.owns('gh-12')).toBe(false);
    const none = new RoutedTracker({ jira: [], github: [] }, exec);
    expect(none.owns('AI-12')).toBe(false);
    expect(() => none.view('AI-12')).toThrow(TpmError);
    expect(() => none.comment('gh-12', note)).toThrow(/課題管理の課題ではありません: gh-12/);
    expect(calls).toHaveLength(0);
  });

  test('github を宣言した設定が 2 つ以上なら、gh- の Key は止まる（Jira の Key は通る）', () => {
    const { exec, calls } = fake();
    const tracker = new RoutedTracker({ jira: [jira], github: [web, source('api', 'github')] }, exec);
    expect(() => tracker.owns('gh-12')).toThrow(/どの repo の Issue かが決まりません.*\/w\/web\/\.claude\/roles\/config\.jsonc・\/w\/api\/\.claude\/roles\/config\.jsonc.*folders で/);
    expect(tracker.owns('AI-12')).toBe(true);
    expect(tracker.owns('t-x7k2')).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
