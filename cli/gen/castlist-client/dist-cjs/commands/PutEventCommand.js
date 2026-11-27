"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PutEventCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * 出来事を足す。id は送り手が決める。同じ id で同じ本文（写しは docs/src/api.md の「データ」）なら、足さずに前の行を 200 で返し、
 * 本文が違えば 409（前の行はそのまま）。同じ id かは `by` を引くより先に見る。新しく足せば 201。
 * `by` は出し手の中の鍵の付随する id で引き、引けなければ 400。`detail` は JSON の物（無ければ `\{\}`）で、ほかの形は 400。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, PutEventCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, PutEventCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // PutEventInput
 *   eventId: "STRING_VALUE", // required
 *   issuer: "STRING_VALUE", // required
 *   by: "STRING_VALUE", // required
 *   type: "STRING_VALUE", // required
 *   detail: "DOCUMENT_VALUE",
 *   sentAt: new Date("TIMESTAMP"), // required
 * };
 * const command = new PutEventCommand(input);
 * const response = await client.send(command);
 * // { // PutEventOutput
 * //   id: "STRING_VALUE", // required
 * //   actorId: "STRING_VALUE", // required
 * //   type: "STRING_VALUE", // required
 * //   detail: "DOCUMENT_VALUE", // required
 * //   sentAt: new Date("TIMESTAMP"), // required
 * //   receivedAt: new Date("TIMESTAMP"), // required
 * //   clockSkew: true || false, // required
 * //   status: Number("int"), // required
 * // };
 *
 * ```
 *
 * @param PutEventCommandInput - {@link PutEventCommandInput}
 * @returns {@link PutEventCommandOutput}
 * @see {@link PutEventCommandInput} for command's `input` shape.
 * @see {@link PutEventCommandOutput} for command's `response` shape.
 * @see {@link CastlistClientResolvedConfig | config} for CastlistClient's `config` shape.
 *
 * @throws {@link ValidationException} (client fault)
 *  A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
 *
 * @throws {@link Conflict} (client fault)
 *  同じ id の物がもうあり、中身が違う。
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
class PutEventCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "PutEvent", schemas_0_1.PutEvent$) {
}
exports.PutEventCommand = PutEventCommand;
