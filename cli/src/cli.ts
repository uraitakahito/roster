#!/usr/bin/env node
// tpm [-v|--verbose] [folder]
//
// TPM 担当の Claude Code を起こす 1 行を出す（起こすのは、それを写して打つ利用者）。
// folder を渡さなければ今いる folder。追加の skill セットは folder の .claude/roles/config.json の skill-sets で選ぶ。
// --verbose なら、読んだ config・追加の skill セット・skill セットごとの skill を stderr に出す（stdout は 1 行のまま）。
// cli/bin/tpm（sh）が本当の在り処の path でこれを node で直に動かす（build は無い。nodenv が repo の .node-version を読むため）。repo は自分の在り処（import.meta.dirname）から求める。
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { buildCommand } from './command.ts';
import { registerMessages } from './commands/register.ts';
import { hello } from './commands/role-side.ts';
import { assign, close, init, roles, type AssignOptions } from './commands/tpm-side.ts';
import { createContext } from './context.ts';
import { debugCommand } from './debug.ts';
import { ROLE_NAMES, type RoleName } from './protocol.ts';
import { requireRole } from './roster.ts';
import { runRole } from './run-role.ts';
import { readSkillSets, TpmError } from './skill-sets.ts';
import { explain } from './verbose.ts';

/** この file は <repo>/cli/src/cli.ts にある。 */
const root = join(import.meta.dirname, '..', '..');

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
  program.addCommand(debugCommand());

  const print = (lines: string[]): void => console.log(lines.join('\n'));
  program.command('init').description('TPM 担当が名乗る（宛先を状態に書き、名簿を出す）')
    .requiredOption('--model <model>', '自分の model（claude-opus-5-5 の形）')
    .requiredOption('--effort <effort>', '自分の effort')
    .action((options: { model: string, effort: string }) => print(init(createContext(), options)));
  program.command('roles').description('名簿を、動いている居場所と突き合わせて出す').action(() => print(roles(createContext())));
  program.command('assign <key>').description('課題を担当に振る（動いていれば【依頼】を送る。いなければ起こし、名乗るまで待つ）')
    .requiredOption('--role <role>', ROLE_NAMES.join('・'))
    .option('--title <短い題>', '居場所の題に付ける短い題')
    .option('--brief <URL>', '依頼書の URL')
    .option('--issue <課題>', '課題管理の課題の鍵')
    .option('--cwd <folder>', '担当を起こす folder（既定は project）')
    .option('--model <model>').option('--effort <effort>').option('--permission-mode <mode>')
    .option('--note <一言>', '【依頼】に添える一言（担当が動いているとき）')
    .option('--wait <秒>', '起きた合図を待つ秒（0 なら待たない）', '90')
    .action((key: string, options: Omit<AssignOptions, 'wait' | 'role'> & { wait: string, role: string }) => {
      if (!(ROLE_NAMES as string[]).includes(options.role)) throw new TpmError(`--role は ${ROLE_NAMES.join('・')} のどれかにしてください`);
      print(assign(createContext(), key, { ...options, role: options.role as RoleName, wait: Number(options.wait) }));
    });
  program.command('close <key>').description('担当の居場所を閉じ、名簿から消す').action((key: string) => print(close(createContext(), key)));
  program.command('hello').description('担当が名乗る（起きた合図。受け持ちを返す）').action(() => print(hello(createContext())));
  registerMessages(program, print);
  program.command('run-role <key>').description('（連携の道具が動かす）名簿を読んで担当の claude を起こす')
    .requiredOption('--project <folder>', 'TPM 担当を起こした folder')
    .requiredOption('--state <folder>', '状態の folder')
    .action((key: string, options: { project: string, state: string }) => {
      const ctx = createContext({ ...process.env, TPM_PROJECT: options.project, TPM_STATE: options.state });
      process.exit(runRole(requireRole(ctx, key), ctx.project, ctx.state.dir, ctx.root));
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
