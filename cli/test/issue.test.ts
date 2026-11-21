import { describe, expect, test } from 'vitest';
import { issueView } from '../src/commands/issue.ts';
import type { Exec, ExecResult } from '../src/exec.ts';
import { TpmError } from '../src/skill-sets.ts';
import { world } from './helpers.ts';

/** 打たれた命令を覚え、決めた出力を返す偽の exec。 */
function fake(result: Partial<ExecResult>) {
  const calls: { cmd: string, args: string[] }[] = [];
  const exec: Exec = (cmd, args) => {
    calls.push({ cmd, args });
    return { status: 0, stdout: '', stderr: '', ...result };
  };
  return { exec, calls };
}

const JIRA = JSON.stringify({
  key: 'AI-14',
  fields: {
    summary: 'Artifact を見る UI',
    status: { name: '未着手' },
    description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }] },
    comment: { comments: [] },
  },
});

describe('tpm issue view', () => {
  test('課題管理が none の project でも、Jira の Key なら acli で読む', () => {
    const { exec, calls } = fake({ stdout: JIRA });
    const ctx = { ...world().tpm, exec };
    expect(issueView(ctx, 'AI-14')).toEqual([
      '課題: AI-14（Jira）',
      '題: Artifact を見る UI',
      '状態: 未着手',
      '--- 本文',
      '本文',
      '--- コメント: 無し',
    ]);
    expect(calls[0]?.cmd).toBe('acli');
  });

  test('GitHub の Issue の Key なら gh で読み、URL とコメントの書き手を出す', () => {
    const { exec, calls } = fake({
      stdout: JSON.stringify({ title: 'T', state: 'OPEN', url: 'https://github.com/o/r/issues/12', body: '', comments: [{ id: 'IC_1', body: 'c', author: { login: 'pm' }, createdAt: '2026-11-20T01:00:00Z' }] }),
    });
    expect(issueView({ ...world().tpm, exec }, 'gh-12')).toEqual([
      '課題: gh-12（GitHub の Issue）',
      '題: T',
      '状態: OPEN',
      'URL: https://github.com/o/r/issues/12',
      '--- 本文',
      '（無し）',
      '--- コメント 1（pm・2026-11-20T01:00:00Z）',
      'c',
    ]);
    expect(calls[0]?.cmd).toBe('gh');
  });

  test('t- の Key は道具を打たずに止まる', () => {
    const { exec, calls } = fake({});
    expect(() => issueView({ ...world().tpm, exec }, 't-x7k2')).toThrow(/課題管理の課題の Key ではありません/);
    expect(calls).toHaveLength(0);
  });

  test('道具が失敗したら、認証を確かめる命令を添えて止まる', () => {
    const { exec } = fake({ status: 1, stderr: 'unauthorized' });
    const run = () => issueView({ ...world().tpm, exec }, 'AI-14');
    expect(run).toThrow(TpmError);
    expect(run).toThrow(/unauthorized[\s\S]*acli jira auth status/);
  });
});
