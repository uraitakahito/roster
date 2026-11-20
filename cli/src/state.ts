// tpm が持つ状態（TPM 担当の宛先・担当の名簿・承認・送った知らせ）の置き場。
// project（TPM 担当を起こした folder）ごとに folder を分け、1 件 1 ファイルで書く（担当が同時に書いてもぶつからない）。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * project の状態の folder。$XDG_STATE_HOME（無ければ ~/.local/state）の tpm/<project の path の / を - に替えた名>。
 * $TPM_STATE があればそれ（起こされた担当は、起こした側と同じ folder をこれで受け取る。shell の環境変数が違っても取り違えない）。
 */
export function stateDir(project: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.TPM_STATE) return env.TPM_STATE;
  const base = env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'tpm', project.replaceAll(/[^A-Za-z0-9._-]/g, '-'));
}

/** 状態の folder の中のファイルを、folder からの相対の名前で読み書きする。 */
export class State {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** JSON を読む。無ければ undefined。 */
  read<T>(name: string): T | undefined {
    const file = join(this.dir, name);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  }

  /** JSON を書く。書きかけを読ませないように、隣に書いてから名前を替える。 */
  write(name: string, value: unknown): void {
    const file = join(this.dir, name);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, file);
  }

  remove(name: string): void {
    rmSync(join(this.dir, name), { force: true });
  }

  /** folder の中の .json の名前（拡張子なし）を名前順に返す。folder が無ければ空。 */
  list(folder: string): string[] {
    const d = join(this.dir, folder);
    if (!existsSync(d)) return [];
    return readdirSync(d).filter(f => f.endsWith('.json')).map(f => f.slice(0, -'.json'.length)).sort();
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
