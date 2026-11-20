// 利用者が写して打つ 1 行（cd と claude の命令）を組む。
import { join } from 'node:path';
import { guardSettings } from './guard.ts';
import { TPM_SETTINGS } from './protocol.ts';
import { shellQuote } from './shell.ts';
import { skillSetDir } from './skill-sets.ts';

const CLAUDE_OPTIONS = ['--model', TPM_SETTINGS.model, '--effort', TPM_SETTINGS.effort, '--permission-mode', TPM_SETTINGS.permissionMode];

/**
 * dir に移って TPM 担当の claude を起こす 1 行を返す。
 * core と追加の skill セットを --add-dir で足し、最初の入力は /tpm。--settings で guard（tpm guard）の hook を付ける。
 * TPM 担当が tpm を名前だけで打てるように、PATH の頭に tpm の folder を足す（担当には tpm run-role が同じことをする）。
 * --add-dir は後ろの語もまとめて folder として読むので、最初の入力の前に -- を置く。
 */
export function buildCommand(dir: string, root: string, skillSets: string[]): string {
  const addDirs = ['core', ...skillSets].map(s => skillSetDir(root, s));
  const bin = join(root, 'cli', 'bin');
  const claude = ['claude', ...CLAUDE_OPTIONS, '--settings', guardSettings(join(bin, 'tpm')), '--add-dir', ...addDirs, '--', '/tpm'];
  return `cd ${shellQuote(dir)} && PATH=${shellQuote(bin)}:"$PATH" ${claude.map(shellQuote).join(' ')}`;
}
