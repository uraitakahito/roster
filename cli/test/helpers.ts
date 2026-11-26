// 決まりの命令の試験の足場: file の連携を使う project と、TPM 担当・担当それぞれの周りを作る。
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_TYPES, type FileRecord } from '../src/commands/file.ts';
import type { PageRecord } from '../src/commands/page.ts';
import { DEFAULT_PAGES_URL, pagetrayClient } from '../src/commands/store.ts';
import { createContext, type Context } from '../src/context.ts';
import type { Exec, ExecOptions, ExecResult } from '../src/exec.ts';
import { nextHandler, type NextAnswer, type NextSeen } from './next-fake.ts';
import { reportDone } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { FileTransport } from '../src/transport/file.ts';

/** 課題の概要の節（40 字以上）のある依頼書。world が置き場に置く。 */
export const BRIEF_HTML = '<h1>依頼書</h1><section id="summary"><h2>課題の概要</h2><p>試しの課題。担当が課題の中身を読めるようにし、TPM 担当が相談に乗れるようにすることが求められている。</p></section>';
/** world が置き場に置く、概要の節のある依頼書の URL（どの world でも同じ）。 */
export const BRIEF = `${DEFAULT_PAGES_URL}/brief-1.html`;

export interface Call {
  cmd: string
  args: string[]
  options?: ExecOptions
}

/** 誤りの状態の数 → restJson1 の誤りの型（新しい API の決まり）。 */
const ERROR_TYPES: Readonly<Record<number, string>> = { 400: 'ValidationException', 403: 'Forbidden', 404: 'NotFound', 409: 'Conflict', 413: 'PayloadTooLarge', 415: 'UnsupportedMediaType', 500: 'InternalError', 503: 'Unavailable' };

/** 新しい API の誤りの答え。 */
const failed = (status: number, message: string, fieldList?: { path: string, message: string }[]): NextAnswer => ({ status, type: ERROR_TYPES[status] ?? 'InternalError', body: message, ...(fieldList === undefined ? {} : { fieldList }) });

/** 記録（PageRecord・FileRecord。欄は snake_case、n は数）を、新しい API の答えの形（欄は camelCase、n は字）にする。 */
const wire = (record: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k.replaceAll(/_([a-z])/g, (_, c: string) => c.toUpperCase()), k === 'n' ? String(v) : v as unknown]));

/** 一覧の 1 頁（新しい API の maxResults・nextToken。nextToken は次の頭の位置の字）。 */
function pageOf<T>(rows: T[], q: URLSearchParams): { items: T[], nextToken?: string } {
  const from = Number(q.get('nextToken') ?? 0);
  const to = from + Number(q.get('maxResults') ?? 100);
  return { items: rows.slice(from, to), ...(to < rows.length ? { nextToken: String(to) } : {}) };
}

/** 偽の置き場が持つメッセージの記録（新しい API の答えの形のまま。時刻は UTC・ミリ秒までの字）。 */
export interface MessageRecord {
  project: string
  id: string
  key?: string
  heading: string
  from: string
  to: string
  text: string
  sentAt: string
  state: string
  deliveredAt?: string
  via?: string
  deliveries?: number
  replyTo?: string
  createdAt: string
  updatedAt: string
  /** 送り手の付随する id（「送った側」の書き込みに付いていた時だけ）。 */
  sender?: { issuer: string, ref: string }
}

/** メッセージの状態の強さ（書き足しは、今より強い時だけ替える）。 */
const STATE_RANK: Readonly<Record<string, number>> = { waiting: 0, carried: 0, expired: 1, undeliverable: 1, delivered: 2 };

/** 道の 1 段（project・Key）に置ける字か。 */
const isSegment = (v: string): boolean => /^[A-Za-z0-9._-]{1,255}$/.test(v) && v !== '.' && v !== '..';
/** メッセージの id の形か。 */
const isMessageId = (v: string): boolean => /^[A-Za-z0-9._-]{1,128}$/.test(v);

