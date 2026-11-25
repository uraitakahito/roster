// 生成した client（cli/gen/<server>-client/。server の Smithy の定義から作った restJson1 の client）の土台（AI-36 の段 6c）。
// server ごとに、今の client（curl）と生成した client のどちらで送るかを、設定の api で選ぶ。分けるのは nextApi の 1 か所だけ（段 9 で今の client と共に消す）。
// 生成した client は、使う時だけ読む（module の頭で読まない。送る物の無い guard の起動を遅くしない）。build した JS（dist-cjs/）を createRequire で読み、型は dist-types/ から取る。
import { createRequire } from 'node:module';
import type { HttpHandler, HttpHandlerUserInput } from '@smithy/core/protocols';
import type { Provider, UserAgent } from '@smithy/types';
import type * as Castlist from '../gen/castlist-client/dist-types/index.js';
import type { ApiServer } from './config.ts';
import type { Context } from './context.ts';

/** server に、生成した client で送るか（設定の api の、その server の欄が next）。書いていなければ今の client。 */
export const nextApi = (ctx: Pick<Context, 'config'>, server: ApiServer): boolean => ctx.config.api?.[server] === 'next';

const load = createRequire(import.meta.url);

/** 生成した castlist の client の module。初めて呼んだ時に読む（Node が控えるので、2 度目からは読まない）。 */
export const castlistApi = (): typeof Castlist => load('../gen/castlist-client/dist-cjs/index.js') as typeof Castlist;

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
 * 3 回まで送り直す（castlist の Unavailable は `@retryable`）。だから、そこから読む欄をみな書き、送り直さない（1 度だけ送る。送り直すかは呼ぶ側が決める。今の curl と同じ）。
 * 時間切れは今の curl の --max-time と同じ wait（ミリ秒。つなぐまでと、答えを読み終えるまで）。接続は使い回さない（命令の process が、送り終えたらすぐ終わるように）。
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
  client.middlewareStack.remove('recursionDetectionMiddleware');
  return client;
}
