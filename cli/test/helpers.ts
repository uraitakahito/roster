// 決まりの命令の試験の足場: file の連携を使う project と、TPM 担当・担当それぞれの周りを作る。
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, type Context } from '../src/context.ts';
import type { Exec, ExecOptions } from '../src/exec.ts';
import { FileTransport } from '../src/transport/file.ts';

export interface Call {
  cmd: string
  args: string[]
  options?: ExecOptions
}

export interface World {
  project: string
  /** 外の命令（acli・gh）が打たれた記録。 */
  calls: Call[]
  /** TPM 担当の周り。 */
  tpm: Context
  /** 鍵 key の担当の周り（address は居場所の宛先）。 */
  role: (key: string, address: string) => Context
  /** file の連携（届いた知らせ・起こす命令を読む）。 */
  wire: FileTransport
  /** sleep で待った回数。 */
  slept: () => number
}

/** config は .claude/roles/config.json に書く中身（transport は file に固定する）。 */
export function world(config: Record<string, unknown> = {}): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-world-')));
  const project = join(base, 'project');
  mkdirSync(join(project, '.claude', 'roles'), { recursive: true });
  writeFileSync(join(project, '.claude', 'roles', 'config.json'), JSON.stringify({ ...config, transport: 'file' }));
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, options) => {
    calls.push({ cmd, args, ...(options === undefined ? {} : { options }) });
    return { status: 0, stdout: '{}', stderr: '' };
  };
  let slept = 0;
  const at = (env: NodeJS.ProcessEnv): Context => ({
    ...createContext({ XDG_STATE_HOME: join(base, 'state'), ...env }, project, exec),
    now: () => new Date('2026-11-20T12:00:00.000Z'),
    sleep: () => {
      slept += 1;
    },
  });
  const tpm = at({});
  return {
    project,
    calls,
    tpm,
    role: (key, address) => at({ TPM_PROJECT: project, TPM_KEY: key, TPM_ADDRESS: address }),
    wire: new FileTransport(tpm.state, 'file:tpm'),
    slept: () => slept,
  };
}
