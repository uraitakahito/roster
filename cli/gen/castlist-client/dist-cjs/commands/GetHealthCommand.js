"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetHealthCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
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
class GetHealthCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "GetHealth", schemas_0_1.GetHealth$) {
}
exports.GetHealthCommand = GetHealthCommand;
