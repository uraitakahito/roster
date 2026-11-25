// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { PutSettingInput, PutSettingOutput } from "../models/models_0";
import { PutSetting$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link PutSettingCommand}.
 */
export interface PutSettingCommandInput extends PutSettingInput {}
/**
 * @public
 *
 * The output of {@link PutSettingCommand}.
 */
export interface PutSettingCommandOutput extends PutSettingOutput, __MetadataBearer {}

/**
 * model と effort を足す。id は送り手が決める。同じ id の扱いは PutEvent と同じ（同じ本文は 200・違えば 409・`by` を引くより先に見る）。
 * 新しい id でも、そのアクターの最新（受けた順で。`source` は比べない）と model と effort が同じなら、足さずに最新の行を 200 で返す
 * （その時の id は残らない。なので同じ id を後で送り直すと、その時の最新と比べ直し、間に別の設定が入っていれば新しい行として足す）。
 * 知らない model と effort の名は、初めて来た時に一覧に足す。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, PutSettingCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, PutSettingCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // PutSettingInput
 *   settingId: "STRING_VALUE", // required
 *   issuer: "STRING_VALUE", // required
 *   by: "STRING_VALUE", // required
 *   model: "STRING_VALUE", // required
 *   effort: "STRING_VALUE", // required
 *   source: "STRING_VALUE", // required
 *   sentAt: new Date("TIMESTAMP"), // required
 * };
 * const command = new PutSettingCommand(input);
 * const response = await client.send(command);
 * // { // PutSettingOutput
 * //   id: "STRING_VALUE",
 * //   actorId: "STRING_VALUE", // required
 * //   model: "STRING_VALUE", // required
 * //   effort: "STRING_VALUE", // required
 * //   source: "STRING_VALUE", // required
 * //   sentAt: new Date("TIMESTAMP"), // required
 * //   receivedAt: new Date("TIMESTAMP"), // required
 * //   clockSkew: true || false, // required
 * //   status: Number("int"), // required
 * // };
 *
 * ```
 *
 * @param PutSettingCommandInput - {@link PutSettingCommandInput}
 * @returns {@link PutSettingCommandOutput}
 * @see {@link PutSettingCommandInput} for command's `input` shape.
 * @see {@link PutSettingCommandOutput} for command's `response` shape.
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
export class PutSettingCommand extends command<PutSettingCommandInput, PutSettingCommandOutput>(
  _ep0,
  _mw0,
  "PutSetting",
  PutSetting$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: PutSettingInput;
      output: PutSettingOutput;
    };
    sdk: {
      input: PutSettingCommandInput;
      output: PutSettingCommandOutput;
    };
  };
}
