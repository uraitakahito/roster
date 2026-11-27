// shell に渡す語の引用。利用者が写して打つ 1 行と、hook の命令（Claude Code が shell で動かす）が使う。

/** shell の 1 語として打てるように引用する。安全な字だけならそのまま、ほかは '…' で包む。 */
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_./:=,+@%-]+$/.test(word)) return word;
  return `'${word.replaceAll('\'', '\'\\\'\'')}'`;
}

/** 命令の頭に付いても、打つ命令そのものではない語（予約語・前に付けて命令を動かす命令）。 */
const PREFIX_WORDS = new Set(['!', '{', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time', 'exec', 'command', 'builtin', 'nohup', 'sudo', 'env', 'xargs', 'nice']);
/** -c で字の命令を動かす shell。 */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
/** 変数への代入（FOO=1）。 */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * 命令の置き換え（`$(…)`・backtick）の跡に、語の中に残す印（値の分からない所）。語の途中の置き換え（`"$(cat f)":/data`・`x$(echo y)`）も、
 * 字で書いた語と見分けられるようにする（t-ta2b の review-1 の指摘 1。前は跡を残さず、`:/data`・`x` の字の語に見えた）。
 * 印が見えるのは splitCommandsMarked だけ。splitCommands・rawCommands は印を除いた語を返す（review-3 の指摘 1）。
 */
export const SUBSTITUTED = '\u0000';

/** 字の命令を読む途中の位置と、出てきた単純な命令（語の並び）。 */
class Lexer {
  private i = 0;
  private words: string[] = [];
  private word: string | undefined;
  /** 次の語は redirect の先（命令の語ではない）。 */
  private redirect = false;
  /** 行の終わりで読み飛ばす here-document の終わりの印（`<<-` なら字下げを許す）。 */
  private heredocs: { end: string, strip: boolean }[] = [];
  readonly commands: string[][] = [];

  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  run(): string[][] {
    const s = this.src;
    while (this.i < s.length) {
      const c = s[this.i] ?? '';
      if (c === '\\') {
        // 行の続き（\ と改行）は何も足さない。
        if (s[this.i + 1] !== '\n') this.add(s[this.i + 1] ?? '');
        this.i += 2;
      }
      else if (c === '\'') {
        const end = s.indexOf('\'', this.i + 1);
        this.add(s.slice(this.i + 1, end === -1 ? s.length : end));
        this.i = end === -1 ? s.length : end + 1;
      }
      else if (c === '"') this.doubleQuoted();
      else if (c === '$' && s[this.i + 1] === '(') this.add(this.substitution(this.i + 2));
      else if (c === '`') this.add(this.backtick());
      else if (c === '#' && this.word === undefined) {
        // 語の頭の # から行の終わりまでは注釈。
        const end = s.indexOf('\n', this.i);
        this.i = end === -1 ? s.length : end;
      }
      else if (c === ' ' || c === '\t') {
        this.endWord();
        this.i += 1;
      }
      else if (c === '<' || c === '>') this.redirection();
      else if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')') {
        this.endCommand();
        this.i += 1;
        if (c === '\n') this.skipHeredocs();
      }
      else {
        this.add(c);
        this.i += 1;
      }
    }
    this.endCommand();
    return this.commands;
  }

  private add(text: string): void {
    this.word = (this.word ?? '') + text;
  }

  private endWord(): void {
    if (this.word === undefined) return;
    if (this.redirect) this.redirect = false;
    else this.words.push(this.word);
    this.word = undefined;
  }

  private endCommand(): void {
    this.endWord();
    this.redirect = false;
    if (this.words.length > 0) this.commands.push(this.words);
    this.words = [];
  }

  /** "…" の中。$(…) と `…` は中の命令も読む。 */
  private doubleQuoted(): void {
    const s = this.src;
    this.i += 1;
    let text = '';
    while (this.i < s.length && s[this.i] !== '"') {
      if (s[this.i] === '\\') {
        text += s[this.i + 1] ?? '';
        this.i += 2;
      }
      else if (s[this.i] === '$' && s[this.i + 1] === '(') text += this.substitution(this.i + 2);
      else if (s[this.i] === '`') text += this.backtick();
      else {
        text += s[this.i];
        this.i += 1;
      }
    }
    this.i += 1;
    this.add(text);
  }

  /** $( の後ろ（start）から、対の ) までを命令として読む。返すのは語に足す字（中身は語にしない。跡の印 SUBSTITUTED）。 */
  private substitution(start: number): string {
    const s = this.src;
    let depth = 1;
    let j = start;
    let quote: string | undefined;
    for (; j < s.length && depth > 0; j += 1) {
      const c = s[j];
      if (quote !== undefined) {
        if (c === '\\' && quote === '"') j += 1;
        else if (c === quote) quote = undefined;
      }
      else if (c === '\'' || c === '"') quote = c;
      else if (c === '\\') j += 1;
      else if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
    }
    const inner = s.slice(start, depth === 0 ? j - 1 : j);
    this.commands.push(...splitCommandsMarked(inner));
    this.i = j;
    return SUBSTITUTED;
  }

  /** `…` を命令として読む。返すのは跡の印 SUBSTITUTED。 */
  private backtick(): string {
    const s = this.src;
    const end = s.indexOf('`', this.i + 1);
    this.commands.push(...splitCommandsMarked(s.slice(this.i + 1, end === -1 ? s.length : end)));
    this.i = end === -1 ? s.length : end + 1;
    return SUBSTITUTED;
  }

  /** `<`・`>`・`>>`・`>&`・`<<`（here-document）・`<<<`（here-string）。次の語は redirect の先なので命令の語にしない。 */
  private redirection(): void {
    const s = this.src;
    // 2>&1 の 2 のような、redirect の前に付いた fd の番号は語にしない。
    if (this.word !== undefined && /^\d+$/.test(this.word)) this.word = undefined;
    this.endWord();
    if (s.startsWith('<<<', this.i)) {
      this.i += 3;
      this.redirect = true;
      return;
    }
    if (s.startsWith('<<', this.i)) {
      this.i += 2;
      const strip = s[this.i] === '-';
      if (strip) this.i += 1;
      while (s[this.i] === ' ' || s[this.i] === '\t') this.i += 1;
      const m = /^(?:'([^']*)'|"([^"]*)"|([^\s;&|<>()]+))/.exec(s.slice(this.i));
      if (m !== null) {
        this.heredocs.push({ end: m[1] ?? m[2] ?? (m[3] ?? '').replaceAll('\\', ''), strip });
        this.i += m[0].length;
      }
      return;
    }
    this.i += 1;
    while (s[this.i] === '>' || s[this.i] === '&' || s[this.i] === '|') this.i += 1;
    // 2>&1 の 1、>&- の - は redirect の先。
    this.redirect = true;
  }

  /** 改行の後、here-document の中身（命令ではない字）を、終わりの印の行まで読み飛ばす。 */
  private skipHeredocs(): void {
    const s = this.src;
    for (const doc of this.heredocs) {
      while (this.i < s.length) {
        const end = s.indexOf('\n', this.i);
        const line = s.slice(this.i, end === -1 ? s.length : end);
        this.i = end === -1 ? s.length : end + 1;
        if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.end) break;
      }
    }
    this.heredocs = [];
  }
}

