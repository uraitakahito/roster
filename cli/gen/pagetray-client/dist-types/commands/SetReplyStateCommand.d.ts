import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { SetReplyStateInput, SetReplyStateOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link SetReplyStateCommand}.
 */
export interface SetReplyStateCommandInput extends SetReplyStateInput {
}
/**
 * @public
 *
 * The output of {@link SetReplyStateCommand}.
 */
export interface SetReplyStateCommandOutput extends SetReplyStateOutput, __MetadataBearer {
}
declare const SetReplyStateCommand_base: {
    new (input: SetReplyStateCommandInput): import("@smithy/core/client").CommandImpl<SetReplyStateCommandInput, SetReplyStateCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (input: SetReplyStateCommandInput): import("@smithy/core/client").CommandImpl<SetReplyStateCommandInput, SetReplyStateCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * ページ 1 枚の返事の状態を書く。答えは、そのページの記録。同じ状態を 2 度書いても同じ答え（時刻は初めの物を保つ）。
 * - `waiting`: 待ちの相手を `on`（既定 `pm`）にし、答えた時刻を消す。答えた後にもう 1 度求めれば、求めた時刻を今にする
 *   （相手を替えてよい）。今ほかの相手を待っていれば 409（待ちを黙って移さない）。
 * - `answered`: 答えた時刻を入れる。待ちの相手が `on` と違えば 409。`pm` は、求めていないページも答えたにでき
 *   （求めた時刻と答えた時刻は同じ）、ほかの相手は、求めたページだけ。
 * - 無いページと消したページは 404。409 の時は何も替えない。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, SetReplyStateCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, SetReplyStateCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // SetReplyStateInput
 *   project: "STRING_VALUE", // required
 *   key: "STRING_VALUE", // required
 *   kind: "STRING_VALUE", // required
 *   n: "STRING_VALUE", // required
 *   state: "STRING_VALUE", // required
 *   on: "STRING_VALUE",
 * };
 * const command = new SetReplyStateCommand(input);
 * const response = await client.send(command);
 * // { // SetReplyStateOutput
 * //   project: "STRING_VALUE", // required
 * //   key: "STRING_VALUE", // required
 * //   kind: "STRING_VALUE", // required
 * //   n: "STRING_VALUE", // required
 * //   title: "STRING_VALUE", // required
 * //   role: "STRING_VALUE", // required
 * //   workspace: "STRING_VALUE", // required
 * //   createdAt: new Date("TIMESTAMP"), // required
 * //   size: Number("long"), // required
 * //   path: "STRING_VALUE", // required
 * //   sender: { // Sender
 * //     issuer: "STRING_VALUE", // required
 * //     ref: "STRING_VALUE", // required
 * //     actor: { // ActorSummary
 * //       id: "STRING_VALUE", // required
 * //       name: "STRING_VALUE", // required
 * //       kind: "STRING_VALUE", // required
 * //     },
 * //     resolvedAt: new Date("TIMESTAMP"),
 * //   },
 * //   askedAt: new Date("TIMESTAMP"),
 * //   answeredAt: new Date("TIMESTAMP"),
 * //   waitsOn: "STRING_VALUE",
 * //   verdict: "STRING_VALUE",
 * //   targets: [ // Targets
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param SetReplyStateCommandInput - {@link SetReplyStateCommandInput}
 * @returns {@link SetReplyStateCommandOutput}
 * @see {@link SetReplyStateCommandInput} for command's `input` shape.
 * @see {@link SetReplyStateCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
 *
 * @throws {@link ValidationException} (client fault)
 *  A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
 *
 * @throws {@link NotFound} (client fault)
 *  名指した物が無い。
 *
 * @throws {@link Conflict} (client fault)
 *  同じ id の物がもうあり、中身が違う。
 *
 * @throws {@link Unavailable} (server fault)
 *  混んでいる・時間がかかりすぎた・呼ぶ先が答えない。少し待って送り直す。
 * 時間切れは、どの操作の前でも効く（server の守りの層）。
 *
 * @throws {@link InternalError} (server fault)
 *  server の中で失敗した（DB の誤りなど）。送り直しても直らない見込みなので、@retryable は付けない。
 * 訳は server の記録に書き、答えの `message` は決まった字にする（中の誤りの字を外に出さない）。
 *
 * @throws {@link Forbidden} (client fault)
 *  受けない要求。castlist を動かす機械の外からの名（`Host`）と、browser の中のページからの書く要求（`Origin` の付いた
 * `GET`・`HEAD` のほか）を断る。どの操作の前でも効く（server の守りの層）。
 *
 * @throws {@link PayloadTooLarge} (client fault)
 *  本文が上限より大きい。どの操作の前でも効く（server の守りの層。上限は server が決める）。
 *
 * @throws {@link PagetrayServiceException}
 * <p>Base exception class for all service exceptions from Pagetray service.</p>
 *
 *
 * @public
 */
export declare class SetReplyStateCommand extends SetReplyStateCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: SetReplyStateInput;
            output: SetReplyStateOutput;
        };
        sdk: {
            input: SetReplyStateCommandInput;
            output: SetReplyStateCommandOutput;
        };
    };
}
