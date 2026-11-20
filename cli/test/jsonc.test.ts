import { describe, expect, test } from 'vitest';
import { parseJsonc } from '../src/jsonc.ts';

describe('parseJsonc', () => {
  test('ただの JSON はそのまま読む', () => {
    expect(parseJsonc('{ "a": [1, "x"], "b": null }')).toEqual({ a: [1, 'x'], b: null });
  });

  test('// と /* */ のコメントを読み飛ばす', () => {
    const text = [
      '// 頭のコメント',
      '{',
      '  "a": 1, // 行の後ろ',
      '  /* 塊の',
      '     コメント */ "b": 2',
      '}',
    ].join('\n');
    expect(parseJsonc(text)).toEqual({ a: 1, b: 2 });
  });

  test('object と配列の末尾のカンマを許す（コメントを挟んでも）', () => {
    expect(parseJsonc('{ "a": [1, 2, ], "b": 3, // c\n }')).toEqual({ a: [1, 2], b: 3 });
  });

  test('文字列の中の // ・ /* ・ , は替えない', () => {
    expect(parseJsonc('{ "url": "https://x/*y*/", "s": "a,]", "q": "\\"//\\"" }')).toEqual({ url: 'https://x/*y*/', s: 'a,]', q: '"//"' });
  });

  test('CRLF の行でも読む', () => {
    expect(parseJsonc('{\r\n  "a": 1, // c\r\n}\r\n')).toEqual({ a: 1 });
  });

  test('閉じないコメントは、その場所を言う SyntaxError', () => {
    expect(() => parseJsonc('{\n  "a": 1 /* x')).toThrow(/閉じていないコメント.*line 2 column 10/);
  });

  test('JSON の誤りは、コメントを替えた後も元の行・列を言う', () => {
    expect(() => parseJsonc('{\n  /* c */ "a": 1\n  "b": 2\n}')).toThrow(/line 3 column 3/);
  });

  test('値の間のカンマが無い・余るのは誤り', () => {
    expect(() => parseJsonc('[1,,]')).toThrow(SyntaxError);
    expect(() => parseJsonc('{ , }')).toThrow(SyntaxError);
  });
});
