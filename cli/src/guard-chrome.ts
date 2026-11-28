// guard の (7): Chrome・Chromium のバイナリを Bash で直に起こす命令を、旗があっても止め、roster chrome を案内する（t-qx3r。台帳 #402・#403）。
// 直に起こすと、旗を書き忘れた時に Chrome が macOS の keychain を読もうとし、Product Manager の画面にダイアログが出る。
// 起こす道を roster chrome 1 つにし、旗は roster chrome が付ける。guard.ts とは別の file に置く（同じ時に guard を直す課題とぶつかりにくく）。
// 見るのは Bash の字だけ。script・node の child_process の中から起こす Chrome は見えない（守りは「うっかり」まで）。
import { CHROME_NAMES, flagValue, normalizeChromeArgs } from './chrome.ts';
import { rawCommands, scanCommand, shellQuote, splitCommands, SUBSTITUTED } from './shell.ts';

/** 変数への代入（CH=…）。 */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
/** 変数だけの語（`$CH`・`${CH}`）。 */
const VARIABLE = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/;
/**
 * 後ろの命令を動かす道具（頭がこれなら、その旗と値の後ろの語を道具として見る）と、値を取る旗・旗の後ろの語の数。
 * shell.ts が頭でだけ外す前置きの語（nohup・env など）も、包む道具の後ろや path つき（/usr/bin/env）で来るので、ここでも外す（review-5 の提案 4）。
 */
const WRAPPERS: Readonly<Record<string, { valueFlags: ReadonlySet<string>, operands: number }>> = {
  timeout: { valueFlags: new Set(['-s', '--signal', '-k', '--kill-after']), operands: 1 },
  gtimeout: { valueFlags: new Set(['-s', '--signal', '-k', '--kill-after']), operands: 1 },
  caffeinate: { valueFlags: new Set(['-t', '-w']), operands: 0 },
  nohup: { valueFlags: new Set(), operands: 0 },
  nice: { valueFlags: new Set(['-n']), operands: 0 },
  env: { valueFlags: new Set(['-u', '-C', '-S', '-P']), operands: 0 },
  arch: { valueFlags: new Set(['-arch']), operands: 0 },
  sudo: { valueFlags: new Set(['-u', '-g', '-C', '-h', '-p']), operands: 0 },
  exec: { valueFlags: new Set(['-a']), operands: 0 },
};
/** open の的にした時に止める bundle id。 */
const CHROME_BUNDLES = /^(?:com\.google\.chrome|org\.chromium\.chromium|com\.microsoft\.edgemac|com\.brave\.browser)/i;
/** 命令の字に Chrome の仲間の名があるか（頭が命令の置き換えだけの時に見る）。 */
const CHROME_TEXT = /chrom(?:e|ium)|microsoft edge|brave browser/i;

/** 語を道具の名として読んだ字（path を外し、`.app` の path は中の名に）。 */
function toolName(word: string): string {
  const trimmed = word.replace(/\/+$/, '');
  const app = /([^/]+)\.app$/.exec(trimmed);
  return app?.[1] ?? trimmed.split('/').at(-1) ?? '';
}

/** guard が止めた形。 */
export type ChromeLaunch = { kind: 'direct', tool: string, path: string | undefined, args: string[] } | { kind: 'open', target: string };

/** 単純な命令（語の並び）の、包む道具を（当たらなくなるまで繰り返して）外した道具の位置。代入（env の NAME=V）も外す。 */
function toolIndex(words: string[]): number {
  let i = 0;
  for (;;) {
    while (i < words.length && ASSIGNMENT.test(words[i] ?? '')) i += 1;
    const wrapper = WRAPPERS[toolName(words[i] ?? '')];
    if (wrapper === undefined) return i;
    i += 1;
    while (i < words.length && ((words[i] ?? '').startsWith('-') || ASSIGNMENT.test(words[i] ?? ''))) i += wrapper.valueFlags.has(words[i] ?? '') ? 2 : 1;
    i += wrapper.operands;
  }
}

