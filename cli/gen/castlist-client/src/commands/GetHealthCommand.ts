// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { GetHealthInput, GetHealthOutput } from "../models/models_0";
import { GetHealth$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetHealthCommand}.
 */
export interface GetHealthCommandInput extends GetHealthInput {}
/**
 * @public
 *
 * The output of {@link GetHealthCommand}.
 */
export interface GetHealthCommandOutput extends GetHealthOutput, __MetadataBearer {}

/**
 * 動いているかと、castlist の今の時刻（送り手が、自分の時計との差を測る）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, GetHealthCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, GetHealthCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = {};
 * const command = new GetHealthCommand(input);
 * const response = await client.send(command);
 * // { // GetHealthOutput
 * //   status: "STRING_VALUE", // required
 * //   version: "STRING_VALUE", // required
 * //   now: new Date("TIMESTAMP"), // required
 * // };
 *
 * ```
 *
 * @param GetHealthCommandInput - {@link GetHealthCommandInput}
 * @returns {@link GetHealthCommandOutput}
 * @see {@link GetHealthCommandInput} for command's `input` shape.
 * @see {@link GetHealthCommandOutput} for command's `response` shape.
 * @see {@link CastlistClientResolvedConfig | config} for CastlistClient's `config` shape.
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
 * @throws {@link CastlistServiceException}
 * <p>Base exception class for all service exceptions from Castlist service.</p>
 *
 *
 * @public
 */
export class GetHealthCommand extends command<GetHealthCommandInput, GetHealthCommandOutput>(
  _ep0,
  _mw0,
  "GetHealth",
  GetHealth$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
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