/**
 * 偽の置き場: 生成した pagetray の client が送る新しい API（restJson1）の要求と、本文を取る curl（GET /<project>/<Key>/…）を受け、本物（pagetray 1.1.0）と同じ決まりで答える。
 * 番号は種類ごとに今の最大＋1（消した番号も数える）、名指した番号が使われているか消した番号なら 409。消した URL は 410。本物との揃いは、CI のつなぎの段が見る。
 * file（/api/projects/<project>/keys/<Key>/files・/api/files）も同じ決まり。番号は名と拡張子ごと。world は client（{@link FakeStore.client}）を Context に差し込む。
 * メッセージの記録（PutMessage・ListMessages）は、初めての id は 201・もうある id は 200 の書き足し（状態は前へだけ進む）。
 */
export class FakeStore {
  /** 置かれたページ（置き場の中の path → 記録と本文）。 */
  pages = new Map<string, { record: PageRecord, body: Buffer }>();
  /** 消したページの path（番号は 2 度使わず、URL は 410）。 */
  removed = new Set<string>();
  /** true の間、つながらない（curl の exit 7。client は送れない）。 */
  down = false;
  /** 置く要求の答えを替える（置き場が断る時の試験）。message は誤りの訳。 */
  refuse: { code: number, message: string } | undefined;
  /** 置かれた file（置き場の中の path → 記録と中身）。 */
  files = new Map<string, { record: FileRecord, body: Buffer }>();
  /** 消した file の path。 */
  removedFiles = new Set<string>();
  /** 置けば、印を書く要求（SetReplyState・AddReviewMarks）に、この code で誤りを返す（置き場が誤りを返す時の試験）。 */
  markError: number | undefined;
  /** 置く要求（CreatePage・CreateFile）の引数（新しい API の名）。送った順。 */
  posts: URLSearchParams[] = [];
  /**
   * 受けた新しい API の要求（つながらない間の物も）。送った順。メッセージの記録を置く要求（PutMessage）は入れず、{@link FakeStore.messagePuts} に入れる
   * （送る命令のたびに、命令を待たせずに出るので、ページと file の要求の並びを見る試験に混ぜない）。
   */
  requests: NextSeen[] = [];
  /** 置かれたメッセージの記録（`<project>/<id>` → 記録。置いた順）。 */
  messages = new Map<string, MessageRecord>();
  /** 受けた、メッセージの記録を置く要求（PutMessage。つながらない間の物も）。送った順。 */
  messagePuts: NextSeen[] = [];
  /** 置けば、メッセージの記録を置く要求に、この code で誤りを返す（503 は、置き場が castlist に聞けない時）。 */
  messageError: number | undefined;
  /** true の間、メッセージの記録の操作を持たない（pagetray 1.0.2 までの置き場。知らない道の 404 を返す）。 */
  noMessages = false;
  /**
   * 送り手（actorIssuer・actorRef）を書いた置く要求に、castlist が何と答えたことにするか（pagetray の「送り手」）。
   * known は登録のあるアクター（置く）、unregistered は登録が無い（400 の fieldList に /actorRef）、unreachable は castlist に聞けない（503）。どちらも何も置かない。
   */
  sender: 'known' | 'unregistered' | 'unreachable' = 'known';

  /** 返事の状態を書いた回数（時刻をずらすため）。 */
  private replies = 0;

  /** 生成した client に差し込む偽の HTTP の handler。 */
  private readonly handler = nextHandler(seen => this.answer(seen)).handler;

  /** この置き場に送る、生成した pagetray の client（Context の clients.pagetray）。 */
  client = (url: string): ReturnType<typeof pagetrayClient> => pagetrayClient(url, this.handler);

