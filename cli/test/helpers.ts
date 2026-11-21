// 決まりの命令の試験の足場: file の連携を使う project と、TPM 担当・担当それぞれの周りを作る。
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PAGES_URL } from '../src/commands/page.ts';
import { createContext, type Context } from '../src/context.ts';
import type { Exec, ExecOptions } from '../src/exec.ts';
import { FileTransport } from '../src/transport/file.ts';

/** 課題の概要の節（40 字以上）のある依頼書。world が置き場に置く。 */
export const BRIEF_HTML = '<h1>依頼書</h1><section id="summary"><h2>課題の概要</h2><p>試しの課題。担当が課題の中身を読めるようにし、TPM 担当が相談に乗れるようにすることが求められている。</p></section>';
/** world が置き場に置く、概要の節のある依頼書の URL（どの world でも同じ）。 */
export const BRIEF = `${DEFAULT_PAGES_URL}/brief-1.html`;

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
  /** file の連携（届いたメッセージ・起こす命令を読む）。 */
  wire: FileTransport
  /** sleep で待った回数。 */
  slept: () => number
}

/** config は .claude/roles/config.jsonc に書く中身（transport は file に固定する）。env は TPM 担当の周りの環境変数に足す物。 */
export function world(config: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-world-')));
  const project = join(base, 'project');
  mkdirSync(join(project, '.claude', 'roles'), { recursive: true });
  writeFileSync(join(project, '.claude', 'roles', 'config.jsonc'), JSON.stringify({ ...config, transport: 'file' }));
  mkdirSync(join(base, 'pages'));
  writeFileSync(join(base, 'pages', 'brief-1.html'), BRIEF_HTML);
  const calls: Call[] = [];
  const exec: Exec = (cmd, args, options) => {
    calls.push({ cmd, args, ...(options === undefined ? {} : { options }) });
    // curl は置き場の HEAD（tpm page put・tpm assign の課題の写し）。置き場は出していることにする。
    return { status: 0, stdout: cmd === 'curl' ? '200' : '{}', stderr: '' };
  };
  let slept = 0;
  const at = (env: NodeJS.ProcessEnv): Context => ({
    // 置き場も一時の folder にする（本物の置き場に試験のページを置かない）。
    ...createContext({ XDG_STATE_HOME: join(base, 'state'), TPM_PAGES_DIR: join(base, 'pages'), ...env }, project, exec),
    now: () => new Date('2026-11-20T12:00:00.000Z'),
    sleep: () => {
      slept += 1;
    },
  });
  const tpm = at(env);
  return {
    project,
    calls,
    tpm,
    role: (key, address) => at({ TPM_PROJECT: project, TPM_KEY: key, TPM_ADDRESS: address }),
    wire: new FileTransport(tpm.state, 'file:tpm'),
    slept: () => slept,
  };
}
