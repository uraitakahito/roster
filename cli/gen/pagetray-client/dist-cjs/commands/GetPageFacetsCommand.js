"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetPageFacetsCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * ページの、絞り込みの候補と件数・待ちの数（callboard のページの一覧の画面が、絞り込みの列と操作の帯の数に使う）。
 * どれも、置き場の全部を数える（絞らない）。引数は無い。件数が 0 の値は出さない。
 * - `waiting`・`answered`: Product Manager の返事待ち・答えたページの数。`reviewWaiting`: レビュー待ちのページの数。
 *   `escalated`: TPM 担当に上げて、まだ決まっていないページの数。
 * - `senders`: 送り手ごとの数。castlist の答えのある送り手だけ。`value` はアクターの id、`note` はその名。多い順に 100 まで。
 * - `roles`・`kinds`・`projects`・`verdicts`: 役割・種類・project・レビューの判定ごとの数。件数の多い順（同じなら名の順）。
 * - `workspaces`: workspace の ID ごとの数（書かずに置いた物は空の値）。新しく置かれた順に 100 まで。`note` は、その ID で
 *   置かれた Key（`, ` で繋ぐ。空の値には無い）。
 * - `keys`: Key ごとの数。新しく置かれた順に 100 まで。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, GetPageFacetsCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, GetPageFacetsCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = {};
 * const command = new GetPageFacetsCommand(input);
 * const response = await client.send(command);
 * // { // GetPageFacetsOutput
 * //   waiting: Number("long"), // required
 * //   answered: Number("long"), // required
 * //   reviewWaiting: Number("long"), // required
 * //   escalated: Number("long"), // required
 * //   senders: [ // FacetCounts // required
 * //     { // FacetCount
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   roles: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   workspaces: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   kinds: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   keys: [ // required
 * //     {
 * //       value: "STRING_VALUE", // required
 * //       count: Number("long"), // required
 * //       note: "STRING_VALUE",
 * //     },
 * //   ],
 * //   projects: "<FacetCounts>", // required
 * //   verdicts: "<FacetCounts>", // required
 * // };
 *
 * ```
 *
 * @param GetPageFacetsCommandInput - {@link GetPageFacetsCommandInput}
 * @returns {@link GetPageFacetsCommandOutput}
 * @see {@link GetPageFacetsCommandInput} for command's `input` shape.
 * @see {@link GetPageFacetsCommandOutput} for command's `response` shape.
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
class GetPageFacetsCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "GetPageFacets", schemas_0_1.GetPageFacets$) {
}
exports.GetPageFacetsCommand = GetPageFacetsCommand;
