// 偽の HTTP の handler: 生成した castlist の client（cli/gen/castlist-client/）に差し込み、受けた要求を記録して、決まりの形（restJson1）で答える。
// 答えは試験が道ごとに決める（answer）。type を付けた答えは誤り（X-Amzn-Errortype と本文の message）。socket は使わない。
import { Readable } from 'node:stream';
import type { HttpRequest } from '@smithy/types';

/** 受けた要求 1 件。query は引数の名 → 値（重ねた物は配列）。timeout は send に渡された requestTimeout。 */
export interface NextSeen {
  method: string
  path: string
  query: Record<string, string | string[] | null>
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
  timeout: number | undefined
}

/** 偽の handler の答え。type があれば restJson1 の誤り（body は message の字）。throws は、つながらない時のように handler が投げる。 */
export type NextAnswer = { status: number, body?: unknown, type?: string } | { throws: Error };

/** 偽の handler を作る。answer が undefined を返す要求は 404 の UnknownOperationException。 */
export function nextHandler(answer: (seen: NextSeen) => NextAnswer | undefined) {
  const seen: NextSeen[] = [];
  const handler = {
    metadata: { handlerProtocol: 'http/1.1' },
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
    destroy: () => undefined,
    handle: (request: HttpRequest, options?: { requestTimeout?: number }) => {
      const raw: unknown = request.body;
      const text = typeof raw === 'string' ? raw : raw instanceof Uint8Array ? Buffer.from(raw).toString() : undefined;
      const one: NextSeen = {
        method: request.method,
        path: request.path,
        query: { ...request.query },
        headers: { ...request.headers },
        body: text === undefined || text === '' ? undefined : JSON.parse(text) as Record<string, unknown>,
        timeout: options?.requestTimeout,
      };
      seen.push(one);
      const got = answer(one) ?? { status: 404, type: 'UnknownOperationException', body: '知らない道' };
      if ('throws' in got) return Promise.reject(got.throws);
      const headers: Record<string, string> = { 'content-type': 'application/json', ...(got.type === undefined ? {} : { 'x-amzn-errortype': got.type }) };
      const body = got.type === undefined ? got.body : { message: got.body };
      return Promise.resolve({ response: { statusCode: got.status, reason: '', headers, body: Readable.from([Buffer.from(JSON.stringify(body ?? {}))]) } });
    },
  };
  return { handler, seen };
}
