#!/usr/bin/env node
// tpm [-v|--verbose] [folder]
//
// TPM 担当の Claude Code を起こす 1 行を出す（起こすのは、それを写して打つ利用者）。
// folder を渡さなければ今いる folder。追加の skill セットは folder の .claude/roles/config.json の skill-sets で選ぶ。
// --verbose なら、読んだ config・追加の skill セット・skill セットごとの skill を stderr に出す（stdout は 1 行のまま）。
// bin/tpm は dist/cli.js への symlink。Node は main を realpath で解くので、symlink から呼んでも repo は正しく求まる。
import { realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { buildCommand } from './command.js';
import { readSkillSets, TpmError } from './skill-sets.js';
import { explain } from './verbose.js';

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
    .description('TPM 担当の Claude Code を起こす 1 行を出す')
    .argument('[folder]', '起こす folder（既定は今いる folder）')
    .option('-v, --verbose', '読んだ config・追加の skill セット・skill セットごとの skill を stderr に出す')
    .exitOverride((err: CommanderError) => {
      process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE);
    })
    .action((folder: string | undefined, options: { verbose?: boolean }) => {
      const dir = resolveFolder(folder ?? process.cwd());
      const configFile = join(dir, '.claude', 'roles', 'config.json');
      const skillSets = readSkillSets(configFile, root);
      if (options.verbose) {
        for (const line of explain({ given: folder, dir, root, configFile, skillSets })) process.stderr.write(`tpm: ${line}\n`);
      }
      console.log(buildCommand(dir, root, skillSets));
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
