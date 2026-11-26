// 生成した client（cli/gen/<server>-client/。server の Smithy の定義から作った restJson1 の client）の土台。castlist と pagetray には、これで送る。
// 生成した client は、使う時だけ読む（module の頭で読まない。送る物の無い guard の起動を遅くしない）。build した JS（dist-cjs/）を createRequire で読み、型は dist-types/ から取る。
import { createRequire } from 'node:module';
import type { HttpHandler, HttpHandlerUserInput } from '@smithy/core/protocols';
import type { Provider, UserAgent } from '@smithy/types';
import type * as Castlist from '../gen/castlist-client/dist-types/index.js';
import type * as Pagetray from '../gen/pagetray-client/dist-types/index.js';
import { TpmError } from './skill-sets.ts';

const load = createRequire(import.meta.url);

/** 生成した castlist の client の module。初めて呼んだ時に読む（Node が控えるので、2 度目からは読まない）。 */
export const castlistApi = (): typeof Castlist => load('../gen/castlist-client/dist-cjs/index.js') as typeof Castlist;

/** 生成した pagetray の client の module。初めて呼んだ時に読む。 */
export const pagetrayApi = (): typeof Pagetray => load('../gen/pagetray-client/dist-cjs/index.js') as typeof Pagetray;

/** 生成した client を作る時に、必ず書く欄（clientConfig）。 */
export interface ClientConfig {
  endpoint: string
  /** 送る回数（1 は送り直さない）。 */
  maxAttempts: number
  retryMode: 'standard'
  defaultsMode: 'standard'
  requestHandler: HttpHandlerUserInput
  /** User-Agent の字（roster だけ）。 */
  defaultUserAgentProvider: Provider<UserAgent>
  /** User-Agent に足す app id（足さない）。 */
  userAgentAppId: Provider<string | undefined>
}

/**
 * 生成した client を作る時の設定。生成した runtimeConfig は、書かない欄を AWS の決まり（環境変数 AWS_MAX_ATTEMPTS・AWS_RETRY_MODE と ~/.aws/config の profile）から読み、
 * 3 回まで送り直す（castlist の Unavailable は `@retryable`）。だから、そこから読む欄をみな書き、送り直さない（1 度だけ送る。送り直すかは呼ぶ側が決める）。
 * requestHandler の時間切れ（wait ミリ秒）は、つなぐまでと答えの頭までしか数えない（本文を読む間は数えない）。送る 1 回の全部（curl の --max-time と同じ）の上限は、
 * 呼ぶ側が send に渡す abortSignal（AbortSignal.timeout）で付ける。接続は使い回さない（命令の process が、送り終えたらすぐ終わるように）。
 * requestHandler は試験が偽の HTTP を差し込む所（無ければ node の http）。
 */
export function clientConfig(url: string, wait: number, requestHandler?: HttpHandler): ClientConfig {
  return {
    endpoint: url,
    maxAttempts: 1,
    retryMode: 'standard',
    defaultsMode: 'standard',
    requestHandler: requestHandler ?? { connectionTimeout: wait, requestTimeout: wait, throwOnRequestTimeout: true, httpAgent: { keepAlive: false } },
    // 既定の User-Agent は AWS の SDK の名と、環境変数 AWS_SDK_UA_APP_ID・~/.aws/config の app id を足す。
    defaultUserAgentProvider: () => Promise.resolve([['roster']]),
    userAgentAppId: () => Promise.resolve(undefined),
  };
}

/** middleware を名で外せる物（生成した client はどれも）。 */
export interface HasMiddleware {
  middlewareStack: {
    /** 名の middleware を外す（無ければ false）。 */
    remove: (name: string) => boolean
  }
}

/** 作った client から、AWS の Lambda のための頭（環境変数 AWS_LAMBDA_FUNCTION_NAME・_X_AMZN_TRACE_ID を読んで X-Amzn-Trace-Id を足す）を外す。 */
export function withoutAwsMiddleware<T extends HasMiddleware>(client: T): T {
  // 外せなければ止める（@aws-sdk/core の更新で名が替わると、黙って環境変数を読む形に戻るため）。
  // install し直しても直らないので、install の訳にしない（sendOnce は TpmError をそのまま投げる）。
  if (!client.middlewareStack.remove('recursionDetectionMiddleware')) throw new TpmError('生成した client から recursionDetectionMiddleware を外せない（@aws-sdk/core の名が替わった。cli/pnpm-lock.yaml の版に戻すか、外す名を直す）。roster ask tpm で知らせてください');
  return client;
}

