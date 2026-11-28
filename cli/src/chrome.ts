// 担当が手元で起こす Chrome の旗の組み（roster chrome と roster figure shot が使う。台帳 #402・#403・#404）。
// 旗が無いと、Chrome が macOS の keychain の「Chrome Safe Storage」などを読もうとし、Product Manager の画面に
// keychain のパスワードを求めるダイアログが出る。旗の組みと、使わせない旗の検査は、ここ 1 か所に置く。
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { TpmError } from './skill-sets.ts';

/** keychain を読ませない旗。 */
export const KEYCHAIN_SAFE_FLAGS = ['--use-mock-keychain', '--password-store=basic'] as const;

/** いつも前に付ける旗（keychain の 2 つと、Product Manager の画面に出うる初めの画面・「既定のブラウザ」の問いを止める 2 つ）。 */
export const ALWAYS_FLAGS = [...KEYCHAIN_SAFE_FLAGS, '--no-first-run', '--no-default-browser-check'] as const;

/** Chrome の既定の在り処（$ROSTER_CHROME で替える）。 */
export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Chrome の仲間の実行の file の名（path を外した名）。どれも同じ形で keychain の鍵を読む。
 * guard（Chrome の直起こしを止める）も、この表を使う。
 */
export const CHROME_NAMES: ReadonlySet<string> = new Set([
  'Google Chrome',
  'Google Chrome for Testing',
  'Google Chrome Canary',
  'Google Chrome Beta',
  'Google Chrome Dev',
  'Chromium',
  'chrome',
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'google-chrome-beta',
  'chrome-headless-shell',
  'Microsoft Edge',
  'Brave Browser',
]);

/** puppeteer が Chrome for Testing を置く所（`for-testing` で選ぶ）。 */
const PUPPETEER_CHROME = ['.cache', 'puppeteer', 'chrome'];
/** Chrome for Testing の実行の file の、版の folder からの path（macOS）。 */
const FOR_TESTING_EXE = ['Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'];

/** 版の字（156.0.8078.47）を、数の並びとして比べる。 */
function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * `--bin` の字を、起こす実行の file の path にする。
 * 無ければ $ROSTER_CHROME、それも無ければ DEFAULT_CHROME。`.app` は中の実行の file に読み替える。
 * `for-testing`（`for-testing@156` で版の頭を絞る）は、puppeteer が置いた Chrome for Testing のいちばん新しい版。
 * 名が Chrome の仲間でなければ断る（roster chrome で別の道具を起こさせない）。
 */
export function resolveChrome(spec: string | undefined, env: NodeJS.ProcessEnv, home = homedir()): string {
  const given = spec ?? (env.ROSTER_CHROME || DEFAULT_CHROME);
  let exe = given;
  const testing = /^for-testing(?:@(.+))?$/.exec(given);
  if (testing !== null) exe = forTesting(home, testing[1]);
  else if (given.replace(/\/+$/, '').endsWith('.app')) {
    const app = given.replace(/\/+$/, '');
    exe = join(app, 'Contents', 'MacOS', basename(app, '.app'));
  }
  if (!CHROME_NAMES.has(basename(exe))) throw new TpmError(`--bin が Chrome の仲間ではありません: ${given}（${[...CHROME_NAMES].join('・')}）`);
  return exe;
}

/** puppeteer の置いた Chrome for Testing のうち、版の頭が prefix の、いちばん新しい物の実行の file。 */
function forTesting(home: string, prefix: string | undefined): string {
  const root = join(home, ...PUPPETEER_CHROME);
  const found: { version: string, exe: string }[] = [];
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    const version = /-(\d[\d.]*)$/.exec(dir)?.[1];
    if (version === undefined || (prefix !== undefined && version !== prefix && !version.startsWith(`${prefix}.`))) continue;
    const base = join(root, dir);
    for (const sub of readdirSync(base)) {
      const exe = join(base, sub, ...FOR_TESTING_EXE);
      if (existsSync(exe)) found.push({ version, exe });
    }
  }
  const best = found.sort((a, b) => compareVersions(b.version, a.version))[0];
  if (best === undefined) throw new TpmError(`Chrome for Testing${prefix === undefined ? '' : ` ${prefix}`} が ${root} にありません（npx @puppeteer/browsers install chrome@<版> で置く）`);
  return best.exe;
}

/** 旗の値（`--name=value`）。無ければ undefined。同じ旗がいくつもあれば、後ろの物（Chrome と同じ）。 */
export function flagValue(args: readonly string[], name: string): string | undefined {
  let value: string | undefined;
  for (const arg of args) if (arg.startsWith(`${name}=`)) value = arg.slice(name.length + 1);
  return value;
}

