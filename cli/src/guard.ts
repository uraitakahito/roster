// guard: 担当が使う道具を、実行の前に見て、通すか止めるかを決める（Claude Code の PreToolUse hook から呼ばれる）。
// 止めるのは 7 つ。(1) project の設定（infra。直下の folder の設定の宣言も合わせる）に書いた環境に触る命令で、手続きを踏んでいない物。
// (2) 連携と課題管理の道具の直打ち（roster を通さないと、記録と状態が抜ける）。
// (3) 担当が置き場のページと file を消す命令: 消す要求を直に送る curl と、置き場の CLI（pagetray）の消す命令
//     （消してよいのは TPM 担当だけ。roster page delete・roster file delete も担当からは止まる）。
// (4) 読むだけの担当（Auditor・Staff Engineer 担当）が repo・設定・記録を変えること: project の folder・状態の folder・ページの控えの下への書き込み（Edit・Write・NotebookEdit）と、
//     git・gh の変える命令（どちらも見て勧めるだけで、直さない）。
// (5) Audit の席を起こす命令（roster audit start。起こすのは Product Manager）。
// (6) pattern で選んだ process に合図を送る命令（pkill・killall と、pid を名指さない kill。どの席からも。台帳 #89・#92）。
// (7) Chrome・Chromium のバイナリを直に起こす命令と、open で Chrome を開く命令（旗があっても。起こすのは roster chrome。どの席からも。台帳 #402・#403。guard-chrome.ts）。
// (1) は、命令を単純な命令に分けて match の語で当て、語で当たらなくても命令の字全体に match の字が含まれれば止める（共有の環境は、疑わしければ止める）。
//     字の含みだけの当たりを通すのは、どの単純な命令も、引数も入力も命令として動かさない道具の表（cat・grep・tail・roster・git の読む命令など。字を動かす旗は外す）か、
//     命令を起こす呼び出しの字の無い python・node の時だけ（textStays。t-y67q の案 B）。
// (2)〜(7) の shell の命令は、単純な命令に分け、その頭（実際に打つ道具の命令）だけを見る。commit の文・grep の型・here-document に道具の名が入っても止めない。
// どれも字で見るので、防げるのは「うっかり」まで。script に包んだ命令や、shell の redirect での書き込みはすり抜ける。確実な守りは、担当に渡す権限の方で行う。
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { envLabel, type InfraEnv, type RolesConfig } from './config.ts';
import { chromeLaunch, chromeReason } from './guard-chrome.ts';
import type { RoleName } from './protocol.ts';
import { rawCommands, scanCommand, shellQuote, splitCommands, splitCommandsMarked, SUBSTITUTED } from './shell.ts';
import type { State } from './state.ts';

/** 環境を変えてよい担当。 */
const INFRA_ROLE: RoleName = 'devops-engineer';

/** Auditor（session の始まりに roster audit fresh を呼ぶ席）。 */
const AUDIT_ROLE: RoleName = 'auditor';

