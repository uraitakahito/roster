"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListReviewsCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * 名指したページ（`target`。ページの path）を見たレビューのページ（種類が `review` で、見た物にその path を書いた物）。
 * 置いた古い順。ページの一覧の画面が、行の下に「レビュー」の link と判定を出すのに使う。
 * - `target` は 1 つから 200 まで（無ければ・超えれば 400）。path の形は見ない（置き場に無い path には、何も返さない）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, ListReviewsCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, ListReviewsCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // ListReviewsInput
 *   target: [ // ReviewTargets // required
 *     "STRING_VALUE",
 *   ],
 * };
 * const command = new ListReviewsCommand(input);
 * const response = await client.send(command);
 * // { // ListReviewsOutput
 * //   reviews: [ // ReviewsOf // required
 * //     { // ReviewOf
 * //       target: "STRING_VALUE", // required
 * //       path: "STRING_VALUE", // required
 * //       verdict: "STRING_VALUE",
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ListReviewsCommandInput - {@link ListReviewsCommandInput}
 * @returns {@link ListReviewsCommandOutput}
 * @see {@link ListReviewsCommandInput} for command's `input` shape.
 * @see {@link ListReviewsCommandOutput} for command's `response` shape.
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
class ListReviewsCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "ListReviews", schemas_0_1.ListReviews$) {
}
exports.ListReviewsCommand = ListReviewsCommand;
