// 起こす folder の .claude/roles/config.json から、core のほかに加える追加の skill セット（skill-sets）を読む。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** tpm が利用者に見せて止まる誤り。cli は `tpm: <message>` と出して exit 1 にする。 */
export class TpmError extends Error {}

const SKILL_SET_NAME = /^[a-z0-9-]+$/;

/**
 * config.json の skill-sets を確かめ、追加の skill セットの名前を書いた順に返す（core と重なりは除く）。
 * ファイルや skill-sets の欄が無ければ空。誤りなら TpmError を投げる。
 */
export function readSkillSets(configFile: string, root: string): string[] {
  const config = readConfig(configFile);
  if (config === undefined) return [];
  const skillSets = skillSetsField(config, configFile);
  if (skillSets === undefined) return [];
  const names = [...new Set(skillSets.filter(s => s !== 'core'))];
  for (const name of names) assertSkillSetExists(name, root);
  return names;
}

/** config.json を JSON として読む。ファイルが無ければ undefined。 */
export function readConfig(configFile: string): unknown {
  if (!existsSync(configFile)) return undefined;
  try {
    return JSON.parse(readFileSync(configFile, 'utf8'));
  }
  catch (e) {
    throw new TpmError(`${configFile} を JSON として読めません: ${(e as Error).message}`);
  }
}

/** skill-sets の欄を取り出す。欄が無ければ undefined、skill セットの名前の配列でなければ誤り。 */
function skillSetsField(config: unknown, configFile: string): string[] | undefined {
  if (typeof config !== 'object' || config === null || !('skill-sets' in config)) return undefined;
  const skillSets = config['skill-sets'];
  if (skillSets === undefined) return undefined;
  if (!Array.isArray(skillSets) || !skillSets.every(s => typeof s === 'string' && SKILL_SET_NAME.test(s))) {
    throw new TpmError(`${configFile} の skill-sets は skill セットの名前（英小文字・数字・-）の配列にしてください`);
  }
  return skillSets as string[];
}

/** skill セット name の folder（repo の skill-sets/<name>）。 */
export function skillSetDir(root: string, name: string): string {
  return join(root, 'skill-sets', name);
}

/** skill セットは skillSetDir の .claude/skills にある。無ければ誤り。 */
function assertSkillSetExists(name: string, root: string): void {
  if (!existsSync(join(skillSetDir(root, name), '.claude', 'skills'))) {
    throw new TpmError(`skill セットがありません: ${name}`);
  }
}