/** open の命令の的が Chrome か。的の字を返す（違えば undefined）。`--args` の後ろは Chrome に渡す引数なので見ない。 */
function openTarget(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--args') break;
    if (/^-[A-Za-z]+$/.test(arg) && /[ab]/.test(arg)) {
      const target = args[i + 1] ?? '';
      if (CHROME_NAMES.has(toolName(target)) || CHROME_BUNDLES.test(target)) return target;
      i += 1;
      continue;
    }
    if (!arg.startsWith('-') && /\.app\/?$/.test(arg) && CHROME_NAMES.has(toolName(arg))) return arg;
  }
  return undefined;
}

/** command の i にある `$(…)` の終わり（閉じ括弧の次）。 */
function substitutionEnd(command: string, i: number): number {
  let depth = 1;
  let j = i + 2;
  for (; j < command.length && depth > 0; j += 1) {
    if (command[j] === '(') depth += 1;
    else if (command[j] === ')') depth -= 1;
  }
  return j;
}

/**
 * 単純な命令の頭に来る命令の置き換え（`$(…)`）の中の字。頭は、行の初め・`;`・`&`・`|`・`(`・改行の後ろ（空白を挟んでよい）。
 * 引数の置き換え（`ls $(mdfind … chromium)`）は見ない（review-5 の提案 7）。引用の見分けはしない（字の含みを見るだけなので）。
 */
