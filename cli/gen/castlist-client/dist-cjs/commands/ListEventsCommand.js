"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListEventsCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * 出来事を、アクターをまたいで探す（監査の検索）。条件はどれも AND で、無くてもよい。並びは受けた順。
 * - `type` は重ねれば、どれかの種類（OR）。`actor` はそのアクターの出来事。`from`・`to` は受けた時刻（`receivedAt`）の窓（両端を含む）。
 * - `reason`・`source` は `detail` の同じ名の欄が、その字と等しい出来事。
 * - `skewed` は時刻ずれの行。true だけを受ける（false は 400）。
 * - 頁は受けた順で後ろから続ける（辿る間に行が足されても、元の組に穴も重なりも出ない）。`nextToken` はこの検索の答えの物を渡す（違えば 400）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, ListEventsCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, ListEventsCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // ListEventsInput
 *   type: [ // EventTypes
 *     "STRING_VALUE",
 *   ],
 *   actor: "STRING_VALUE",
 *   from: new Date("TIMESTAMP"),
 *   to: new Date("TIMESTAMP"),
 *   reason: "STRING_VALUE",
 *   source: "STRING_VALUE",
 *   skewed: true || false,
 *   maxResults: Number("int"),
 *   nextToken: "STRING_VALUE",
 * };
 * const command = new ListEventsCommand(input);
 * const response = await client.send(command);
 * // { // ListEventsOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   events: [ // EventRows // required
 * //     { // EventRow
 * //       id: "STRING_VALUE", // required
 * //       actorId: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       detail: "DOCUMENT_VALUE", // required
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
 * @param ListEventsCommandInput - {@link ListEventsCommandInput}
 * @returns {@link ListEventsCommandOutput}
 * @see {@link ListEventsCommandInput} for command's `input` shape.
 * @see {@link ListEventsCommandOutput} for command's `response` shape.
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
class ListEventsCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "ListEvents", schemas_0_1.ListEvents$) {
}
exports.ListEventsCommand = ListEventsCommand;
