// 起こす folder の .claude/roles/config.json から、core のほかに足す束（packs）を読む。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** tpm が利用者に見せて止まる誤り。cli は `tpm: <message>` と出して exit 1 にする。 */
export class TpmError extends Error {}

const PACK_NAME = /^[a-z0-9-]+$/;

/**
 * config.json の packs を確かめ、足す束の名前を書いた順に返す（core と重なりは除く）。
 * ファイルや packs の欄が無ければ空。誤りなら TpmError を投げる。
 */
export function readPacks(configFile: string, root: string): string[] {
  const config = readConfig(configFile);
  if (config === undefined) return [];
  const packs = packsField(config, configFile);
  if (packs === undefined) return [];
  const names = [...new Set(packs.filter(p => p !== 'core'))];
  for (const name of names) assertPackExists(name, root);
  return names;
}

/** config.json を JSON として読む。ファイルが無ければ undefined。 */
function readConfig(configFile: string): unknown {
  if (!existsSync(configFile)) return undefined;
  try {
    return JSON.parse(readFileSync(configFile, 'utf8'));
  }
  catch (e) {
    throw new TpmError(`${configFile} を JSON として読めません: ${(e as Error).message}`);
  }
}

/** packs の欄を取り出す。欄が無ければ undefined、束の名前の配列でなければ誤り。 */
function packsField(config: unknown, configFile: string): string[] | undefined {
  if (typeof config !== 'object' || config === null || !('packs' in config)) return undefined;
  const { packs } = config;
  if (packs === undefined) return undefined;
  if (!Array.isArray(packs) || !packs.every(p => typeof p === 'string' && PACK_NAME.test(p))) {
    throw new TpmError(`${configFile} の packs は束の名前（英小文字・数字・-）の配列にしてください`);
  }
  return packs as string[];
}

/** 束は repo の <name>/.claude/skills にある。無ければ誤り。 */
function assertPackExists(name: string, root: string): void {
  if (!existsSync(join(root, name, '.claude', 'skills'))) {
    throw new TpmError(`pack がありません: ${name}`);
  }
}
