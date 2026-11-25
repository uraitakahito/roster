// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { GetActorSettingAtInput, GetActorSettingAtOutput } from "../models/models_0";
import { GetActorSettingAt$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetActorSettingAtCommand}.
 */
export interface GetActorSettingAtCommandInput extends GetActorSettingAtInput {}
/**
 * @public
 *
 * The output of {@link GetActorSettingAtCommand}.
 */
export interface GetActorSettingAtCommandOutput extends GetActorSettingAtOutput, __MetadataBearer {}

/**
 * ある時刻に効いていた model と effort: 受けた時刻（`receivedAt`）がその時刻まで（含む）の行のうち、最新（受けた順で）の 1 つ。
 * 無ければ `setting` が無い。`time` は DB に残す字（UTC・ミリ秒まで。ミリ秒より下は切る）に直して比べ、直した物を `at` で返す。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, GetActorSettingAtCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, GetActorSettingAtCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // GetActorSettingAtInput
 *   actorId: "STRING_VALUE", // required
 *   time: new Date("TIMESTAMP"), // required
 * };
 * const command = new GetActorSettingAtCommand(input);
 * const response = await client.send(command);
 * // { // GetActorSettingAtOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   actorId: "STRING_VALUE", // required
 * //   at: new Date("TIMESTAMP"), // required
 * //   setting: { // Setting
 * //     id: "STRING_VALUE",
 * //     actorId: "STRING_VALUE", // required
 * //     model: "STRING_VALUE", // required
 * //     effort: "STRING_VALUE", // required
 * //     source: "STRING_VALUE", // required
 * //     sentAt: new Date("TIMESTAMP"), // required
 * //     receivedAt: new Date("TIMESTAMP"), // required
 * //     clockSkew: true || false, // required
 * //   },
 * // };
 *
 * ```
 *
 * @param GetActorSettingAtCommandInput - {@link GetActorSettingAtCommandInput}
 * @returns {@link GetActorSettingAtCommandOutput}
 * @see {@link GetActorSettingAtCommandInput} for command's `input` shape.
 * @see {@link GetActorSettingAtCommandOutput} for command's `response` shape.
 * @see {@link CastlistClientResolvedConfig | config} for CastlistClient's `config` shape.
 *
 * @throws {@link NotFound} (client fault)
 *  名指した物が無い。
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
export class GetActorSettingAtCommand extends command<GetActorSettingAtCommandInput, GetActorSettingAtCommandOutput>(
  _ep0,
  _mw0,
  "GetActorSettingAt",
  GetActorSettingAt$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: GetActorSettingAtInput;
      output: GetActorSettingAtOutput;
    };
    sdk: {
      input: GetActorSettingAtCommandInput;
      output: GetActorSettingAtCommandOutput;
    };
  };
}
