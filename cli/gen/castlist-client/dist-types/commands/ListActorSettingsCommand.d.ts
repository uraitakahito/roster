import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { ListActorSettingsInput, ListActorSettingsOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link ListActorSettingsCommand}.
 */
export interface ListActorSettingsCommandInput extends ListActorSettingsInput {
}
/**
 * @public
 *
 * The output of {@link ListActorSettingsCommand}.
 */
export interface ListActorSettingsCommandOutput extends ListActorSettingsOutput, __MetadataBearer {
}
declare const ListActorSettingsCommand_base: {
    new (input: ListActorSettingsCommandInput): import("@smithy/core/client").CommandImpl<ListActorSettingsCommandInput, ListActorSettingsCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (input: ListActorSettingsCommandInput): import("@smithy/core/client").CommandImpl<ListActorSettingsCommandInput, ListActorSettingsCommandOutput, import("..").CastlistClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * あるアクターの model と effort の行の全部（受けた順）。頁は分けない（1 つのアクターの行は少ない。今の server と同じ）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, ListActorSettingsCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, ListActorSettingsCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // ListActorSettingsInput
 *   actorId: "STRING_VALUE", // required
 * };
 * const command = new ListActorSettingsCommand(input);
 * const response = await client.send(command);
 * // { // ListActorSettingsOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   actorId: "STRING_VALUE", // required
 * //   settings: [ // Settings // required
 * //     { // Setting
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
 * @param ListActorSettingsCommandInput - {@link ListActorSettingsCommandInput}
 * @returns {@link ListActorSettingsCommandOutput}
 * @see {@link ListActorSettingsCommandInput} for command's `input` shape.
 * @see {@link ListActorSettingsCommandOutput} for command's `response` shape.
 * @see {@link CastlistClientResolvedConfig | config} for CastlistClient's `config` shape.
 *
 * @throws {@link NotFound} (client fault)
 *  名指した物が無い。
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
export declare class ListActorSettingsCommand extends ListActorSettingsCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListActorSettingsInput;
            output: ListActorSettingsOutput;
        };
        sdk: {
            input: ListActorSettingsCommandInput;
            output: ListActorSettingsCommandOutput;
        };
    };
}
