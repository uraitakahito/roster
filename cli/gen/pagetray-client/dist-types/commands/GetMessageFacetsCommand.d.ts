import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { GetMessageFacetsInput, GetMessageFacetsOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetMessageFacetsCommand}.
 */
export interface GetMessageFacetsCommandInput extends GetMessageFacetsInput {
}
/**
 * @public
 *
 * The output of {@link GetMessageFacetsCommand}.
 */
export interface GetMessageFacetsCommandOutput extends GetMessageFacetsOutput, __MetadataBearer {
}
declare const GetMessageFacetsCommand_base: {
    new (input: GetMessageFacetsCommandInput): import("@smithy/core/client").CommandImpl<GetMessageFacetsCommandInput, GetMessageFacetsCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (...[input]: [] | [GetMessageFacetsCommandInput]): import("@smithy/core/client").CommandImpl<GetMessageFacetsCommandInput, GetMessageFacetsCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * メッセージの記録の、絞り込みの候補と件数（callboard のメッセージの一覧の画面が、絞り込みの列と「まだ届いていない n 件」に使う）。
 * どの並びも、置き場の全部を数える（絞らない）。件数が 0 の値は出さない（下の、引数に書いた値を除く）。
 * - `states`: 状態ごとの数。`waiting`・`delivered`・`undeliverable`・`expired`・`carried` の順。
 * - `to`・`from`: 受け手・送り手の名ごとの数。件数の多い順（同じなら名の順）に 100 まで。
 * - `keys`: Key ごとの数。新しく送られた順に 100 まで（Key を書かずに置いた記録は数えない）。
 * - `projects`: project ごとの数。件数の多い順（同じなら名の順）。
 * - 引数の `to`・`from`・`key` は絞らない。書いた値が、その並びの 100 件に入っていなければ、その値と件数（置き場に無ければ 0）を
 *   並びの後ろに足す（画面が、今絞っている値を候補に出して、押して外せるように）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, GetMessageFacetsCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, GetMessageFacetsCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // GetMessageFacetsInput
 *   to: "STRING_VALUE",
 *   from: "STRING_VALUE",
 *   key: "STRING_VALUE",
 * };
 * const command = new GetMessageFacetsCommand(input);
 * const response = await client.send(command);
 * // { // GetMessageFacetsOutput
 * //   states: [ // FacetCounts // required
 * //     { // FacetCount
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   to: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   from: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   keys: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   projects: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param GetMessageFacetsCommandInput - {@link GetMessageFacetsCommandInput}
 * @returns {@link GetMessageFacetsCommandOutput}
 * @see {@link GetMessageFacetsCommandInput} for command's `input` shape.
 * @see {@link GetMessageFacetsCommandOutput} for command's `response` shape.
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
export declare class GetMessageFacetsCommand extends GetMessageFacetsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: GetMessageFacetsInput;
            output: GetMessageFacetsOutput;
        };
        sdk: {
            input: GetMessageFacetsCommandInput;
            output: GetMessageFacetsCommandOutput;
        };
    };
}