  /** 新しい API の要求に答える。知らない道は undefined（型の無い 404 でなく、偽の handler の UnknownOperationException）。 */
  private answer(seen: NextSeen): NextAnswer | undefined {
    const message = /^\/api\/projects\/([^/]+)\/messages\/([^/]+)$/.exec(seen.path)?.slice(1).map(decodeURIComponent);
    const putsMessage = seen.method === 'PUT' && message !== undefined;
    (putsMessage ? this.messagePuts : this.requests).push(seen);
    if (this.down) return { throws: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8801'), { code: 'ECONNREFUSED' }) };
    const q = new URLSearchParams(Object.entries(seen.query).flatMap(([k, v]) => typeof v === 'string' ? [[k, v]] : []));
    const at = (re: RegExp): string[] | undefined => re.exec(seen.path)?.slice(1).map(decodeURIComponent);
    const page = at(/^\/api\/projects\/([^/]+)\/keys\/([^/]+)\/kinds\/([^/]+)\/pages\/([^/]+)\/(reply|review)$/);
    const pages = at(/^\/api\/projects\/([^/]+)\/keys\/([^/]+)\/kinds\/([^/]+)\/pages$/);
    const files = at(/^\/api\/projects\/([^/]+)\/keys\/([^/]+)\/files$/);
    if (seen.method === 'POST' && pages !== undefined) return this.createPage(seen, q, pages);
    if (seen.method === 'POST' && files !== undefined) return this.createFile(seen, q, files);
    if (page !== undefined && ((seen.method === 'PUT' && page[4] === 'reply') || (seen.method === 'POST' && page[4] === 'review'))) {
      if (this.markError !== undefined) return failed(this.markError, '置き場の中の誤り');
      const found = this.pages.get(`/${page[0]}/${page[1]}/${page[2]}-${page[3]}.html`);
      if (found === undefined) return failed(404, 'そのページは無い');
      return page[4] === 'reply' ? this.setReply(found.record, seen.body ?? {}) : this.addMarks(found.record, seen.body ?? {});
    }
    if (seen.path === '/api/pages' && seen.method === 'GET') return this.listPages(q);
    if (seen.path === '/api/pages' && seen.method === 'DELETE') return this.deletePages(q);
    if (seen.path === '/api/files' && seen.method === 'GET') return this.listFiles(q);
    if (seen.path === '/api/files' && seen.method === 'DELETE') return this.deleteFiles(q);
    if (this.noMessages) return undefined;
    if (putsMessage) return this.putMessage(q, message, seen.body ?? {});
    if (seen.path === '/api/messages' && seen.method === 'GET') return this.listMessages(q);
    return undefined;
  }

  /**
   * PutMessage（本文は記録の欄）。初めての id は作る（201）。もうある id は書き足す（200）: 状態は強い時だけ替え、deliveries は大きい方、
   * deliveredAt は初めの時刻、via は状態を替えた時か今が空の時だけ。key・heading・from・to・text・sentAt・replyTo は初めの値を保つ（形は書き足す時も見る）。
   * 送り手は「送った側」の書き込み（waiting・carried）の物だけを castlist に聞いて残す（もう入っていれば替えない）。
   */
  private putMessage(q: URLSearchParams, [project = '', id = '']: string[], body: Record<string, unknown>): NextAnswer {
    if (this.messageError !== undefined) return failed(this.messageError, this.messageError === 503 ? 'castlist に送り手を聞けない' : '置き場の中の誤り');
    const text = (name: string): string | undefined => typeof body[name] === 'string' ? body[name] : undefined;
    const time = (name: string): string | undefined => text(name) === undefined || Number.isNaN(Date.parse(text(name) ?? '')) ? undefined : new Date(text(name) ?? '').toISOString();
    const bad = (path: string): NextAnswer => failed(400, '引数が決まりに合わない', [{ path, message: '決まりに合わない' }]);
    const [key, heading, from, to, content, state, via, replyTo] = ['key', 'heading', 'from', 'to', 'text', 'state', 'via', 'replyTo'].map(text);
    const sentAt = time('sentAt');
    const deliveries = typeof body.deliveries === 'number' ? body.deliveries : undefined;
    const length = (v: string): number => [...v].length;
    if (!isSegment(project) || project === 'api') return bad('/project');
    if (!isMessageId(id) || id === '.' || id === '..') return bad('/id');
    if (key !== undefined && !isSegment(key)) return bad('/key');
    if (heading === undefined || !/^[a-z][a-z0-9-]{0,31}$/.test(heading)) return bad('/heading');
    if (from === undefined || length(from) < 1 || length(from) > 200) return bad('/from');
    if (to === undefined || length(to) < 1 || length(to) > 200) return bad('/to');
    if (content === undefined || length(content) < 1 || length(content) > 8000) return bad('/text');
    if (sentAt === undefined) return bad('/sentAt');
    if (state === undefined || !Object.hasOwn(STATE_RANK, state)) return bad('/state');
    if (body.deliveredAt !== undefined && time('deliveredAt') === undefined) return bad('/deliveredAt');
    if (via !== undefined && !/^[a-z][a-z0-9-]{0,31}$/.test(via)) return bad('/via');
    if (body.deliveries !== undefined && (deliveries === undefined || !Number.isInteger(deliveries) || deliveries < 1)) return bad('/deliveries');
    if (replyTo !== undefined && !isMessageId(replyTo)) return bad('/replyTo');
    // 送り手は「送った側」の書き込みだけ castlist に聞く。ほかは、組（片方だけは 400）だけを見る。
    const sending = STATE_RANK[state] === 0;
    if (q.has('actorIssuer') !== q.has('actorRef')) return failed(400, 'actorIssuer と actorRef は両方書くか、両方書かない', [{ path: '/actorIssuer', message: '両方書くか、両方書かない' }]);
    const refusal = sending ? this.senderRefusal(q) : undefined;
    if (refusal !== undefined) return refusal;
    const sender = sending && q.has('actorRef') ? { issuer: q.get('actorIssuer') ?? '', ref: q.get('actorRef') ?? '' } : undefined;
    const deliveredAt = time('deliveredAt');
    const now = `2026-11-20T14:00:${String(this.messagePuts.length % 60).padStart(2, '0')}.000Z`;
    const name = `${project}/${id}`;
    const had = this.messages.get(name);
    if (had === undefined) {
      const record: MessageRecord = {
        project,
        id,
        ...(key === undefined ? {} : { key }),
        heading,
        from,
        to,
        text: content,
        sentAt,
        state,
        ...(deliveredAt === undefined ? {} : { deliveredAt }),
        ...(via === undefined ? {} : { via }),
        ...(deliveries === undefined ? {} : { deliveries }),
        ...(replyTo === undefined ? {} : { replyTo }),
        createdAt: now,
        updatedAt: now,
        ...(sender === undefined ? {} : { sender }),
      };
      this.messages.set(name, record);
      return { status: 201, body: record };
    }
    const stronger = (STATE_RANK[state] ?? 0) > (STATE_RANK[had.state] ?? 0);
    if (stronger) had.state = state;
    if (via !== undefined && (stronger || had.via === undefined)) had.via = via;
    if (deliveries !== undefined) had.deliveries = Math.max(had.deliveries ?? 0, deliveries);
    if (deliveredAt !== undefined) had.deliveredAt ??= deliveredAt;
    if (sender !== undefined) had.sender ??= sender;
    had.updatedAt = now;
    return { status: 200, body: had };
  }

  /** ListMessages（送った時刻の新しい順が既定。同じ時刻は置いた順で、新しい順なら後に置いた物が先）。 */
  private listMessages(q: URLSearchParams): NextAnswer {
    const word = (q.get('q') ?? '').trim();
    const found = [...this.messages.values()].map((r, i) => ({ r, i }))
      .filter(({ r }) => (['project', 'key', 'to', 'from', 'state', 'heading'] as const).every(f => !q.has(f) || q.get(f) === r[f]))
      .filter(({ r }) => word === '' || [r.text, r.from, r.to].some(v => v.includes(word)))
      .sort((a, b) => (q.get('sort') === 'sentAt' ? 1 : -1) * (a.r.sentAt.localeCompare(b.r.sentAt) || a.i - b.i))
      .map(({ r }) => r);
    const { items, nextToken } = pageOf(found, q);
    return { status: 200, body: { messages: items, ...(nextToken === undefined ? {} : { nextToken }) } };
  }

  /** 置く要求の送り手を見る。置いてよければ undefined、断るなら誤りの答え。片方だけ書いた時は 400（castlist には聞かない）。 */
  private senderRefusal(q: URLSearchParams): NextAnswer | undefined {
    if (q.has('actorIssuer') !== q.has('actorRef')) return failed(400, 'actorIssuer と actorRef は両方書くか、両方書かない', [{ path: '/actorIssuer', message: '両方書くか、両方書かない' }]);
    if (!q.has('actorRef') || this.sender === 'known') return undefined;
    return this.sender === 'unregistered'
      ? failed(400, 'castlist に登録の無い送り手', [{ path: '/actorRef', message: 'castlist に登録の無い送り手' }])
      : failed(503, 'castlist に送り手を聞けない');
  }

  /** 置いた時刻（名指しが無ければ、置いた数でずらした時刻）。 */
  private static createdAt(q: URLSearchParams, fallback: string): string {
    const given = q.get('createdAt');
    return given === null ? fallback : new Date(given).toISOString();
  }

  /** CreatePage。 */
  private createPage(seen: NextSeen, q: URLSearchParams, [project = '', key = '', kind = '']: string[]): NextAnswer {
    this.posts.push(q);
    if (this.refuse !== undefined) return failed(this.refuse.code, this.refuse.message);
    const refusal = this.senderRefusal(q);
    if (refusal !== undefined) return refusal;
    const body = seen.bytes ?? Buffer.alloc(0);
    const prefix = `/${project}/${key}/${kind}-`;
    const taken = [...this.pages.keys(), ...this.removed].filter(p => p.startsWith(prefix) && /^\d+\.html$/.test(p.slice(prefix.length))).map(p => Number.parseInt(p.slice(prefix.length), 10));
    const n = Number(q.get('n') ?? Math.max(0, ...taken) + 1);
    if (taken.includes(n)) return failed(409, 'その番号は、もう使われている');
    const record: PageRecord = {
      project,
      key,
      kind,
      n,
      title: /<title>(.*?)<\/title>/.exec(body.toString())?.[1] ?? '',
      role: q.get('role') ?? '',
      workspace: q.get('workspace') ?? '',
      created_at: FakeStore.createdAt(q, `2026-11-20T12:00:${String(this.pages.size).padStart(2, '0')}.000Z`),
      size: body.length,
      path: `/${project}/${key}/${kind}-${n}.html`,
    };
    this.pages.set(record.path, { record, body });
    const url = `${seen.origin ?? ''}${record.path}`;
    return { status: 201, body: { ...wire(record), url }, headers: { location: url } };
  }

  /** CreateFile。 */
  private createFile(seen: NextSeen, q: URLSearchParams, [project = '', key = '']: string[]): NextAnswer {
    this.posts.push(q);
    if (this.refuse !== undefined) return failed(this.refuse.code, this.refuse.message);
    const body = seen.bytes ?? Buffer.alloc(0);
    const [stem = '', ext = ''] = (q.get('name') ?? '').split('.');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(stem) || body.length === 0) return failed(400, '引数が決まりに合わない', [{ path: '/name', message: '決まりに合わない' }]);
    const type = seen.headers['content-type'] ?? '';
    if (!Object.hasOwn(FILE_TYPES, ext) || type.split(';')[0] !== FILE_TYPES[ext]?.split(';')[0]) return failed(415, '受けない種類');
    // castlist には、ほかの決まり（400・415）を見終えてから聞く。
    const refusal = this.senderRefusal(q);
    if (refusal !== undefined) return refusal;
    const prefix = `/${project}/${key}/files/${stem}-`;
    const taken = [...this.files.keys(), ...this.removedFiles].filter(p => p.startsWith(prefix) && p.endsWith(`.${ext}`) && /^\d+$/.test(p.slice(prefix.length, -ext.length - 1)))
      .map(p => Number.parseInt(p.slice(prefix.length), 10));
    const n = Number(q.get('n') ?? Math.max(0, ...taken) + 1);
    if (taken.includes(n)) return failed(409, 'その番号は、もう使われている');
    const record: FileRecord = {
      project,
      key,
      name: stem,
      ext,
      n,
      type: FILE_TYPES[ext] ?? '',
      size: body.length,
      sha256: '0'.repeat(64),
      role: q.get('role') ?? '',
      workspace: q.get('workspace') ?? '',
      created_at: FakeStore.createdAt(q, `2026-11-20T13:00:${String(this.files.size).padStart(2, '0')}.000Z`),
      path: `/${project}/${key}/files/${stem}-${n}.${ext}`,
    };
    this.files.set(record.path, { record, body });
    const url = `${seen.origin ?? ''}${record.path}`;
    return { status: 201, body: { ...wire(record), url }, headers: { location: url } };
  }

