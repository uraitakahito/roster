"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListUsageCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * トークンの数と費えの行を、アクターをまたいで読む（2.1.0 から）。条件はどれも AND。並びは受けた順。集計はしない（まとめるのは呼ぶ側）。
 * - `from`・`to` は、区間の終わりの時刻（`toAt`）の窓（`from <= toAt < to`。始めは含み、終わりは含まない）。どちらも要る。
 *   `to - from` は 31 日まで（越えれば 400）。受けた時刻（`receivedAt`）とは比べない。
 * - `label` は `鍵:値`（ListActors の `label` と同じ）。重ねれば、どれも持つアクターの行。`actorId` は、そのアクターの行。
 * - `actors` は、この頁の行に出てきたアクターを 1 度ずつ（行に初めて出た順）。
 * - 同じアクター・同じ時・同じ種類の行は、2 つ以上在りうる。読む側は、数（`turns`・トークンの数・web の検索と取得の回数・`costMicroUsd`・`buckets` の段ごとの数）を足し、
 *   `maxContext` は大きい方を取る。
 * - 頁は受けた順で後ろから続ける（辿る間に行が足されても、元の組に穴も重なりも出ない）。`nextToken` はこの検索の答えの物を渡す（違えば 400）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, ListUsageCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, ListUsageCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // ListUsageInput
 *   from: new Date("TIMESTAMP"), // required
 *   to: new Date("TIMESTAMP"), // required
 *   label: [ // LabelFilters
 *     "STRING_VALUE",
 *   ],
 *   actorId: "STRING_VALUE",
 *   maxResults: Number("int"),
 *   nextToken: "STRING_VALUE",
 * };
 * const command = new ListUsageCommand(input);
 * const response = await client.send(command);
 * // { // ListUsageOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   usage: [ // UsageRows // required
 * //     { // Usage
 * //       id: "STRING_VALUE", // required
 * //       actorId: "STRING_VALUE", // required
 * //       model: "STRING_VALUE", // required
 * //       agent: "STRING_VALUE",
 * //       speed: "STRING_VALUE", // required
 * //       serviceTier: "STRING_VALUE", // required
 * //       fromAt: new Date("TIMESTAMP"), // required
 * //       toAt: new Date("TIMESTAMP"), // required
 * //       turns: Number("long"), // required
 * //       inputTokens: Number("long"), // required
 * //       outputTokens: Number("long"), // required
 * //       cacheReadTokens: Number("long"), // required
 * //       cacheWrite5mTokens: Number("long"), // required
 * //       cacheWrite1hTokens: Number("long"), // required
 * //       webSearchRequests: Number("long"), // required
 * //       webFetchRequests: Number("long"), // required
 * //       costMicroUsd: Number("long"), // required
 * //       maxContext: Number("long"), // required
 * //       buckets: [ // UsageBuckets // required
 * //         { // UsageBucket
 * //           bucket: Number("int"), // required
 * //           turns: Number("long"), // required
 * //           costMicroUsd: Number("long"), // required
 * //         },
 * //       ],
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //     },
 * //   ],
 * //   actors: [ // UsageActors // required
 * //     { // UsageActor
 * //       id: "STRING_VALUE", // required
 * //       name: "STRING_VALUE", // required
 * //       labels: { // Labels // required
 * //         "<keys>": "STRING_VALUE",
 * //       },
 * //     },
 * //   ],
 * //   nextToken: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListUsageCommandInput - {@link ListUsageCommandInput}
 * @returns {@link ListUsageCommandOutput}
 * @see {@link ListUsageCommandInput} for command's `input` shape.
 * @see {@link ListUsageCommandOutput} for command's `response` shape.
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
class ListUsageCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "ListUsage", schemas_0_1.ListUsage$) {
}
exports.ListUsageCommand = ListUsageCommand;
