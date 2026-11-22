// guard: 担当が使う道具を、実行の前に見て、通すか止めるかを決める（Claude Code の PreToolUse hook から呼ばれる）。
// 止めるのは 4 つ。(1) project の設定（infra。直下の folder の設定の宣言も合わせる）に書いた環境に触る命令で、手続きを踏んでいない物。
// (2) 連携と課題管理の道具の直打ち（tpm を通さないと、記録と状態が抜ける）。
// (3) 担当が置き場のページと file を消す命令: 消す要求を直に送る curl と、置き場の CLI（pagetray）の消す命令
//     （消してよいのは TPM 担当だけ。tpm page delete・tpm file delete も担当からは止まる）。
// (4) 読むだけの担当（Auditor・Staff Engineer 担当）が repo・設定・記録を変えること: project の folder・状態の folder・ページの控えの下への書き込み（Edit・Write・NotebookEdit）と、
//     git・gh の変える命令（どちらも見て勧めるだけで、直さない）。
// (1) は命令の字全体に match の字が含まれるかで見る（共有の環境は、疑わしければ止める）。
// (2)〜(4) の shell の命令は、単純な命令に分け、その頭（実際に打つ道具の命令）だけを見る。commit の文・grep の型・here-document に道具の名が入っても止めない。
// どれも字で見るので、防げるのは「うっかり」まで。script に包んだ命令や、shell の redirect での書き込みはすり抜ける。確実な守りは、担当に渡す権限の方で行う。
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { envLabel, type InfraEnv, type RolesConfig } from './config.ts';
import type { RoleName } from './protocol.ts';
import { shellQuote, splitCommands } from './shell.ts';
import type { State } from './state.ts';

/** 環境を変えてよい担当。 */
const INFRA_ROLE: RoleName = 'devops-engineer';

/** Auditor（session の始まりに tpm audit fresh を呼ぶ席）。 */
const AUDIT_ROLE: RoleName = 'auditor';

/** 見て勧めるだけで、repo・設定・記録を変えない担当と、止めた訳に書く字（name は文の頭に置く名。英字で終わる名は、後ろに空白を空ける）。 */
const READ_ONLY: Partial<Record<RoleName, { name: string, instead: string, how: string }>> = {
  'auditor': {
    name: 'Auditor ',
    instead: '直すことは、監査のページの勧告に書いてください（直すのは、Product Manager が通した後に振られた担当）。',
    how: '監査のページの file は一時の folder（$TMPDIR など）に書いて tpm page put で置き、見つけた食い違いは監査のページに挙げてください。',
  },
  'staff-engineer': {
    name: 'Staff Engineer 担当',
    instead: '直すことは、レビューのページの指摘に書いてください（直すのは、その課題の担当）。',
    how: 'レビューのページの file は一時の folder（$TMPDIR など）に書いて tpm page put で置き、直すことはレビューのページの指摘に書いてください。',
  },
};

/** 役割が、読むだけの担当なら、その字。 */
const readOnly = (role: RoleName | undefined) => role === undefined ? undefined : READ_ONLY[role];

/** file を書き替える道具（hook が、shell の命令のほかに見る物）。 */
export const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const;

/** 承認 1 件（`approvals/<環境>.jsonc`）。until を過ぎたら効かない。 */
export interface Approval {
  until: string
  note?: string
}

/** guard の答え。止めるときは、代わりにどうするかを reason に書く。 */
export type Verdict = { allow: true } | { allow: false, reason: string };

/** 直に打たせない道具の命令（単純な命令の語を空白でつないだ字の頭に当てる）と、代わりに使う tpm の命令。 */
const DIRECT: [pattern: RegExp, instead: string][] = [
  [/^cmux agent message\b/, 'tpm ask …・tpm report …（担当）、tpm notify・tpm answer・tpm dismiss（TPM 担当）'],
  [/^cmux set-status\b/, 'tpm wait <work|pm|tpm> "<何を>"'],
  [/^cmux (workspace create|new-workspace)\b/, 'tpm assign <Key> --role …'],
  [/^cmux (workspace close|close-workspace)\b/, 'tpm close <Key>'],
  [/^acli jira workitem (comment create|transition)\b/, 'tpm report …・tpm ask pm・tpm answer（記録は命令が書く）'],
  [/^gh issue (comment|close)\b/, 'tpm report …・tpm ask pm・tpm answer（記録は命令が書く）'],
];

