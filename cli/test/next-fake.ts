// 偽の HTTP の handler: 生成した client（cli/gen/<server>-client/）に差し込み、受けた要求を記録して、決まりの形（restJson1）で答える。
// どの server の client にも使える（本文は字のまま text に、JSON なら body にも入れる）。答えは試験が要求ごとに決める。socket は使わない。
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import type { HttpRequest } from '@smithy/types';

/**
 * 受けた要求 1 件。query は引数の名 → 値（重ねた物は配列）。text は本文の字、body は本文が JSON なら読んだ物。
 * origin（送った先の `http://<host>:<port>`）と bytes（本文の byte）は、偽の handler だけが入れる。
 */
export interface NextSeen {
  method: string
  origin?: string
  path: string
  query: Record<string, string | string[] | null>
  headers: Record<string, string>
  text: string | undefined
  bytes?: Buffer
  body: Record<string, unknown> | undefined
}

/**
 * 偽の handler の答え。type があれば restJson1 の誤り（body は message の字、fieldList は ValidationException の欄）。
 * raw は本文の字をそのまま（JSON でない答え）。throws は、つながらない時のように handler が投げる。
 */
export type NextAnswer =
  | { status: number, body?: unknown, type?: string, fieldList?: { path: string, message: string }[], headers?: Record<string, string> }
  | { status: number, raw: string }
  | { throws: Error };

/** 偽の handler を作る。answer が undefined を返す要求は 404 の UnknownOperationException。record が false を返す要求は、答えるが seen に入れない。 */
export function nextHandler(answer: (seen: NextSeen) => NextAnswer | undefined, record: (seen: NextSeen) => boolean = () => true) {
  const seen: NextSeen[] = [];
  const handler = {
    metadata: { handlerProtocol: 'http/1.1' },
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
    destroy: () => undefined,
    handle: (request: HttpRequest) => {
      const raw: unknown = request.body;
      const bytes = typeof raw === 'string' ? Buffer.from(raw) : raw instanceof Uint8Array ? Buffer.from(raw) : undefined;
      const text = bytes?.toString();
      const json = (request.headers['content-type'] ?? '').startsWith('application/json') && text !== undefined && text !== '';
      const one: NextSeen = { method: request.method, origin: `${request.protocol}//${request.hostname}${request.port === undefined ? '' : `:${request.port}`}`, path: request.path, query: { ...request.query }, headers: { ...request.headers }, text, bytes, body: json ? JSON.parse(text) as Record<string, unknown> : undefined };
      // roster の client は、どの頼みにも日本語を頼む（clients.ts の askingJapanese）。頭の無い頼みは、askingJapanese を通していない client の物なので、
      // 残さずに 400 で断る（AI-48）。投げずに答えるのは、投げると「つながらない」と読まれ、つながらない時の道を見る試験が通ってしまうため。
      if (one.headers['accept-language'] !== 'ja') {
        const refused = JSON.stringify({ message: `accept-language: ja の無い頼み（${one.method} ${one.path}）。client を askingJapanese に通す` });
        return Promise.resolve({ response: { statusCode: 400, reason: '', headers: { 'content-type': 'application/json', 'x-amzn-errortype': 'MissingAcceptLanguage' }, body: Readable.from([Buffer.from(refused)]) } });
      }
      if (record(one)) seen.push(one);
      const got = answer(one) ?? { status: 404, type: 'UnknownOperationException', body: '知らない道' };
      if ('throws' in got) return Promise.reject(got.throws);
      const type = 'type' in got ? got.type : undefined;
      const headers: Record<string, string> = { 'content-type': 'application/json', ...('headers' in got ? got.headers : {}), ...(type === undefined ? {} : { 'x-amzn-errortype': type }) };
      const payload = 'raw' in got ? got.raw : JSON.stringify((type === undefined ? got.body : { message: got.body, ...(got.fieldList === undefined ? {} : { fieldList: got.fieldList }) }) ?? {});
      return Promise.resolve({ response: { statusCode: got.status, reason: '', headers, body: Readable.from([Buffer.from(payload)]) } });
    },
  };
  return { handler, seen };
}

/**
 * 何も待っていない所（`127.0.0.1:1`）。
 *
 * 空いた口を取って閉じた所にすると、並んで流れる別の試験の偽の server が同じ口を取ることがあり、頼みがそこに届いて
 * 試験が揺れうる（AI-56。Linux では手放した口がまた渡る）。番号 1 は、OS が `listen(0)` で渡す帯（既定で Linux は
 * 32768〜、macOS は 49152〜）の外なので、並ぶ試験の偽の server が取ることは無い。待ち受ける物が居れば、揺れでなく、
 * deadUrl で落ちる。
 */
export const NOWHERE = { host: '127.0.0.1', port: 1 } as const;

/** 何も待っていない 127.0.0.1 の URL（server が止まっている。つなぐと、すぐ断られる）。 */
export async function deadUrl(): Promise<string> {
  await assertRefused(NOWHERE.host, NOWHERE.port);
  return `http://${NOWHERE.host}:${NOWHERE.port}`;
}

/** host:port へつなぎ、すぐ断られる（ECONNREFUSED）ことを確かめる。つながった・待たされた時は、訳を書いて投げる。 */
export async function assertRefused(host: string, port: number): Promise<void> {
  const got = await new Promise<string>((resolve) => {
    const socket = connect(port, host);
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve('2 秒で答えが無い');
    });
    socket.on('connect', () => {
      socket.destroy();
      resolve('つながった');
    });
    socket.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
  });
  if (got === 'ECONNREFUSED') return;
  if (got === 'つながった') throw new Error(`${host}:${port} で何かが待ち受けている。何も待っていない所の試験は、この機械では流せない`);
  throw new Error(`${host}:${port} へつなぐと、断られずに ${got} になった。何も待っていない所の試験は、この機械では流せない`);
}
