import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { GetGraphInput, GetGraphOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetGraphCommand}.
 */
export interface GetGraphCommandInput extends GetGraphInput {
}
/**
 * @public
 *
 * The output of {@link GetGraphCommand}.
 */
export interface GetGraphCommandOutput extends GetGraphOutput, __MetadataBearer {
}
declare const GetGraphCommand_base: {
    new (input: GetGraphCommandInput): import("@smithy/core/client").CommandImpl<GetGraphCommandInput, GetGraphCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (...[input]: [] | [GetGraphCommandInput]): import("@smithy/core/client").CommandImpl<GetGraphCommandInput, GetGraphCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * 図（タイムライン・相関図）の点と線。`label`（`鍵:値`）と、登録を受けた時刻（`receivedAt`）の窓（`from`・`to`。両端を含む）で
 * アクターの組を絞り、組に触れる線（`from` か `to` が組の中）の全部と、その線の向こうの端のアクター（一歩だけ）も含める（人の根が切れないように）。
 * どれも無ければ全部のアクター。点も線も受けた順（seq）。重い読みの接続（2 本）だけを使い、引き当てなどの軽い読みを待たせない。
 * 引数はどれも 1 つだけ（restJson1 は、2 度付ければ初めの物を使う）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, GetGraphCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, GetGraphCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // GetGraphInput
 *   label: "STRING_VALUE",
 *   from: new Date("TIMESTAMP"),
 *   to: new Date("TIMESTAMP"),
 * };
 * const command = new GetGraphCommand(input);
 * const response = await client.send(command);
 * // { // GetGraphOutput
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
 * // };
 *
 * ```
 *
 * @param GetGraphCommandInput - {@link GetGraphCommandInput}
 * @returns {@link GetGraphCommandOutput}
 * @see {@link GetGraphCommandInput} for command's `input` shape.
 * @see {@link GetGraphCommandOutput} for command's `response` shape.
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
export declare class GetGraphCommand extends GetGraphCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetGraphInput;
            output: GetGraphOutput;
        };
        sdk: {
            input: GetGraphCommandInput;
            output: GetGraphCommandOutput;
        };
    };
}