/** 置き場のページと file を消す要求（curl の DELETE）。 */
const REMOVE_PAGES = /^curl\b.*(?:-X ?|--request[ =])DELETE\b/;
/** 消す要求を受けるエンドポイント（ページと file）。 */
const REMOVE_ENDPOINTS = ['/api/pages', '/api/files'];

/**
 * 置き場の CLI（pagetray。path で名指した物も）の、ページと file を消す命令: `pagetray page delete`・`pagetray file delete` と、API を直に呼ぶ `pagetray api` の DELETE
 * （method は大文字でも小文字でも通るので、どちらも見る）。
 */
const PAGETRAY_REMOVE = [
  /^(?:\S*\/)?pagetray\b.*\b(?:page|file) delete\b/,
  /^(?:\S*\/)?pagetray\b.*\bapi\b.*(?:-X ?|--method[ =])delete\b/i,
];

/** 単純な命令の頭が、担当の打ってはいけない「置き場のページか file を消す命令」か。 */
const removesPages = (head: string): boolean =>
  (REMOVE_PAGES.test(head) && REMOVE_ENDPOINTS.some(endpoint => head.includes(endpoint))) || PAGETRAY_REMOVE.some(pattern => pattern.test(head));

/** git の、命令の前に置く旗のうち、値を取る物（`git -C <folder> pull` の pull を命令と読むため）。 */
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
/** git の、repo か checkout を変える命令。 */
const GIT_CHANGES = new Set(['add', 'am', 'apply', 'checkout', 'cherry-pick', 'clean', 'commit', 'merge', 'mv', 'pull', 'push', 'rebase', 'reset', 'restore', 'revert', 'rm', 'stash', 'switch']);
/** git の、引数が読むだけの形なら通す命令と、通す引数（どれにも当たらない引数があれば、変える命令とみなす）。 */
const GIT_READ_ARGS: Record<string, RegExp> = {
  branch: /^(?:-a|-r|-v|-vv|-l|--all|--remotes|--list|--verbose|--show-current|--no-color)$/,
  tag: /^(?:-l|-n\d*|--list)$/,
  worktree: /^list$|^--porcelain$/,
};
/** gh の、変える命令（`gh <語> <語>` の 2 語）。 */
const GH_CHANGES = /^gh (?:pr (?:create|merge|close|edit|ready|reopen|review|comment)|issue (?:create|edit|delete|reopen|close|comment)|release (?:create|delete|edit|upload)|repo (?:create|delete|edit|rename|archive|sync)|workflow (?:run|enable|disable)|run (?:rerun|cancel|delete)|(?:secret|variable|label) (?:set|delete|create|edit))\b/;
/** gh api の、書き込みになる旗（-X GET のほかの method と、欄を送る旗。欄を送ると POST になる）。 */
const GH_API_WRITES = /^(?:-f|-F|--field|--raw-field|--input)$/;

/** git の命令の語から、命令の名と、その後ろの引数を取り出す。命令が無ければ undefined。 */
function gitCommand(words: string[]): { name: string, args: string[] } | undefined {
  let i = 1;
  while (i < words.length && (words[i] ?? '').startsWith('-')) i += GIT_VALUE_FLAGS.has(words[i] ?? '') ? 2 : 1;
  const name = words[i];
  return name === undefined ? undefined : { name, args: words.slice(i + 1) };
}

/** 単純な命令（語の並び）が、repo・checkout・GitHub の側を変える git・gh の命令か。 */
function changesRepo(words: string[]): boolean {
  if (words[0] === 'git') {
    const git = gitCommand(words);
    if (git === undefined) return false;
    if (GIT_CHANGES.has(git.name)) return true;
    const read = GIT_READ_ARGS[git.name];
    return read !== undefined && git.args.some(a => !read.test(a));
  }
  if (words[0] !== 'gh') return false;
  if (GH_CHANGES.test(words.join(' '))) return true;
  if (words[1] !== 'api') return false;
  const args = words.slice(2);
  const method = args.findIndex(a => a === '-X' || a === '--method');
  const named = args.find(a => /^(?:-X|--method=)./.test(a))?.replace(/^(?:-X|--method=)/, '') ?? (method === -1 ? undefined : args[method + 1]);
  return (named !== undefined && named.toUpperCase() !== 'GET') || (named === undefined && args.some(a => GH_API_WRITES.test(a)));
}

/** Audit の席を起こす命令。Product Manager が自分の手で打つ物なので、TPM 担当と担当が道具として打つのは止める。 */
const AUDIT_START = /^tpm audit start\b/;

/** 命令の頭にこれを書くと、道具の直打ちを通す（tpm 自身の開発と試しのため。環境の手続きと、読むだけの担当の守りと、Audit の席を起こす命令には効かない）。 */
export const RAW = 'TPM_RAW=1';

