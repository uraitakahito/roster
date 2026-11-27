// guard: 担当が使う道具を、実行の前に見て、通すか止めるかを決める（Claude Code の PreToolUse hook から呼ばれる）。
// 止めるのは 6 つ。(1) project の設定（infra。直下の folder の設定の宣言も合わせる）に書いた環境に触る命令で、手続きを踏んでいない物。
// (2) 連携と課題管理の道具の直打ち（roster を通さないと、記録と状態が抜ける）。
// (3) 担当が置き場のページと file を消す命令: 消す要求を直に送る curl と、置き場の CLI（pagetray）の消す命令
//     （消してよいのは TPM 担当だけ。roster page delete・roster file delete も担当からは止まる）。
// (4) 読むだけの担当（Auditor・Staff Engineer 担当）が repo・設定・記録を変えること: project の folder・状態の folder・ページの控えの下への書き込み（Edit・Write・NotebookEdit）と、
//     git・gh の変える命令（どちらも見て勧めるだけで、直さない）。
// (5) Audit の席を起こす命令（roster audit start。起こすのは Product Manager）。
// (6) pattern で選んだ process に合図を送る命令（pkill・killall と、pid を名指さない kill。どの席からも。台帳 #89・#92）。
// (1) は、命令を単純な命令に分けて match の語で当て、語で当たらなくても命令の字全体に match の字が含まれれば止める（共有の環境は、疑わしければ止める）。
//     字の含みだけの当たりを通すのは、命令がみな引数の字を命令として動かさない物（roster・git commit・grep・rg）で、書き出しも無い時だけ（touched）。
// (2)〜(6) の shell の命令は、単純な命令に分け、その頭（実際に打つ道具の命令）だけを見る。commit の文・grep の型・here-document に道具の名が入っても止めない。
// どれも字で見るので、防げるのは「うっかり」まで。script に包んだ命令や、shell の redirect での書き込みはすり抜ける。確実な守りは、担当に渡す権限の方で行う。
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { envLabel, type InfraEnv, type RolesConfig } from './config.ts';
import type { RoleName } from './protocol.ts';
import { rawCommands, shellQuote, shownWord, splitCommands, SUBSTITUTED } from './shell.ts';
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

/** 命令の頭にこれを書くと、道具の直打ちを通す（roster 自身の開発と試しのため。環境の手続きと、読むだけの担当の守りと、Audit の席を起こす命令と、pattern で process に合図を送る命令には効かない）。 */
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
 * 字の含みだけで match に当たる命令を通してよいのは、どの単純な命令もこれに当たる時（#253 の roster file put … --name callboard-x.png など）。
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
 * file への書き出し（fd への写し `2>&1`・`>&2`・`>&-` と `/dev/null` を除く。`>& file`・`&> file` は書き出し）・here-document・here-string・
 * process substitution・命令の置き換え（`$(…)` と backtick。中の命令は rawCommands でも整えた形で入るので、頭の代入や path を見られない）。
 * 引用の中の字でも当てる（止める方に倒す）。
 */
