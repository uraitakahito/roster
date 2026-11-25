import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { ListSettingsInput, ListSettingsOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link ListSettingsCommand}.
 */
export interface ListSettingsCommandInput extends ListSettingsInput {
}
/**
 * @public
 *
 * The output of {@link ListSettingsCommand}.
 */
export interface ListSettingsCommandOutput extends ListSettingsOutput, __MetadataBearer {
}
declare const ListSettingsCommand_base: {
    new (input: ListSettingsCommandInput): import("@smithy/core/client").CommandImpl<ListSettingsCommandInput, ListSettingsCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (...[input]: [] | [ListSettingsCommandInput]): import("@smithy/core/client").CommandImpl<ListSettingsCommandInput, ListSettingsCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * model と effort の行を、アクターをまたいで探す（監査の検索）。条件はどれも AND で、無くてもよい。並びは受けた順。
 * - `model`・`effort`・`source` はその名・出の行。`from`・`to` は受けた時刻（`receivedAt`）の窓（両端を含む）。
 * - `mismatch` は、見た（`observed`）行のうち、同じアクターのそれより前の最新の頼んだ（`requested`）行と、model か effort が違う物。
 *   前に頼んだ行の無い見た行は入らない。true だけを受ける（false は 400。絞らないなら付けない）。
 * - `skewed` は時刻ずれの行。true だけを受ける（false は 400）。
 * - 頁は受けた順で後ろから続ける（辿る間に行が足されても、元の組に穴も重なりも出ない）。`nextToken` はこの検索の答えの物を渡す（違えば 400）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, ListSettingsCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, ListSettingsCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // ListSettingsInput
 *   model: "STRING_VALUE",
 *   effort: "STRING_VALUE",
 *   source: "STRING_VALUE",
 *   from: new Date("TIMESTAMP"),
 *   to: new Date("TIMESTAMP"),
 *   mismatch: true || false,
 *   skewed: true || false,
 *   maxResults: Number("int"),
 *   nextToken: "STRING_VALUE",
 * };
 * const command = new ListSettingsCommand(input);
 * const response = await client.send(command);
 * // { // ListSettingsOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   settings: [ // SettingRows // required
 * //     { // SettingRow
 * //       id: "STRING_VALUE",
 * //       actorId: "STRING_VALUE", // required
 * //       model: "STRING_VALUE", // required
 * //       effort: "STRING_VALUE", // required
 * //       source: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //       actorName: "STRING_VALUE", // required
 * //     },
 * //   ],
 * //   nextToken: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListSettingsCommandInput - {@link ListSettingsCommandInput}
 * @returns {@link ListSettingsCommandOutput}
 * @see {@link ListSettingsCommandInput} for command's `input` shape.
 * @see {@link ListSettingsCommandOutput} for command's `response` shape.
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
export declare class ListSettingsCommand extends ListSettingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListSettingsInput;
            output: ListSettingsOutput;
        };
        sdk: {
            input: ListSettingsCommandInput;
            output: ListSettingsCommandOutput;
        };
    };
}
