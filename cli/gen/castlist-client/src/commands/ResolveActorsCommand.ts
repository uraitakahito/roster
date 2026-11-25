// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { ResolveActorsInput, ResolveActorsOutput } from "../models/models_0";
import { ResolveActors$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link ResolveActorsCommand}.
 */
export interface ResolveActorsCommandInput extends ResolveActorsInput {}
/**
 * @public
 *
 * The output of {@link ResolveActorsCommand}.
 */
export interface ResolveActorsCommandOutput extends ResolveActorsOutput, __MetadataBearer {}

/**
 * 鍵の付随する id（`種類:値`）から、出し手の中のアクターを引く。答えは問いと同じ順で、引けない物（知らない・鍵でない・出し手が違う）は `actor` が無い。
 * 1 つでも形の違う参照があれば、全体を 400 で断る。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, ResolveActorsCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, ResolveActorsCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // ResolveActorsInput
 *   issuer: "STRING_VALUE", // required
 *   refs: [ // ActorRefs // required
 *     "STRING_VALUE",
 *   ],
 * };
 * const command = new ResolveActorsCommand(input);
 * const response = await client.send(command);
 * // { // ResolveActorsOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   results: [ // Resolutions // required
 * //     { // Resolution
 * //       ref: "STRING_VALUE", // required
 * //       actor: { // ActorSummary
 * //         id: "STRING_VALUE", // required
 * //         name: "STRING_VALUE", // required
 * //         kind: "STRING_VALUE", // required
 * //       },
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param ResolveActorsCommandInput - {@link ResolveActorsCommandInput}
 * @returns {@link ResolveActorsCommandOutput}
 * @see {@link ResolveActorsCommandInput} for command's `input` shape.
 * @see {@link ResolveActorsCommandOutput} for command's `response` shape.
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
export class ResolveActorsCommand extends command<ResolveActorsCommandInput, ResolveActorsCommandOutput>(
  _ep0,
  _mw0,
  "ResolveActors",
  ResolveActors$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: ResolveActorsInput;
      output: ResolveActorsOutput;
    };
    sdk: {
      input: ResolveActorsCommandInput;
      output: ResolveActorsCommandOutput;
    };
  };
}
