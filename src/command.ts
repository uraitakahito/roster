// 利用者が写して打つ 1 行（cd と claude の命令）を組む。
import { join } from 'node:path';

const CLAUDE_OPTIONS = ['--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'bypassPermissions'];

/** shell の 1 語として打てるように引用する。安全な字だけならそのまま、ほかは '…' で包む。 */
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_./:=,+@%-]+$/.test(word)) return word;
  return `'${word.replaceAll('\'', '\'\\\'\'')}'`;
}

/**
 * dir に移って TPM 担当の claude を起こす 1 行を返す。
 * core と追加の skill セットを --add-dir で足し、最初の入力は /tpm（追加の skill セットがあれば /tpm skill-sets=<名前,…>）。
 * --add-dir は後ろの語もまとめて folder として読むので、最初の入力の前に -- を置く。
 */
export function buildCommand(dir: string, root: string, skillSets: string[]): string {
  const addDirs = ['core', ...skillSets].map(s => join(root, s));
  const first = skillSets.length ? `/tpm skill-sets=${skillSets.join(',')}` : '/tpm';
  const claude = ['claude', ...CLAUDE_OPTIONS, '--add-dir', ...addDirs, '--', first];
  return `cd ${shellQuote(dir)} && ${claude.map(shellQuote).join(' ')}`;
}
