// 命令が動くときの周り: どの project の設定と状態を使い、どの道具の adapter を使うか。
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { CastlistClient } from '../gen/castlist-client/dist-types/index.js';
import type { PagetrayClient } from '../gen/pagetray-client/dist-types/index.js';
import { castlistClient } from './castlist.ts';
import { pagetrayClient } from './commands/store.ts';
import { composeRolesConfig, composeSkillSets, type RolesConfig } from './config.ts';
import { actor } from './evidence.ts';
import { exec as realExec, type Exec } from './exec.ts';
import { migrateLegacyJson, State, stateDir } from './state.ts';
import { RecordedTracker } from './tracker/recorded.ts';
import { RoutedTracker } from './tracker/routed.ts';
import type { Tracker } from './tracker/types.ts';
import { CmuxTransport } from './transport/cmux.ts';
import { FileTransport } from './transport/file.ts';
import type { Transport } from './transport/types.ts';
import { assertNoLegacySeat, envOf } from './env.ts';

/** 生成した client を作る関数（server ごと。試験は偽の HTTP の handler を持つ client を作る物に替える）。 */
export interface Clients {
  /** castlist の URL から、生成した castlist の client を作る（castlist.ts の castlistClient）。 */
  castlist: (url: string) => CastlistClient
  /** 置き場の URL から、生成した pagetray の client を作る（commands/store.ts の pagetrayClient）。 */
  pagetray: (url: string) => PagetrayClient
}

/** 命令が動くときの周り。命令はみなこれを受け取り、試験では偽物の道具を入れて組む。 */
export interface Context {
  /** TPM 担当を起こした folder。設定（ここと直下の folder の .claude/roles/config.jsonc）と状態はここで決まる。 */
  project: string
  /** project の folder とその直下の folder の設定を合わせた物。 */
  config: RolesConfig
  state: State
  transport: Transport
  tracker: Tracker
  env: NodeJS.ProcessEnv
  exec: Exec
  /** この roster の repo（<root>/cli/src/context.ts にある）。 */
  root: string
  /** core のほかに足す skill セット（合わせた設定の skill-sets）。 */
  skillSets: string[]
  /** 待つ（試験で替える）。 */
  sleep: (ms: number) => Promise<void>
  /** 今の時刻（試験で替える）。 */
  now: () => Date
  /** 生成した client を作る関数（castlist と pagetray に送る物は、みなこれで作った client で送る。試験は偽の HTTP を差し込む）。 */
  clients: Clients
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * 周りを組む。project は $ROSTER_PROJECT（担当は起こされるときに渡される）、無ければ今いる folder。
 * file の連携での自分の宛先は $ROSTER_ADDRESS（無ければ file:tpm）。
 */
export function createContext(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd(), exec: Exec = realExec): Context {
  assertNoLegacySeat(env);
  const project = realpathSync(envOf(env, 'PROJECT') || cwd);
  const root = join(import.meta.dirname, '..', '..');
  const config = composeRolesConfig(project);
  const state = new State(stateDir(project, env));
  migrateLegacyJson(state.dir);
  const transport = config.transport === 'file' ? new FileTransport(state, envOf(env, 'ADDRESS') || 'file:tpm') : new CmuxTransport(exec);
  // 課題管理への書き込みは tracker.jsonl に残す。
  const tracker = new RecordedTracker(new RoutedTracker(config.trackers, exec), state, actor(env));
  return { project, config, state, transport, tracker, env, exec, root, skillSets: composeSkillSets(config.sources, root), sleep, now: () => new Date(), clients: { castlist: url => castlistClient(url), pagetray: url => pagetrayClient(url) } };
}