  /** SetReplyState（本文は state と on）。 */
  private setReply(r: PageRecord, body: Record<string, unknown>): NextAnswer {
    const now = `2026-11-20T13:00:${String(this.replies += 1).padStart(2, '0')}.000Z`;
    const on = typeof body.on === 'string' ? body.on : 'pm';
    const nowOn = r.waits_on ?? 'pm';
    if (body.state === 'waiting') {
      // 今ほかの相手を待っていれば、待ちを移さない。
      if (r.asked_at !== undefined && r.answered_at === undefined && on !== nowOn) return failed(409, 'そのページは、on の相手の返事を待っていない（何も替えていない）');
      if (r.asked_at === undefined || r.answered_at !== undefined) r.asked_at = now;
      delete r.answered_at;
      if (on === 'pm') delete r.waits_on;
      else r.waits_on = on;
    }
    else if (body.state === 'answered') {
      if (on !== nowOn || (on !== 'pm' && r.asked_at === undefined)) return failed(409, 'そのページは、on の相手の返事を待っていない（何も替えていない）');
      r.asked_at ??= now;
      r.answered_at ??= now;
    }
    else {
      return failed(400, 'state は waiting か answered', [{ path: '/state', message: 'waiting か answered' }]);
    }
    return { status: 200, body: wire(r) };
  }

