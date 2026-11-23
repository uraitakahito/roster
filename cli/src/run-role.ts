// roster run-role <Key> --project <folder> --state <folder>: 連携の道具が担当の居場所で動かす短い命令。名簿を読み、旗と環境変数を付けて claude を起こす。
// 起動の命令に長さの上限がある道具（cmux は 1,024 バイト）でも、model・skill セット・最初の入力を気にせず渡せる。
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { guardSettings } from './guard.ts';
import { ROLES } from './protocol.ts';
import type { RoleRecord } from './roster.ts';
import { type EnvName, withEnv } from './env.ts';

/**
 * claude の引数。--add-dir は後ろの語もまとめて folder として読むので、最初の入力の前に -- を置く。
 * --settings で guard（roster guard）の hook を付ける。hook の拒否は bypassPermissions でも効く。見る道具は役割で決まる（guardSettings）。
 * --add-dir の先の settings の hook は読まれないので、ここで渡す。
 */
export function claudeArgs(record: RoleRecord, root: string): string[] {
  return [
    '--settings',
    guardSettings(join(root, 'cli', 'bin', 'roster'), record.role),
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

/** 起こしの印の環境変数（castlist の hook が読む）。 */
export const LAUNCH_ENV = ['LAUNCH', 'LAUNCHED_BY', 'LAUNCH_MODEL', 'LAUNCH_EFFORT', 'LAUNCH_FRESH'] as const satisfies readonly EnvName[];

/**
 * 担当に渡す環境変数。担当の roster は、これで project（設定）・状態の folder・自分の Key を知る。PATH の頭に roster の folder を足す。
 * PAGETRAY_NO_DELETE は、置き場の CLI（pagetray）に「消す命令は何もせずに止まれ」と伝える（消してよいのは TPM 担当だけ。guard と二重に守る）。
 * 名簿に起こしの id（castlist を設定した時に roster assign・roster audit start が書く）があれば、起こしの印（LAUNCH_ENV）を渡す:
 * 起こしの id・起こした者・頼んだ model と effort（claude の --model・--effort と同じ値）・起こしたばかりの印。受け継いだ印（TPM 担当の物）は渡さない。
 */
export function roleEnv(record: RoleRecord, project: string, state: string, root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const launch: Partial<Record<EnvName, string | undefined>> = record.launch === undefined
    ? Object.fromEntries(LAUNCH_ENV.map(name => [name, undefined]))
    : { LAUNCH: record.launch, LAUNCHED_BY: record.launchedBy, LAUNCH_MODEL: record.model, LAUNCH_EFFORT: record.effort, LAUNCH_FRESH: '1' };
  return {
    ...withEnv(env, { ...launch, PROJECT: project, STATE: state, KEY: record.key, ROLE: record.role }),
    PAGETRAY_NO_DELETE: '1',
    PATH: `${join(root, 'cli', 'bin')}:${env.PATH ?? ''}`,
  };
}

/** claude を起こし、終わるまで待って終了コードを返す。 */
export function runRole(record: RoleRecord, project: string, state: string, root: string, env: NodeJS.ProcessEnv = process.env): number {
  const r = spawnSync('claude', claudeArgs(record, root), { cwd: record.cwd, env: roleEnv(record, project, state, root, env), stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
}
