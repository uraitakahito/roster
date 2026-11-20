import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Exec, ExecOptions, ExecResult } from '../src/exec.ts';
import { TpmError } from '../src/skill-sets.ts';
import { adfToText, noteToAdf } from '../src/tracker/adf.ts';
import { GithubTracker, noteToMarkdown } from '../src/tracker/github.ts';
import { JiraTracker } from '../src/tracker/jira.ts';
import { NoneTracker } from '../src/tracker/none.ts';
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
});

describe('JiraTracker', () => {
  test('Jira の鍵だけを自分の物とする', () => {
    const jira = new JiraTracker(fake().exec);
    expect(['SKILLS-12', 'AB2-1'].map(k => jira.owns(k))).toEqual([true, true]);
    expect(['t-same-se', 'gh-12', 'skills-12', '12'].map(k => jira.owns(k))).toEqual([false, false, false, false]);
  });

  test('comment は ADF をファイルで渡し、後でファイルを消す', () => {
    const { exec, calls, seen } = fake();
    new JiraTracker(exec).comment('SKILLS-12', note);
    expect(calls[0]?.cmd).toBe('acli');
    expect(calls[0]?.args.slice(0, 7)).toEqual(['jira', 'workitem', 'comment', 'create', '--key', 'SKILLS-12', '--body-file']);
    expect(JSON.parse(seen[0] ?? '')).toEqual(noteToAdf(note));
    expect(existsSync(calls[0]?.args.at(-1) ?? '')).toBe(false);
  });

  test('comments は view の ADF を字にして返す', () => {
    const { exec, calls } = fake({ stdout: JSON.stringify({ fields: { comment: { comments: [{ id: '10042', body: noteToAdf(note) }] } } }) });
    expect(new JiraTracker(exec).comments('SKILLS-12')).toEqual([{ id: '10042', text: adfToText(noteToAdf(note)) }]);
    expect(calls[0]?.args).toEqual(['jira', 'workitem', 'view', 'SKILLS-12', '--fields', 'comment', '--json']);
  });

  test('close は状態を 完了 に進める', () => {
    const { exec, calls } = fake();
    new JiraTracker(exec).close('SKILLS-12');
    expect(calls[0]?.args).toEqual(['jira', 'workitem', 'transition', '--key', 'SKILLS-12', '--status', '完了', '--yes']);
  });

  test('acli が失敗したら TpmError', () => {
    expect(() => new JiraTracker(fake({ status: 1, stderr: 'not found\n' }).exec).close('SKILLS-999')).toThrow(TpmError);
  });
});

describe('GithubTracker', () => {
  test('記録は段落を空行で分けた Markdown', () => {
    expect(noteToMarkdown(note)).toBe(`【計画】Software Engineer: 案 B の計画（PR 2 本）\n\n計画: ${URL}\n\n<要点>`);
  });

  test('gh-12・#12・12 を自分の鍵とする', () => {
    const github = new GithubTracker(fake().exec, '/w');
    expect(['gh-12', 'GH-12', '#12', '12'].map(k => github.owns(k))).toEqual([true, true, true, true]);
    expect(['SKILLS-12', 't-x', 'gh-'].map(k => github.owns(k))).toEqual([false, false, false]);
  });

  test('comment は project の folder で、本文を標準入力で渡す', () => {
    const { exec, calls } = fake();
    new GithubTracker(exec, '/w').comment('gh-12', note);
    expect(calls[0]).toEqual({ cmd: 'gh', args: ['issue', 'comment', '12', '--body-file', '-'], options: { cwd: '/w', input: noteToMarkdown(note) } });
  });

  test('comments は本文をそのまま返す', () => {
    const { exec, calls } = fake({ stdout: JSON.stringify({ comments: [{ id: 'IC_1', body: 'a\n\nb', author: {} }] }) });
    expect(new GithubTracker(exec, '/w').comments('#12')).toEqual([{ id: 'IC_1', text: 'a\n\nb' }]);
    expect(calls[0]?.args).toEqual(['issue', 'view', '12', '--json', 'comments']);
  });

  test('close は completed で閉じる', () => {
    const { exec, calls } = fake();
    new GithubTracker(exec, '/w').close('12');
    expect(calls[0]?.args).toEqual(['issue', 'close', '12', '--reason', 'completed']);
  });

  test('鍵の形が違えば gh を打たずに TpmError', () => {
    const { exec, calls } = fake();
    expect(() => new GithubTracker(exec, '/w').close('SKILLS-12')).toThrow(/gh-12 の形/);
    expect(calls).toHaveLength(0);
  });
});

describe('NoneTracker', () => {
  test('どの鍵も持たず、何も書かない', () => {
    const none = new NoneTracker();
    expect(none.owns()).toBe(false);
    none.comment();
    none.close();
    expect(none.comments()).toEqual([]);
  });
});