  /** AddReviewMarks（本文は verdict と targets）。 */
  private addMarks(r: PageRecord, body: Record<string, unknown>): NextAnswer {
    const verdict = typeof body.verdict === 'string' ? body.verdict : undefined;
    const given = Array.isArray(body.targets) ? body.targets.map(String) : [];
    if (verdict !== undefined && r.kind !== 'review') return failed(400, '判定を書けるのは、kind が review のページだけ', [{ path: '/verdict', message: 'kind が review のページだけ' }]);
    if (given.some(t => !t.startsWith('/') && !t.startsWith('https://'))) return failed(400, 'targets は、置き場のページの path か https の URL', [{ path: '/targets', message: 'path か https の URL' }]);
    if (verdict !== undefined) r.verdict = verdict;
    const targets = [...(r.targets ?? []), ...given];
    if (targets.length > 0) r.targets = [...new Set(targets)];
    return { status: 200, body: wire(r) };
  }

  /** ListPages（reply は on の相手の分だけ。on が無ければ Product Manager の分）。 */
  private listPages(q: URLSearchParams): NextAnswer {
    const found = [...this.pages.values()].map(p => p.record)
      .filter(r => (['project', 'key', 'kind', 'role', 'workspace'] as const).every(f => !q.has(f) || q.get(f) === r[f]))
      .filter(r => !q.has('q') || r.title.includes(q.get('q') ?? ''))
      .filter(r => !q.has('reply') || (q.get('reply') === 'answered' ? r.answered_at !== undefined : r.asked_at !== undefined && r.answered_at === undefined))
      .filter(r => !q.has('reply') || (r.waits_on ?? 'pm') === (q.get('on') ?? 'pm'))
      .sort((a, b) => (q.get('sort') === 'createdAt' ? 1 : -1) * a.created_at.localeCompare(b.created_at));
    const { items, nextToken } = pageOf(found, q);
    return { status: 200, body: { pages: items.map(wire), ...(nextToken === undefined ? {} : { nextToken }) } };
  }

