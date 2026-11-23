// 置き場のページの返事の状態（返事待ち・答えた）: roster ask pm が返事待ちにし、roster answer が答えたにする。
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { answer, askPm, dismiss, reportDone } from '../src/commands/messages.ts';
import { pageList, pagePut, pageReply } from '../src/commands/page.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { BRIEF, world, type World } from './helpers.ts';

const BASE = 'http://127.0.0.1:8801';
const TPM = { model: 'claude-opus-5-5', effort: 'medium' };

/** TPM 担当が名乗り、t-x7k2 の Software Engineer 担当を起こして名乗らせた世界。担当は確認のページを置ける。 */
function started() {
  const w: World = world();
  hello(w.tpm, TPM);
  assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
  const se: Context = w.role('t-x7k2', 'file:1');
  hello(se);
  const html = join(w.project, '..', 'confirm-src.html');
  /** 確認のページを置いて、URL を返す。 */
  const confirm = (title: string): string => {
    writeFileSync(html, `<title>${title}</title>`);
    return pagePut(se, html, { kind: 'confirm' })[1]?.replace('URL: ', '') ?? '';
  };
  const project = basename(w.tpm.state.dir);
  /** 置き場に入っているページの返事の状態（番号で）。 */
  const state = (n: number): string => {
    const r = w.store.pages.get(`/${project}/t-x7k2/confirm-${n}.html`)?.record;
    return r?.answered_at !== undefined ? 'answered' : r?.asked_at !== undefined ? 'waiting' : 'none';
  };
  const texts = (address: string): string[] => w.wire.inbox(address).map(m => m.text);
  return { w, se, tpm: w.tpm, confirm, state, texts, project };
}

