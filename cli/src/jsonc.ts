// JSONC（コメントと末尾のカンマを許す JSON）を読む。
// 依存を足さない（足すと、pull の後に pnpm install し直すまで roster が import で落ちる）。
// コメントと末尾のカンマを同じ長さの空白に替えて（改行は残す）JSON.parse に渡すので、誤りの行・列はそのまま合う。

/** JSONC の text を読む。読めなければ JSON.parse と同じ SyntaxError を投げる。 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(blankTrailingCommas(blankComments(text)));
}

/** 文字列の外の // … と /* … *\/ を空白に替える。閉じない /* は SyntaxError。 */
function blankComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    }
    else if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      const end = nl === -1 ? text.length : nl;
      out += blank(text.slice(i, end));
      i = end;
    }
    else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) throw new SyntaxError(`閉じていないコメント（/*）があります: ${position(text, i)}`);
      out += blank(text.slice(i, close + 2));
      i = close + 2;
    }
    else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * 文字列の外で、値の後ろにあり、空白だけを挟んで `}` か `]` が続くカンマを空白に替える。
 * `{`・`[`・`,` の直後のカンマ（`{ , }`・`[1,,]`）は替えず、JSON.parse の誤りにする。
 */
function blankTrailingCommas(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += c === ',' && !/[{[,]\s*$/.test(out) && /^\s*[}\]]/.test(text.slice(i + 1)) ? ' ' : c;
    i++;
  }
  return out;
}

/** text[start] の " で始まる文字列の、閉じる " の次の位置（閉じなければ末尾。誤りは JSON.parse に任せる）。 */
function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === '"') return i + 1;
    else i++;
  }
  return text.length;
}

/** 改行は残し、ほかを空白にする。 */
const blank = (s: string): string => s.replace(/[^\n]/g, ' ');

/** text の位置 i を「line L column C」で言う（JSON.parse の誤りと同じ数え方）。 */
function position(text: string, i: number): string {
  const before = text.slice(0, i).split('\n');
  return `line ${before.length} column ${before[before.length - 1]!.length + 1}`;
}
