// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { GetLineageInput, GetLineageOutput } from "../models/models_0";
import { GetLineage$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetLineageCommand}.
 */
export interface GetLineageCommandInput extends GetLineageInput {}
/**
 * @public
 *
 * The output of {@link GetLineageCommand}.
 */
export interface GetLineageCommandOutput extends GetLineageOutput, __MetadataBearer {}

/**
 * 起こした・継いだ線を上り下りする。上りは人で止める（人は含む。起点が人なら上らない）。
 * 既定の深さは上 20 段・下 1 段で、`depth` を付ければ両方にそれを使う。`type` は上りと下りの両方の線を絞る。
 * `nodes` は一覧の形を初めの登場の順（同じなら受けた順）に、`edges` は線を受けた順に、重ならずに返す。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, GetLineageCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, GetLineageCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // GetLineageInput
 *   actorId: "STRING_VALUE", // required
 *   direction: "STRING_VALUE",
 *   depth: Number("int"),
 *   type: "STRING_VALUE",
 * };
 * const command = new GetLineageCommand(input);
 * const response = await client.send(command);
 * // { // GetLineageOutput
 * //   asOf: new Date("TIMESTAMP"), // required
 * //   actorId: "STRING_VALUE", // required
 * //   nodes: [ // ActorRows // required
 * //     { // ActorRow
 * //       id: "STRING_VALUE", // required
 * //       name: "STRING_VALUE", // required
 * //       kind: "STRING_VALUE", // required
 * //       issuer: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //       labels: { // Labels // required
 * //         "<keys>": "STRING_VALUE",
 * //       },
 * //       firstEnteredAt: new Date("TIMESTAMP"),
 * //       lastExitedAt: new Date("TIMESTAMP"),
 * //       lastExitType: "STRING_VALUE",
 * //       present: true || false, // required
 * //       inferred: true || false, // required
 * //       presence: "STRING_VALUE",
 * //       skewed: true || false,
 * //       model: "STRING_VALUE",
 * //       effort: "STRING_VALUE",
 * //       url: "STRING_VALUE", // required
 * //     },
 * //   ],
 * //   edges: [ // Links // required
 * //     { // Link
 * //       id: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       from: "STRING_VALUE", // required
 * //       to: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //     },
 * //   ],
 * // };
 *
 * ```
 *
 * @param GetLineageCommandInput - {@link GetLineageCommandInput}
 * @returns {@link GetLineageCommandOutput}
 * @see {@link GetLineageCommandInput} for command's `input` shape.
 * @see {@link GetLineageCommandOutput} for command's `response` shape.
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
export class GetLineageCommand extends command<GetLineageCommandInput, GetLineageCommandOutput>(
  _ep0,
  _mw0,
  "GetLineage",
  GetLineage$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: GetLineageInput;
      output: GetLineageOutput;
    };
    sdk: {
      input: GetLineageCommandInput;
      output: GetLineageCommandOutput;
    };
  };
}
