// roster の命令の木。cli.ts がこれを動かし、試験が命令の一覧（protocol.ts の COMMANDS）と揃っているかを見る。
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { emphasize } from './castlist.ts';
import { startTpm } from './command.ts';
import { registerAudit } from './commands/audit.ts';
import { sessionEnd, sessionStart } from './commands/castlist.ts';
import { checkStart, showReturned } from './commands/returned.ts';
import { castlistEvents, castlistFind, castlistLineage, castlistSettings, castlistShow, type EventsOptions, type FindOptions, type JsonOption, type LineageOptions, type SettingsOptions } from './commands/castlist-read.ts';
import { bannerCheck, bannerHook, bannerLog, bannerSetup } from './commands/banner.ts';
import { registerIncident } from './commands/incident.ts';
import { guard, infraApprove, infraList, infraRevoke, infraRun } from './commands/infra.ts';
import { issueView } from './commands/issue.ts';
import { messageRecordsSettled } from './commands/message-record.ts';
import { fileDelete, fileList, filePath, filePut, type FileListOptions, type FilePutOptions } from './commands/file.ts';
import { PAGE_KINDS, pageDelete, pageImport, pageList, pagePath, pagePut, pageReply, type PageDeleteOptions, type PageListOptions } from './commands/page.ts';
import { mailClaim, mailGate, mailPrompt, mailRelease, mailWait, type WaitResult } from './commands/mail.ts';
import { registerMessages } from './commands/register.ts';
import { registerReview } from './commands/review.ts';
import { hello, inboxNow } from './commands/role-side.ts';
import { assign, close, newKey, roles, type AssignOptions } from './commands/tpm-side.ts';
import { composeSkillSets, readConfigSources } from './config.ts';
import { createContext, mailroomsClosed } from './context.ts';
import { usesNats } from './mail.ts';
import { exec } from './exec.ts';
import type { Verdict } from './guard.ts';
import { ROLE_NAMES, type RoleName } from './protocol.ts';
import { requireRole } from './roster.ts';
import { runRole } from './run-role.ts';
import { TpmError } from './skill-sets.ts';
import { explain } from './verbose.ts';
import { withEnv } from './env.ts';

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

