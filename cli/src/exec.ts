// 外の命令（cmux・acli・gh）の打ち方。adapter はこの型を受け取り、試験では偽物に替える。
import { spawnSync } from 'node:child_process';

/** 打った命令の終了コードと出力。 */
export interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

/** 命令を打つ folder と標準入力。 */
export interface ExecOptions {
  cwd?: string
  /** 標準入力に渡す字。 */
  input?: string
}

/** 外の命令を打つ関数の形。 */
export type Exec = (cmd: string, args: string[], options?: ExecOptions) => ExecResult;

/** 命令を打ち、終わるまで待つ。命令が無いなど、起こせなかったときは status 127。 */
export const exec: Exec = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { cwd: options.cwd, input: options.input, encoding: 'utf8' });
  if (r.error) return { status: 127, stdout: '', stderr: r.error.message };
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};