describe('roster ask pm と roster answer が、置き場のページの返事の状態を書く', () => {
  test('レビュー待ち・上げた件（待ちの相手が Product Manager でない物）は、answer と --supersede の数に入らない', () => {
    const s = started();
    const url = s.confirm('案を選ぶ');
    const other = s.confirm('レビューの依頼書のつもり');
    expect(pageReply(s.tpm, [other], { waiting: true, on: 'review' })).toEqual([`レビュー待ちにした: ${other}`]);
    askPm(s.se, { url, items: ['案の選択'], waitingFor: '案の選択' });
    // Product Manager の返事待ちは 1 枚なので、--url が無くても答えられる
    expect(answer(s.tpm, 't-x7k2', { text: '案 A' })).toEqual(['送った: 【answer】→ file:1（相手の手が空いた時に届く。送り直さない）', `置き場の印: 答えたにした ${url}`]);
    expect(s.state(2)).toBe('waiting');
    expect(pageList(s.tpm, { reply: 'waiting', on: 'review' })).toHaveLength(1);
    expect(() => pageList(s.tpm, { on: 'review' })).toThrow(/--on は --reply と一緒に/);
    expect(() => pageList(s.tpm, { reply: 'waiting', on: 'staff' })).toThrow(/--on は pm/);
  });

  test('ask pm が確認のページを返事待ちにし、answer が答えたにする（--url は要らない）', () => {
    const s = started();
    const url = s.confirm('案を選ぶ');
    expect(s.state(1)).toBe('none');
    expect(askPm(s.se, { url, items: ['案の選択'], waitingFor: '案の選択' })).toEqual([
      '送った: 【ask-pm】→ file:tpm（相手の手が空いた時に届く。送り直さない）',
      `置き場の印: 返事待ちにした ${url}`,
      '状態: 回答待ち(PM): 案の選択',
    ]);
    expect(s.state(1)).toBe('waiting');
    expect(pageList(s.tpm, { reply: 'waiting' })).toHaveLength(1);
    expect(pageList(s.tpm, { reply: 'answered' })).toEqual(['合うページは無い']);

    expect(answer(s.tpm, 't-x7k2', { text: '案 A' })).toEqual([
      '送った: 【answer】→ file:1（相手の手が空いた時に届く。送り直さない）',
      `置き場の印: 答えたにした ${url}`,
    ]);
    expect(s.state(1)).toBe('answered');
    expect(pageList(s.tpm, { reply: 'waiting' })).toEqual(['合うページは無い']);
    expect(() => pageList(s.tpm, { reply: 'done' })).toThrow(/--reply は waiting/);
  });

  test('返事待ちが無い Key への answer は、印に触らずに答えを返す', () => {
    const s = started();
    s.confirm('まだ送っていない確認');
    expect(answer(s.tpm, 't-x7k2', { text: '進めてよい' })).toEqual(['送った: 【answer】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    expect(s.state(1)).toBe('none');
  });

  test('返事待ちが 2 枚ある時、どれへの答えかが無ければ、送る前に止まる。--url でそのページだけ、--all でみな', () => {
    const s = started();
    const first = s.confirm('案を選ぶ');
    const second = s.confirm('計画の確認');
    askPm(s.se, { url: first, items: ['案の選択'], waitingFor: '案' });
    askPm(s.se, { url: second, items: ['計画の承認'], waitingFor: '計画' });

    expect(() => answer(s.tpm, 't-x7k2', { text: '案 A' })).toThrow(new RegExp(`返事待ちのページが 2 枚あります。答えは送っていません[\\s\\S]*${first}\\n${second}\\n[\\s\\S]*--url`));
    expect(s.texts('file:1').filter(t => t.startsWith('【answer】'))).toEqual([]);
    expect([s.state(1), s.state(2)]).toEqual(['waiting', 'waiting']);

    expect(answer(s.tpm, 't-x7k2', { text: '案 A', urls: [first] })).toEqual([
      '送った: 【answer】→ file:1（相手の手が空いた時に届く。送り直さない）',
      `置き場の印: 答えたにした ${first}`,
    ]);
    expect([s.state(1), s.state(2)]).toEqual(['answered', 'waiting']);
    // 残りが 1 枚になれば、また --url は要らない。
    answer(s.tpm, 't-x7k2', { text: '計画のとおり' });
    expect(s.state(2)).toBe('answered');

    const third = s.confirm('3 つ目');
    const fourth = s.confirm('4 つ目');
    askPm(s.se, { url: third, items: ['a'], waitingFor: 'a' });
    askPm(s.se, { url: fourth, items: ['b'], waitingFor: 'b' });
    expect(answer(s.tpm, 't-x7k2', { text: 'どちらもお勧めのとおり', all: true }).slice(1)).toEqual([
      `置き場の印: 答えたにした ${third}`,
      `置き場の印: 答えたにした ${fourth}`,
    ]);
    expect(() => answer(s.tpm, 't-x7k2', { text: '別の答え', urls: ['https://example.com/x.html'] })).toThrow(/--url は、置き場の確認のページの URL/);
  });

  test('置き場の外の URL（前の形の確認）では、置き場に頼まず、行も足さない', () => {
    const s = started();
    const before = s.w.calls.length;
    expect(askPm(s.se, { url: 'https://claude.ai/artifact/c1', items: ['案の選択'], waitingFor: '案の選択' })).toEqual([
      '送った: 【ask-pm】→ file:tpm（相手の手が空いた時に届く。送り直さない）',
      '状態: 回答待ち(PM): 案の選択',
    ]);
    expect(s.w.calls.length).toBe(before);
  });
});

describe('返事の状態を持てない置き場でも、メッセージは送る', () => {
  test('0.5.0 より前の置き場（書く道が無く、一覧は絞りを読まない）: 印は付けず、ask pm も answer も通る', () => {
    const s = started();
    const first = s.confirm('案を選ぶ');
    s.confirm('計画の確認');
    s.w.store.noReply = true;
    const out = askPm(s.se, { url: first, items: ['案の選択'], waitingFor: '案の選択' });
    expect(out[0]).toBe('送った: 【ask-pm】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    expect(out[1]).toMatch(/^置き場の印: 付けていない（置き場の版が古く/);
    expect(out[2]).toBe('状態: 回答待ち(PM): 案の選択');
    // 前の置き場は reply の絞りを読まずに 2 枚とも返すが、返事待ちとは数えない（止まらない）。
    expect(answer(s.tpm, 't-x7k2', { text: '案 A' })).toEqual(['送った: 【answer】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    expect(pageList(s.tpm, { reply: 'waiting' })).toEqual(['合うページは無い']);
    expect(() => pageReply(s.tpm, [first], { waiting: true })).toThrow(/版が古く[\s\S]*roster ask devops/);
  });

  test('止まっている置き場: 印は付けず、ask pm も answer も dismiss も通る', () => {
    const s = started();
    const url = s.confirm('案を選ぶ');
    s.w.store.down = true;
    const out = askPm(s.se, { url, items: ['案の選択'], waitingFor: '案の選択' });
    expect(out[1]).toMatch(new RegExp(`^置き場の印: 付けていない（置き場が応えない。[\\s\\S]*roster page reply ${url} --waiting`));
    expect(s.texts('file:tpm').at(-1)).toMatch(/^【ask-pm】/);
    expect(answer(s.tpm, 't-x7k2', { text: '案 A' })).toEqual(['送った: 【answer】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    expect(() => pageReply(s.tpm, [url], { waiting: true })).toThrow(/置き場（.*）が応えません。返事の状態は書いていません。/);
    reportDone(s.se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
    expect(dismiss(s.tpm, 't-x7k2', { handover: false })).toEqual(['送った: 【dismiss】→ file:1（相手の手が空いた時に届く。送り直さない）']);
  });
});

describe('roster page reply と roster dismiss', () => {
  test('TPM 担当が手で直せる。担当からは止まる。旗は 1 つだけ', () => {
    const s = started();
    const url = s.confirm('案を選ぶ');
    expect(pageReply(s.tpm, [url], { waiting: true })).toEqual([`返事待ちにした: ${url}`]);
    expect(s.state(1)).toBe('waiting');
    expect(pageReply(s.tpm, [url], { answered: true })).toEqual([`答えたにした: ${url}`]);
    expect(s.state(1)).toBe('answered');

    expect(() => pageReply({ ...s.se, env: { ...s.se.env, ROSTER_ROLE: 'software-engineer' } }, [url], { waiting: true })).toThrow(/TPM 担当だけ/);
    expect(() => pageReply(s.tpm, [url], {})).toThrow(/どちらか 1 つ/);
    expect(() => pageReply(s.tpm, [url], { waiting: true, answered: true })).toThrow(/どちらか 1 つ/);
    expect(() => pageReply(s.tpm, [], { waiting: true })).toThrow(/URL を 1 つ以上/);
    expect(() => pageReply(s.tpm, [url, `${BASE}/`], { waiting: true })).toThrow(/ページの URL ではありません/);
    expect(s.state(1)).toBe('answered');
    expect(() => pageReply(s.tpm, [`${BASE}/${s.project}/t-x7k2/confirm-9.html`], { waiting: true })).toThrow(/置き場にありません/);
  });

  test('dismiss は、返事待ちのまま残るページを知らせる（止めない）', () => {
    const s = started();
    const url = s.confirm('案を選ぶ');
    askPm(s.se, { url, items: ['案の選択'], waitingFor: '案' });
    reportDone(s.se, { kind: 'proposal', summary: '3 案', remaining: 'なし', decisions: '案の選択', points: [] });
    expect(dismiss(s.tpm, 't-x7k2', { handover: false })).toEqual([
      '送った: 【dismiss】→ file:1（相手の手が空いた時に届く。送り直さない）',
      '置き場に、t-x7k2 の返事待ちのページが 1 枚残っています:',
      url,
      'もう答えが要らなければ、roster page reply <URL>… --answered で印を外す',
    ]);
  });
});

describe('roster ask pm --supersede: 置き換えた古い確認の印を外す', () => {
  test('新しい確認を返事待ちにし、名指した古い確認を答えたにする。置き換えはメッセージ（log）にも載る', () => {
    const s = started();
    const old = s.confirm('plan-9 で進むか');
    const other = s.confirm('名の言葉づかい');
    const next = s.confirm('plan-10 で進むか');
    askPm(s.se, { url: old, items: ['plan-9 で進むか'], waitingFor: 'a' });
    askPm(s.se, { url: other, items: ['名'], waitingFor: 'b' });

    expect(askPm(s.se, { url: next, items: ['plan-10 で進むか'], waitingFor: '進むか', supersede: [old] })).toEqual([
      '送った: 【ask-pm】→ file:tpm（相手の手が空いた時に届く。送り直さない）',
      `置き場の印: 返事待ちにした ${next}`,
      `置き場の印: 置き換えたので返事待ちを外した ${old}`,
      '状態: 回答待ち(PM): 進むか',
    ]);
    // 名指さなかった確認は、同じ Key でも返事待ちのまま。
    expect([s.state(1), s.state(2), s.state(3)]).toEqual(['answered', 'waiting', 'waiting']);
    expect(s.texts('file:tpm').at(-1)).toBe(`【ask-pm】${next} 項目: (1) plan-10 で進むか 置き換える確認: ${old}`);
    const logged = s.w.tpm.state.lines<{ heading: string, text: string }>('log.jsonl').findLast(l => l.heading === 'ask-pm');
    expect(logged?.text).toContain(`置き換える確認: ${old}`);
  });

  test('別の Key・答え済み・返事を求めていない・置き場の外・送る確認そのものは、送る前に断る', () => {
    const s = started();
    const old = s.confirm('古い');
    const notAsked = s.confirm('送っていない');
    const next = s.confirm('新しい');
    askPm(s.se, { url: old, items: ['a'], waitingFor: 'a' });
    answer(s.tpm, 't-x7k2', { text: '答え' });
    const sent = s.texts('file:tpm').length;
    const ask = (supersede: string[]) => () => askPm(s.se, { url: next, items: ['b'], waitingFor: 'b', supersede });

    expect(ask([`${BASE}/${s.project}/t-other/confirm-1.html`])).toThrow(/t-x7k2 の確認だけを置き換えられます[\s\S]*t-other/);
    expect(ask([old])).toThrow(/返事待ちではありません[\s\S]*confirm-1\.html/);
    expect(ask([notAsked])).toThrow(/返事待ちではありません[\s\S]*confirm-2\.html/);
    expect(ask(['https://example.com/x.html'])).toThrow(/置き場の確認のページの URL/);
    expect(ask([next])).toThrow(/送る確認そのもの/);
    // どれも送っていない・印も変えていない。
    expect(s.texts('file:tpm')).toHaveLength(sent);
    expect([s.state(1), s.state(2), s.state(3)]).toEqual(['answered', 'none', 'none']);
  });

  test('止まっている置き場では、返事待ちかを確かめられないので断らず、外せなかったことと直し方を出す', () => {
    const s = started();
    const old = s.confirm('古い');
    const next = s.confirm('新しい');
    askPm(s.se, { url: old, items: ['a'], waitingFor: 'a' });
    s.w.store.down = true;
    const out = askPm(s.se, { url: next, items: ['b'], waitingFor: 'b', supersede: [old] });
    expect(out[0]).toBe('送った: 【ask-pm】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    expect(out[2]).toMatch(new RegExp(`^置き場の印: 付けていない（置き場が応えない。[\\s\\S]*roster page reply ${old} --answered`));
  });
});