/** `roster` の命令の木を組む。readStdin は hook の標準入力を読む（試験で替える）。 */
export function buildProgram(readStdin: () => string = () => readFileSync(0, 'utf8')): Command {
  const print = (lines: string[]): void => console.log(lines.join('\n'));
  const program = new Command()
    .name('roster')
    .description('担当（Claude Code）のあいだの決まりを受け持つ: 担当を起こす・メッセージを送る・課題に記録する・共有の環境を守る')
    .exitOverride((err: CommanderError) => {
      process.exit(err.exitCode === 0 ? 0 : EXIT_USAGE);
    });

  program.command('start [folder]').description('TPM 担当の Claude Code を起こす 1 行を出す（起こすのは、それを写して打つ利用者。castlist を設定していれば、起きているかを先に見る）')
    .option('-v, --verbose', '読んだ config・追加の skill セット・skill セットごとの skill を stderr に出す')
    .action(async (folder: string | undefined, options: { verbose?: boolean }) => {
      const dir = resolveFolder(folder ?? process.cwd());
      const sources = readConfigSources(dir);
      const skillSets = composeSkillSets(sources, root);
      if (options.verbose) {
        for (const line of explain({ given: folder, dir, root, configFiles: sources.map(s => s.file), skillSets })) process.stderr.write(`roster: ${line}\n`);
      }
      // 担当の居場所の中で打っても、その担当の project と状態の folder を受け継がない（設定と状態は、渡した folder の物）。
      const ctx = createContext(withEnv(process.env, { PROJECT: dir, STATE: undefined }), dir);
      const { warnings, alert, line } = await startTpm(ctx);
      // castlist を設定していない警告は、Product Manager の terminal で目立つよう強める（起こす 1 行は止めない）。
      const prefixed = (lines: string[]): string[] => lines.map(l => `roster: ${l}`);
      for (const warning of [...emphasize(prefixed(alert), { isTTY: process.stderr.isTTY, env: process.env }), ...prefixed(warnings)]) process.stderr.write(`${warning}\n`);
      console.log(line);
    });

  program.command('roles').description('名簿を、動いている居場所と突き合わせて出す').action(async () => print(await roles(createContext())));
  program.command('key').description('課題管理の課題が無い課題の Key（t- と 4 文字）を、使われていない物から作って出す')
    .action(() => console.log(newKey(createContext())));
  program.command('assign <key>').description('課題を担当に振る（動いていれば【brief】を送る。いなければ起こし、名乗るまで待つ）')
    .requiredOption('--role <role>', ROLE_NAMES.join('・'))
    .option('--title <短い題>', '居場所の題に付ける短い題')
    .option('--brief <URL>', '依頼書の URL')
    .option('--issue <課題>', '課題管理の課題の Key')
    .option('--cwd <folder>', '担当を起こす folder（既定は project）')
    .option('--model <model>', '担当の model（既定は config.jsonc の担当の欄・$ROSTER_MODEL・担当の既定の順）')
    .option('--effort <effort>', '担当の effort（既定は config.jsonc の担当の欄・$ROSTER_EFFORT・担当の既定の順）')
    .option('--permission-mode <mode>', '担当の permission mode（既定は config.jsonc の担当の欄・$ROSTER_PERMISSION_MODE・担当の既定の順）')
    .option('--note <一言>', '【brief】に添える一言（担当が動いているとき）')
    .option('--supersede', '続きの【brief】で、済んでいない前の依頼書を取り消す（本文に「取り消す: …」と載る）')
    .option('--after', '続きの【brief】で、済んでいない前の依頼書を済ませてから、これをさせる（本文に載る）')
    .option('--no-issue-copy <訳>', '課題（Jira・GitHub の Issue の Key）の写しのページを作らずに振る。訳は担当に届く')
    .option('--wait <秒>', '起こした担当の roster hello を待つ秒（0 なら待たない）', '90')
    .action(async (key: string, { issueCopy, ...options }: Omit<AssignOptions, 'wait' | 'role' | 'noIssueCopy'> & { wait: string, role: string, issueCopy: true | string }) => {
      if (!(ROLE_NAMES as string[]).includes(options.role)) throw new TpmError(`--role は ${ROLE_NAMES.join('・')} のどれかにしてください`);
      // commander は --no-issue-copy <訳> を issueCopy（既定 true・付けたら訳の字）にする。
      const skip = issueCopy === true ? {} : { noIssueCopy: issueCopy };
      print(await assign(createContext(), key, { ...options, ...skip, role: options.role as RoleName, wait: Number(options.wait) }));
    });
  program.command('close <key>').description('担当の居場所を閉じ、名簿から消す').action(async (key: string) => print(await close(createContext(), key)));
  program.command('hello').description('名乗る（TPM 担当は宛先を状態に書いて名簿を出す。担当は受け持ちを返す）')
    .option('--model <model>', 'TPM 担当の model（既定は roster start が起こす model。$ROSTER_MODEL があればそれ）')
    .option('--effort <effort>', 'TPM 担当の effort（既定は $CLAUDE_EFFORT、無ければ roster start が起こす effort）')
    .action(async (options: { model?: string, effort?: string }) => print(await hello(createContext(), options)));
  program.command('inbox').description('自分宛てで、まだ届いていないメッセージを出す（段の区切りに見る）').action(async () => print(await inboxNow(createContext())));
  registerMessages(program, print);
  registerReview(program, print);
  registerIncident(program, print);
  registerAudit(program, print, readStdin);

  const infra = program.command('infra').description('インフラの環境の宣言と承認');
  infra.command('list').description('環境・手続き・承認を出す').action(() => print(infraList(createContext())));
  infra.command('approve <env>').description('TPM 担当が、Product Manager の承認を時間付きで書く')
    .requiredOption('--minutes <分>', '承認が効く分')
    .option('--note <一言>', '何の承認か')
    .action((name: string, options: { minutes: string, note?: string }) => print(infraApprove(createContext(), name, { ...options, minutes: Number(options.minutes) })));
  infra.command('revoke <env>').description('TPM 担当が承認を消す').action((name: string) => print(infraRevoke(createContext(), name)));
  infra.command('run <env> <command...>').description('環境を名指して命令を打ち、記録を残す（roster infra run <env> -- <命令>）')
    .action((name: string, command: string[]) => {
      const r = infraRun(createContext(), name, command);
      print(r.lines);
      process.exit(r.status);
    });

  const issue = program.command('issue').description('課題管理の課題（Jira・GitHub の Issue）を読む');
  issue.command('view <key>').description('課題の題・状態・本文・コメントを出す（課題管理が none の project でも、Key の形で道具を選んで読む）')
    .action((key: string) => print(issueView(createContext(), key)));

  const page = program.command('page').description('依頼書と成果のページを、置き場（127.0.0.1 の pagetray）に置く・読む・探す・消す');
  page.command('put <file>').description('ページを置き場に置き、控えを写して URL を出す（置き場が応えなければ置けない）')
    .requiredOption('--kind <種類>', PAGE_KINDS.join('・'))
    .option('--key <Key>', '課題の Key（担当は $ROSTER_KEY。TPM 担当は要る）')
    .action(async (file: string, options: { kind: string, key?: string }) => print(await pagePut(createContext(), file, options)));
  page.command('path <url>').description('置き場の URL を控えの file の path にする（Read tool で読むため。控えに無ければ置き場から取る）')
    .action(async (url: string) => print(await pagePath(createContext(), url)));
  page.command('list').description('置き場のページを絞って探す（今の project の新しい順）')
    .option('--key <Key>', '課題の Key')
    .option('--role <役割>', '置いた担当の役割（tpm・software-engineer など。前の置き場から入れた物は unknown）')
    .option('--workspace <宛先>', '置いた担当の居場所の宛先（workspace:12 など）')
    .option('--kind <種類>', PAGE_KINDS.join('・'))
    .option('--q <語>', '題と本文を探す')
    .option('--limit <件数>', '出す件数（1000 まで）', '50')
    .option('--oldest', '古い順に出す')
    .option('--all-projects', 'ほかの project のページも出す')
    .option('--reply <状態>', '返事の状態で絞る（waiting は返事待ち、answered は答えた物）')
    .option('--on <相手>', '--reply で絞る時の待ちの相手（pm＝既定・review はレビューの席・tpm は TPM 担当）')
    .option('--json', '記録を JSON で出す')
    .action(async (options: PageListOptions) => print(await pageList(createContext(), options)));
  page.command('reply <urls...>').description('ページの返事の状態を手で直す（TPM 担当だけ。いつもは roster ask pm と roster answer が書く）')
    .option('--waiting', '返事待ちにする（既定は Product Manager の返事待ち）')
    .option('--answered', '答えたにする')
    .option('--on <相手>', '待ちの相手（pm＝既定・review はレビューの席・tpm は TPM 担当。上げた件が決まったら --answered --on tpm）')
    .action(async (urls: string[], options: { waiting?: boolean, answered?: boolean, on?: string }) => print(await pageReply(createContext(), urls, options)));
  page.command('delete [urls...]').description('ページを置き場と控えから消す（TPM 担当だけ。戻せない。一覧を見せ、--yes で消す）')
    .option('--key <key>', 'この Key のページをみな消す')
    .option('--project <name>', 'この project（状態の folder の名）のページを消す。--key が無ければ project のページをみな消す（既定は今の project）')
    .option('--yes', '一覧を見せるだけでなく、本当に消す')
    .option('--pm <言葉>', 'Auditor が置いたページを消す訳（Product Manager の言葉。記録に残る）')
    .action(async (urls: string[], options: PageDeleteOptions) => print(await pageDelete(createContext(), urls, options)));
  page.command('import').description('控えの folder にあって置き場に無いページと file を、同じ番号で置き場に入れる（切り替えと、DB を失った後）')
    .action(async () => print(await pageImport(createContext())));

  const file = program.command('file').description('ページから参照する画像・PDF・字の file を、置き場（127.0.0.1 の pagetray）に上げる・読む・探す・消す');
  file.command('put <file>').description('file を置き場に上げ、控えを写して URL とページからの参照を出す（画像・PDF は --reviewed が要る）')
    .option('--name <語.拡張子>', '置き場での名（無ければ元の file の名から作る）')
    .option('--reviewed', '画像・PDF の中身を Read tool で見て、秘密が写っていないと確かめた')
    .option('--allow-secret', '秘密の形に当たる字の file を、わかった上で上げる（記録に残る）')
    .option('--key <Key>', '課題の Key（担当は $ROSTER_KEY。TPM 担当は要る）')
    .action(async (path: string, options: FilePutOptions) => print(await filePut(createContext(), path, options)));
  file.command('path <url>').description('置き場の file の URL を控えの file の path にする（Read tool で読むため。控えに無ければ置き場から取る）')
    .action(async (url: string) => print(await filePath(createContext(), url)));
  file.command('list').description('置き場の file を絞って探す（今の project の新しい順）')
    .option('--key <Key>', '課題の Key')
    .option('--role <役割>', '上げた担当の役割')
    .option('--q <語>', '名（<語>.<拡張子>）を探す')
    .option('--limit <件数>', '出す件数（1000 まで）', '50')
    .option('--all-projects', 'ほかの project の file も出す')
    .option('--json', '記録を JSON で出す')
    .action(async (options: FileListOptions) => print(await fileList(createContext(), options)));
  file.command('delete <urls...>').description('file を置き場と控えから消す（TPM 担当だけ。戻せない。消す物と参照しているページを見せ、--yes で消す）')
    .option('--yes', '一覧を見せるだけでなく、本当に消す')
    .action(async (urls: string[], options: { yes?: boolean }) => print(await fileDelete(createContext(), urls, options)));

  program.command('guard').description('（hook が呼ぶ）標準入力の命令を通すか止めるかを決める')
    .action(async () => {
      // 設定を読めないときも止める（guard を素通りさせない）。
      let verdict: Verdict;
      try {
        verdict = await guard(createContext(), readStdin());
      }
      catch (e) {
        verdict = { allow: false, reason: `guard が命令を見られません: ${(e as Error).message}` };
      }
      if (verdict.allow) return;
      process.stderr.write(`roster guard: ${verdict.reason}\n`);
      process.exit(2);
    });
  const returned = program.command('returned').description('届け違い: 新しい session の始まりに、前の session 宛てに届いたメッセージを見つけて TPM 担当へ返す（check は hook が呼ぶ）・返った物の全文を読む（show）');
  returned.command('check').description('（SessionStart の hook が呼ぶ）この居場所に届いた・待っているメッセージの宛先の担当と自分を比べ、違う物を配らせず、扱わないよう示し、台帳に書いて【returned】で返す')
    .action(async () => {
      // hook なので、どんな誤りでも 0 で終わる。標準出力は、届け違いがあった時の JSON だけ（Claude Code が画面と文脈に出す）。
      try {
        const out = await checkStart(createContext());
        if (out !== undefined) console.log(JSON.stringify(out));
      }
      catch (e) {
        process.stderr.write(`roster returned check: ${(e as Error).message}\n`);
      }
    });
  returned.command('show').description('返った物（【returned】の id）の宛先と全文を、送った記録から出す（TPM 担当。読むだけ）').argument('<id>', 'メッセージの id（頭の数字だけでもよい）')
    .action((id: string) => print(showReturned(createContext(), id)));
  // メッセージを NATS で渡す hook の命令（設定の messages が nats の席にだけ付く。guard.ts の guardSettings）。
  // hook なので、どんな誤りでも何も出さずに 0 で終わる（Claude Code の作業を止めない）。
  const quiet = (name: string, run: () => void | Promise<void>) => async (): Promise<void> => {
    try {
      await run();
    }
    catch (e) {
      process.stderr.write(`roster mail ${name}: ${(e as Error).message}\n`);
    }
  };
  const mail = program.command('mail').description('メッセージを NATS JetStream で渡す hook の命令（設定の messages が nats の席で、Claude Code の hook が呼ぶ）');
  mail.command('claim').description('（SessionStart の hook が呼ぶ）この session が「渡す hook を持つ」と名乗る（Claude Code の pid が分からなければ名乗らない）')
    .action(quiet('claim', () => mailClaim(createContext(), readStdin())));
  mail.command('release').description('（SessionEnd の hook が呼ぶ）名乗りを外し、待つ命令を止める')
    .action(quiet('release', () => mailRelease(createContext(), readStdin())));
  mail.command('gate').description('（Bash の後の hook が呼ぶ。PostToolUse・PostToolUseFailure の両方）送る前の検査が止めた後に、自分宛ての本文を文脈に渡す（止めた印が無ければ、何もしない）')
    .action(quiet('gate', async () => {
      const out = await mailGate(createContext(), readStdin());
      if (out !== undefined) console.log(out);
    }));
  mail.command('prompt').description('（UserPromptSubmit の hook が呼ぶ）待つ命令を止め、自分宛てがあれば本文を文脈に渡す（決して exit 2 にしない）')
    .action(quiet('prompt', async () => {
      const out = await mailPrompt(createContext(), readStdin());
      if (out !== undefined) console.log(out);
    }));
  mail.command('wait').description('（Stop・SessionStart の hook が背景で呼ぶ）自分宛てが来るまで待ち、来たら本文を stderr に出して exit 2 で終わる（Claude Code が session を起こす）')
    .action(async () => {
      // 止める合図（次の待つ命令・人の入力の時の hook が送る SIGTERM）で、取り置いた物を返して終わる。
      const stop = new AbortController();
      for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(sig, () => stop.abort());
      let result: WaitResult = { code: 0 };
      try {
        result = await mailWait(createContext(), readStdin(), stop.signal);
      }
      catch (e) {
        process.stderr.write(`roster mail wait: ${(e as Error).message}\n`);
      }
      await messageRecordsSettled();
      await mailroomsClosed();
      // exit 2 は、渡す本文がある時だけ。本文を書き終えてから終わる（待ちの timer が残るので、自分で終わる）。
      const text = result.code === 2 ? result.stderr : undefined;
      if (text !== undefined) await new Promise<void>(resolve => void process.stderr.write(`${text}\n`, () => resolve()));
      process.exit(text === undefined ? 0 : 2);
    });
  const castlist = program.command('castlist').description('アクターの台帳（castlist）: session の始まりと終わりを送る（hook が呼ぶ。castlist を設定していなければ何もしない）・監査の検索を読む（find・show・lineage・events・settings。読むだけ）');
  castlist.command('session-start').description('（SessionStart の hook が呼ぶ）session を登録し、登場・再登場・要約・分身と、起こした・継いだ線を送る')
    .action(async () => {
      // hook なので、どんな誤りでも何も出さずに 0 で終わる（標準出力は、Claude Code が文脈に足してしまう）。
      try {
        await sessionStart(createContext(), readStdin());
      }
      catch (e) {
        process.stderr.write(`roster castlist session-start: ${(e as Error).message}\n`);
      }
    });
  castlist.command('session-end').description('（SessionEnd の hook が呼ぶ）/clear なら交代、ほかは退場を送る')
    .action(async () => {
      try {
        await sessionEnd(createContext(), readStdin());
      }
      catch (e) {
        process.stderr.write(`roster castlist session-end: ${(e as Error).message}\n`);
      }
    });
  // 監査の検索を読む命令（GET だけ）。旗は castlist の引数にそのまま写す（時刻は RFC 3339。値を確かめて断るのは castlist）。
  const repeat = (value: string, previous: string[] | undefined): string[] => [...previous ?? [], value];
  castlist.command('find').description('アクターを探す（GET /api/actors。条件は AND。行ごとにプロフィールの画面の URL を出す）')
    .option('--label <鍵:値>', 'そのラベルを持つ（何度でも。tpm.key:<Key>・tpm.role:<役割>・tpm.project:<folder> など）', repeat)
    .option('--binding <種類:値>', 'その付随する id を、--at の時（無ければ今）に最後に受けた者（cmux.workspace.ref:workspace:3 など）')
    .option('--at <時刻>', '--binding の時刻')
    .option('--active-from <時刻>', '居た間が、この時刻から後に掛かる')
    .option('--active-to <時刻>', '居た間が、この時刻までに掛かる')
    .option('--active <true|false>', 'true で今稼働中のアクター、false で停止したアクター')
    .option('--model <model>', 'その model で動いたことがある')
    .option('--effort <effort>', 'その effort で動いたことがある')
    .option('--launched-by <名か id>', 'その者が起こした')
    .option('--skewed', '送り手の時計がずれた行を持つ')
    .option('--kind <ai|human>', 'アクターの種類')
    .option('--sort <entered|exited>', '初めの登場（既定）か最後の退場で並べる')
    .option('--order <asc|desc>', '並べる向き（既定は asc）')
    .option('--limit <件数>', '1 頁の数（castlist の既定は 100・1000 まで）')
    .option('--after <next>', '前の答えの next（続きの頁）')
    .option('--json', 'castlist の答えを、前の API の形（欄の名は snake_case）で出す')
    .action(async (options: FindOptions) => print(await castlistFind(createContext(), options)));
  castlist.command('show <名か-id>').description('1 つのアクター: ラベル・付随する id・今の状態・最新の model と effort・線の要約（名は、この project の roster が登録して控えた物だけ引ける）')
    .option('--json', 'castlist の答え（GET /api/actors/{id}）を、前の API の形（欄の名は snake_case）で出す')
    .action(async (target: string, options: JsonOption) => print(await castlistShow(createContext(), target, options)));
  castlist.command('lineage <名か-id>').description('誰が起こしたか・誰を起こしたか（GET /api/actors/{id}/lineage。上は人まで、下は既定で 1 段）')
    .option('--direction <up|down|both>', '辿る向き（既定は both）')
    .option('--depth <段>', '辿る段（1〜20）')
    .option('--type <launched|continued>', 'その線だけを辿る')
    .option('--json', 'castlist の答えを、前の API の形（欄の名は snake_case）で出す')
    .action(async (target: string, options: LineageOptions) => print(await castlistLineage(createContext(), target, options)));
  castlist.command('events').description('出来事を、アクターをまたいで探す（GET /api/events。受けた順）')
    .option('--type <種類>', '出来事の種類（何度でも。どれか）', repeat)
    .option('--actor <名か id>', 'そのアクターの物')
    .option('--from <時刻>', 'castlist が受けた時刻の窓の始め')
    .option('--to <時刻>', 'castlist が受けた時刻の窓の終わり')
    .option('--reason <訳>', 'detail.reason が、その値')
    .option('--source <きっかけ>', 'detail.source が、その値')
    .option('--skewed', '送り手の時計がずれた行')
    .option('--limit <件数>', '1 頁の数（1000 まで）')
    .option('--after <next>', '前の答えの next（続きの頁）')
    .option('--json', 'castlist の答えを、前の API の形（欄の名は snake_case）で出す')
    .action(async (options: EventsOptions) => print(await castlistEvents(createContext(), options)));
  castlist.command('settings').description('model と effort の行（--actor が無ければ GET /api/settings、あれば GET /api/actors/{id}/settings。--at も付ければ GET /api/actors/{id}/settings/at）')
    .option('--actor <名か id>', 'そのアクターの行（--at でその時に効いていた 1 行）')
    .option('--at <時刻>', '--actor の時刻')
    .option('--model <model>', 'その model の行')
    .option('--effort <effort>', 'その effort の行')
    .option('--source <requested|observed>', '頼んだ行か、見た行')
    .option('--from <時刻>', 'castlist が受けた時刻の窓の始め')
    .option('--to <時刻>', 'castlist が受けた時刻の窓の終わり')
    .option('--mismatch', '見た行のうち、その前に頼んだ行と model か effort が違う物')
    .option('--skewed', '送り手の時計がずれた行')
    .option('--limit <件数>', '1 頁の数（1000 まで）')
    .option('--after <next>', '前の答えの next（続きの頁）')
    .option('--json', 'castlist の答えを、前の API の形（欄の名は snake_case）で出す')
    .action(async (options: SettingsOptions) => print(await castlistSettings(createContext(), options)));
  program.command('run-role <key>').description('（連携の道具が動かす）名簿を読んで担当の claude を起こす')
    .requiredOption('--project <folder>', 'TPM 担当を起こした folder')
    .requiredOption('--state <folder>', '状態の folder')
    .action((key: string, options: { project: string, state: string }) => {
      const ctx = createContext(withEnv(process.env, { PROJECT: options.project, STATE: options.state }));
      process.exit(runRole(requireRole(ctx, key), ctx.project, ctx.state.dir, ctx.root, process.env, usesNats(ctx)));
    });

  const banner = program.command('banner').description('通知のバナー（cmux の通知）を、居場所の役割 × きっかけで出すか消すか');
  banner.command('hook').description('（cmux の通知の hook が呼ぶ）標準入力の通知を読み、バナーを消すなら effects を返す')
    .action(() => {
      // どんな誤りでも {} を返して 0 で終わる（失敗すると cmux が「Notification Hook Failed」を出すため）。
      let out = '{}';
      try {
        out = bannerHook(readStdin(), { env: process.env, exec, now: new Date() });
      }
      catch (e) {
        process.stderr.write(`roster banner hook: ${(e as Error).message}\n`);
      }
      process.stdout.write(`${out}\n`);
    });
  banner.command('setup').description('cmux.json に足す hook の 1 行と手順を出す（cmux.json は書き替えない）')
    .action(() => print(bannerSetup(root, process.env)));
  banner.command('check').description('バナーの設定と、cmux.json の hook を確かめる')
    .action(() => {
      const r = bannerCheck(root, process.env);
      print(r.lines);
      if (!r.ok) process.exit(1);
    });
  banner.command('log').description('この project の居場所の通知を、hook がどう決めたかを新しい順に出す')
    .option('--limit <件数>', '出す件数', '30')
    .action((options: { limit: string }) => print(bannerLog(createContext(), Number(options.limit))));
  return program;
}

