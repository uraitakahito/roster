// 偽の HTTP の handler: 生成した client（cli/gen/<server>-client/）に差し込み、受けた要求を記録して、決まりの形（restJson1）で答える。
// どの server の client にも使える（本文は字のまま text に、JSON なら body にも入れる）。答えは試験が要求ごとに決める。socket は使わない。
import { Readable } from 'node:stream';
import type { HttpRequest } from '@smithy/types';

/** 受けた要求 1 件。query は引数の名 → 値（重ねた物は配列）。text は本文の字、body は本文が JSON なら読んだ物。 */
export interface NextSeen {
  method: string
  path: string
  query: Record<string, string | string[] | null>
  headers: Record<string, string>
  text: string | undefined
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

/** 偽の handler を作る。answer が undefined を返す要求は 404 の UnknownOperationException。 */
export function nextHandler(answer: (seen: NextSeen) => NextAnswer | undefined) {
  const seen: NextSeen[] = [];
  const handler = {
    metadata: { handlerProtocol: 'http/1.1' },
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
    destroy: () => undefined,
    handle: (request: HttpRequest) => {
      const raw: unknown = request.body;
      const text = typeof raw === 'string' ? raw : raw instanceof Uint8Array ? Buffer.from(raw).toString() : undefined;
      const json = (request.headers['content-type'] ?? '').startsWith('application/json') && text !== undefined && text !== '';
      seen.push({ method: request.method, path: request.path, query: { ...request.query }, headers: { ...request.headers }, text, body: json ? JSON.parse(text) as Record<string, unknown> : undefined });
      const got = answer(seen.at(-1) as NextSeen) ?? { status: 404, type: 'UnknownOperationException', body: '知らない道' };
      if ('throws' in got) return Promise.reject(got.throws);
      const type = 'type' in got ? got.type : undefined;
      const headers: Record<string, string> = { 'content-type': 'application/json', ...('headers' in got ? got.headers : {}), ...(type === undefined ? {} : { 'x-amzn-errortype': type }) };
      const payload = 'raw' in got ? got.raw : JSON.stringify((type === undefined ? got.body : { message: got.body, ...(got.fieldList === undefined ? {} : { fieldList: got.fieldList }) }) ?? {});
      return Promise.resolve({ response: { statusCode: got.status, reason: '', headers, body: Readable.from([Buffer.from(payload)]) } });
    },
  };
  return { handler, seen };
}
