import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { ListActorsInput, ListActorsOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link ListActorsCommand}.
 */
export interface ListActorsCommandInput extends ListActorsInput {
}
/**
 * @public
 *
 * The output of {@link ListActorsCommand}.
 */
export interface ListActorsCommandOutput extends ListActorsOutput, __MetadataBearer {
}
declare const ListActorsCommand_base: {
    new (input: ListActorsCommandInput): import("@smithy/core/client").CommandImpl<ListActorsCommandInput, ListActorsCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (...[input]: [] | [ListActorsCommandInput]): import("@smithy/core/client").CommandImpl<ListActorsCommandInput, ListActorsCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * アクターを条件で探す（監査の検索）。条件はどれも AND。時刻の条件は、どれも castlist が受けた時刻（`receivedAt`）で比べる。
 * 索引で引ける条件（`label`・`binding`・`activeFrom`・`activeTo`・`active` が true・`model`・`effort`・`launchedBy`・`skewed`）が
 * 1 つも無ければ 400（`kind` と `active` が false は、それだけでは数えない）。
 * - `label` は `鍵:値`。重ねれば、どれも持つアクター。
 * - `binding` は `種類:値`。`at`（既定は `asOf`）までに受けた、その値の付随する id の最新の行（出し手と鍵かを問わない）のアクター 1 つ。
 *   `at` は `binding` と一緒にだけ付ける（無ければ 400）。
 * - `activeFrom`・`activeTo` は稼働した期間（初めの登場から最後の退場まで。稼働中なら今まで）が窓に掛かるアクター（両端を含む）。
 *   登場していないアクターは入らない。
 * - `active` は今稼働中か。`model`・`effort` は、その名の model か effort の行を 1 つでも持つ。`launchedBy` は、そのアクターが起こした（launched）。
 * - `skewed` は時刻ずれの行（アクター・出来事・model と effort）を持つ。true だけを受ける（false は 400。絞らないなら付けない）。
 * - 並びは `sort`（`entered` は初めの登場・`exited` は最後の退場。既定 `entered`）と `order`（既定 `asc`）。値の無いアクターは昇順で先・降順で後。
 *   同じ値は受けた順（同じ向き）。
 * - 頁は keyset で分ける（並べる値と受けた順で後ろから続けるので、辿る間に行が足されても、元の組に穴も重なりも出ない）。
 *   `nextToken` は同じ `sort` と `order` の答えの物を渡す（違えば 400。ほかの条件は見ない）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, ListActorsCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, ListActorsCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // ListActorsInput
 *   label: [ // LabelFilters
 *     "STRING_VALUE",
 *   ],
 *   binding: "STRING_VALUE",
 *   at: new Date("TIMESTAMP"),
 *   activeFrom: new Date("TIMESTAMP"),
 *   activeTo: new Date("TIMESTAMP"),
 *   kind: "STRING_VALUE",
 *   model: "STRING_VALUE",
 *   effort: "STRING_VALUE",
 *   active: true || false,
 *   launchedBy: "STRING_VALUE",
 *   skewed: true || false,
 *   sort: "STRING_VALUE",
 *   order: "STRING_VALUE",
 *   maxResults: Number("int"),
 *   nextToken: "STRING_VALUE",
 * };
 * const command = new ListActorsCommand(input);
 * const response = await client.send(command);
 * // { // ListActorsOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   actors: [ // ActorRows // required
 * //     { // ActorRow
 * //       id: "STRING_VALUE", // required
 * //       name: "STRING_VALUE", // required
 * //       kind: "STRING_VALUE", // required
 * //       issuer: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //       labels: { // Labels // required
 * //         "<keys>": "STRING_VALUE",
 * //       },
 * //       firstEnteredAt: new Date("TIMESTAMP"),
 * //       lastExitedAt: new Date("TIMESTAMP"),
 * //       lastExitType: "STRING_VALUE",
 * //       present: true || false, // required
 * //       inferred: true || false, // required
 * //       presence: "STRING_VALUE",
 * //       skewed: true || false,
 * //       model: "STRING_VALUE",
 * //       effort: "STRING_VALUE",
 * //       url: "STRING_VALUE", // required
 * //     },
 * //   ],
 * //   nextToken: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListActorsCommandInput - {@link ListActorsCommandInput}
 * @returns {@link ListActorsCommandOutput}
 * @see {@link ListActorsCommandInput} for command's `input` shape.
 * @see {@link ListActorsCommandOutput} for command's `response` shape.
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
export declare class ListActorsCommand extends ListActorsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListActorsInput;
            output: ListActorsOutput;
        };
        sdk: {
            input: ListActorsCommandInput;
            output: ListActorsCommandOutput;
        };
    };
}
