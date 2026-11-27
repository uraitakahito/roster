"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetFileRulesCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * 受ける file の種類と、1 つの大きさの上限（callboard のページの一覧の画面の、file を上げる枠が、送る前に見る）。
 * 並びは、置き場が種類を断る時の文と同じ。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, GetFileRulesCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, GetFileRulesCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = {};
 * const command = new GetFileRulesCommand(input);
 * const response = await client.send(command);
 * // { // GetFileRulesOutput
 * //   types: [ // FileTypes // required
 * //     { // FileType
 * //       ext: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //     },
 * //   ],
 * //   maxBytes: Number("long"), // required
 * // };
 *
 * ```
 *
 * @param GetFileRulesCommandInput - {@link GetFileRulesCommandInput}
 * @returns {@link GetFileRulesCommandOutput}
 * @see {@link GetFileRulesCommandInput} for command's `input` shape.
 * @see {@link GetFileRulesCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
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
class GetFileRulesCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "GetFileRules", schemas_0_1.GetFileRules$) {
}
exports.GetFileRulesCommand = GetFileRulesCommand;
