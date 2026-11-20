// tpm run-role <鍵> --project <folder> --state <folder>: 連携の道具が担当の居場所で動かす短い命令。名簿を読み、旗と環境変数を付けて claude を起こす。
// 起動の命令に長さの上限がある道具（cmux は 1,024 バイト）でも、model・skill セット・最初の入力を気にせず渡せる。
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROLES } from './protocol.ts';
import type { RoleRecord } from './roster.ts';

/** claude の引数。--add-dir は後ろの語もまとめて folder として読むので、最初の入力の前に -- を置く。 */
export function claudeArgs(record: RoleRecord): string[] {
  return [
    '--model',
    record.model,
    '--effort',
    record.effort,
    '--permission-mode',
    record.permissionMode,
    '--add-dir',
    ...record.addDirs,
    '--',
    ROLES[record.role].prompt,
  ];
}

/** 担当に渡す環境変数。担当の tpm は、これで project（設定）・状態の folder・自分の鍵を知る。PATH の頭に tpm の folder を足す。 */
export function roleEnv(record: RoleRecord, project: string, state: string, root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    TPM_PROJECT: project,
    TPM_STATE: state,
    TPM_KEY: record.key,
    TPM_ROLE: record.role,
    PATH: `${join(root, 'cli', 'bin')}:${env.PATH ?? ''}`,
  };
}

/** claude を起こし、終わるまで待って終了コードを返す。 */
export function runRole(record: RoleRecord, project: string, state: string, root: string, env: NodeJS.ProcessEnv = process.env): number {
  const r = spawnSync('claude', claudeArgs(record), { cwd: record.cwd, env: roleEnv(record, project, state, root, env), stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
}
