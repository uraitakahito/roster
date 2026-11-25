"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetHealthCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
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
class GetHealthCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "GetHealth", schemas_0_1.GetHealth$) {
}
exports.GetHealthCommand = GetHealthCommand;
