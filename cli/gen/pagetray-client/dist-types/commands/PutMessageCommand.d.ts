import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { PutMessageInput, PutMessageOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link PutMessageCommand}.
 */
export interface PutMessageCommandInput extends PutMessageInput {
}
/**
 * @public
 *
 * The output of {@link PutMessageCommand}.
 */
export interface PutMessageCommandOutput extends PutMessageOutput, __MetadataBearer {
}
declare const PutMessageCommand_base: {
    new (input: PutMessageCommandInput): import("@smithy/core/client").CommandImpl<PutMessageCommandInput, PutMessageCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (input: PutMessageCommandInput): import("@smithy/core/client").CommandImpl<PutMessageCommandInput, PutMessageCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * メッセージの記録を 1 件置く・書き足す（同じ project と id に、何度打ってもよい）。pagetray は、ほかの道具（roster）が配った
 * メッセージの記録を写して見せるだけで、配らず、状態を自分で決めず、期限を持たない。
 * - 初めての id なら作る（201。状態は来たまま）。もうある id なら書き足す（200）。書き足しは、届く順に依らない
 *   （「渡した」の記録が「送った」の記録より先に届いても、同じ記録になる）:
 *   - `state` は前へだけ進む。強さは `waiting`＝`carried` ＜ `expired`＝`undeliverable` ＜ `delivered` で、今より強い時だけ替える。
 *   - `deliveries` は大きい方を保つ。`via` は、`state` を替えた時か、今が空の時だけ入れる（どちらも、書かなければ前のまま）。
 *   - `deliveredAt` は、まだ無い時だけ入れる（初めの時刻を保つ）。
 * - `key`・`heading`・`from`・`to`・`text`・`sentAt`・`replyTo` は、初めに置いた値を保つ（違う値が来ても変えず、
 *   誤りにもしない）。形は、書き足す時も見る。
 * - 送り手として残すのは、「送った側」の書き込み（`state` が `waiting` か `carried`）の物だけ。その書き込みに付随する id
 *   （`actorIssuer`・`actorRef`）があれば、CreatePage と同じく castlist に聞き、登録の無い送り手は 400、聞けなければ 503
 *   （どちらも何も替えない）。記録の送り手がまだ空なら入れ、もう入っていれば替えない。ほかの `state` の書き込みは、
 *   付随する id が付いていても castlist に聞かず、送り手として残さない（組と形は見る。片方だけは 400）。
 * - 時刻（`sentAt`・`deliveredAt`）は UTC・ミリ秒まで（細かい時刻は 400）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, PutMessageCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, PutMessageCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // PutMessageInput
 *   project: "STRING_VALUE", // required
 *   id: "STRING_VALUE", // required
 *   actorIssuer: "STRING_VALUE",
 *   actorRef: "STRING_VALUE",
 *   key: "STRING_VALUE",
 *   heading: "STRING_VALUE", // required
 *   from: "STRING_VALUE", // required
 *   to: "STRING_VALUE", // required
 *   text: "STRING_VALUE", // required
 *   sentAt: new Date("TIMESTAMP"), // required
 *   state: "STRING_VALUE", // required
 *   deliveredAt: new Date("TIMESTAMP"),
 *   via: "STRING_VALUE",
 *   deliveries: Number("int"),
 *   replyTo: "STRING_VALUE",
 * };
 * const command = new PutMessageCommand(input);
 * const response = await client.send(command);
 * // { // PutMessageOutput
 * //   project: "STRING_VALUE", // required
 * //   id: "STRING_VALUE", // required
 * //   key: "STRING_VALUE",
 * //   heading: "STRING_VALUE", // required
 * //   from: "STRING_VALUE", // required
 * //   to: "STRING_VALUE", // required
 * //   text: "STRING_VALUE", // required
 * //   sentAt: new Date("TIMESTAMP"), // required
 * //   state: "STRING_VALUE", // required
 * //   deliveredAt: new Date("TIMESTAMP"),
 * //   via: "STRING_VALUE",
 * //   deliveries: Number("int"),
 * //   replyTo: "STRING_VALUE",
 * //   createdAt: new Date("TIMESTAMP"), // required
 * //   updatedAt: new Date("TIMESTAMP"), // required
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
 * //   status: Number("int"), // required
 * // };
 *
 * ```
 *
 * @param PutMessageCommandInput - {@link PutMessageCommandInput}
 * @returns {@link PutMessageCommandOutput}
 * @see {@link PutMessageCommandInput} for command's `input` shape.
 * @see {@link PutMessageCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
 *
 * @throws {@link ValidationException} (client fault)
 *  A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
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
export declare class PutMessageCommand extends PutMessageCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: PutMessageInput;
            output: PutMessageOutput;
        };
        sdk: {
            input: PutMessageCommandInput;
            output: PutMessageCommandOutput;
        };
    };
}