/** 見て勧めるだけで、repo・設定・記録を変えない担当と、止めた訳に書く字（name は文の頭に置く名。英字で終わる名は、後ろに空白を空ける）。 */
const READ_ONLY: Partial<Record<RoleName, { name: string, instead: string, how: string }>> = {
  'auditor': {
    name: 'Auditor ',
    instead: '直すことは、監査のページの勧告に書いてください（直すのは、Product Manager が通した後に振られた担当）。',
    how: '監査のページの file は一時の folder（$TMPDIR など）に書いて roster page put で置き、見つけた食い違いは監査のページに挙げてください。',
  },
  'staff-engineer': {
    name: 'Staff Engineer 担当',
    instead: '直すことは、レビューのページの指摘に書いてください（直すのは、その課題の担当）。',
    how: 'レビューのページの file は一時の folder（$TMPDIR など）に書いて roster page put で置き、直すことはレビューのページの指摘に書いてください。',
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

/** 直に打たせない道具の命令（単純な命令の語を空白でつないだ字の頭に当てる）と、代わりに使う roster の命令。 */
const DIRECT: [pattern: RegExp, instead: string][] = [
  [/^cmux agent message\b/, 'roster ask …・roster report …（担当）、roster notify・roster answer・roster dismiss（TPM 担当）'],
  [/^cmux set-status\b/, 'roster wait <work|pm|tpm> "<何を>"'],
  [/^cmux (workspace create|new-workspace)\b/, 'roster assign <Key> --role …（TPM 担当。担当は roster ask tpm で頼む）'],
  [/^cmux (workspace close|close-workspace)\b/, 'roster close <Key>（TPM 担当。担当は roster ask tpm で頼む）'],
  [/^acli jira workitem (comment create|transition)\b/, 'roster report …・roster ask pm・roster answer（記録は命令が書く）'],
  [/^gh issue (comment|close)\b/, 'roster report …・roster ask pm・roster answer（記録は命令が書く）'],
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
const AUDIT_START = /^roster audit start\b/;

/** pattern で選んだ process に合図を送る命令（引数に依らず止める）。 */
const PATTERN_KILLERS = new Set(['pkill', 'killall']);
/** kill の、値を取る旗（`-s TERM`・`-n 9`）。 */
const KILL_VALUE_FLAGS = new Set(['-s', '-n']);
/** kill の的として通す字: pid（数字。0 は自分の process group なので外す）・job（`%1`）・変数（`$pid`・`${PID}`・`$!`・`$$`・`$1`）。 */
const KILL_TARGET = /^(?:[1-9]\d*|%\S+|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$[!$\d])$/;

/**
 * 単純な命令（語の並び）が、pattern で選んだ process に合図を送る命令か。pkill・killall はいつも。
 * kill は、的（旗でない引数）がみな pid・job・変数の時だけ通す（通す形を数える。疑わしければ止める）。的が無い（`pgrep … | xargs kill`）・
 * 空の語（`$(pgrep …)` の跡）・`{}`・0・負の数（process group）は止める。`--` の後ろはみな的。
 * `kill -l`・`kill -L`（合図の一覧）は通す。
 */
function killsByPattern(words: string[]): boolean {
  const [name, ...args] = words;
  if (name !== undefined && PATTERN_KILLERS.has(name)) return true;
  if (name !== 'kill') return false;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      targets.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && targets.length === 0) {
      // 合図の一覧。的の後ろの -l は旗でない（kill は先に的へ送る）ので、的の前だけで見る。
      if (arg === '-l' || arg === '-L') return false;
      if (KILL_VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    targets.push(arg);
  }
  return targets.length === 0 || targets.some(t => !KILL_TARGET.test(t));
}

/** roster の、メッセージを送る命令と、ページを置く命令（送る前の検査を通る物）。 */
const SENDS = /^roster (?:(?:ask|report|notify|answer|dismiss|assign|seat)\b|page put\b)/;

/** 命令の中に、roster の送る命令（ask・report・notify・answer・dismiss・assign・seat・page put）があるか。単純な命令の頭だけを見る。 */
export const sendsMessage = (command: string): boolean => splitCommands(command).some(words => SENDS.test(words.join(' ')));

/** 命令の頭にこれを書くと、道具の直打ちを通す（roster 自身の開発と試しのため。環境の手続きと、読むだけの担当の守りと、Audit の席を起こす命令と、pattern で process に合図を送る命令と、Chrome の直起こしには効かない）。 */
export const RAW = 'ROSTER_RAW=1';

/** guard に聞く 1 件。打った命令と、決めるのに要る設定・承認・時刻。 */
export interface Asked {
  command: string
  /** 打った担当。TPM 担当と、roster が起こしていない session は undefined。 */
  role: RoleName | undefined
  config: Pick<RolesConfig, 'infra' | 'trackers'>
  /** 環境の名前 → 承認。 */
  approvals: Record<string, Approval | undefined>
  now: Date
}

/** match の語 1 つと命令の語 1 つ。末尾が * の語は前方一致、ほかは丸ごと一致。 */
const wordHits = (pattern: string, word: string | undefined): boolean =>
  word !== undefined && (pattern.endsWith('*') ? word.startsWith(pattern.slice(0, -1)) : word === pattern);

/**
 * 単純な命令 1 つの語に、match の 1 項目が当たるか。
 * - 頭が旗（`--name callboard`・`-v pagetray-data*`）: その語の並びが、どこかに続けて（間に何も挟まらずに）現れる。
 * - 頭が旗でない（`container stop callboard`）: 語のどこかに頭の語があり、残りの語がその後に順に現れる（間に何が挟まってもよい）。
 *   命令の名に揃えないのは、知らない前置きの命令と旗の値（`timeout 60 …`・`sudo -u root …`）を splitCommands が外さないため。
 */
export function hitsWords(words: string[], match: string): boolean {
  const pattern = match.trim().split(/\s+/);
  const [head, ...rest] = pattern;
  if (head === undefined) return false;
  if (head.startsWith('-')) return words.some((_, i) => pattern.every((p, k) => wordHits(p, words[i + k])));
  return words.some((word, i) => {
    if (!wordHits(head, word)) return false;
    let k = 0;
    for (const later of words.slice(i + 1)) if (k < rest.length && wordHits(rest[k] ?? '', later)) k += 1;
    return k === rest.length;
  });
}

/**
 * 引数の字を命令として動かさないと分かっている単純な命令（語の頭が path・頭の代入・前置きの語の無い形だけ）。
 * 粗い区切りの当たりを外す quietForSegments が使う（字の含みを外す条件は、広い表の passesText。t-y67q）。
 * 字を命令として動かす道は道具の数だけあるので、止める側を並べず、通す側を要る物だけ並べる（t-7j37 の review-5）。
 */
function inert(words: string[]): boolean {
  const [name, first, second] = words;
  // roster infra run は、環境に命令を打つ。
  if (name === 'roster') return !(first === 'infra' && second === 'run');
  // git は丸ごと並べない（rebase -x・-c alias が字を動かす）。直後の語が commit の時だけ。
  if (name === 'git') return first === 'commit';
  return name === 'grep' || name === 'rg';
}

/**
 * gh の、本文を送るだけの命令（`gh <語> <語>` の 2 語）。通す側を要る物だけ並べる（alias・extension と、その別の名 cs・ext は、名が決まっていないので止める側には並べない。
 * review-4 の指摘 3）。
 */
const GH_SENDS = /^gh (?:pr (?:create|comment|edit|review)|issue (?:create|comment|edit)|release (?:create|edit))$/;

/** 引用しない here-document（`<<EOF`。中の `$(…)`・backtick を shell が命令として動かす）と、置き換えが、同じ命令の字にあるか（review-4 の指摘 1）。 */
const runsInHeredoc = (command: string): boolean => /<<-?\s*[A-Za-z_]/.test(command) && (command.includes('$(') || command.includes('`'));

/**
 * 字を粗く区切りに分けて読む当たり（textSegments）を外してよい単純な命令: inert のほか、字を出すだけの命令（cat・echo・printf）と、
 * 本文を送るだけの gh（GH_SENDS）。PR の本文・commit の文の here-document・`gh pr create --body "$(cat <<'EOF' …)"` に、
 * container の命令の字を書いても止めないため（review-3 の指摘 4）。`cat <<X | sh` のように字を動かす命令が並べば、読む。
 */
function quietForSegments(words: string[]): boolean {
  const [name] = words;
  if (name === 'cat' || name === 'echo' || name === 'printf') return true;
  if (name === 'gh') return GH_SENDS.test(words.slice(0, 3).join(' '));
  return inert(words);
}

/** 引数も入力も命令として動かさない道具（字を出す・読む・比べる・並べる・場所を移す）。字を動かす旗のある道具は TEXT_FLAGS で外す。 */
const TEXT_TOOLS = new Set(['cat', 'echo', 'printf', 'tee', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'ls', 'cd', 'pwd', 'mkdir', 'test', '[', 'true', 'false', 'date', 'jq', 'basename', 'dirname', 'realpath', 'grep', 'rg']);
/** 表の道具の、値を命令として動かす長い旗（略も当てる）。 */
const TEXT_FLAGS: Record<string, string[]> = { sort: ['--compress-program'], rg: ['--pre', '--pre-glob', '--hostname-bin'] };
/** git の、字を命令として動かさない命令。 */
const GIT_TEXT = new Set(['commit', 'grep', 'show', 'log', 'diff', 'status', 'rev-parse', 'ls-files', 'blame']);
/** git の、命令の前に置くと設定の字を命令にする旗（-c は丸ごと、ほかは略も当てる）。 */
const GIT_CONFIG_FLAGS = ['--config-env', '--exec-path'];
/** git の、pager や外の道具を動かす旗（命令の後ろ。略も当てる）。grep の -O は束ねた短い旗（-nO…）も当てる。 */
const GIT_RUN_FLAGS = ['--open-files-in-pager', '--ext-diff', '--textconv'];
/** gh の、字を命令として動かさない命令（`gh <語> <語>`）。 */
const GH_TEXT = /^(?:pr (?:create|comment|edit|review|view|ready|checks|diff|list)|issue (?:create|comment|edit|view|list)|release (?:create|edit|view|list)|run (?:view|list))$/;
/** pnpm の、package.json の script を動かすだけの命令（知らない語は script か exec として動くので並べない）。 */
const PNPM_TEXT = new Set(['test', 't', 'run']);
/** pnpm の命令の前に置いてよい旗（閉じて並べる）と、そのうち値を取る旗。 */
const PNPM_FLAGS = new Set(['-C', '--dir', '--filter', '-F', '-r', '--recursive', '-s', '--silent']);
const PNPM_VALUE_FLAGS = new Set(['-C', '--dir', '--filter', '-F']);
/** npx で動かしてよい道具（この repo の道具。zx・tsx などは字を動かす）。 */
const NPX_TEXT = new Set(['vitest', 'tsc', 'eslint', 'prettier', 'typedoc']);
/** npx の的の前に置いてよい旗（npm の設定はどれも旗で渡せ、--node-options などが字を動かすので、閉じて並べる。review-3 の指摘 2）。 */
const NPX_FLAGS = new Set(['--yes', '-y', '--no']);
/** 環境変数を読んで字を命令として動かしうる道具（EDITOR・GIT_EDITOR・PAGER・NODE_OPTIONS・PYTHONSTARTUP など）。代入だけの命令と並べない（review-3 の指摘 1）。 */
const ENV_READERS = new Set(['git', 'gh', 'pnpm', 'npx', 'python', 'python3', 'node']);
/** 命令の頭の、飛ばしてよい shell の語（`for … do x; done` の do・done など）。 */
const SHELL_WORDS = new Set(['{', '}', 'do', 'done', 'then', 'else', 'fi', '!']);
/** 頭の代入（FOO=1）。 */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** `${名}` のほかの形の展開（引用の中の字も当てる。止める側に倒れる）。 */
const EXPANSION_BEYOND_NAME = /\$\{(?![A-Za-z_][A-Za-z0-9_]*\})/;

/**
 * python・node の、命令を起こす呼び出しの字（案 B。t-y67q）。止める側を並べる表なので、並べていない API（言い換え・版で増える API）は通る。言語の版を上げる時に見直す。
 */
const RUN_CALLS = /subprocess|os\.system|os\.popen|os\.exec|os\.spawn|posix_spawn|\bexecv(?:e|p|pe)?\b|pty\.spawn|child_process|execSync|execFileSync|spawnSync|\bspawn\s*\(|\bexeca\b|\bexec\s*\(|\bsystem\s*\(|\bpopen\b/;
/** 字を読ませて動く道具の中で、命令の字に RUN_CALLS が無ければ通す言語。 */
const QUIET_LANGS = new Set(['python', 'python3', 'node']);

/** 略と読まない、ほかの旗の丸ごとの名（git diff の --text は --textconv の略でない）。 */
const EXACT_FLAGS = new Set(['--text']);

/**
 * 語が、長い旗のどれかか、その略（`--` の後ろ 1 字以上。getopt_long と git は、見分けがつけば 1 字の略も受ける。review-4 の指摘 2）か。`=` の後ろは値。
 * 止める側に倒れる（`--o` も当たる）が、表の道具の読む命令では困らない。
 */
function abbreviates(word: string, flags: string[]): boolean {
  const name = word.split('=')[0] ?? '';
  return name.length >= 3 && name.startsWith('--') && !EXACT_FLAGS.has(name) && flags.some(flag => flag.startsWith(name));
}

/** 単純な命令（書いたままの語）の、飛ばしてよい shell の語の後ろ。 */
function withoutShellWords(words: string[]): string[] {
  let k = 0;
  while (k < words.length && SHELL_WORDS.has(words[k] ?? '')) k += 1;
  return words.slice(k);
}

/** git の命令（書いたままの語）が、字を命令として動かさない形か。 */
function gitPasses(words: string[]): boolean {
  // 命令の名を探す前に、設定の旗を語の全体で見る（`git -c … --help` は命令の名が無く、help が設定の命令を動かす。review-4 の指摘 3）。
  const git = gitCommand(words);
  if (git === undefined) return false;
  // 設定の旗は命令の名より前だけ（命令の後ろの -c は git grep -c などの別の旗）。
  if (words.slice(1, words.length - git.args.length - 1).some(a => a === '-c' || abbreviates(a, GIT_CONFIG_FLAGS))) return false;
  if (git.args.some(a => abbreviates(a, GIT_RUN_FLAGS) || (git.name === 'grep' && /^-[A-Za-z]*O/.test(a)))) return false;
  return GIT_TEXT.has(git.name);
}

/**
 * pnpm・npx の命令（書いたままの語）の、旗でも旗の値でもない初めの語。その前に、並べた旗（allowed）のほかの旗があれば undefined（通さない）。
 * 旗の値（`--dir=x`）は、旗の名で見る。
 */
function firstOperand(args: string[], allowed: Set<string>, valued: Set<string>): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('-')) return arg;
    const name = arg.split('=')[0] ?? '';
    if (!allowed.has(name)) return undefined;
    if (valued.has(arg)) i += 1;
  }
  return undefined;
}

/** python・node の、script（字か file）の前に置いてよい旗。値を取る旗（-c・-e・-p）の後ろは script の字。node --run・-r・--import・python -m などは止める（review-4 の指摘 7）。 */
const LANG_FLAGS: Record<string, { plain: Set<string>, code: Set<string> }> = {
  python: { plain: new Set(['-u', '-B', '-I']), code: new Set(['-c']) },
  python3: { plain: new Set(['-u', '-B', '-I']), code: new Set(['-c']) },
  node: { plain: new Set(['--input-type=module', '--input-type=commonjs']), code: new Set(['-e', '--eval', '-p', '--print']) },
};

/** python・node の旗が、並べた形だけか（script の path か `-` か、字を渡す旗に着くまで）。 */
function quietLang(name: string, args: string[]): boolean {
  const flags = LANG_FLAGS[name];
  if (flags === undefined) return false;
  for (const arg of args) {
    if (arg === '-' || !arg.startsWith('-') || flags.code.has(arg)) return true;
    if (!flags.plain.has(arg)) return false;
  }
  return true;
}

/** uniq の、値を取る旗。 */
const UNIQ_VALUE_FLAGS = new Set(['-f', '-s']);

/**
 * redirect と tee のほかに、file を書く表の道具の形（`sort -o`・`uniq IN OUT`・git の `--output`）。設定を読む道具を外す条件に数える（review-3 の指摘 3）。
 */
function writesByFlag(raw: string[]): boolean {
  const [name, ...args] = withoutShellWords(raw);
  if (name === 'sort') return args.some(a => /^-[A-Za-z]*o/.test(a) || abbreviates(a, ['--output']));
  if (name === 'git') return args.some(a => abbreviates(a, ['--output']));
  if (name !== 'uniq') return false;
  const operands = args.filter((a, i) => !a.startsWith('-') && !UNIQ_VALUE_FLAGS.has(args[i - 1] ?? ''));
  return operands.length >= 2;
}

/**
 * 単純な命令（rawCommands の、書いたままの語）が、字の含みを効かせなくてよい道具か（t-y67q の案 B）。
 * 頭の代入（GIT_PAGER=… など、字を命令として読む変数かもしれない）・前置きの語（sudo・env・xargs など）・path の付いた名は当てない。
 * 代入だけの命令（S=/tmp/x）と `for x in …` は通す（中の命令は別の単純な命令として見る。代入だけの命令を環境を読む道具と並べる形は textStays が外す）。
 * 設定を読む道具（git・gh・pnpm・npx）は、同じ命令に log でない file への書き出しか python・node があれば外す（`.git/config`・package.json を書いて読ませる形）。
 */
function passesText(raw: string[], command: string, configWrites: boolean): boolean {
  const words = withoutShellWords(raw);
  if (words.length === 0 || words[0] === 'for') return true;
  if (words.every(w => ASSIGNMENT.test(w))) return true;
  const [name, ...args] = words;
  if (name === undefined || ASSIGNMENT.test(name) || name.includes('/')) return false;
  if (TEXT_TOOLS.has(name)) return !args.some(a => abbreviates(a, TEXT_FLAGS[name] ?? []));
  if (name === 'roster') return !(args[0] === 'infra' && args[1] === 'run');
  if (QUIET_LANGS.has(name)) return quietLang(name, args) && !RUN_CALLS.test(command);
  if (configWrites) return false;
  // gh も設定（~/.config/gh/config.yml の browser・editor・pager）と .git/config を読む（review-4 の指摘 4）。
  if (name === 'gh') return GH_TEXT.test(args.slice(0, 2).join(' '));
  if (name === 'git') return gitPasses(words);
  if (name === 'pnpm') return PNPM_TEXT.has(firstOperand(args, PNPM_FLAGS, PNPM_VALUE_FLAGS) ?? '');
  if (name === 'npx') return NPX_TEXT.has(firstOperand(args, NPX_FLAGS, new Set()) ?? '');
  return false;
}

/**
 * 設定にも code にもならない書き出しの先（log と字の出力）。これだけなら、設定を読む道具を外さない（`pnpm test > all.log`）。
 * 読む側（git・gh・pnpm・npx）の設定の file の名が決まっている（.git/config・package.json・config.yml など）ことに依る。道具を表に足す時に見直す（review-4 の指摘 10）。
 */
const OUTPUT_FILE = /\.(?:log|txt|out)$/;

/**
 * 字の含みを効かせなくてよい命令か（t-y67q の案 B）: どの単純な命令も passesText に当たり、引用しない here-document に置き換えが無い時。
 * 設定を読む道具（git・gh・pnpm・npx）は、同じ命令に、log でない file への書き出し（redirect・tee）か python・node があれば外す
 * （.git/config・.git/hooks・package.json を書いて読ませる形。python は書く先を読めない。review-2 の指摘 1）。
 */
function textStays(command: string): boolean {
  const { commands, writes, heredocRuns, marked } = scanCommand(command);
  if (heredocRuns) return false;
  // `$名`・`${名}` のほかの展開（`${名:=字}`・`${名::=字}`・`${(…)名}` など）は、変数を替えうるので、書き方を並べずに類で止める（review-5 の指摘 1）。
  // 見るのは命令の語だけ（here-document の本文は shell が展開しないか、引用しない本文なら字のまま書く先に入るだけ。python で書き替える code の `${a.b}` で止めない）。
  if (commands.some(words => words.some(word => EXPANSION_BEYOND_NAME.test(word)))) return false;
  // 命令の名の位置の置き換え（`$(…)echo`）は、出力が命令の語になる（review-4 の指摘 8）。
  if (marked.some(words => (withoutShellWords(words).find(w => !ASSIGNMENT.test(w)) ?? '').includes(SUBSTITUTED))) return false;
  const tees = commands.flatMap((raw) => {
    const [name, ...args] = withoutShellWords(raw);
    return name === 'tee' ? args.filter(a => !a.startsWith('-')) : [];
  });
  const names = commands.map(words => withoutShellWords(words)[0] ?? '');
  const lang = names.some(name => QUIET_LANGS.has(name));
  const configWrites = lang || commands.some(writesByFlag) || [...writes, ...tees].some(target => !OUTPUT_FILE.test(target));
  // 代入だけの命令（`GIT_EDITOR=…; git commit`）は、書き出し済みの変数なら子の process に渡る。PATH は、どの道具とも並べない（review-3 の指摘 1）。
  // for の変数と printf -v の名も、同じく変数を替える（review-4 の指摘 5）。
  const assigned = commands.flatMap((raw) => {
    const words = withoutShellWords(raw);
    if (words[0] === 'for') return words.slice(1, 2);
    if (words[0] === 'printf') return words.flatMap((w, i) => (w === '-v' ? [words[i + 1] ?? ''] : w.startsWith('-v') ? [w.slice(2)] : []));
    return words.length > 0 && words.every(w => ASSIGNMENT.test(w)) ? words.map(w => w.slice(0, w.indexOf('='))) : [];
  });
  // PATH は zsh の path（結び付いた配列）も（review-5 の指摘 2）。
  if (assigned.some(name => name.toUpperCase() === 'PATH') || (assigned.length > 0 && names.some(name => ENV_READERS.has(name)))) return false;
  return commands.every(words => passesText(words, command, configWrites));
}

/** 名を宣言する項目（`--name X`・`--name=X`・`-v X`）。X が環境の container か volume の名。 */
const DECLARES_NAME = /^(?:--name[ =]|-v )(\S+)$/;

/** 名の字（末尾の * は前方一致の印なので除いて比べる）。 */
const bareName = (name: string): string => name.replace(/\*$/, '');

/**
 * 環境の、名を書いた項目の動詞（t-9tac）。名は、名を宣言する項目（DECLARES_NAME）から引き、終わりの語がその名の項目
 * （`container stop callboard`・`container volume rm castlist-data*`）だけを「動詞＋名」と読む（`container stop`・`container volume rm`）。
 * 名を宣言しない環境（container-system）と、終わりの語が名でない項目（`container builder stop`・`container volume prune`）からは引かない
 * （引くと `container volume inspect $V` のような読むだけの命令まで止まる。review-1 の指摘 2）。
 */
function verbsOf(env: InfraEnv): string[] {
  const names = new Set(env.match.flatMap(m => DECLARES_NAME.exec(m.trim())?.[1] ?? []).map(bareName));
  return [...new Set(env.match.flatMap((m) => {
    const words = m.trim().split(/\s+/);
    const last = words.at(-1) ?? '';
    return words.length >= 3 && !(words[0] ?? '').startsWith('-') && names.has(bareName(last)) ? [words.slice(0, -1).join(' ')] : [];
  }))];
}

/** 語を道具の名として読んだ字（path と、置き換えの跡の印を除く。`/opt/homebrew/bin/container`・`container$(true)` は container）。 */
const toolName = (word: string): string => unmark(word).split('/').at(-1) ?? '';

/** 語から、置き換えの跡の印を除いた字（印を残した語の、命令の名・動詞・旗を読む所で使う）。 */
const unmark = (word: string): string => word.replaceAll(SUBSTITUTED, '');

/**
 * 単純な命令の語で、動詞に当たった所より後ろの語。当たらなければ undefined。
 * 動詞の語の間に挟まってよいのは旗とその値だけ（`container --debug stop`）。旗でない語が挟まる `container builder stop` は、
 * `container stop` の動詞に当てない（別の動詞）。
 */
function argsAfter(words: string[], verb: string): string[] | undefined {
  const [head, ...rest] = verb.split(' ');
  for (let i = 0; i < words.length; i += 1) {
    // 頭でない位置の path で書いた道具（`timeout 60 /opt/homebrew/bin/container …`）も、名で比べる（review-2 の指摘 4）。
    if (toolName(words[i] ?? '') !== head) continue;
    let j = i + 1;
    let k = 0;
    while (j < words.length && k < rest.length) {
      const word = unmark(words[j] ?? '');
      // 旗と、旗の直後の語（旗の値。`ssh -p 22 staging` の 22）は挟まってよい。旗でも値でもない語（`container exec x make clean` の exec）で切る。
      if (word === rest[k]) k += 1;
      else if (!word.startsWith('-') && !unmark(words[j - 1] ?? '').startsWith('-')) break;
      j += 1;
    }
    if (k === rest.length) return words.slice(j);
  }
  return undefined;
}

/** 字で書いた名（的として通す形）。 */
const WRITTEN_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** 値を取る旗（container の stop・kill の `-s KILL`・`-t 5`）。値の語は的に数えない。 */
const TARGET_VALUE_FLAGS = new Set(['-s', '--signal', '-t', '--time']);

/**
 * 動詞の後ろの引数が、名を書かずに的を選ぶ形か（t-9tac）。通す形を数える（killsByPattern と同じく、疑わしければ止める。review-1 の指摘 1）:
 * 的（旗と、値を取る旗の値を除いた語）が 1 つ以上あり、どれも字で書いた名（WRITTEN_NAME）で、`--all` が無い時だけ通す。
 * 的が無い（xargs で渡す・`-a` だけ）・置き換えの跡（SUBSTITUTED の印。語の途中の `x$(echo y)` も）・変数・glob・`{}`・`%` は当てる。help（`-h`・`--help`）は何も変えないので当てない。
 * `-a` は名を書いた的と並ぶ時は当てない（container start の `-a` は attach）。stop・rm などで名と `-a`・`--all` を一緒に渡すと、
 * container（1.7.1）が「explicitly supplied container ID(s) conflict with the --all flag」で断るので、害は無い（review-2 の指摘 3）。
 */
function unnamedTarget(args: string[]): boolean {
  const plain = args.map(unmark);
  if (plain.some(a => a === '-h' || a === '--help')) return false;
  if (plain.includes('--all')) return true;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = plain[i] ?? '';
    if (TARGET_VALUE_FLAGS.has(arg)) i += 1;
    else if (!arg.startsWith('-')) targets.push(args[i] ?? '');
  }
  return targets.length === 0 || !targets.every(t => WRITTEN_NAME.test(t));
}

/** container の命令の、名か volume を値に取る旗（normalizeFlags でそろえた後の形）。 */
const VALUE_FLAGS = new Set(['--name', '-v']);

/**
 * 値の分からない所: 変数（`$N`・`${N}`・`$1`・`$@`・裸の `$`）・命令の置き換えの跡（SUBSTITUTED）・glob の字（`*`・`?`）・
 * xargs と find の置き場の字と brace の展開（`{}`・`{a,b}`・`{1..3}`）・xargs -I の置き場によく使う `%`。
 */
const UNKNOWN = new RegExp(`\\$\\{[^}]*\\}|\\$[A-Za-z_][A-Za-z0-9_]*|\\$[0-9@*#?$!-]?|[*?%${SUBSTITUTED}]|\\{[^}]*\\}`);

/**
 * --mount の値（`type=volume,source=<>,target=<>`。key の順に依らない）の source（src）の値。
 * source が無く、値に値の分からない所があれば、値の分からない語（SUBSTITUTED。`--mount "$M"`・`--mount "type=volume,target=/data,$S"` の S が source を持つかもしれない。
 * 値そのものを返すと、値の途中の変数の前の字を項目の頭と比べて外れる。review-3 の指摘 2）。字で書いて source が無ければ undefined（tmpfs・名の無い volume。review-1 の指摘 3）。
 */
const mountSource = (spec: string): string | undefined =>
  spec.split(',').map(part => /^(?:source|src)=(.*)$/s.exec(part)?.[1]).find(source => source !== undefined)
  // 値の分からない所が、key= を持たない所（`$S`・`$M`。source を持つかもしれない）にある時だけ。ほかの key の値（`tmpfs-size=$SZ`）なら当てない（review-4 の指摘 6）。
  ?? (spec.split(',').some(part => !/^[\w-]+=/.test(part) && UNKNOWN.test(part)) ? SUBSTITUTED : undefined);

/**
 * container の命令の旗を、1 つの形にそろえる（t-ta2b。台帳 #300）。宣言の項目の語も同じ関数でそろえるので、項目は書き方ごとに並べなくてよい:
 * - 長い旗の = を、最初の 1 つで割る（`--name=x` → `--name x`。`--mount=type=volume,…` → `--mount type=volume,…`）。
 * - volume の長い旗を短い旗に（`--volume` → `-v`）。
 * - 短い旗を束ねた語（`-v`・`-dv`・`-vx`・`-v=x`・`-dvx`）に v があれば、getopt のように読む: v より前の字は旗のまま、
 *   v より後ろの字があれば -v の値（頭の = は除く）、無ければ次の語が値（`-dvx` → `-d -v x`）。
 * - --mount の source（src）を、volume の旗の値と読む（`--mount type=volume,source=x,target=/d` → `-v x`。mountSource が無ければ、そのまま）。
 * container の旗の読み方で通らない書き方もそろえる（止めても、通らない命令が止まるだけ）。
 * 置き換えの跡の印を残した語（splitCommandsMarked）も受ける: 旗の名の中の印は除き（`--name$(true)` は --name）、値の中の印は残す。
 */
export function normalizeFlags(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const long = new RegExp(`^(--[A-Za-z${SUBSTITUTED}][\\w${SUBSTITUTED}-]*)(?:=(.*))?$`, 's').exec(word);
    const short = long === null ? new RegExp(`^-([A-Za-uw-z${SUBSTITUTED}]*)v(.*)$`, 's').exec(word) : null;
    let flag = long === null ? word : unmark(long[1] ?? '');
    let value = long?.[2];
    if (short !== null) {
      if (unmark(short[1] ?? '') !== '') out.push(`-${unmark(short[1] ?? '')}`);
      flag = '-v';
      value = short[2] === '' ? undefined : (short[2] ?? '').replace(/^=/, '');
    }
    if (flag === '--volume') flag = '-v';
    if (flag === '--mount') {
      const spec = value ?? words[i + 1];
      // 値が無い（旗が語の終わり。`… | xargs container run --mount`）時は、値の無い -v にする（-v・--name の値の無い形と同じく当てる。review-2 の指摘 3）。
      if (spec === undefined) {
        out.push('-v');
        continue;
      }
      const source = mountSource(spec);
      if (value === undefined) i += 1;
      out.push(...(source !== undefined ? ['-v', source] : [flag, spec]));
      continue;
    }
    out.push(flag, ...(value === undefined ? [] : [value]));
  }
  return out;
}

/**
 * 単純な命令が container の命令（どこかの語の名が container。`timeout 60 /opt/homebrew/bin/container …` も）なら、その語より後ろの旗をそろえた語。違えば undefined。
 * `--` より後ろと、`container exec`（名と volume の旗を持たない。後ろは container の中で動かす命令の語）の後ろはそろえない
 * （`container exec x tar -xzv castlist-data-v1.tgz` の -xzv を -v と読まない。review-1 の指摘 9）。
 */
function containerWords(words: string[]): string[] | undefined {
  const at = words.findIndex(word => toolName(word) === 'container');
  if (at === -1) return undefined;
  const rest = words.slice(at + 1);
  const plain = rest.map(unmark);
  if (plain.find(word => !word.startsWith('-')) === 'exec') return [...words.slice(0, at), 'container', ...rest];
  const end = plain.includes('--') ? plain.indexOf('--') : rest.length;
  // 名の語も、path と置き換えの跡を除いた名にする（`timeout 60 container$(true) stop x` を項目の `container stop x` に当てる。review-2 の指摘 2）。
  return [...words.slice(0, at), 'container', ...normalizeFlags(rest.slice(0, end)), ...rest.slice(end)];
}

/**
 * 命令の字を、粗く区切りに分けて語に割る（字の含みの当たりで、here-document・`ssh host '…'` の中の container の命令の旗を読むため）。
 * 区切りは `;`・`&`・`|`・`(`・`)`・改行で分ける（行全体を 1 つの命令と読むと、`container logs x | grep -v "$X"` の grep の旗まで container の旗と読む。
 * 前に exec か `--` のある container の命令があると、後ろの区切りの container の命令をそろえ損ねる。review-2 の指摘 1）。
 */
const textSegments = (command: string): string[][] =>
  // \ と改行で続けた行は、1 つの命令に戻してから分ける（here-document・ssh の中の長い命令。review-3 の指摘 3）。
  command.replace(/\\\n/g, ' ').split(/[;&|()\n]+/).map(segment => segment.split(/[\s'"`<>\\]+/).filter(word => word !== '')).filter(words => words.length > 0);

/** いつも絶対の path に広がる変数（`-v "$PWD:/w"` は bind で、volume の名ではない）。 */
const PATH_NAMES = ['HOME', 'PWD', 'OLDPWD', 'TMPDIR'];

/**
 * 命令の字の中で、絶対の path と読んでよい変数を `/` に替える関数。名が `$` の後ろ以外に出る変数（`HOME=x`・`export HOME`・`read HOME`・`for HOME in`）は、
 * 同じ行で値を替えうるので、path と読まない（値の分からない所のまま。同じ行の代入を読まない決めと揃える。review-1 の指摘 4）。
 * 替えるのは、後ろが `/`・`:`・語の終わりの時だけ（`$OLDPWD`・`$TMPDIR` は空のことがあり、`${TMPDIR}castlist-data-v1` は空なら volume の名になる。
 * 後ろが `/`・`:`・終わりなら、空でも volume の名にならない。review-2 の指摘 4）。
 */
function pathReader(command: string): (word: string) => string {
  const names = PATH_NAMES.filter(name => !new RegExp(`(?<![\\w\${])${name}(?!\\w)`).test(command));
  if (names.length === 0) return word => word;
  const variables = new RegExp(`\\$(?:\\{(?:${names.join('|')})\\}|(?:${names.join('|')})(?!\\w))(?=[/:]|$)`, 'g');
  return word => word.replace(variables, '/');
}

/**
 * 旗の値の語が値の分からない所（UNKNOWN）を持ち、その所を何でも当たるとみなすと、項目の値（`castlist.box`・`castlist-data*`）に当たるか。
 * 字で書いた所は読む。値の分からない所が無い語は false（今までの当て方に任せる）。比べ方:
 * - 末尾 * の項目（前方一致）: 語の初めの値の分からない所より前の字を p、項目の * の前の字を q として、p が q で始まるか、q が p で始まれば当たる
 *   （`cast"$X":/data`・`"$V":/data` は castlist-data* に当たる）。
 * - * の無い項目: 語の値の分からない所を `.*` にした型を、項目の字に丸ごと当てる（`"${N}.box"` は castlist.box に当たり、`test-$N`・`"$N"x` は当たらない）。
 */
function unknownValueHits(pattern: string, word: string): boolean {
  const literals = word.split(UNKNOWN);
  if (literals.length === 1) return false;
  if (pattern.endsWith('*')) {
    const prefix = bareName(pattern);
    const head = literals[0] ?? '';
    return head.startsWith(prefix) || prefix.startsWith(head);
  }
  return new RegExp(`^${literals.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's').test(pattern);
}

/** container の、読むだけの動詞（環境を変えない。担当が状態を見る手）。 */
const READ_VERBS = new Set(['logs', 'inspect', 'stats', 'list', 'ls']);
/** volume の群の、読むだけの動詞。 */
const VOLUME_READ_VERBS = new Set(['inspect', 'list', 'ls']);
/** volume の群の名（`container volume …`・略の `container v …`）。 */
const VOLUME_GROUPS = new Set(['volume', 'v']);
/** container を的に取る、知っている動詞（1.7.1 の help から）。的は container の名とだけ比べる。知らない動詞は container と volume の名の両方と比べる。 */
const CONTAINER_VERBS = new Set(['exec', 'cp', 'copy', 'commit', 'export', 'clean', 'start', 'stop', 'kill', 'delete', 'rm', 'prune']);
/**
 * 名の container を的にしない動詞と群（略の i・r・m・n・s も）。run・create は、名と volume を `--name`・`-v` の項目が当て、image より後ろは container の中の命令の語。
 * image・network・system などは、環境の container・volume を名で的にしない（system stop・prune は container-system の宣言が当てる）。
 */
const NOT_TARGETING = new Set(['run', 'create', 'image', 'i', 'registry', 'r', 'machine', 'm', 'network', 'n', 'system', 's', 'cluster', 'build', 'builder', 'help']);
/** 値を取る旗（値の語を的に数えない）。知らない旗は値を取らないと読む（値の語も的に数え、止める側に倒れる）。 */
const VERB_VALUE_FLAGS = new Set([...TARGET_VALUE_FLAGS, '-o', '--output']);

/** 宣言に無い動詞の命令の的。names は的と比べる名の種類、unnamed は名を書かずに選ぶ（的の語が無い・`--all`）か。 */
interface VerbTargets {
  names: ('container' | 'volume')[]
  targets: string[]
  unnamed: boolean
}

/**
 * exec の的の候補（argsAfter と同じ読み方。review-1 の指摘 2）: 旗と、旗の直後の語（値かもしれない）を読み進め、旗の直後でない初めの語までを候補にする。
 * 値を取る旗を数えないので、束ねた短い旗の値（`-iu root castlist.box`）でも的を見落とさない。後ろは container の中の命令なので見ない。`--` の後ろは初めの語。
 */
function execTargets(args: string[]): { targets: string[], help: boolean } {
  const plain = args.map(unmark);
  const targets: string[] = [];
  let help = false;
  for (let k = 0; k < args.length; k += 1) {
    const arg = plain[k] ?? '';
    if (arg === '--') return { targets: [...targets, ...args.slice(k + 1, k + 2)], help };
    // help は exec 自身の旗（候補を読み終える前）だけで見る。後ろの -h・--help は container の中の命令の旗（review-2 の指摘 2）。
    if (arg === '-h' || arg === '--help') help = true;
    if (arg.startsWith('-')) continue;
    targets.push(args[k] ?? '');
    if (!(plain[k - 1] ?? '').startsWith('-')) break;
  }
  return { targets, help };
}

/**
 * container の命令（containerWords の後の語）の、環境を変えうる動詞の的（t-d37r）。動詞が無い・読むだけの動詞・名の container を的にしない動詞・help なら undefined。
 * 宣言にある動詞（stop・rm など）も除かない（`ssh host 'container stop -t 5 x'` の区切りの中は、宣言の項目が語で当たらない。review-1 の指摘 1）。
 * 的: exec は execTargets、cp・copy は `:` を含む語の `:` より前（`:` の無い語は手元の path。値の分からない語は container:path かもしれないので、語ごと）、
 * ほかは旗とその値を除いたどの語も（`--` の後ろはみな的）。volume の群は、その次の語を動詞として読み、的は volume の名。
 */
function verbTargets(words: string[]): VerbTargets | undefined {
  const at = words.findIndex(word => toolName(word) === 'container');
  let i = at + 1;
  const nextVerb = (): string | undefined => {
    while (i < words.length && unmark(words[i] ?? '').startsWith('-')) i += 1;
    i += 1;
    return words[i - 1] === undefined ? undefined : unmark(words[i - 1] ?? '');
  };
  const verb = nextVerb();
  if (verb === undefined || NOT_TARGETING.has(verb) || READ_VERBS.has(verb)) return undefined;
  const volume = VOLUME_GROUPS.has(verb);
  if (volume) {
    const sub = nextVerb();
    if (sub === undefined || VOLUME_READ_VERBS.has(sub)) return undefined;
  }
  const args = words.slice(i);
  const plain = args.map(unmark);
  const names: VerbTargets['names'] = volume ? ['volume'] : CONTAINER_VERBS.has(verb) ? ['container'] : ['container', 'volume'];
  if (verb === 'exec') {
    const { targets, help } = execTargets(args);
    return help ? undefined : { names, targets, unnamed: targets.length === 0 };
  }
  if (plain.some(a => a === '-h' || a === '--help')) return undefined;
  const operands: string[] = [];
  for (let k = 0; k < args.length; k += 1) {
    const arg = plain[k] ?? '';
    if (arg === '--') {
      operands.push(...args.slice(k + 1));
      break;
    }
    if (arg.startsWith('-')) {
      if (VERB_VALUE_FLAGS.has(arg)) k += 1;
      continue;
    }
    operands.push(args[k] ?? '');
  }
  // 的の語が無いのを「名を書かずに選ぶ」と読むのは、的を取ると分かっている動詞だけ。知らない動詞は、container の語を引数に持つ検索
  // （`git grep -n container -- docs`・`find . -name container`。container の後ろの語を動詞と読む）と見分けられないので、的の語が無ければ当てない（review-2 の指摘 1）。
  const unnamed = ((volume || CONTAINER_VERBS.has(verb)) && operands.length === 0) || plain.includes('--all');
  if (verb === 'cp' || verb === 'copy') {
    return { names, targets: operands.flatMap(o => o.includes(':') ? [o.slice(0, o.indexOf(':'))] : UNKNOWN.test(o) ? [o] : []), unnamed };
  }
  return { names, targets: operands, unnamed };
}

/** 命令が環境に触る当たり方: 名を書いた項目に当たる（named）か、名を書かずに的を選ぶ（unnamed）か、名や volume を変数で渡す（variable）か、宣言に無い動詞で名を的にする（verb）か。 */
type Touch = 'named' | 'unnamed' | 'variable' | 'verb';

/**
 * 命令が触る環境。命令を単純な命令に分け、match の項目が命令の語に当たれば触る（hitsWords）。container の命令の語と項目の語は、旗をそろえてから比べる（normalizeFlags）。
 * 語で当たらなくても、命令の字全体に match の字（* を除く）が含まれるか、字を粗く区切りに分けて割った語の container の命令の旗が、頭が旗の項目に当たれば、今までどおり触るとみなす。
 * ただし、字が命令として動きうる形でない時（textStays。どの単純な命令も通す道具の表か、呼び出しの無い python・node。t-y67q）は、字の含みでは当てない。
 * 名を書いた項目の動詞に当たり、名を書かずに的を選ぶ命令（`container stop --all`・`container rm $(…)`・`xargs container rm`）も、
 * その環境に触るとみなす（unnamedTarget。どの環境の名にも当たらないので、前は通っていた）。
 * container の命令の --name・-v の値を変数・置き換えで渡し、値の分からない所を何でも当たるとみなすと項目に当たる命令も、触るとみなす（unknownValueHits。t-ta2b）。
 */
export function touched(command: string, infra: Record<string, InfraEnv>): string[] {
  return Object.entries(infra).filter(([, env]) => touchOf(command, env) !== undefined).map(([name]) => name);
}

/**
 * 名と volume の旗の、字の含みで見る書き方。前に設定へ並べていた項目（`--name=X`・`--volume X`）と同じ字だけにする（`-v=`・`--volume=` まで広げると、
 * 前は通っていた PR の本文の `--volume=…` が止まる）。
 */
const FLAG_SPELLINGS: Record<string, string[]> = { '--name': ['--name ', '--name='], '-v': ['-v ', '--volume '] };

/**
 * 字の含みで見る、項目の字（* を除く）。名と volume の旗の項目（`--name X`・`-v X`）は、同じ当たりになる書き方の字も見る（t-d37r）。
 * container の語の無い包み（`./up.sh --name=X`）は旗をそろえて読めないので、前は `--name=X`・`--volume X` の項目を並べて当てていた。
 */
function spellings(match: string, item: string[]): string[] {
  const [flag, value, ...rest] = item;
  const texts = flag === undefined || value === undefined || rest.length > 0 ? [] : (FLAG_SPELLINGS[flag] ?? []).map(prefix => `${prefix}${value}`);
  return [match, ...texts].map(text => text.replaceAll('*', ''));
}

/** 命令が環境に触る当たり方。触らなければ undefined。 */
function touchOf(command: string, env: InfraEnv): Touch | undefined {
  const commands = splitCommands(command).map(words => containerWords(words) ?? words);
  // 置き換えの跡の印を残した語は、値の分からない語を見分ける所（名を書かない的と、名と volume の旗の値）だけで使う（review-3 の指摘 1）。
  const markedRaw = splitCommandsMarked(command);
  const markedContainers = markedRaw.map(containerWords);
  const marked = markedContainers.map((words, i) => words ?? markedRaw[i] ?? []);
  const raws = rawCommands(command);
  const textOnly = textStays(command);
  const segments = textOnly || (raws.every(quietForSegments) && !runsInHeredoc(command)) ? [] : textSegments(command).map(containerWords).filter((words): words is string[] => words !== undefined);
  // 変数の値で当てるのは、container の命令（と字を粗く割った区切りの container の命令）の旗の値だけ（`grep -v "$X"` には当てない）。
  const containers = [...markedContainers.filter((words): words is string[] => words !== undefined), ...segments];
  const items = env.match.map(match => normalizeFlags(match.trim().split(/\s+/)));
  const flagItem = (item: string[]): boolean => (item[0] ?? '').startsWith('-');
  // 名を宣言しない環境（container-system）の、頭が旗でない項目は、語が命令の中に続けて並ぶ時だけ語で当てる（間は旗だけ）。
  // 間に何が挟まってもよい hitsWords では、`container exec x make clean` が `container clean` に当たる（review-2 の指摘 1）。
  const verbs = verbsOf(env);
  const wordHit = (words: string[], item: string[]): boolean =>
    verbs.length === 0 && !flagItem(item) ? argsAfter(words, item.join(' ')) !== undefined : hitsWords(words, item.join(' '));
  const hits = (match: string, k: number): boolean => {
    const item = items[k] ?? [];
    return commands.some(words => wordHit(words, item))
      || (!textOnly && spellings(match, item).some(text => command.includes(text)))
      || (flagItem(item) && segments.some(words => hitsWords(words, item.join(' '))));
  };
  if (env.match.some(hits)) return 'named';
  const unnamed = (verb: string): boolean => marked.some((words) => {
    const args = argsAfter(words, verb);
    return args !== undefined && unnamedTarget(args);
  });
  if (verbs.some(unnamed)) return 'unnamed';
  const readPaths = pathReader(command);
  // 宣言に無い動詞（exec・cp・commit・export・知らない動詞）で、名を宣言した container か volume を的にする命令（t-d37r）。読むだけの動詞は verbTargets が外す。
  const declared = (flag: string): string[] => items.flatMap(item => item.length === 2 && item[0] === flag ? [item[1] ?? ''] : []);
  const names = { container: declared('--name'), volume: declared('-v') };
  // 字を粗く割った区切り（`ssh host '…'` の中）は、字で書いた名だけを当てる（区切りは `$(…)` の中を割るので、`roster ask tpm "container stop $(…)"` の跡を的と読まない。
  // 名を書かずに選ぶ形を単純な命令だけで見る t-9tac と同じ）。
  // 字を動かさない単純な命令（grep・rg・git commit・cat・echo・printf・roster など）は、container の語を引数に持っても container の命令と読まない（review-2 の指摘 1）。
  const parsed = markedContainers.flatMap((words, i) => words === undefined || quietForSegments((markedRaw[i] ?? []).map(unmark)) ? [] : [{ words, coarse: false }]);
  for (const { words, coarse } of [...parsed, ...segments.map(words => ({ words, coarse: true }))]) {
    const verb = verbTargets(words);
    const own = verb === undefined ? [] : verb.names.flatMap(kind => names[kind]);
    if (verb === undefined || own.length === 0) continue;
    if (own.some(name => verb.targets.some(target => wordHits(name, unmark(target))))) return 'verb';
    if (!coarse && (verb.unnamed || own.some(name => verb.targets.some(target => unknownValueHits(name, readPaths(target)))))) return 'unnamed';
  }
  // 旗が語の終わりにあり値が無い（`… | xargs container run -d --name`。値は後ろから足される）時も、値の分からない語とみなす（review-1 の指摘 2）。
  const variable = ([flag, value, ...rest]: string[]): boolean =>
    flag !== undefined && value !== undefined && rest.length === 0 && VALUE_FLAGS.has(flag)
    && containers.some(words => words.some((word, i) => word === flag && unknownValueHits(value, readPaths(words[i + 1] ?? SUBSTITUTED))));
  return items.some(variable) ? 'variable' : undefined;
}

/** 環境 1 つについて、この担当が今、変えてよいか。 */
export function judgeEnv(name: string, env: InfraEnv, role: RoleName | undefined, approval: Approval | undefined, now: Date): Verdict {
  if (env.guard === 'free') return { allow: true };
  if (env.guard === 'pm-only') {
    return { allow: false, reason: `環境 ${envLabel(name, env)} の手は Product Manager だけのものです（どの担当も、承認があっても打てない）。Product Manager が自分の terminal で直に打ちます。打ってほしい 1 行と訳を確認のページに書き（roster page put）、roster ask pm で送ってください。` };
  }
  if (role !== INFRA_ROLE) {
    return { allow: false, reason: `環境 ${envLabel(name, env)} を変えてよいのは DevOps Engineer 担当だけです。roster ask devops --what … --why … で TPM 担当に頼んでください。` };
  }
  if (env.guard === 'tpm') return { allow: true };
  if (approval !== undefined && now.getTime() < Date.parse(approval.until)) return { allow: true };
  const expired = approval === undefined ? '' : `（承認は ${approval.until} で切れた）`;
  return {
    allow: false,
    reason: `環境 ${envLabel(name, env)} は、ほかの人と共有です。変えるには Product Manager の承認が要ります${expired}。何を・なぜ・何が止まるかを確認のページに書き（roster page put）、roster ask pm で送ってください。承認されたら TPM 担当が roster infra approve ${name} で承認を書きます。`,
  };
}

/** 名を書かずに的を選ぶ命令を止めた時に、訳に添える字。 */
const UNNAMED_HINT = '（名を書かずに的を選ぶ命令（--all・-a・$(…)・xargs・変数・glob）は、その動詞を持つ環境にみな当たるとみなします。自分の container は、container ls で名を見て、名を書いて打ってください）';

/** 名や volume を変数で渡す命令を止めた時に、訳に添える字。 */
const VARIABLE_HINT = '（container の命令の --name・-v・--volume・--mount の値を、変数・$(…)・glob で渡す命令は、値の分からない所を何でも当たるとみなします（同じ行の代入と環境変数は読まない）。名を字で書いて打ってください）';

/** 宣言に無い動詞で名を的にする命令を止めた時に、訳に添える字。 */
const VERB_HINT = '（環境の container・volume の名を的にする container の命令は、宣言に無い動詞（exec・cp・commit・export など）でも止めます。状態を見るだけなら、読むだけの logs・inspect・stats・ls（volume は inspect・ls）は通します）';

/** 止めた訳に添える字（当たり方ごと）。 */
const HINTS: Record<Touch, string> = { named: '', unnamed: UNNAMED_HINT, variable: VARIABLE_HINT, verb: VERB_HINT };

/** 命令を通すか。環境の手続きを先に見て、次に道具の直打ちを見る。 */
export function judge(asked: Asked): Verdict {
  for (const name of touched(asked.command, asked.config.infra)) {
    const env = asked.config.infra[name];
    if (env === undefined) continue;
    const verdict = judgeEnv(name, env, asked.role, asked.approvals[name], asked.now);
    if (!verdict.allow) return { allow: false, reason: `${verdict.reason}${HINTS[touchOf(asked.command, env) ?? 'named']}` };
  }
  const commands = splitCommands(asked.command);
  if (commands.some(words => AUDIT_START.test(words.join(' ')))) {
    return { allow: false, reason: 'Audit の席を起こすのは Product Manager です。roster audit start は、Product Manager が自分の手で打ちます（Auditor は TPM 担当の回し方も見るので、TPM 担当と担当は起こさない）。' };
  }
  // kill の的は、印の残った語で読む（`kill 1$(pgrep -f x)` の的を pid 1 と読まない。review-4 の指摘 4）。訳に出す字は、印を除く。
  const killer = splitCommandsMarked(asked.command).find(killsByPattern)?.map(word => word.replaceAll(SUBSTITUTED, ''));
  if (killer !== undefined) {
    return { allow: false, reason: `pattern で選んで process に合図を送る命令は止めます（${killer.filter(w => w !== '').slice(0, 3).join(' ')}）。思わぬ process に届くため（macOS の pkill は後ろの旗も pattern に読み、2026-11-23 の朝（JST）に担当の session ごと 29 個を止めた）。pgrep -fl '<型>' で pid と command line を見て、当たった数を確かめてから、その数字を kill <pid> に書いてください（pgrep の出力を変数や $(…) で kill に渡すと、見る手が抜けます）。` };
  }
  // (7) Chrome の直起こし（guard-chrome.ts。ROSTER_RAW=1 でも外れない）。
  const chrome = chromeLaunch(asked.command);
  if (chrome !== undefined) return { allow: false, reason: chromeReason(chrome) };
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
      return { allow: false, reason: `ページと file を消せるのは TPM 担当だけです。消すページや file の URL と訳を、roster ask tpm で TPM 担当に送って頼んでください。roster 自身の開発や試しで直に打つなら、命令の頭に ${RAW} を付けてください。` };
    }
    for (const [pattern, instead] of DIRECT) {
      // どの設定も課題管理に GitHub の Issue を使わない project では、gh issue は課題管理の道具ではない。
      if (pattern.source.startsWith('^gh issue') && asked.config.trackers.github.length === 0) continue;
      if (heads.some(h => pattern.test(h))) {
        return { allow: false, reason: `道具を直に打つと、記録と状態が抜けます。代わりに: ${instead}。roster 自身の開発や試しで直に打つなら、命令の頭に ${RAW} を付けてください。` };
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

/** 環境の承認を書く（`roster infra approve`）。 */
export function writeApproval(state: State, name: string, approval: Approval): void {
  state.write(approvalFile(name), approval);
}

/** 環境の承認を消す（`roster infra revoke`）。 */
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
 * 担当の claude に渡す settings（--settings）。道具の前に roster guard を呼ぶ hook。hook の命令は shell が読むので、path を引用する。
 * 見る道具は Bash。読むだけの担当の席だけ、file を書き替える道具（WRITE_TOOLS）も見る（ほかの担当では、書くたびに hook を動かさない）。
 * どの席にも、session の始まりと終わりに castlist に送る hook（roster castlist session-start・session-end）を付ける。castlist を設定していなければ、その命令は何もしない。
 * Auditor の席には、session の始まりに roster audit fresh を呼ぶ hook も付ける。
 * どの席にも、メッセージを NATS で渡す hook（roster mail …）を、その後ろに付ける:
 * 名乗る・外す（SessionStart・SessionEnd）、検査が止めた後に渡す（Bash を使い終えた後。PostToolUse と PostToolUseFailure の両方）、人の入力の時に渡す（UserPromptSubmit）、
 * 手を止めている間に待つ（Stop と SessionStart。背景で動き、exit 2 で session を起こす）。
 * 前の版が付けた、届け違いを見る hook（roster returned check）は付けない（命令は、前の版が起こした席のために残してある。何もしない）。
 * TPM 担当の席（role を渡さない呼び出し。担当の席は run-role.ts が role を渡す）にだけ、手を止める時に返事の言葉を数える hook（roster reply-language check）を、待つ hook の後ろに付ける（t-jen6）。
 * `|| true` を付けるのは、cli/bin/roster が node を起こせない時に exit 2 で終わり、待たせる Stop の hook では「止める」と読まれて手を止めるたびに続けさせるため（review-6 の指摘 4）。
 */
export function guardSettings(tpmBin: string, role?: RoleName): string {
  const hook = (command: string) => ({ type: 'command', command: `${shellQuote(tpmBin)} ${command}` });
  // 待つ命令: 背景で動かし（async）、exit 2 で終わった時に stderr の字で session を起こさせる（asyncRewake）。待つのは長くて 1 日。
  const waiting = { type: 'command', async: true, asyncRewake: true, timeout: 86400, command: `${shellQuote(tpmBin)} mail wait` };
  const matcher = readOnly(role) === undefined ? 'Bash' : ['Bash', ...WRITE_TOOLS].join('|');
  return JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher, hooks: [hook('guard')] }],
      // Auditor の席は、席を起こした時と /clear の時に印を書く（前の監査の文脈が残ったまま、次の監査を始めないため）。
      SessionStart: [{ hooks: [...(role === AUDIT_ROLE ? [hook('audit fresh')] : []), hook('castlist session-start'), hook('mail claim'), waiting] }],
      SessionEnd: [{ hooks: [hook('castlist session-end'), hook('mail release')] }],
      // Bash を使い終えた後（成功の後・失敗の後の両方）。結果を pipe で切る（… | tail -1）と、検査が止めても命令は「成功」になるため。
      PostToolUse: [{ matcher: 'Bash', hooks: [hook('mail gate')] }],
      PostToolUseFailure: [{ matcher: 'Bash', hooks: [hook('mail gate')] }],
      Stop: [{ hooks: role === undefined ? [waiting, hook('reply-language check || true')] : [waiting] }],
      UserPromptSubmit: [{ hooks: [hook('mail prompt')] }],
    },
  });
}