function headSubstitutions(command: string): string[] {
  const out: string[] = [];
  // 引用した頭（`"$(…)"`）と backtick の頭も見る（review-6 の指摘 1）。
  for (const m of command.matchAll(/(?:^|[;&|(\n])\s*"?(\$\(|`)/g)) {
    const at = (m.index ?? 0) + m[0].length - (m[1] ?? '').length;
    if (m[1] === '`') {
      const end = command.indexOf('`', at + 1);
      if (end !== -1) out.push(command.slice(at + 1, end));
    }
    else out.push(command.slice(at + 2, substitutionEnd(command, at) - 1));
  }
  return out;
}

/**
 * 代入（`CH=…`）の値の、書いたままの字（引用と命令の置き換えを含む）。名ごとに後ろの物。rawCommands の語は置き換えを除くので、
 * 値が置き換えの代入（`CH=$(ls … Chrome for Testing …)`）を見分けるのに使う（review-5 の指摘 3）。
 */
function assignedTexts(command: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of command.matchAll(/(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=/g)) {
    let j = (m.index ?? 0) + m[0].length;
    const from = j;
    let quote: string | undefined;
    while (j < command.length) {
      const c = command[j] ?? '';
      if (quote !== undefined) {
        if (c === quote) quote = undefined;
        j += 1;
      }
      else if (c === '"' || c === '\'') {
        quote = c;
        j += 1;
      }
      else if (command.startsWith('$(', j)) j = substitutionEnd(command, j);
      else if (/[\s;&|)]/.test(c)) break;
      else j += 1;
    }
    out.set(m[1] ?? '', command.slice(from, j));
  }
  return out;
}

/** 字に命令の置き換えがあるか。 */
const substituted = (text: string): boolean => text.includes('$(') || text.includes('`');

/** 版を見るだけの起こし（窓も profile も使わない）。 */
const versionOnly = (args: string[]): boolean => args.length === 1 && args[0] === '--version';

/** バイナリの在り処を見るだけの命令（`command -v chromium`）。splitCommands は command と -v を外して頭を chromium にするので、書いたままの語で見る。 */
function looksUpOnly(raw: string[]): boolean {
  const words = raw.filter(w => !ASSIGNMENT.test(w));
  return words[0] === 'command' && (words[1] === '-v' || words[1] === '-V');
}

/**
 * 命令が Chrome を直に起こすか（起こすなら、その形）。止めるのは:
 * - 単純な命令の道具の名が Chrome の仲間（sh -c・eval・exec・xargs・nohup・$(…) の中も。timeout・gtimeout・caffeinate で包んでも）。
 * - 道具が変数で、名が ROSTER_CHROME か、同じ 1 行の中のその変数への代入の値が Chrome の仲間（命令の字全体は見ない。`"$R" chrome start` を止めないため）。
 * - 道具が命令の置き換えだけ（`$(mdfind … chromium) --headless`）で、命令の字に Chrome の仲間の名がある。
 * - open の的が Chrome（-a・-b とまとめた旗・`.app` の path）。
 * 通すのは、`--version` だけの起こしと、`command -v`・`-V`。
 */
export function chromeLaunch(command: string): ChromeLaunch | undefined {
  const raws = rawCommands(command);
  const assigned = new Map<string, string>();
  for (const raw of raws) {
    for (const word of raw) {
      const m = ASSIGNMENT.exec(word);
      if (m !== null) assigned.set(m[1] ?? '', m[2] ?? '');
    }
  }
  const texts = assignedTexts(command);
  for (const raw of raws) {
    if (looksUpOnly(raw)) continue;
    // 案内に出す path を拾う語: 書いたままの語と、sh -c・eval に渡した字の中の語（review-5 の指摘 2）。
    const written = [...raw, ...raw.filter(w => /\s/.test(w)).flatMap(w => rawCommands(w).flat())];
    // 書いたままの命令 1 つを、頭を整えた単純な命令に分け直す（sh -c・eval の中も、ここで拾う）。
    for (const words of splitCommands(raw.map(shellQuote).join(' '))) {
      const i = toolIndex(words);
      const word = words[i] ?? '';
      const args = words.slice(i + 1);
      if (toolName(word) === 'open') {
        const target = openTarget(args);
        if (target !== undefined) return { kind: 'open', target };
        continue;
      }
      const variable = VARIABLE.exec(word)?.[1];
      if (variable !== undefined) {
        // 代入の値に命令の置き換えがあれば、path は分からない（rawCommands は置き換えを除く）。置き換えの中の字に Chrome の名があれば止める。
        const text = texts.get(variable) ?? '';
        const value = assigned.get(variable);
        const named = variable === 'ROSTER_CHROME' || (value !== undefined && CHROME_NAMES.has(toolName(value))) || (substituted(text) && CHROME_TEXT.test(text));
        if (named && !versionOnly(args)) {
          const tool = value !== undefined && CHROME_NAMES.has(toolName(value)) ? toolName(value) : (/chrome for testing/i.test(text.replaceAll('\\ ', ' ')) ? 'Google Chrome for Testing' : `$${variable}`);
          return { kind: 'direct', tool, path: substituted(text) ? undefined : value, args };
        }
        continue;
      }
      // splitCommands は頭の道具の path を外すので、案内に出す path は書いたままの語から拾う。
      const path = written.find(w => w.includes('/') && toolName(w) === toolName(word)) ?? word;
      if (CHROME_NAMES.has(toolName(path)) && !versionOnly(args)) return { kind: 'direct', tool: toolName(path), path, args };
    }
  }
  // 頭が命令の置き換えだけの命令は、splitCommands に出ない（中の命令だけが出る）。印の残る形で見て、頭の置き換えの中の字に Chrome の名があれば止める
  // （後ろの引数の字・ほかの命令の引数の置き換えは見ない。`$(which roster) chrome start` を止めないため）。
  const inner = headSubstitutions(command).some(text => CHROME_TEXT.test(text));
  for (const words of inner ? scanCommand(command).marked : []) {
    const head = words.find(w => !ASSIGNMENT.test(w)) ?? '';
    if (head !== '' && head.replaceAll(SUBSTITUTED, '') === '') {
      const args = words.slice(words.indexOf(head) + 1).map(w => w.replaceAll(SUBSTITUTED, ''));
      if (!versionOnly(args)) return { kind: 'direct', tool: '$(…)', path: undefined, args };
    }
  }
  return undefined;
}

/** roster chrome が付ける・断る旗（案内の 1 行から外す）。 */
const MANAGED = /^--(?:use-mock-keychain|password-store(?:=.*)?|no-first-run|no-default-browser-check|user-data-dir(?:=.*)?|remote-debugging-port(?:=.*)?)$/;
/** roster chrome が断る旗（案内から外し、訳に添える。review-5 の提案 6）。 */
const REFUSED = /^--(?:profile-directory|remote-debugging-address)(?:=.*)?$/;

/** 案内の 1 語。`$` を含む語は、shell が展開するように二重引用で包む（単引用だと字のまま渡る。review-5 の指摘 1）。`~/` は `$HOME/` にする。 */
function quoteWord(word: string): string {
  const home = word.startsWith('~/') ? `$HOME/${word.slice(2)}` : word;
  return home.includes('$') ? `"${home.replaceAll(/["\\`]/g, '\\$&')}"` : shellQuote(home);
}