/** path を、symlink を解いて比べられる形にする（まだ無い path は、在る親まで解いて後ろを足す）。 */
function realish(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  return join(realpathSync(head), ...tail);
}

/** CDP の口を開いてよい在り処（機械の外に開かない）。 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Chrome を起こす形の求め。 */
export interface ChromeLaunch {
  /** 担当が書いた Chrome の引数（`--` の後ろ）。 */
  args: readonly string[]
  /** 渡す profile（user-data-dir）。 */
  profile: string
  /** 窓を出す（headless にしない）。 */
  headed?: boolean
  /** CDP の口（裏で起こす時）。0 なら Chrome が選ぶ。 */
  port?: number
}

/**
 * 担当の引数を見て、使わせない旗を断る。断る訳は TpmError。
 * - `--password-store=` の basic 以外の値（keychain を読む）。
 * - `--user-data-dir`・`--profile-directory`（profile は roster chrome の --profile で渡す。Product Manager のふだんの profile を指させないため）。
 * - `--remote-debugging-address` が loopback の外（CDP を機械の外に開く）。
 * - `--headed` と担当の `--headless` が両方ある。
 * - `--remote-debugging-port` を、--port と別の値で書いた。
 */
export function checkChromeArgs(launch: ChromeLaunch, home = homedir()): void {
  const { args } = launch;
  const store = flagValue(args, '--password-store');
  if (store !== undefined && store !== 'basic') throw new TpmError(`--password-store=${store} は使えません（keychain を読むため。roster chrome が --password-store=basic を付ける）`);
  if (args.some(a => a === '--user-data-dir' || a.startsWith('--user-data-dir='))) throw new TpmError('--user-data-dir は Chrome の引数に書かず、roster chrome の --profile <dir> で渡してください');
  if (args.some(a => a === '--profile-directory' || a.startsWith('--profile-directory='))) throw new TpmError('--profile-directory は使えません（ふだんの profile を選ぶ旗。roster chrome の --profile <dir> で、別の folder を渡してください）');
  const address = flagValue(args, '--remote-debugging-address');
  if (address !== undefined && !LOOPBACK.has(address)) throw new TpmError(`--remote-debugging-address=${address} は使えません（CDP を機械の外に開くため。127.0.0.1 だけ）`);
  if (launch.headed === true && args.some(a => a === '--headless' || a.startsWith('--headless='))) throw new TpmError('--headed と、Chrome の引数の --headless が両方あります。どちらか 1 つにしてください');
  const port = flagValue(args, '--remote-debugging-port');
  if (port !== undefined && launch.port !== undefined && Number(port) !== launch.port) throw new TpmError(`--port ${launch.port} と、Chrome の引数の --remote-debugging-port=${port} が違います。どちらか 1 つにしてください`);
  const appSupport = realish(join(home, 'Library', 'Application Support'));
  const profile = realish(launch.profile);
  if (profile === appSupport || profile.startsWith(`${appSupport}${sep}`)) throw new TpmError(`--profile が ${join(home, 'Library', 'Application Support')} の下です（Product Manager のふだんのブラウザの profile。keychain の鍵を読み、記録を変えるため）。別の folder を渡してください`);
}

/**
 * Chrome に渡す引数を組む。いつもの旗（ALWAYS_FLAGS）・headless（担当が書かず、--headed でもなければ --headless=new）・
 * user-data-dir・CDP の口（port を渡した時。担当が --remote-debugging-port を書いていれば足さない）を、担当の引数の前に置く。
 * 使わせない旗は checkChromeArgs が断る。
 */
export function chromeArgs(launch: ChromeLaunch, home = homedir()): string[] {
  checkChromeArgs(launch, home);
  const { args } = launch;
  const headless = launch.headed === true || args.some(a => a === '--headless' || a.startsWith('--headless=')) ? [] : ['--headless=new'];
  const port = launch.port === undefined || flagValue(args, '--remote-debugging-port') !== undefined ? [] : [`--remote-debugging-port=${launch.port}`];
  return [...ALWAYS_FLAGS, ...headless, `--user-data-dir=${launch.profile}`, ...port, ...args];
}

/** Chrome が CDP の口を書く file（profile の中）。 */
export const DEVTOOLS_PORT_FILE = 'DevToolsActivePort';

/**
 * profile の DevToolsActivePort から、CDP の口を読む。since（起こした時刻、ms）より前に書かれた file は、前に落ちた Chrome の残りとして読まない。
 * 無い・古い・読めなければ undefined。
 */
export function readDevToolsPort(profile: string, since: number): number | undefined {
  const file = join(profile, DEVTOOLS_PORT_FILE);
  if (!existsSync(file)) return undefined;
  // mtime は秒より細かく持たない file system もあるので、1 秒の幅を見る。
  if (statSync(file).mtimeMs < since - 1000) return undefined;
  const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}
