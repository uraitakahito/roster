"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PutUsageCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * アクターのトークンの使用量を 1 行足す（2.1.0 から）。同じ id で同じ本文なら 200（足さない）、同じ id で本文が違えば 409（前の行はそのまま）。
 * 同じ id かは、`by` を引くより先に見る。
 * - 1 行は、アクター 1 人の、時計の 1 時間（UTC の時）の内の、同じ種類（`model`・`agent`・`speed`・`serviceTier`）の回のまとめ。
 *   同じアクター・同じ時・同じ種類の行は、2 つ以上在りうる（送り手が、増えた分を新しい id の行で送る）。
 *   PutSetting の「最新と同じなら足さない」は無い（同じかは、id と本文だけで決める）。
 * - 読む側は、数（`turns`・トークンの数・web の検索と取得の回数・`costMicroUsd`・`buckets` の段ごとの数）を足し、`maxContext` は大きい方を取る。
 * - `fromAt`・`toAt` は区間の始めの回と終わりの回の時刻。`fromAt` は `toAt` より後でなく、2 つは同じ UTC の時（年月日と時が同じ）の内（違えば 400）。
 *   ミリ秒まで残す（それより下は切る）。
 * - `buckets` は、文脈の長さの段ごとの数。同じ `bucket` は 1 度だけで、`turns` の和は行の `turns` と、`costMicroUsd` の和は行の
 *   `costMicroUsd` と合う（違えば 400）。並びは問わない（答えは `bucket` の順）。
 * - 知らない model の名は、初めて来た時に一覧に足す。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, PutUsageCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, PutUsageCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // PutUsageInput
 *   usageId: "STRING_VALUE", // required
 *   issuer: "STRING_VALUE", // required
 *   by: "STRING_VALUE", // required
 *   model: "STRING_VALUE", // required
 *   agent: "STRING_VALUE",
 *   speed: "STRING_VALUE", // required
 *   serviceTier: "STRING_VALUE", // required
 *   fromAt: new Date("TIMESTAMP"), // required
 *   toAt: new Date("TIMESTAMP"), // required
 *   turns: Number("long"), // required
 *   inputTokens: Number("long"), // required
 *   outputTokens: Number("long"), // required
 *   cacheReadTokens: Number("long"), // required
 *   cacheWrite5mTokens: Number("long"), // required
 *   cacheWrite1hTokens: Number("long"), // required
 *   webSearchRequests: Number("long"), // required
 *   webFetchRequests: Number("long"), // required
 *   costMicroUsd: Number("long"), // required
 *   maxContext: Number("long"), // required
 *   buckets: [ // UsageBuckets // required
 *     { // UsageBucket
 *       bucket: Number("int"), // required
 *       turns: Number("long"), // required
 *       costMicroUsd: Number("long"), // required
 *     },
 *   ],
 *   sentAt: new Date("TIMESTAMP"), // required
 * };
 * const command = new PutUsageCommand(input);
 * const response = await client.send(command);
 * // { // PutUsageOutput
 * //   id: "STRING_VALUE", // required
 * //   actorId: "STRING_VALUE", // required
 * //   model: "STRING_VALUE", // required
 * //   agent: "STRING_VALUE",
 * //   speed: "STRING_VALUE", // required
 * //   serviceTier: "STRING_VALUE", // required
 * //   fromAt: new Date("TIMESTAMP"), // required
 * //   toAt: new Date("TIMESTAMP"), // required
 * //   turns: Number("long"), // required
 * //   inputTokens: Number("long"), // required
 * //   outputTokens: Number("long"), // required
 * //   cacheReadTokens: Number("long"), // required
 * //   cacheWrite5mTokens: Number("long"), // required
 * //   cacheWrite1hTokens: Number("long"), // required
 * //   webSearchRequests: Number("long"), // required
 * //   webFetchRequests: Number("long"), // required
 * //   costMicroUsd: Number("long"), // required
 * //   maxContext: Number("long"), // required
 * //   buckets: [ // UsageBuckets // required
 * //     { // UsageBucket
 * //       bucket: Number("int"), // required
 * //       turns: Number("long"), // required
 * //       costMicroUsd: Number("long"), // required
 * //     },
 * //   ],
 * //   sentAt: new Date("TIMESTAMP"), // required
 * //   receivedAt: new Date("TIMESTAMP"), // required
 * //   clockSkew: true || false, // required
 * //   status: Number("int"), // required
 * // };
 *
 * ```
 *
 * @param PutUsageCommandInput - {@link PutUsageCommandInput}
 * @returns {@link PutUsageCommandOutput}
 * @see {@link PutUsageCommandInput} for command's `input` shape.
 * @see {@link PutUsageCommandOutput} for command's `response` shape.
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
class PutUsageCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "PutUsage", schemas_0_1.PutUsage$) {
}
exports.PutUsageCommand = PutUsageCommand;
