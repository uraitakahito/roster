// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { AddReviewMarksInput, AddReviewMarksOutput } from "../models/models_0";
import { AddReviewMarks$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link AddReviewMarksCommand}.
 */
export interface AddReviewMarksCommandInput extends AddReviewMarksInput {}
/**
 * @public
 *
 * The output of {@link AddReviewMarksCommand}.
 */
export interface AddReviewMarksCommandOutput extends AddReviewMarksOutput, __MetadataBearer {}

/**
 * レビューの印を書く。答えは、そのページの記録。本文は無くてもよい（何も替えずに記録を返す）。
 * - `verdict` は、書けば替わり、書かなければ前のまま（消す道は無い）。種類が `review` のページだけ（ほかは 400）。
 * - `targets` は、置き場のページの path（`/<project>/<key>/<kind>-<n>.html`）か、空白と制御字の無い `https://` の URL
 *   （2048 字まで）を、1 度に 100 個まで。足すだけで、同じ物は 1 つ、書いた順。足すとページ 1 枚で 100 個を超えるなら 400
 *   （判定も替えない）。
 * - 無いページと消したページは 404。ページを消すと、見た物も消える。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, AddReviewMarksCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, AddReviewMarksCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // AddReviewMarksInput
 *   project: "STRING_VALUE", // required
 *   key: "STRING_VALUE", // required
 *   kind: "STRING_VALUE", // required
 *   n: "STRING_VALUE", // required
 *   verdict: "STRING_VALUE",
 *   targets: [ // Targets
 *     "STRING_VALUE",
 *   ],
 * };
 * const command = new AddReviewMarksCommand(input);
 * const response = await client.send(command);
 * // { // AddReviewMarksOutput
 * //   project: "STRING_VALUE", // required
 * //   key: "STRING_VALUE", // required
 * //   kind: "STRING_VALUE", // required
 * //   n: "STRING_VALUE", // required
 * //   title: "STRING_VALUE", // required
 * //   role: "STRING_VALUE", // required
 * //   workspace: "STRING_VALUE", // required
 * //   createdAt: new Date("TIMESTAMP"), // required
 * //   size: Number("long"), // required
 * //   path: "STRING_VALUE", // required
 * //   sender: { // Sender
 * //     issuer: "STRING_VALUE", // required
 * //     ref: "STRING_VALUE", // required
 * //     actor: { // ActorSummary
 * //       id: "STRING_VALUE", // required
 * //       name: "STRING_VALUE", // required
 * //       kind: "STRING_VALUE", // required
 * //     },
 * //     resolvedAt: new Date("TIMESTAMP"),
 * //   },
 * //   askedAt: new Date("TIMESTAMP"),
 * //   answeredAt: new Date("TIMESTAMP"),
 * //   waitsOn: "STRING_VALUE",
 * //   verdict: "STRING_VALUE",
 * //   targets: [ // Targets
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param AddReviewMarksCommandInput - {@link AddReviewMarksCommandInput}
 * @returns {@link AddReviewMarksCommandOutput}
 * @see {@link AddReviewMarksCommandInput} for command's `input` shape.
 * @see {@link AddReviewMarksCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
 *
 * @throws {@link ValidationException} (client fault)
 *  A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
 *
 * @throws {@link NotFound} (client fault)
 *  名指した物が無い。
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
export class AddReviewMarksCommand extends command<AddReviewMarksCommandInput, AddReviewMarksCommandOutput>(
  _ep0,
  _mw0,
  "AddReviewMarks",
  AddReviewMarks$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: AddReviewMarksInput;
      output: AddReviewMarksOutput;
    };
    sdk: {
      input: AddReviewMarksCommandInput;
      output: AddReviewMarksCommandOutput;
    };
  };
}