/** guard に聞く 1 件。打った命令と、決めるのに要る設定・承認・時刻。 */
export interface Asked {
  command: string
  /** 打った担当。TPM 担当と、tpm が起こしていない session は undefined。 */
  role: RoleName | undefined
  config: Pick<RolesConfig, 'infra' | 'trackers'>
  /** 環境の名前 → 承認。 */
  approvals: Record<string, Approval | undefined>
  now: Date
}

/** 命令が触る環境（match のどれかを含む）。 */
export function touched(command: string, infra: Record<string, InfraEnv>): string[] {
  return Object.entries(infra).filter(([, env]) => env.match.some(m => command.includes(m))).map(([name]) => name);
}

/** 環境 1 つについて、この担当が今、変えてよいか。 */
export function judgeEnv(name: string, env: InfraEnv, role: RoleName | undefined, approval: Approval | undefined, now: Date): Verdict {
  if (env.guard === 'free') return { allow: true };
  if (env.guard === 'pm-only') {
    return { allow: false, reason: `環境 ${envLabel(name, env)} の手は Product Manager だけのものです（どの担当も、承認があっても打てない）。Product Manager が自分の terminal で直に打ちます。打ってほしい 1 行と訳を確認のページに書き（tpm page put）、tpm ask pm で送ってください。` };
  }
  if (role !== INFRA_ROLE) {
    return { allow: false, reason: `環境 ${envLabel(name, env)} を変えてよいのは DevOps Engineer 担当だけです。tpm ask devops --what … --why … で TPM 担当に頼んでください。` };
  }
  if (env.guard === 'tpm') return { allow: true };
  if (approval !== undefined && now.getTime() < Date.parse(approval.until)) return { allow: true };
  const expired = approval === undefined ? '' : `（承認は ${approval.until} で切れた）`;
  return {
    allow: false,
    reason: `環境 ${envLabel(name, env)} は、ほかの人と共有です。変えるには Product Manager の承認が要ります${expired}。何を・なぜ・何が止まるかを確認のページに書き（tpm page put）、tpm ask pm で送ってください。承認されたら TPM 担当が tpm infra approve ${name} で承認を書きます。`,
  };
}

/** 命令を通すか。環境の手続きを先に見て、次に道具の直打ちを見る。 */
export function judge(asked: Asked): Verdict {
  for (const name of touched(asked.command, asked.config.infra)) {
    const env = asked.config.infra[name];
    if (env === undefined) continue;
    const verdict = judgeEnv(name, env, asked.role, asked.approvals[name], asked.now);
    if (!verdict.allow) return verdict;
  }
  const commands = splitCommands(asked.command);
  if (commands.some(words => AUDIT_START.test(words.join(' ')))) {
    return { allow: false, reason: 'Audit の席を起こすのは Product Manager です。tpm audit start は、Product Manager が自分の手で打ちます（Auditor は TPM 担当の回し方も見るので、TPM 担当と担当は起こさない）。' };
  }
  const reader = readOnly(asked.role);
  if (reader !== undefined) {
    const change = commands.find(changesRepo);
    if (change !== undefined) {
      return { allow: false, reason: `${reader.name}は repo を変えません（${change.slice(0, 3).join(' ')}）。${reader.instead}` };
    }
  }
  if (!asked.command.includes(RAW)) {
    const heads = commands.map(words => words.join(' '));
    if (asked.role !== undefined && heads.some(removesPages)) {
      return { allow: false, reason: `ページと file を消せるのは TPM 担当だけです。消すページや file の URL と訳を、tpm ask tpm で TPM 担当に送って頼んでください。tpm 自身の開発や試しで直に打つなら、命令の頭に ${RAW} を付けてください。` };
    }
    for (const [pattern, instead] of DIRECT) {
      // どの設定も課題管理に GitHub の Issue を使わない project では、gh issue は課題管理の道具ではない。
      if (pattern.source.startsWith('^gh issue') && asked.config.trackers.github.length === 0) continue;
      if (heads.some(h => pattern.test(h))) {
        return { allow: false, reason: `道具を直に打つと、記録と状態が抜けます。代わりに: ${instead}。tpm 自身の開発や試しで直に打つなら、命令の頭に ${RAW} を付けてください。` };
      }
    }
  }
  return { allow: true };
}

const approvalFile = (name: string): string => `approvals/${name}.jsonc`;