  /** ListFiles。 */
  private listFiles(q: URLSearchParams): NextAnswer {
    const found = [...this.files.values()].map(f => f.record)
      .filter(r => (['project', 'key', 'role', 'workspace'] as const).every(f => !q.has(f) || q.get(f) === r[f]))
      .filter(r => !q.has('q') || `${r.name}.${r.ext}`.includes(q.get('q') ?? ''))
      .sort((a, b) => (q.get('sort') === 'createdAt' ? 1 : -1) * a.created_at.localeCompare(b.created_at));
    const { items, nextToken } = pageOf(found, q);
    return { status: 200, body: { files: items.map(wire), ...(nextToken === undefined ? {} : { nextToken }) } };
  }

  /** DeletePages（project と、key・kind・n）。 */
  private deletePages(q: URLSearchParams): NextAnswer {
    const gone = [...this.pages.values()].map(p => p.record)
      .filter(r => r.project === q.get('project') && (['key', 'kind', 'n'] as const).every(f => !q.has(f) || q.get(f) === String(r[f])))
      .map(r => r.path);
    for (const path of gone) {
      this.pages.delete(path);
      this.removed.add(path);
    }
    return { status: 200, body: { removed: gone } };
  }

  /** DeleteFiles（project と、key・name・n）。 */
  private deleteFiles(q: URLSearchParams): NextAnswer {
    const gone = [...this.files.values()].map(f => f.record)
      .filter(r => r.project === q.get('project') && (!q.has('key') || q.get('key') === r.key)
        && (!q.has('name') || q.get('name') === `${r.name}.${r.ext}`) && (!q.has('n') || q.get('n') === String(r.n)))
      .map(r => r.path);
    for (const path of gone) {
      this.files.delete(path);
      this.removedFiles.add(path);
    }
    return { status: 200, body: { removed: gone } };
  }

