// shell に渡す語の引用。利用者が写して打つ 1 行と、hook の命令（Claude Code が shell で動かす）が使う。

/** shell の 1 語として打てるように引用する。安全な字だけならそのまま、ほかは '…' で包む。 */
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_./:=,+@%-]+$/.test(word)) return word;
  return `'${word.replaceAll('\'', '\'\\\'\'')}'`;
}