/** 設定にある環境ごとの承認を読む。承認が無い環境は undefined。 */
export function readApprovals(state: State, infra: Record<string, InfraEnv>): Record<string, Approval | undefined> {
  return Object.fromEntries(Object.keys(infra).map(name => [name, state.read<Approval>(approvalFile(name))]));
}

/** 環境の承認を書く（`tpm infra approve`）。 */
export function writeApproval(state: State, name: string, approval: Approval): void {
  state.write(approvalFile(name), approval);
}

/** 環境の承認を消す（`tpm infra revoke`）。 */
export function removeApproval(state: State, name: string): void {
  state.remove(approvalFile(name));
}

/** hook の標準入力（PreToolUse）から、shell の命令を取り出す。Bash でなければ undefined。 */
export function commandOf(stdin: string): string | undefined {
  const input = JSON.parse(stdin) as { tool_name?: string, tool_input?: { command?: unknown } };
  if (input.tool_name !== 'Bash' || typeof input.tool_input?.command !== 'string') return undefined;
  return input.tool_input.command;
}

/** file を書き替える道具の呼び出し 1 件。path は書く先（入力から読めなければ undefined）。 */
export interface WriteCall {
  tool: string
  path: string | undefined
}

/** hook の標準入力（PreToolUse）から、file を書き替える道具の呼び出しを取り出す。WRITE_TOOLS でなければ undefined。 */
export function writeOf(stdin: string): WriteCall | undefined {
  const input = JSON.parse(stdin) as { tool_name?: string, tool_input?: { file_path?: unknown, notebook_path?: unknown } };
  if (!(WRITE_TOOLS as readonly string[]).includes(input.tool_name ?? '')) return undefined;
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  return { tool: input.tool_name ?? '', path: typeof path === 'string' && path !== '' ? path : undefined };
}

/** path を、symbolic link をたどった絶対 path にする。まだ無い file は、在るいちばん近い親までをたどる。 */
function realPath(path: string): string {
  const rest: string[] = [];
  let dir = resolve(path);
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest.unshift(basename(dir));
    dir = dirname(dir);
  }
  return join(realpathSync(dir), ...rest);
}

/** 読むだけの担当が書き替えない folder（名は、止めた訳に出す字）。 */
export interface Protected {
  name: string
  dir: string
}

/**
 * file を書き替える道具を通すか。読むだけの担当（Auditor・Staff Engineer 担当）は、守る folder（project・状態・ページの控え）の下を書き替えない。
 * 書く先を読めない呼び出しも止める（疑わしければ止める）。ほかの担当と TPM 担当は通す。
 */
export function judgeWrite(call: WriteCall, role: RoleName | undefined, roots: Protected[]): Verdict {
  const reader = readOnly(role);
  if (reader === undefined) return { allow: true };
  const { name, how } = reader;
  if (call.path === undefined) return { allow: false, reason: `${name}の ${call.tool} の書く先を読めないので止めます。${how}` };
  const path = realPath(call.path);
  const hit = roots.find(r => path === realPath(r.dir) || path.startsWith(`${realPath(r.dir)}${sep}`));
  if (hit === undefined) return { allow: true };
  return { allow: false, reason: `${name}は、${hit.name} の下を書き替えません（repo・設定・記録は変えない）: ${path}。${how}` };
}

/**
 * 担当の claude に渡す settings（--settings）。道具の前に tpm guard を呼ぶ hook。hook の命令は shell が読むので、path を引用する。
 * 見る道具は Bash。読むだけの担当の席だけ、file を書き替える道具（WRITE_TOOLS）も見る（ほかの担当では、書くたびに hook を動かさない）。
 * どの席にも、session の始まりと終わりに castlist に送る hook（tpm castlist session-start・session-end）を付ける。castlist を設定していなければ、その命令は何もしない。
 * Auditor の席には、session の始まりに tpm audit fresh を呼ぶ hook も付ける。
 */
export function guardSettings(tpmBin: string, role?: RoleName): string {
  const hook = (command: string) => ({ type: 'command', command: `${shellQuote(tpmBin)} ${command}` });
  const matcher = readOnly(role) === undefined ? 'Bash' : ['Bash', ...WRITE_TOOLS].join('|');
  return JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher, hooks: [hook('guard')] }],
      // Auditor の席は、席を起こした時と /clear の時に印を書く（前の監査の文脈が残ったまま、次の監査を始めないため）。
      SessionStart: [{ hooks: [...(role === AUDIT_ROLE ? [hook('audit fresh')] : []), hook('castlist session-start')] }],
      SessionEnd: [{ hooks: [hook('castlist session-end')] }],
    },
  });
}