  /** 本文を取る curl（`-w %{http_code} -o <file> <URL>`）に答える。本文は -o の file に書き、stdout は HTTP の code。 */
  curl(args: string[]): ExecResult {
    if (this.down) return { status: 7, stdout: '000', stderr: 'curl: (7) Failed to connect' };
    const path = decodeURIComponent(new URL(args.at(-1) ?? '').pathname);
    const out = args[args.indexOf('-o') + 1] ?? '';
    const reply = (code: number, body: Buffer | string): ExecResult => {
      writeFileSync(out, body);
      return { status: 0, stdout: String(code), stderr: '' };
    };
    if (this.removed.has(path)) return reply(410, '{"error":"そのページは消した（2026-11-21T00:00:00.000Z）"}');
    if (this.removedFiles.has(path)) return reply(410, '{"error":"その file は消した"}');
    const found = this.pages.get(path) ?? this.files.get(path);
    return found === undefined ? reply(404, '{"error":"そのページは無い"}') : reply(200, found.body);
  }
}

export interface World {
  project: string
  /** 外の命令（acli・gh）が打たれた記録。 */
  calls: Call[]
  /** TPM 担当の周り。 */
  tpm: Context
  /** key の担当の周り（address は居場所の宛先）。 */
  role: (key: string, address: string) => Context
  /** file の連携（届いたメッセージ・起こす命令を読む）。 */
  wire: FileTransport
  /** 偽の置き場（roster page …・roster file … と、roster assign の課題の写しが使う。API は生成した client で、本文は curl で受ける）。 */
  store: FakeStore
  /** 置き場に頼んだ物（API の要求は `<method> <path>`、本文を取る curl は `GET <URL>`）。置き場に頼む前に止まるかを見る。 */
  asked: () => string[]
  /** sleep で待った回数。 */
  slept: () => number
  /** PR の URL → `gh pr view` が返す state（無い URL は MERGED）。値が undefined の URL は、gh が読めない（exit 1）。 */
  prs: Map<string, string | undefined>
  /** 外の命令の答えを替える（`<命令> <引数…>` の字 → 答え）。無い命令は今までどおり exit 0・`{}`。 */
  answers: Map<string, ExecResult>
}

