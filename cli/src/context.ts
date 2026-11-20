// 命令が動くときの周り: どの project の設定と状態を使い、どの道具の adapter を使うか。
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { readRolesConfig, type RolesConfig } from './config.ts';
import { exec as realExec, type Exec } from './exec.ts';
import { State, stateDir } from './state.ts';
import { GithubTracker } from './tracker/github.ts';
import { JiraTracker } from './tracker/jira.ts';
import { NoneTracker } from './tracker/none.ts';
import type { Tracker } from './tracker/types.ts';
import { CmuxTransport } from './transport/cmux.ts';
import { FileTransport } from './transport/file.ts';
import type { Transport } from './transport/types.ts';

export interface Context {
  /** TPM 担当を起こした folder。設定（.claude/roles/config.json）と状態はここで決まる。 */
  project: string
  config: RolesConfig
  state: State
  transport: Transport
  tracker: Tracker
  env: NodeJS.ProcessEnv
  exec: Exec
}

/**
 * 周りを組む。project は $TPM_PROJECT（担当は起こされるときに渡される）、無ければ今いる folder。
 * file の連携での自分の宛先は $TPM_ADDRESS（無ければ file:tpm）。
 */
export function createContext(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd(), exec: Exec = realExec): Context {
  const project = realpathSync(env.TPM_PROJECT || cwd);
  const config = readRolesConfig(join(project, '.claude', 'roles', 'config.json'));
  const state = new State(stateDir(project, env));
  const transport = config.transport === 'file' ? new FileTransport(state, env.TPM_ADDRESS || 'file:tpm') : new CmuxTransport(exec);
  const tracker = config.tracker === 'jira' ? new JiraTracker(exec) : config.tracker === 'github' ? new GithubTracker(exec, project) : new NoneTracker();
  return { project, config, state, transport, tracker, env, exec };
}