/**
 * 生成した client で 1 つ送った結果（server を問わない形）。
 * failed は HTTP の誤りの答え（状態の数・訳・ValidationException の fieldList の path）。down は答えの無い物（つながらない・時間切れ）と、2xx なのに本文を読めない答え
 * （読めない 2xx は、その状態の数を status に持つ。形の違う答えを、応えないと見分けるため）。
 */
export type Sent<O> = { kind: 'ok', out: O } | { kind: 'failed', code: number, message: string, fields: string[] } | { kind: 'down', status?: number };

/** 送り終えたら閉じる物（生成した client はどれも）。 */
export interface Closable {
  /** 接続を閉じる。 */
  destroy: () => void
}

/** {@link sendOnce} の、server ごとに違う所。 */
export interface SendHow {
  /** 訳に入れる server の名（castlist・pagetray）。 */
  server: string
  /** 送る 1 回の全部（つなぐ・送る・答えの本文を読み終えるまで）の上限のミリ秒（curl の --max-time と同じ）。 */
  wait: number
  /** 誤りの型の無い 404（この roster の呼ぶ道を持たない、定義より古い版の server が答えた物）の訳。 */
  outdated: string
}

/**
 * 生成した client で 1 つ送る（server を問わない送り方。答えの形の直しは server ごとの呼ぶ側）。
 * make で client を作り（読めなければ install を言う TpmError。lock を替えた後に install していない時。guard は、この誤りを 2 で止める）、
 * 送る 1 回の全部を abortSignal で how.wait に切る。client は送り終えたら閉じる。
 */
export async function sendOnce<C extends Closable, O>(make: () => C, send: (client: C, options: { abortSignal: AbortSignal }) => Promise<O>, how: SendHow): Promise<Sent<O>> {
  let client: C;
  try {
    client = make();
  }
  catch (e) {
    if (e instanceof TpmError) throw e;
    throw new TpmError(`生成した ${how.server} の client を読めません（${e instanceof Error ? e.message : String(e)}）。cli/ で pnpm install --frozen-lockfile を打ってください`);
  }
  try {
    return { kind: 'ok', out: await send(client, { abortSignal: AbortSignal.timeout(how.wait) }) };
  }
  catch (e) {
    const code = (e as { $metadata?: { httpStatusCode?: unknown } } | undefined)?.$metadata?.httpStatusCode;
    const type = (e as { name?: unknown } | undefined)?.name;
    // 答えの無い物と、時間切れ・中止（頭の後に本文で止まった時も、状態の数を持つことがある）は、状態の数の無い down（応えない）。
    if (typeof code !== 'number' || type === 'AbortError' || type === 'TimeoutError') return { kind: 'down' };
    // 2xx なのに本文を読めない答えは、状態の数を持つ down（0.x の置き場の /healthz の字の ok など）。
    if (code >= 200 && code < 300) return { kind: 'down', status: code };
    const fields = ((e as { fieldList?: { path?: unknown }[] }).fieldList ?? []).map(f => f.path).filter((p): p is string => typeof p === 'string');
    const message = code === 404 && type !== 'NotFound' ? how.outdated : e instanceof Error ? e.message : String(e);
    return { kind: 'failed', code, message, fields };
  }
  finally {
    client.destroy();
  }
}

/** 欄の名（camelCase）を前の API の名（snake_case）にする。 */
const snakeName = (name: string): string => name.replaceAll(/[A-Z]/g, c => `_${c.toLowerCase()}`);

/**
 * 新しい API の答えを前の API の形にする（呼ぶ側の code と --json の形を替えないため）: 欄の名を snake_case に、時刻（Date）を字（UTC・ミリ秒まで）にし、$metadata を落とす。
 * keep の名の欄の中（送られた物そのままの labels・detail など）は替えない。
 */
export function toSnake(value: unknown, keep: readonly string[] = []): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(v => toSnake(v, keep));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '$metadata').map(([k, v]) => [snakeName(k), keep.includes(k) ? v : toSnake(v, keep)]));
}