/**
 * 字の命令を、単純な命令（語の並び）に分ける。; && || | & 改行で分け、$(…)・`…`・sh -c '…' の中の命令も拾う。
 * 引用の中の字・注釈・here-document の中身・redirect の先は、命令の語にしない。
 * 頭の代入（FOO=1）と、前に付けて命令を動かす語（sudo・env・if など）は外し、命令の名は path を外した名にする。
 * shell を真似るのは「うっかり」を見分けるのに要るところまで（別名・関数・script の中は見ない）。
 */
export function splitCommands(src: string): string[][] {
  return splitCommandsMarked(src).map(unmarkAll);
}

/**
 * splitCommands と同じ分け方で、命令の置き換えの跡の印（SUBSTITUTED）を語に残した形。値の分からない語を見分けたい所（guard の、名と volume の旗の値と、
 * 名を書かずに的を選ぶ命令の的）だけが使う。ほかの所は、印の無い splitCommands を使う（語を字のまま比べる守りが、印の付いた語を別の語と読まないため。
 * t-ta2b の review-3 の指摘 1）。頭を整える所（前置きの語・命令の名・sh -c）は、印を除いた字で読む。
 */
export function splitCommandsMarked(src: string): string[][] {
  return new Lexer(src).run().flatMap(head);
}

/**
 * 字の命令を、単純な命令に分けるが、頭を整えない（頭の代入・前置きの語・命令の名の path を、書いたまま残す）。
 * 命令の名を書いたままの字で見たい時に使う（guard の、字の含みだけの当たりを通してよいか）。$(…)・`…` の中は splitCommands の形で入る。印は除く。
 */
export function rawCommands(src: string): string[][] {
  return new Lexer(src).run().map(unmarkAll);
}

/** 語から、置き換えの跡の印を除く（前の形。`x$(…)` は x、`$(…)` は空の語）。 */
const unmarkAll = (words: string[]): string[] => words.map(word => word.replaceAll(SUBSTITUTED, ''));

/** 単純な命令 1 つの頭を整える。sh -c と eval は、中の字を命令として読む。決めるのは印を除いた字で、返す語には印を残す。 */
function head(words: string[]): string[][] {
  const plain = unmarkAll(words);
  let k = 0;
  for (;;) {
    while (k < plain.length && ASSIGNMENT.test(plain[k] ?? '')) k += 1;
    if (k < plain.length && PREFIX_WORDS.has(plain[k] ?? '')) {
      k += 1;
      // sudo -u x・env -i などの旗は飛ばす（旗の値までは見ない）。
      while (k < plain.length && (plain[k] ?? '').startsWith('-')) k += 1;
      continue;
    }
    break;
  }
  const rest = plain.slice(k);
  const name = rest[0]?.split('/').at(-1);
  // 命令の名が置き換えだけの語（`$(…) args`）は、名を読めないので命令に数えない（前からの形）。
  if (name === undefined || name === '') return [];
  if (name === 'eval') return splitCommandsMarked(rest.slice(1).join(' '));
  if (SHELLS.has(name)) {
    const c = rest.findIndex(w => /^-[a-z]*c[a-z]*$/.test(w));
    const script = c === -1 ? undefined : rest[c + 1];
    if (script !== undefined) return splitCommandsMarked(script);
  }
  return [[name, ...words.slice(k + 1)]];
}
