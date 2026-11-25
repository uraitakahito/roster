// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { GetActorInput, GetActorOutput } from "../models/models_0";
import { GetActor$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link GetActorCommand}.
 */
export interface GetActorCommandInput extends GetActorInput {}
/**
 * @public
 *
 * The output of {@link GetActorCommand}.
 */
export interface GetActorCommandOutput extends GetActorOutput, __MetadataBearer {}

/**
 * 1 つのアクターの全部（札・付随する id・出来事・model と effort・線・今の状態）。1 つの読む transaction の中で、揃った写しを読む。
 * 札は map（JSON の鍵の順は決まらない。並べる時は client の側で）、ほかの並びは受けた順（seq）。`currentBindings` は種類ごとの最新を種類の順に、`currentSettings` は最新の 1 つ（無ければ無い）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, GetActorCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, GetActorCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // GetActorInput
 *   actorId: "STRING_VALUE", // required
 * };
 * const command = new GetActorCommand(input);
 * const response = await client.send(command);
 * // { // GetActorOutput
 * //   id: "STRING_VALUE", // required
 * //   name: "STRING_VALUE", // required
 * //   kind: "STRING_VALUE", // required
 * //   issuer: "STRING_VALUE", // required
 * //   sentAt: new Date("TIMESTAMP"), // required
 * //   receivedAt: new Date("TIMESTAMP"), // required
 * //   clockSkew: true || false, // required
 * //   labels: { // Labels // required
 * //     "<keys>": "STRING_VALUE",
 * //   },
 * //   bindings: [ // ActorBindings // required
 * //     { // ActorBinding
 * //       issuer: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       value: "STRING_VALUE", // required
 * //       isKey: true || false, // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //     },
 * //   ],
 * //   currentBindings: [ // required
 * //     {
 * //       issuer: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       value: "STRING_VALUE", // required
 * //       isKey: true || false, // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //     },
 * //   ],
 * //   events: [ // Events // required
 * //     { // Event
 * //       id: "STRING_VALUE", // required
 * //       actorId: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       detail: "DOCUMENT_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //     },
 * //   ],
 * //   settings: [ // Settings // required
 * //     { // Setting
 * //       id: "STRING_VALUE",
 * //       actorId: "STRING_VALUE", // required
 * //       model: "STRING_VALUE", // required
 * //       effort: "STRING_VALUE", // required
 * //       source: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //     },
 * //   ],
 * //   currentSettings: {
 * //     id: "STRING_VALUE",
 * //     actorId: "STRING_VALUE", // required
 * //     model: "STRING_VALUE", // required
 * //     effort: "STRING_VALUE", // required
 * //     source: "STRING_VALUE", // required
 * //     sentAt: new Date("TIMESTAMP"), // required
 * //     receivedAt: new Date("TIMESTAMP"), // required
 * //     clockSkew: true || false, // required
 * //   },
 * //   linksIn: [ // Links // required
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
 * //   linksOut: [ // required
 * //     {
 * //       id: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       from: "STRING_VALUE", // required
 * //       to: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       receivedAt: new Date("TIMESTAMP"), // required
 * //       clockSkew: true || false, // required
 * //     },
 * //   ],
 * //   state: { // ActorState
 * //     presence: "STRING_VALUE",
 * //     present: true || false, // required
 * //     inferred: true || false, // required
 * //     enteredAt: new Date("TIMESTAMP"),
 * //     exitedAt: new Date("TIMESTAMP"),
 * //   },
 * //   asOf: new Date("TIMESTAMP"), // required
 * // };
 *
 * ```
 *
 * @param GetActorCommandInput - {@link GetActorCommandInput}
 * @returns {@link GetActorCommandOutput}
 * @see {@link GetActorCommandInput} for command's `input` shape.
 * @see {@link GetActorCommandOutput} for command's `response` shape.
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
export class GetActorCommand extends command<GetActorCommandInput, GetActorCommandOutput>(
  _ep0,
  _mw0,
  "GetActor",
  GetActor$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: GetActorInput;
      output: GetActorOutput;
    };
    sdk: {
      input: GetActorCommandInput;
      output: GetActorCommandOutput;
    };
  };
}
