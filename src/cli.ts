#!/usr/bin/env node
// tpm [folder]
//
// TPM 役の Claude Code を起こす 1 行を出す（起こすのは、それを写して打つ利用者）。
// folder を渡さなければ今いる folder。束は folder の .claude/roles/config.json の packs で選ぶ。
// bin/tpm は dist/cli.js への symlink。Node は main を realpath で解くので、symlink から呼んでも repo は正しく求まる。
import { realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { buildCommand } from './command.js';
import { readPacks, TpmError } from './packs.js';

/** この file は <repo>/dist/cli.js にある。 */
const root = dirname(import.meta.dirname);

/** 使い方の誤りの終了コード（sh の慣わし）。 */
const EXIT_USAGE = 2;

function resolveFolder(folder: string): string {
  try {
    if (statSync(folder).isDirectory()) return realpathSync(folder);
  }
  catch {
    // 無い folder は下の誤りにまとめる。
  }
  throw new TpmError(`folder がありません: ${folder}`);
}

function main(argv: string[]): void {
  const program = new Command()
    .name('tpm')
    .description('TPM 役の Claude Code を起こす 1 行を出す')
    .argument('[folder]', '起こす folder（既定は今いる folder）')
    .exitOverride((err: CommanderError) => {
      process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE);
    })
    .action((folder: string | undefined) => {
      const dir = resolveFolder(folder ?? process.cwd());
      const packs = readPacks(join(dir, '.claude', 'roles', 'config.json'), root);
      console.log(buildCommand(dir, root, packs));
    });

  try {
    program.parse(argv);
  }
  catch (e) {
    if (!(e instanceof TpmError)) throw e;
    process.stderr.write(`tpm: ${e.message}\n`);
    process.exit(1);
  }
}

main(process.argv);
