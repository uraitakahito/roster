// レビューの席（Staff Engineer 担当）の手元の命令を、通す側を並べた表で読む（t-n4j9。監査 audit-2 の R14）。
// 席と、その手伝い（/code-review の手伝いなど。guard は手伝いの命令にも効く）が、手元で試験・build・script を流さないため。
// 止める側を並べる表（試験の名の表）だと、表に無い名・script に包んだ試験がすり抜けるので、通す側を並べ、表に無い物はみな当たりにする。
// 命令は頭を整えない形（scanCommand）で読む: 命令の名の path・頭の代入・前置きの語（env・xargs・time など）を、書いたままの字で見る（review-3 の指摘 3）。
// 段 1a では止めずに、当たった命令を review-guard.jsonl に記録するだけ。記録を見て表を直してから、段 1b で止める。
import { scanCommand } from './shell.ts';

/** shell の文法の語（命令ではない）。頭にあれば外して、後ろを命令として読む。 */
const SYNTAX = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}']);

/** 字を命令として動かさず、file にも書かない道具（引数は見ない）。 */
const PLAIN = new Set(['cat', 'head', 'tail', 'wc', 'ls', 'stat', 'file', 'du', 'diff', 'cmp', 'cut', 'tr', 'jq', 'echo', 'printf', 'date', 'pwd', 'cd', 'test', '[', 'true', 'false', 'which', 'basename', 'dirname', 'realpath', 'grep', 'read']);

/** 道具ごとの、字を動かす旗・書く旗（`--x=v` の形も当てる）。 */
const BAD_FLAGS: Record<string, RegExp> = {
  rg: /^--pre(?:-glob)?(?:=|$)/,
  sort: /^(?:-o.*|--output(?:=.*)?|--compress-program(?:=.*)?)$/,
  tree: /^-o.*$/,
  find: /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/,
};

/** gh の、通す命令（`gh <語> <語>`）。api は GET だけ（下で見る）。 */
const GH_READS = new Set(['pr view', 'pr diff', 'pr checks', 'pr list', 'run view', 'run list', 'issue view']);

/** gh api の、書き込みになる旗（欄を送ると POST になる）。 */
const GH_API_WRITES = /^(?:-f|-F|--field|--raw-field|--input)(?:=|$)/;

/** sed の 1 つの命令: 番地（行・$・/型/）の後の p・d・q か、s/…/…/ に g・p・I・数の旗。 */
const SED_ADDR = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`;
const SED_SAFE = new RegExp(String.raw`^(?:${SED_ADDR}(?:,${SED_ADDR})?)?\s*(?:[pdq]|s/(?:[^/\\]|\\.)*/(?:[^/\\]|\\.)*/[gpI0-9]*)$`);

/** sed の命令の字が、読むだけの形（p・d・q・s の g と p）か。e（命令を動かす）・w（書く）は外れる。 */
function sedScriptSafe(script: string): boolean {
  return script.split(/[;\n]/).map(part => part.trim()).filter(part => part !== '').every(part => SED_SAFE.test(part));
}

/** sed の引数が、書き替え（-i）を持たず、命令の字がみな読むだけの形か。 */
function sedSafe(args: string[]): boolean {
  if (args.some(a => /^(?:-i.*|--in-place(?:=.*)?|-[a-zA-Z]*i[a-zA-Z]*)$/.test(a))) return false;
  const scripts: string[] = [];
  let sawScript = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? '';
    if (a === '-e' || a === '--expression') {
      scripts.push(args[i + 1] ?? '');
      sawScript = true;
      i += 1;
    }
    else if (a === '-f' || a === '--file') return false;
    else if (!a.startsWith('-') && !sawScript) {
      scripts.push(a);
      sawScript = true;
    }
  }
  return scripts.length > 0 && scripts.every(sedScriptSafe);
}

/** gh の命令が、読むだけの形か。 */
function ghSafe(args: string[]): boolean {
  const [a, b] = args;
  if (a === 'api') {
    const rest = args.slice(1);
    const i = rest.findIndex(w => w === '-X' || w === '--method');
    const named = rest.find(w => /^(?:-X|--method=)./.test(w))?.replace(/^(?:-X|--method=)/, '') ?? (i === -1 ? undefined : rest[i + 1]);
    if (named !== undefined) return named.toUpperCase() === 'GET';
    return !rest.some(w => GH_API_WRITES.test(w));
  }
  return GH_READS.has(`${a ?? ''} ${b ?? ''}`);
}

/** 単純な命令 1 つ（頭を整えない語）が、表に無い物なら、その訳。表の形なら undefined。 */
function outside(words: string[]): string | undefined {
  let k = 0;
  while (k < words.length && SYNTAX.has(words[k] ?? '')) k += 1;
  const [name, ...args] = words.slice(k);
  if (name === undefined || name === '') return undefined;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) return `頭の代入（${name.split('=')[0] ?? ''}=…）`;
  if (name.includes('/')) return `path で書いた命令（${name}）`;
  // for の頭の語の並び（for x in a b）は、命令を動かさない。
  if (name === 'for' || name === 'in' || name === 'case' || name === 'esac') return undefined;
  if (name === 'roster') return args[0] === 'infra' && args[1] === 'run' ? 'roster infra run' : undefined;
  if (name === 'git') return 'git（レビューの席では素の git を打たない）';
  if (name === 'gh') return ghSafe(args) ? undefined : `gh ${args.slice(0, 2).join(' ')}`;
  if (name === 'sed') return sedSafe(args) ? undefined : 'sed（-n の p と s の形のほか）';
  if (name === 'uniq') return args.filter(a => !a.startsWith('-')).length > 1 ? 'uniq の書き出し' : undefined;
  const bad = BAD_FLAGS[name];
  if (bad !== undefined) {
    const flag = args.find(a => bad.test(a));
    return flag === undefined ? undefined : `${name} ${flag}`;
  }
  if (PLAIN.has(name)) return undefined;
  return `表に無い命令（${name}）`;
}

/** 表に照らした答え。outside は表に無い形の訳（無ければ空）、writes は redirect の書く先（/dev/null を除く。段 1a は記録だけ）。 */
export interface ReviewCheck {
  outside: string[]
  writes: string[]
}

/**
 * レビューの席の命令を、通す側の表に照らす。process の置き換え（`<(…)`・`>(…)`）と、引用しない here-document の中の置き換えは、
 * 中の命令を拾い切れないので形ごと当たりにする（review-4 の指摘 3）。subshell `( … )` と `$(…)` の中は、分けた命令として表で読む。
 */
export function checkReviewCommand(command: string): ReviewCheck {
  const scanned = scanCommand(command);
  const found: string[] = [];
  if (/[<>]\(/.test(command)) found.push('process の置き換え（<(…)・>(…)）');
  if (scanned.heredocRuns) found.push('here-document の中の置き換え');
  for (const words of scanned.commands) {
    const reason = outside(words);
    if (reason !== undefined && !found.includes(reason)) found.push(reason);
  }
  return { outside: found, writes: scanned.writes };
}
