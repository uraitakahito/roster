import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { GetTimelineInput, GetTimelineOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetTimelineCommand}.
 */
export interface GetTimelineCommandInput extends GetTimelineInput {
}
/**
 * @public
 *
 * The output of {@link GetTimelineCommand}.
 */
export interface GetTimelineCommandOutput extends GetTimelineOutput, __MetadataBearer {
}
declare const GetTimelineCommand_base: {
    new (input: GetTimelineCommandInput): import("@smithy/core/client").CommandImpl<GetTimelineCommandInput, GetTimelineCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (...[input]: [] | [GetTimelineCommandInput]): import("@smithy/core/client").CommandImpl<GetTimelineCommandInput, GetTimelineCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * タイムラインを描く元の値。点と線は GetGraph と同じ組（同じ引数・同じ絞り・同じ順）で、その点のアクターの出来事
 * （帯と印に要る欄だけ。受けた順）と、model と effort の行の全部（受けた順）を足す。1 つの読む transaction の中で読むので、
 * 4 つの並びは揃った写し。並べる計算（帯・切れ・矢印・目盛り）は、呼ぶ側がする。頁は分けない（並べる計算は、組の全部を 1 度に要る）。
 * 重い読みの接続（2 本）だけを使う。1.1.0 で足した操作。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, GetTimelineCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, GetTimelineCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // GetTimelineInput
 *   label: "STRING_VALUE",
 *   from: new Date("TIMESTAMP"),
 *   to: new Date("TIMESTAMP"),
 * };
 * const command = new GetTimelineCommand(input);
 * const response = await client.send(command);
 * // { // GetTimelineOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   nodes: [ // GraphNodes // required
 * //     { // GraphNode
 * //       id: "STRING_VALUE", // required
 * //       name: "STRING_VALUE", // required
 * //       kind: "STRING_VALUE", // required
 * //       issuer: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //       state: { // ActorState
 * //         presence: "STRING_VALUE",
 * //         present: true || false, // required
 * //         inferred: true || false, // required
 * //         enteredAt: new Date("TIMESTAMP"),
 * //         exitedAt: new Date("TIMESTAMP"),
 * //       },
 * //       currentSettings: { // Setting
 * //         id: "STRING_VALUE",
 * //         actorId: "STRING_VALUE", // required
 * //         model: "STRING_VALUE", // required
 * //         effort: "STRING_VALUE", // required
 * //         source: "STRING_VALUE", // required
 * //         sentAt: new Date("TIMESTAMP"), // required
 * //         receivedAt: new Date("TIMESTAMP"), // required
 * //         clockSkew: true || false, // required
 * //       },
 * //     },
 * //   ],
 * //   edges: [ // Links // required
 * //     { // Link
 * //       id: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       from: "STRING_VALUE", // required
 * //       to: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //     },
 * //   ],
 * //   events: [ // TimelineEvents // required
 * //     { // TimelineEvent
 * //       actorId: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       inferred: true || false, // required
 * //       reason: "STRING_VALUE",
 * //     },
 * //   ],
 * //   settings: [ // Settings // required
 * //     {
 * //       id: "STRING_VALUE",
 * //       actorId: "STRING_VALUE", // required
 * //       model: "STRING_VALUE", // required
 * //       effort: "STRING_VALUE", // required
 * //       source: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param GetTimelineCommandInput - {@link GetTimelineCommandInput}
 * @returns {@link GetTimelineCommandOutput}
 * @see {@link GetTimelineCommandInput} for command's `input` shape.
 * @see {@link GetTimelineCommandOutput} for command's `response` shape.
 * @see {@link CastlistClientResolvedConfig | config} for CastlistClient's `config` shape.
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
 * @throws {@link CastlistServiceException}
 * <p>Base exception class for all service exceptions from Castlist service.</p>
 *
 *
 * @public
 */
export declare class GetTimelineCommand extends GetTimelineCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetTimelineInput;
            output: GetTimelineOutput;
        };
        sdk: {
            input: GetTimelineCommandInput;
            output: GetTimelineCommandOutput;
        };
    };
}
