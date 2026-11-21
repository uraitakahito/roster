// tpm が持つ状態（TPM 担当の宛先・担当の名簿・承認・送ったメッセージ）の置き場。
// project（TPM 担当を起こした folder）ごとに folder を分け、1 件 1 ファイルで書く（担当が同時に書いてもぶつからない）。
// 1 件 1 ファイルは .jsonc（config.jsonc と同じ parseJsonc で読む）、足していく記録は 1 行 1 件の .jsonl。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseJsonc } from './jsonc.ts';
import { TpmError } from './skill-sets.ts';

/**
 * project の状態の folder。$XDG_STATE_HOME（無ければ ~/.local/state）の `tpm/<project の path の / を - に替えた名>`。
 * $TPM_STATE があればそれ（起こされた担当は、起こした側と同じ folder をこれで受け取る。shell の環境変数が違っても取り違えない）。
 */
export function stateDir(project: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.TPM_STATE) return env.TPM_STATE;
  return join(stateBase(env), project.replaceAll(/[^A-Za-z0-9._-]/g, '-'));
}

/** project ごとの状態の folder を並べる folder。$XDG_STATE_HOME（無ければ ~/.local/state）の `tpm`。 */
export function stateBase(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'tpm');
}

/** 状態の base の下にある project の状態の folder（tpm.jsonc か roles/ がある物）。無ければ空。 */
export function projectStateDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const base = stateBase(env);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => join(base, e.name))
    .filter(d => existsSync(join(d, 'tpm.jsonc')) || existsSync(join(d, 'roles')))
    .sort();
}

/** 状態の folder の中のファイルを、folder からの相対の名前で読み書きする。 */
export class State {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** JSONC を読む。無ければ undefined。読めなければ TpmError。 */
  read<T>(name: string): T | undefined {
    const file = join(this.dir, name);
    if (!existsSync(file)) return undefined;
    try {
      return parseJsonc(readFileSync(file, 'utf8')) as T;
    }
    catch (e) {
      throw new TpmError(`${file} を JSONC として読めません: ${(e as Error).message}`);
    }
  }

  /** JSON（そのまま正しい JSONC）を書く。コメントは書かない（手で足したコメントは、書き直すと消える）。書きかけを読ませないように、隣に書いてから名前を替える。 */
  write(name: string, value: unknown): void {
    const file = join(this.dir, name);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, file);
  }

  /** ファイルを消す。無くても誤りにしない。 */
  remove(name: string): void {
    rmSync(join(this.dir, name), { force: true });
  }

  /** folder の中の .jsonc の名前（拡張子なし）を名前順に返す。folder が無ければ空。 */
  list(folder: string): string[] {
    const d = join(this.dir, folder);
    if (!existsSync(d)) return [];
    return readdirSync(d).filter(f => f.endsWith('.jsonc')).map(f => f.slice(0, -'.jsonc'.length)).sort();
  }

  /** 1 行 1 件の記録（.jsonl）の末尾に足す。 */
  append(name: string, value: unknown): void {
    const file = join(this.dir, name);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(value)}\n`);
  }

  /** .jsonl を読む。無ければ空。 */
  lines<T>(name: string): T[] {
    const file = join(this.dir, name);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(l => l !== '').map(l => JSON.parse(l) as T);
  }
}

/**
 * 古い名の状態（*.json）を *.jsonc に移す。folder の下まで見る。.jsonl と書きかけ（*.tmp）には触らない。
 * 両方あれば（古いコードの命令が移した後に書いた）新しい方を .jsonc に残す。
 * 担当が同時に移して先を越された物（ENOENT）は無視する。命令はみな createContext でこれを通る。
 * 古い .json を書く tpm はもう無いので、使う project のどれでも 1 度 tpm を打った後は消してよい。
 */
export function migrateLegacyJson(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const legacy = join(entry.parentPath, entry.name);
    const file = `${legacy}c`;
    try {
      if (existsSync(file) && statSync(file).mtimeMs >= statSync(legacy).mtimeMs) rmSync(legacy);
      else renameSync(legacy, file);
    }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