/**
 * 案内の `--bin`（打ってそのまま通る字。review-5 の指摘 2）。無ければ undefined（既定の Chrome）。
 * - puppeteer の置いた Chrome for Testing の path・path の分からない Chrome for Testing は `for-testing@<版の頭>`・`for-testing`。
 * - 絶対の path・`~/`・`$` で始まる path は、そのまま（引用して）。
 * - PATH で引く名（`chromium`）は `"$(command -v chromium)"`。
 */
function binWord(path: string | undefined, tool: string): string | undefined {
  const testing = path === undefined ? null : /\.cache\/puppeteer\/chrome\/[^/]*-(\d+)\.[\d.]+\//.exec(path);
  if (testing !== null) return `for-testing@${testing[1] ?? ''}`;
  if (path === undefined || path === '') return tool === 'Google Chrome for Testing' ? 'for-testing' : undefined;
  if (path.startsWith('/') || path.startsWith('~/') || path.startsWith('$')) return quoteWord(path);
  return `"$(command -v ${shellQuote(path)})"`;
}

/** 止めた命令に近い roster chrome の 1 行（CDP の口を開くなら start、ほかは run）。 */
export function chromeSuggestion(launch: Extract<ChromeLaunch, { kind: 'direct' }>): string {
  // 1 本の - の旗も、roster chrome と同じく -- の形に揃えて見る。
  const args = normalizeChromeArgs(launch.args);
  const port = flagValue(args, '--remote-debugging-port');
  const profile = flagValue(args, '--user-data-dir');
  const refused = args.filter(a => REFUSED.test(a));
  const rest = args.filter(a => !MANAGED.test(a) && !REFUSED.test(a));
  const bin = binWord(launch.path, launch.tool);
  const own = [...(bin === undefined ? [] : ['--bin', bin]), ...(profile === undefined ? [] : ['--profile', quoteWord(profile)])];
  const line = port === undefined
    ? ['roster chrome run', ...own, '--', ...rest.map(quoteWord)]
    : ['roster chrome start', ...own, ...(port === '0' ? [] : ['--port', port]), '--', ...rest.map(quoteWord)];
  return `${line.join(' ')}${refused.length === 0 ? '' : `（roster chrome が断る ${refused.join('・')} は外した）`}`;
}

/** 止めた訳（guard の judge が返す）。 */
export function chromeReason(launch: ChromeLaunch): string {
  if (launch.kind === 'open') {
    return `open で Chrome を開く命令は止めます（${launch.target}）。Product Manager のふだんの Chrome（ふだんの profile）で開く形で、keychain のダイアログも出うるため（台帳 #402・#403）。Product Manager に見せたいページは、URL を報告に書いてください。自分で開いて見るなら、headless の roster chrome run を使ってください。`;
  }
  return `Chrome を直に起こす命令は止めます（${launch.tool}。旗を付けていても）。旗を書き忘れると、Chrome が macOS の keychain を読もうとし、Product Manager の画面にダイアログが出るため（台帳 #402・#403）。roster chrome で起こしてください（旗は roster chrome が付けます）: ${chromeSuggestion(launch)}。裏で起こして CDP に繋ぐなら roster chrome start、止めるのは roster chrome stop <pid>。`;
}
