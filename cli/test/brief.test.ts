// tpm assign が新しい担当を起こす前に、依頼書の課題の概要の節を確かめること。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { summaryText, SUMMARY_MIN } from '../src/brief.ts';
import { DEFAULT_PAGES_URL } from '../src/commands/store.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { BRIEF, finish, world } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const LONG = 'あ'.repeat(SUMMARY_MIN);

/** 置き場に依頼書 name を置き、URL を返す。 */
function put(w: ReturnType<typeof world>, name: string, html: string): string {
  const dir = w.tpm.env.TPM_PAGES_DIR ?? '';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), html);
  return `${DEFAULT_PAGES_URL}/${name}`;
}

describe('summaryText', () => {
  test('<section id="summary"> の中の字を、見出しと tag を除いて返す。引用符と属性の並びを問わない', () => {
    expect(summaryText('<section id="summary"><h2>課題の概要</h2><p>本文 <b>強く</b></p>\n<ul><li>条件</li></ul></section>')).toBe('本文 強く 条件');
    expect(summaryText(`<section class="x" id='summary' data-a="1"><p>本文</p></section>`)).toBe('本文');
  });

  test('節が無ければ undefined。見出しだけなら空の字', () => {
    expect(summaryText('<h2>課題の概要</h2><p>本文</p>')).toBeUndefined();
    expect(summaryText('<section id="summary-x"><p>本文</p></section>')).toBeUndefined();
    expect(summaryText('<section id="summary"><h2>課題の概要</h2></section>')).toBe('');
  });
});

describe('tpm assign が依頼書の課題の概要の節を確かめる', () => {
  test('節が無ければ、居場所を作らずに止まる', () => {
    const w = world();
    hello(w.tpm, TPM);
    const url = put(w, 'brief-2.html', '<h1>依頼書</h1><p>やること</p>');
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: url, wait: 0 })).toThrow(/課題の概要の節がありません。\n振る前に課題を読み[\s\S]*<section id="summary">/);
    expect(w.wire.seats()).toHaveLength(0);
  });

  test(`見出しだけ・${SUMMARY_MIN} 字に足りなければ止まり、${SUMMARY_MIN} 字なら通す`, () => {
    const w = world();
    hello(w.tpm, TPM);
    const empty = put(w, 'brief-2.html', '<section id="summary"><h2>課題の概要</h2></section>');
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: empty, wait: 0 })).toThrow(`短すぎます（0 字。見出しを除いて ${SUMMARY_MIN} 字以上）`);
    const short = put(w, 'brief-3.html', `<section id="summary"><p>${LONG.slice(1)}</p></section>`);
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: short, wait: 0 })).toThrow(`短すぎます（${SUMMARY_MIN - 1} 字`);
    const ok = put(w, 'brief-4.html', `<section id="summary"><p>${LONG}</p></section>`);
    expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: ok, wait: 0 })[0]).toMatch(/^起こした/);
  });

  test('置き場の外の URL は止まる', () => {
    const w = world();
    hello(w.tpm, TPM);
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b1', wait: 0 })).toThrow(/依頼書は置き場のページにしてください（tpm page put <file> --kind brief --key t-x7k2/);
  });

  test('続きの【brief】では確かめない（担当はもう背景を知っている）', () => {
    const w = world();
    hello(w.tpm, TPM);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: BRIEF, wait: 0 });
    finish(w, 't-x7k2', 'file:1');
    const next = put(w, 'brief-2.html', '<h1>計画まで</h1>');
    expect(assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: next, wait: 0 })).toEqual(['送った: 【brief】→ file:1（相手の手が空いた時に届く。送り直さない）']);
  });

  test('担当が消えて起こし直すとき（交代を含む）は確かめる', () => {
    const w = world();
    hello(w.tpm, TPM);
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: BRIEF, wait: 0 });
    w.wire.close('file:1');
    const next = put(w, 'brief-2.html', '<h1>計画まで</h1>');
    expect(() => assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: next, wait: 0 })).toThrow(/課題の概要の節がありません/);
  });

  test('--brief 無しで起こす担当（Dependabot の PR・DevOps）は確かめない', () => {
    const w = world();
    hello(w.tpm, TPM);
    expect(assign(w.tpm, 'app#12', { role: 'sustaining-engineer', wait: 0 })[0]).toMatch(/^起こした/);
    expect(assign(w.tpm, 'devops', { role: 'devops-engineer', wait: 0 })[0]).toMatch(/^起こした/);
  });
});
