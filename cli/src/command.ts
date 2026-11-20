// 利用者が写して打つ 1 行（cd と claude の命令）を組む。
import { join } from 'node:path';
import { guardSettings } from './guard.ts';
import { presentSettingsEnv, resolveSettings } from './settings.ts';
import { shellQuote } from './shell.ts';
import { skillSetDir } from './skill-sets.ts';

/**
 * dir に移って TPM 担当の claude を起こす 1 行を返す。model などは env から resolveSettings('tpm', …) で決める。
 * env に書いてある TPM_MODEL などは 1 行の頭（PATH の隣）に写す。`TPM_MODEL=… tpm start` と 1 回だけ付けた値も、
 * TPM 担当の環境に入り、tpm hello の状態と tpm assign で起こす担当に効く（profile で export したときと揃う）。
 * core と追加の skill セットを --add-dir で足し、最初の入力は /tpm。--settings で guard（tpm guard）の hook を付ける。
 * TPM 担当が tpm を名前だけで打てるように、PATH の頭に tpm の folder を足す（担当には tpm run-role が同じことをする）。
 * --add-dir は後ろの語もまとめて folder として読むので、最初の入力の前に -- を置く。
 */
export function buildCommand(dir: string, root: string, skillSets: string[], env: NodeJS.ProcessEnv): string {
  const settings = resolveSettings('tpm', { env });
  const addDirs = ['core', ...skillSets].map(s => skillSetDir(root, s));
  const bin = join(root, 'cli', 'bin');
  const claude = ['claude', '--model', settings.model, '--effort', settings.effort, '--permission-mode', settings.permissionMode, '--settings', guardSettings(join(bin, 'tpm')), '--add-dir', ...addDirs, '--', '/tpm'];
  const assigns = [`PATH=${shellQuote(bin)}:"$PATH"`, ...presentSettingsEnv(env).map(([name, value]) => `${name}=${shellQuote(value)}`)];
  return `cd ${shellQuote(dir)} && ${assigns.join(' ')} ${claude.map(shellQuote).join(' ')}`;
}