function feedsOrWrites(command: string): boolean {
  const rest = command.replace(/\d*>&(\d+|-)/g, '').replace(/\d*>>?\s*\/dev\/null/g, '');
  return rest.includes('>') || rest.includes('<<') || rest.includes('<(') || rest.includes('$(') || rest.includes('`');
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

/**
 * 単純な命令の語で、動詞に当たった所より後ろの語。当たらなければ undefined。
 * 動詞の語の間に挟まってよいのは旗とその値だけ（`container --debug stop`）。旗でない語が挟まる `container builder stop` は、
 * `container stop` の動詞に当てない（別の動詞）。
 */
function argsAfter(words: string[], verb: string): string[] | undefined {
  const [head, ...rest] = verb.split(' ');
  for (let i = 0; i < words.length; i += 1) {
    // 頭でない位置の path で書いた道具（`timeout 60 /opt/homebrew/bin/container …`）も、名で比べる（review-2 の指摘 4）。
    if ((words[i] ?? '').split('/').at(-1) !== head) continue;
    let j = i + 1;
    let k = 0;
    while (j < words.length && k < rest.length) {
      const word = words[j] ?? '';
      // 旗と、旗の直後の語（旗の値。`ssh -p 22 staging` の 22）は挟まってよい。旗でも値でもない語（`container exec x make clean` の exec）で切る。
      if (word === rest[k]) k += 1;
      else if (!word.startsWith('-') && !(words[j - 1] ?? '').startsWith('-')) break;
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
  if (args.some(a => a === '-h' || a === '--help')) return false;
  if (args.includes('--all')) return true;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (TARGET_VALUE_FLAGS.has(arg)) i += 1;
    else if (!arg.startsWith('-')) targets.push(arg);
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
 * source が無く、値に値の分からない所があれば値そのもの（`--mount "$M"`）。字で書いて source が無ければ undefined（tmpfs・名の無い volume。review-1 の指摘 3）。
 */
const mountSource = (spec: string): string | undefined =>
  spec.split(',').map(part => /^(?:source|src)=(.*)$/s.exec(part)?.[1]).find(source => source !== undefined) ?? (UNKNOWN.test(spec) ? spec : undefined);

/**
 * container の命令の旗を、1 つの形にそろえる（t-ta2b。台帳 #300）。宣言の項目の語も同じ関数でそろえるので、項目は書き方ごとに並べなくてよい:
 * - 長い旗の = を、最初の 1 つで割る（`--name=x` → `--name x`。`--mount=type=volume,…` → `--mount type=volume,…`）。
 * - volume の長い旗を短い旗に（`--volume` → `-v`）。
 * - 短い旗を束ねた語（`-v`・`-dv`・`-vx`・`-v=x`・`-dvx`）に v があれば、getopt のように読む: v より前の字は旗のまま、
 *   v より後ろの字があれば -v の値（頭の = は除く）、無ければ次の語が値（`-dvx` → `-d -v x`）。
 * - --mount の source（src）を、volume の旗の値と読む（`--mount type=volume,source=x,target=/d` → `-v x`。mountSource が無ければ、そのまま）。
 * container の旗の読み方で通らない書き方もそろえる（止めても、通らない命令が止まるだけ）。
 */
export function normalizeFlags(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const long = /^(--[A-Za-z][\w-]*)=(.*)$/s.exec(word);
    const short = long === null ? /^-([A-Za-uw-z]*)v(.*)$/s.exec(word) : null;
    let flag = long?.[1] ?? word;
    let value = long?.[2];
    if (short !== null) {
      if (short[1] !== '') out.push(`-${short[1] ?? ''}`);
      flag = '-v';
      value = short[2] === '' ? undefined : (short[2] ?? '').replace(/^=/, '');
    }
    if (flag === '--volume') flag = '-v';
    if (flag === '--mount') {
      const spec = value ?? words[i + 1];
      const source = spec === undefined ? undefined : mountSource(spec);
      if (value === undefined && spec !== undefined) i += 1;
      out.push(...(source !== undefined ? ['-v', source] : [flag, ...(spec === undefined ? [] : [spec])]));
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
  const at = words.findIndex(word => word.split('/').at(-1) === 'container');
  if (at === -1) return undefined;
  const rest = words.slice(at + 1);
  if (rest.find(word => !word.startsWith('-')) === 'exec') return words;
  const end = rest.includes('--') ? rest.indexOf('--') : rest.length;
  return [...words.slice(0, at + 1), ...normalizeFlags(rest.slice(0, end)), ...rest.slice(end)];
}

/** 命令の字を、粗く語に割る（字の含みの当たりで、here-document・`ssh host '…'` の中の container の命令の旗を読むため）。 */
const textWords = (command: string): string[] => command.split(/[\s'"`;&|()<>\\]+/).filter(word => word !== '');

/** いつも絶対の path に広がる変数（`-v "$PWD:/w"` は bind で、volume の名ではない）。 */
const PATH_NAMES = ['HOME', 'PWD', 'OLDPWD', 'TMPDIR'];

/**
 * 命令の字の中で、絶対の path と読んでよい変数を `/` に替える関数。名が `$` の後ろ以外に出る変数（`HOME=x`・`export HOME`・`read HOME`・`for HOME in`）は、
 * 同じ行で値を替えうるので、path と読まない（値の分からない所のまま。同じ行の代入を読まない決めと揃える。review-1 の指摘 4）。
 */
function pathReader(command: string): (word: string) => string {
  const names = PATH_NAMES.filter(name => !new RegExp(`(?<![\\w\${])${name}(?!\\w)`).test(command));
  if (names.length === 0) return word => word;
  const variables = new RegExp(`\\$(?:\\{(?:${names.join('|')})\\}|(?:${names.join('|')})(?!\\w))`, 'g');
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

/** 命令が環境に触る当たり方: 名を書いた項目に当たる（named）か、名を書かずに的を選ぶ（unnamed）か、名や volume を変数で渡す（variable）か。 */
type Touch = 'named' | 'unnamed' | 'variable';

/**
 * 命令が触る環境。命令を単純な命令に分け、match の項目が命令の語に当たれば触る（hitsWords）。container の命令の語と項目の語は、旗をそろえてから比べる（normalizeFlags）。
 * 語で当たらなくても、命令の字全体に match の字（* を除く）が含まれるか、字を粗く割った語の container の命令の旗が、頭が旗の項目に当たれば、今までどおり触るとみなす。
 * ただし、どの単純な命令も inert で、書き出し・here-document などが無い時だけは、字の含みでは当てない。
 * 名を書いた項目の動詞に当たり、名を書かずに的を選ぶ命令（`container stop --all`・`container rm $(…)`・`xargs container rm`）も、
 * その環境に触るとみなす（unnamedTarget。どの環境の名にも当たらないので、前は通っていた）。
 * container の命令の --name・-v の値を変数・置き換えで渡し、値の分からない所を何でも当たるとみなすと項目に当たる命令も、触るとみなす（unknownValueHits。t-ta2b）。
 */
export function touched(command: string, infra: Record<string, InfraEnv>): string[] {
  return Object.entries(infra).filter(([, env]) => touchOf(command, env) !== undefined).map(([name]) => name);
}

/** 命令が環境に触る当たり方。触らなければ undefined。 */
function touchOf(command: string, env: InfraEnv): Touch | undefined {
  const raw = splitCommands(command);
  const commands = raw.map(words => containerWords(words) ?? words);
  const textOnly = !feedsOrWrites(command) && rawCommands(command).every(inert);
  const text = textOnly ? undefined : containerWords(textWords(command));
  // 変数の値で当てるのは、container の命令（と字を粗く割った語の container の命令）の旗の値だけ（`grep -v "$X"` には当てない）。
  const containers = [...raw.map(containerWords), text].filter((words): words is string[] => words !== undefined);
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
      || (!textOnly && command.includes(match.replaceAll('*', '')))
      || (text !== undefined && flagItem(item) && hitsWords(text, item.join(' ')));
  };
  if (env.match.some(hits)) return 'named';
  const unnamed = (verb: string): boolean => commands.some((words) => {
    const args = argsAfter(words, verb);
    return args !== undefined && unnamedTarget(args);
  });
  if (verbs.some(unnamed)) return 'unnamed';
  // 旗が語の終わりにあり値が無い（`… | xargs container run -d --name`。値は後ろから足される）時も、値の分からない語とみなす（review-1 の指摘 2）。
  const readPaths = pathReader(command);
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

/** 止めた訳に添える字（当たり方ごと）。 */
const HINTS: Record<Touch, string> = { named: '', unnamed: UNNAMED_HINT, variable: VARIABLE_HINT };

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
  const killer = commands.find(killsByPattern);
  if (killer !== undefined) {
    return { allow: false, reason: `pattern で選んで process に合図を送る命令は止めます（${killer.filter(w => w !== SUBSTITUTED).slice(0, 3).map(shownWord).join(' ')}）。思わぬ process に届くため（macOS の pkill は後ろの旗も pattern に読み、2026-11-23 の朝（JST）に担当の session ごと 29 個を止めた）。pgrep -fl '<型>' で pid と command line を見て、当たった数を確かめてから、その数字を kill <pid> に書いてください（pgrep の出力を変数や $(…) で kill に渡すと、見る手が抜けます）。` };
  }
  const reader = readOnly(asked.role);
  if (reader !== undefined) {
    const change = commands.find(changesRepo);
    if (change !== undefined) {
      return { allow: false, reason: `${reader.name}は repo を変えません（${change.slice(0, 3).map(shownWord).join(' ')}）。${reader.instead}` };
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
      Stop: [{ hooks: [waiting] }],
      UserPromptSubmit: [{ hooks: [hook('mail prompt')] }],
    },
  });
}
