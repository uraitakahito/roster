// 偽の HTTP の handler: 生成した client（cli/gen/<server>-client/）に差し込み、受けた要求を記録して、決まりの形（restJson1）で答える。
// どの server の client にも使える（本文は字のまま text に、JSON なら body にも入れる）。答えは試験が要求ごとに決める。socket は使わない。
import { createServer } from 'node:net';
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

/** 何も待っていない 127.0.0.1 の URL（server が止まっている）。空いた port を 1 度取って閉じる。 */
export async function deadUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}
