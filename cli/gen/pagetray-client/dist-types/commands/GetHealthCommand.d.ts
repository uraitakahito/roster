import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { GetHealthInput, GetHealthOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetHealthCommand}.
 */
export interface GetHealthCommandInput extends GetHealthInput {
}
/**
 * @public
 *
 * The output of {@link GetHealthCommand}.
 */
export interface GetHealthCommandOutput extends GetHealthOutput, __MetadataBearer {
}
declare const GetHealthCommand_base: {
    new (input: GetHealthCommandInput): import("@smithy/core/client").CommandImpl<GetHealthCommandInput, GetHealthCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (...[input]: [] | [GetHealthCommandInput]): import("@smithy/core/client").CommandImpl<GetHealthCommandInput, GetHealthCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * 動いているかと、pagetray の版。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, GetHealthCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, GetHealthCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = {};
 * const command = new GetHealthCommand(input);
 * const response = await client.send(command);
 * // { // GetHealthOutput
 * //   status: "STRING_VALUE", // required
 * //   version: "STRING_VALUE", // required
 * // };
 *
 * ```
 *
 * @param GetHealthCommandInput - {@link GetHealthCommandInput}
 * @returns {@link GetHealthCommandOutput}
 * @see {@link GetHealthCommandInput} for command's `input` shape.
 * @see {@link GetHealthCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
 *
 * @throws {@link Forbidden} (client fault)
 *  受けない要求。castlist を動かす機械の外からの名（`Host`）と、browser の中のページからの書く要求（`Origin` の付いた
 * `GET`・`HEAD` のほか）を断る。どの操作の前でも効く（server の守りの層）。
 *
 * @throws {@link PayloadTooLarge} (client fault)
 *  本文が上限より大きい。どの操作の前でも効く（server の守りの層。上限は server が決める）。
 *
 * @throws {@link Unavailable} (server fault)
 *  混んでいる・時間がかかりすぎた・呼ぶ先が答えない。少し待って送り直す。
 * 時間切れは、どの操作の前でも効く（server の守りの層）。
 *
 * @throws {@link PagetrayServiceException}
 * <p>Base exception class for all service exceptions from Pagetray service.</p>
 *
 *
 * @public
 */
export declare class GetHealthCommand extends GetHealthCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: {};
            output: GetHealthOutput;
        };
        sdk: {
            input: GetHealthCommandInput;
            output: GetHealthCommandOutput;
        };
    };
}
