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
/** 後ろの命令を動かす道具（頭がこれなら、その旗と値の後ろの語を道具として見る）と、値を取る旗。 */
const WRAPPERS: Readonly<Record<string, { valueFlags: ReadonlySet<string>, operands: number }>> = {
  timeout: { valueFlags: new Set(['-s', '--signal', '-k', '--kill-after']), operands: 1 },
  gtimeout: { valueFlags: new Set(['-s', '--signal', '-k', '--kill-after']), operands: 1 },
  caffeinate: { valueFlags: new Set(['-t', '-w']), operands: 0 },
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

/** 単純な命令（語の並び）の、包む道具を外した道具の位置。 */
function toolIndex(words: string[]): number {
  const wrapper = WRAPPERS[toolName(words[0] ?? '')];
  if (wrapper === undefined) return 0;
  let i = 1;
  while (i < words.length && (words[i] ?? '').startsWith('-')) i += wrapper.valueFlags.has(words[i] ?? '') ? 2 : 1;
  return i + wrapper.operands;
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

/** 命令の置き換え（`$(…)`・backtick）の中の字を、みな返す（入れ子は外側ごと）。引用の見分けはしない（字の含みを見るだけなので）。 */
function substitutions(command: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < command.length; i += 1) {
    if (command.startsWith('$(', i)) {
      let depth = 1;
      let j = i + 2;
      for (; j < command.length && depth > 0; j += 1) {
        if (command[j] === '(') depth += 1;
        else if (command[j] === ')') depth -= 1;
      }
      out.push(command.slice(i + 2, j - 1));
      i = j - 1;
    }
    else if (command[i] === '`') {
      const end = command.indexOf('`', i + 1);
      if (end === -1) break;
      out.push(command.slice(i + 1, end));
      i = end;
    }
  }
  return out;
}

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
  for (const raw of raws) {
    if (looksUpOnly(raw)) continue;
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
      // splitCommands は頭の道具の path を外すので、案内に出す path は書いたままの語から拾う。
      const written = raw.find(w => w.includes('/') && toolName(w) === toolName(word)) ?? word;
      const path = variable === undefined ? written : assigned.get(variable);
      const named = (path !== undefined && CHROME_NAMES.has(toolName(path))) || variable === 'ROSTER_CHROME';
      if (named && !versionOnly(args)) return { kind: 'direct', tool: toolName(path ?? word), path, args };
    }
  }
  // 頭が命令の置き換えだけの命令は、splitCommands に出ない（中の命令だけが出る）。印の残る形で見て、置き換えの中の字に Chrome の名があれば止める
  // （後ろの引数の字は見ない。`$(which roster) chrome start` を止めないため）。
  const inner = substitutions(command).some(text => CHROME_TEXT.test(text));
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

/**
 * 案内の `--bin` の語。puppeteer の置いた Chrome for Testing なら `for-testing@<版の頭>`。
 * `$HOME` などの変数を含む path は、shell が展開するように二重引用で包む（単引用だと字のまま渡る）。
 */
function binWord(path: string): string {
  const testing = /\.cache\/puppeteer\/chrome\/[^/]*-(\d+)\.[\d.]+\//.exec(path);
  if (testing !== null) return `for-testing@${testing[1] ?? ''}`;
  return path.includes('$') ? `"${path.replaceAll(/["\\`]/g, '\\$&')}"` : shellQuote(path);
}

/** 止めた命令に近い roster chrome の 1 行（CDP の口を開くなら start、ほかは run）。 */
export function chromeSuggestion(launch: Extract<ChromeLaunch, { kind: 'direct' }>): string {
  // 1 本の - の旗も、roster chrome と同じく -- の形に揃えて見る。
  const args = normalizeChromeArgs(launch.args);
  const port = flagValue(args, '--remote-debugging-port');
  const profile = flagValue(args, '--user-data-dir');
  const rest = args.filter(a => !MANAGED.test(a));
  const bin = launch.path === undefined || launch.path === '' ? [] : ['--bin', binWord(launch.path)];
  const own = [...bin, ...(profile === undefined ? [] : ['--profile', shellQuote(profile)])];
  const line = port === undefined
    ? ['roster chrome run', ...own, '--', ...rest.map(shellQuote)]
    : ['roster chrome start', ...own, ...(port === '0' ? [] : ['--port', port]), '--', ...rest.map(shellQuote)];
  return line.join(' ');
}

/** 止めた訳（guard の judge が返す）。 */
export function chromeReason(launch: ChromeLaunch): string {
  if (launch.kind === 'open') {
    return `open で Chrome を開く命令は止めます（${launch.target}）。Product Manager のふだんの Chrome（ふだんの profile）で開く形で、keychain のダイアログも出うるため（台帳 #402・#403）。Product Manager に見せたいページは、URL を報告に書いてください。自分で開いて見るなら、headless の roster chrome run を使ってください。`;
  }
  return `Chrome を直に起こす命令は止めます（${launch.tool}。旗を付けていても）。旗を書き忘れると、Chrome が macOS の keychain を読もうとし、Product Manager の画面にダイアログが出るため（台帳 #402・#403）。roster chrome で起こしてください（旗は roster chrome が付けます）: ${chromeSuggestion(launch)}。裏で起こして CDP に繋ぐなら roster chrome start、止めるのは roster chrome stop <pid>。`;
}
