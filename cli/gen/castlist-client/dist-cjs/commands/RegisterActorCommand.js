"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegisterActorCommand = void 0;
const commandBuilder_1 = require("../commandBuilder");
const schemas_0_1 = require("../schemas/schemas_0");
/**
 * アクターを登録する。鍵（`bindings` の初めの物）が出し手（`issuer`）の中に既にあれば、そのアクターを返す（200・`created` は false）。
 * 無ければ新しく作る（201）。id は castlist が出す（UUID v7）。名は `<namePrefix>.<番号>`（番号は出し手と接頭辞ごとに 1 から）。
 * 既にあった時は、`kind`・`namePrefix`・`labels` を見ず、変わった鍵でない付随する id と、変わった頼んだ model と effort だけを足す。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { CastlistClient, RegisterActorCommand } from "castlist-client"; // ES Modules import
 * // const { CastlistClient, RegisterActorCommand } = require("castlist-client"); // CommonJS import
 * // import type { CastlistClientConfig } from "castlist-client";
 * const config = {}; // type is CastlistClientConfig
 * const client = new CastlistClient(config);
 * const input = { // RegisterActorInput
 *   issuer: "STRING_VALUE", // required
 *   kind: "STRING_VALUE", // required
 *   namePrefix: "STRING_VALUE", // required
 *   labels: { // Labels
 *     "<keys>": "STRING_VALUE",
 *   },
 *   bindings: [ // Bindings // required
 *     { // Binding
 *       type: "STRING_VALUE", // required
 *       value: "STRING_VALUE", // required
 *     },
 *   ],
 *   sentAt: new Date("TIMESTAMP"), // required
 *   settings: { // RequestedSettings
 *     model: "STRING_VALUE", // required
 *     effort: "STRING_VALUE", // required
 *   },
 * };
 * const command = new RegisterActorCommand(input);
 * const response = await client.send(command);
 * // { // RegisterActorOutput
 * //   actor: { // ActorSummary
 * //     id: "STRING_VALUE", // required
 * //     name: "STRING_VALUE", // required
 * //     kind: "STRING_VALUE", // required
 * //   },
 * //   created: true || false, // required
 * //   status: Number("int"), // required
 * // };
 *
 * ```
 *
 * @param RegisterActorCommandInput - {@link RegisterActorCommandInput}
 * @returns {@link RegisterActorCommandOutput}
 * @see {@link RegisterActorCommandInput} for command's `input` shape.
 * @see {@link RegisterActorCommandOutput} for command's `response` shape.
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
class RegisterActorCommand extends (0, commandBuilder_1.command)(commandBuilder_1._ep0, commandBuilder_1._mw0, "RegisterActor", schemas_0_1.RegisterActor$) {
}
exports.RegisterActorCommand = RegisterActorCommand;
