// tpm の命令の木。cli.ts がこれを動かし、試験が命令の一覧（protocol.ts の COMMANDS）と揃っているかを見る。
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { buildCommand } from './command.ts';
import { guard, infraApprove, infraList, infraRevoke, infraRun } from './commands/infra.ts';
import { registerMessages } from './commands/register.ts';
import { hello, inbox } from './commands/role-side.ts';
import { assign, close, init, roles, type AssignOptions } from './commands/tpm-side.ts';
import { rolesConfigFile } from './config.ts';
import { createContext } from './context.ts';
import type { Verdict } from './guard.ts';
import { ROLE_NAMES, type RoleName } from './protocol.ts';
import { requireRole } from './roster.ts';
import { resolveSettings } from './settings.ts';
import { runRole } from './run-role.ts';
import { readSkillSets, TpmError } from './skill-sets.ts';
import { explain } from './verbose.ts';

/** この file は <repo>/cli/src/program.ts にある。 */
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

/** `tpm` の命令の木を組む。 */
export function buildProgram(): Command {
  const print = (lines: string[]): void => console.log(lines.join('\n'));
  const program = new Command()
    .name('tpm')
    .description('担当（Claude Code）のあいだの決まりを受け持つ: 担当を起こす・知らせを送る・課題に記録する・共有の環境を守る')
    .exitOverride((err: CommanderError) => {
      process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE);
    });

  program.command('start [folder]').description('TPM 担当の Claude Code を起こす 1 行を出す（起こすのは、それを写して打つ利用者）')
    .option('-v, --verbose', '読んだ config・追加の skill セット・skill セットごとの skill を stderr に出す')
    .action((folder: string | undefined, options: { verbose?: boolean }) => {
      const dir = resolveFolder(folder ?? process.cwd());
      const configFile = rolesConfigFile(dir);
      const skillSets = readSkillSets(configFile, root);
      if (options.verbose) {
        for (const line of explain({ given: folder, dir, root, configFile, skillSets })) process.stderr.write(`tpm: ${line}\n`);
      }
      console.log(buildCommand(dir, root, skillSets, resolveSettings('tpm', { env: process.env })));
    });

  program.command('init').description('TPM 担当が名乗る（宛先を状態に書き、名簿を出す）')
    .option('--model <model>', '自分の model（既定は tpm start が起こす model。$TPM_MODEL があればそれ）')
    .option('--effort <effort>', '自分の effort（既定は $CLAUDE_EFFORT、無ければ tpm start が起こす effort）')
    .action((options: { model?: string, effort?: string }) => print(init(createContext(), options)));
  program.command('roles').description('名簿を、動いている居場所と突き合わせて出す').action(() => print(roles(createContext())));
  program.command('assign <key>').description('課題を担当に振る（動いていれば【依頼】を送る。いなければ起こし、名乗るまで待つ）')
    .requiredOption('--role <role>', ROLE_NAMES.join('・'))
    .option('--title <短い題>', '居場所の題に付ける短い題')
    .option('--brief <URL>', '依頼書の URL')
    .option('--issue <課題>', '課題管理の課題の鍵')
    .option('--cwd <folder>', '担当を起こす folder（既定は project）')
    .option('--model <model>', '担当の model（既定は config.jsonc の担当の欄・$TPM_MODEL・担当の既定の順）')
    .option('--effort <effort>', '担当の effort（既定は config.jsonc の担当の欄・$TPM_EFFORT・担当の既定の順）')
    .option('--permission-mode <mode>', '担当の permission mode（既定は config.jsonc の担当の欄・$TPM_PERMISSION_MODE・担当の既定の順）')
    .option('--note <一言>', '【依頼】に添える一言（担当が動いているとき）')
    .option('--wait <秒>', '起こした担当の tpm hello を待つ秒（0 なら待たない）', '90')
    .action((key: string, options: Omit<AssignOptions, 'wait' | 'role'> & { wait: string, role: string }) => {
      if (!(ROLE_NAMES as string[]).includes(options.role)) throw new TpmError(`--role は ${ROLE_NAMES.join('・')} のどれかにしてください`);
      print(assign(createContext(), key, { ...options, role: options.role as RoleName, wait: Number(options.wait) }));
    });
  program.command('close <key>').description('担当の居場所を閉じ、名簿から消す').action((key: string) => print(close(createContext(), key)));
  program.command('hello').description('担当が名乗る（受け持ちを返す）').action(() => print(hello(createContext())));
  program.command('inbox').description('自分宛てで、まだ届いていない知らせを出す（段の区切りに見る）').action(() => print(inbox(createContext())));
  registerMessages(program, print);

  const infra = program.command('infra').description('インフラの環境の宣言と承認');
  infra.command('list').description('環境・級・承認を出す').action(() => print(infraList(createContext())));
  infra.command('approve <env>').description('TPM 担当が、Product Manager の承認を時間付きで書く')
    .requiredOption('--minutes <分>', '承認が効く分')
    .option('--note <一言>', '何の承認か')
    .action((name: string, options: { minutes: string, note?: string }) => print(infraApprove(createContext(), name, { ...options, minutes: Number(options.minutes) })));
  infra.command('revoke <env>').description('TPM 担当が承認を消す').action((name: string) => print(infraRevoke(createContext(), name)));
  infra.command('run <env> <command...>').description('環境を名指して命令を打ち、記録を残す（tpm infra run <env> -- <命令>）')
    .action((name: string, command: string[]) => {
      const r = infraRun(createContext(), name, command);
      print(r.lines);
      process.exit(r.status);
    });

  program.command('guard').description('（hook が呼ぶ）標準入力の命令を通すか止めるかを決める')
    .action(() => {
      // 設定を読めないときも止める（guard を素通りさせない）。
      let verdict: Verdict;
      try {
        verdict = guard(createContext(), readFileSync(0, 'utf8'));
      }
      catch (e) {
        verdict = { allow: false, reason: `guard が命令を見られません: ${(e as Error).message}` };
      }
      if (verdict.allow) return;
      process.stderr.write(`tpm guard: ${verdict.reason}\n`);
      process.exit(2);
    });
  program.command('run-role <key>').description('（連携の道具が動かす）名簿を読んで担当の claude を起こす')
    .requiredOption('--project <folder>', 'TPM 担当を起こした folder')
    .requiredOption('--state <folder>', '状態の folder')
    .action((key: string, options: { project: string, state: string }) => {
      const ctx = createContext({ ...process.env, TPM_PROJECT: options.project, TPM_STATE: options.state });
      process.exit(runRole(requireRole(ctx, key), ctx.project, ctx.state.dir, ctx.root));
    });
  return program;
}

/** 命令の木を「ask pm」のような名前の並びにする（下に命令を持つ物は、下の命令だけを数える）。 */
export function commandPaths(command: Command, prefix: string[] = []): string[] {
  return command.commands.flatMap((c) => {
    const path = [...prefix, c.name()];
    return c.commands.length > 0 ? commandPaths(c, path) : [path.join(' ')];
  });
}