/** 置き場の API を、偽の置き場（生成した client に差し込む handler）に送る周り。 */
const withStore = (ctx: Context, store: FakeStore): Context => ({ ...ctx, clients: { ...ctx.clients, pagetray: store.client } });

/**
 * config は .claude/roles/config.jsonc に書く中身（transport は file に固定する）。env は TPM 担当の周りの環境変数に足す物。
 * folders は、project の直下の folder の名前 → その folder の設定の中身（上の folder から、下のいくつもの repo を触る形）。
 */
export function world(config: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}, folders: Record<string, Record<string, unknown>> = {}): World {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'roster-world-')));
  const project = join(base, 'project');
  const put = (dir: string, body: Record<string, unknown>): void => {
    mkdirSync(join(dir, '.claude', 'roles'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'roles', 'config.jsonc'), JSON.stringify(body));
  };
  put(project, { ...config, transport: 'file' });
  for (const [name, body] of Object.entries(folders)) put(join(project, name), body);
  mkdirSync(join(base, 'pages'));
  writeFileSync(join(base, 'pages', 'brief-1.html'), BRIEF_HTML);
  const calls: Call[] = [];
  const store = new FakeStore();
  const prs = new Map<string, string | undefined>();
  const answers = new Map<string, ExecResult>();
  const exec: Exec = (cmd, args, options) => {
    // gh pr view は、送る前に PR が merge 済みかを見る命令（calls には数えない。記録の gh と分けるため）。
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      const pr = args[2] ?? '';
      const state = prs.has(pr) ? prs.get(pr) : 'MERGED';
      return state === undefined ? { status: 1, stdout: '', stderr: 'gh: not logged in' } : { status: 0, stdout: JSON.stringify({ state }), stderr: '' };
    }
    calls.push({ cmd, args, ...(options === undefined ? {} : { options }) });
    const answer = answers.get([cmd, ...args].join(' '));
    if (answer !== undefined) return answer;
    // curl は置き場の本文を取る要求（roster page path・roster assign の課題の写しなど）。偽の置き場が答える。
    return cmd === 'curl' ? store.curl(args) : { status: 0, stdout: '{}', stderr: '' };
  };
  let slept = 0;
  const at = (env: NodeJS.ProcessEnv): Context => ({
    // 控えの folder も一時の folder にする（本物の控えに試験のページを置かない）。
    ...withStore(createContext({ XDG_STATE_HOME: join(base, 'state'), ROSTER_PAGES_DIR: join(base, 'pages'), ...env }, project, exec), store),
    now: () => new Date('2026-11-20T12:00:00.000Z'),
    sleep: () => {
      slept += 1;
      return Promise.resolve();
    },
  });
  const tpm = at(env);
  return {
    project,
    calls,
    store,
    asked: () => [...store.requests.map(r => `${r.method} ${r.path}`), ...calls.filter(c => c.cmd === 'curl').map(c => `GET ${c.args.at(-1) ?? ''}`)],
    tpm,
    role: (key, address) => at({ ROSTER_PROJECT: project, ROSTER_KEY: key, ROSTER_ADDRESS: address }),
    wire: new FileTransport(tpm.state, 'file:tpm'),
    slept: () => slept,
    prs,
    answers,
  };
}

/** 担当が名乗り、いちばん新しい依頼書の【done】を返す（TPM 担当の dismiss・続きの assign が、済んでいない依頼書で止まらないように）。 */
export async function finish(w: World, key: string, address: string): Promise<void> {
  const se = w.role(key, address);
  await hello(se);
  reportDone(se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
}

/** Staff Engineer 担当の skill が在る、偽の roster の root（roster assign --role staff-engineer は、skill が無ければ起こす前に止まる）。 */
export function staffRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'roster-root-')));
  mkdirSync(join(root, 'skill-sets', 'core', '.claude', 'skills', 'staff-engineer'), { recursive: true });
  writeFileSync(join(root, 'skill-sets', 'core', '.claude', 'skills', 'staff-engineer', 'SKILL.md'), '# Staff Engineer 担当\n');
  return root;
}