/**
 * 命令の木を動かす（cli.ts の入口）。命令は非同期に動くので、parseAsync で終わりまで待つ。
 * 決まりの誤り（TpmError）は、命令が同期に投げても非同期に投げても、`roster: <文>` の 1 行を stderr に出して exit 1。ほかの誤りはそのまま投げる。
 * 送った記録の置き場への写し（commands/message-record.ts。送る命令は待たずに始める）は、ここで済むのを待つ（どの誤りで終わる時も）。
 */
export async function runProgram(argv: string[], program: Command = buildProgram()): Promise<void> {
  let failed = false;
  try {
    await program.parseAsync(argv);
  }
  catch (e) {
    if (!(e instanceof TpmError)) throw e;
    process.stderr.write(`roster: ${e.message}\n`);
    failed = true;
  }
  finally {
    // 止まる前に送った物の、置き場への写しを待つ（process.exit も、ほかの誤りで落ちる時も、途中の写しを切る）。
    await messageRecordsSettled();
    // 配りの口（NATS との繋ぎ）を閉じる。取り置いたままの物は返る。
    await mailroomsClosed();
  }
  if (failed) process.exit(1);
}

/** 命令の木を「ask pm」のような名前の並びにする（下に命令を持つ物は、下の命令だけを数える）。 */
export function commandPaths(command: Command, prefix: string[] = []): string[] {
  return command.commands.flatMap((c) => {
    const path = [...prefix, c.name()];
    return c.commands.length > 0 ? commandPaths(c, path) : [path.join(' ')];
  });
}
