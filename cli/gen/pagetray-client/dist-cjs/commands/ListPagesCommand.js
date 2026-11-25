"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListPagesCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * ページを探す（新しい順が既定）。どの条件も、書いた物だけで絞る（重ねれば、どれにも合う物）。
 * - `q` は前後の空白を落とし、空なら絞らない。どの語も 3 字以上なら、語ごとに題と本文の全文の索引（trigram）で探す
 *   （どの語も含む物。大小を問わない。記号はただの字）。3 字に満たない語があれば、`q` 全体を題と本文の字で探す（大小を分ける）。
 * - `reply` は返事の状態（`waiting`・`answered`）で、`on` はその待ちの相手（既定 `pm`。`reply` と一緒にだけ書く）。
 * - `actor` は送り手の castlist のアクターの id（castlist の答えの無い送り手のページには当たらない）。
 * - 頁は `createdAt` と行の順で続ける（同じ時刻の行が頁の境に並んでも、抜けず重ならない）。
 *   `nextToken` は同じ `sort` の答えの物を渡す（違えば 400。ほかの条件は見ない）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, ListPagesCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, ListPagesCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // ListPagesInput
 *   project: "STRING_VALUE",
 *   key: "STRING_VALUE",
 *   kind: "STRING_VALUE",
 *   role: "STRING_VALUE",
 *   workspace: "STRING_VALUE",
 *   q: "STRING_VALUE",
 *   reply: "STRING_VALUE",
 *   on: "STRING_VALUE",
 *   verdict: "STRING_VALUE",
 *   actor: "STRING_VALUE",
 *   sort: "STRING_VALUE",
 *   maxResults: Number("int"),
 *   nextToken: "STRING_VALUE",
 * };
 * const command = new ListPagesCommand(input);
 * const response = await client.send(command);
 * // { // ListPagesOutput
 * //   pages: [ // Pages // required
 * //     { // Page
 * //       project: "STRING_VALUE", // required
 * //       key: "STRING_VALUE", // required
 * //       kind: "STRING_VALUE", // required
 * //       n: "STRING_VALUE", // required
 * //       title: "STRING_VALUE", // required
 * //       role: "STRING_VALUE", // required
 * //       workspace: "STRING_VALUE", // required
 * //       createdAt: new Date("TIMESTAMP"), // required
 * //       size: Number("long"), // required
 * //       path: "STRING_VALUE", // required
 * //       sender: { // Sender
 * //         issuer: "STRING_VALUE", // required
 * //         ref: "STRING_VALUE", // required
 * //         actor: { // ActorSummary
 * //           id: "STRING_VALUE", // required
 * //           name: "STRING_VALUE", // required
 * //           kind: "STRING_VALUE", // required
 * //         },
 * //         resolvedAt: new Date("TIMESTAMP"),
 * //       },
 * //       askedAt: new Date("TIMESTAMP"),
 * //       answeredAt: new Date("TIMESTAMP"),
 * //       waitsOn: "STRING_VALUE",
 * //       verdict: "STRING_VALUE",
 * //       targets: [ // Targets
 * //         "STRING_VALUE",
 * //       ],
 * //     },
 * //   ],
 * //   nextToken: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListPagesCommandInput - {@link ListPagesCommandInput}
 * @returns {@link ListPagesCommandOutput}
 * @see {@link ListPagesCommandInput} for command's `input` shape.
 * @see {@link ListPagesCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
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
 * @throws {@link PagetrayServiceException}
 * <p>Base exception class for all service exceptions from Pagetray service.</p>
 *
 *
 * @public
 */
class ListPagesCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "ListPages", schemas_0_1.ListPages$) {
}
exports.ListPagesCommand = ListPagesCommand;
