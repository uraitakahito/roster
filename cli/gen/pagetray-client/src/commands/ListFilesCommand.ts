// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { ListFilesInput, ListFilesOutput } from "../models/models_0";
import { ListFiles$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link ListFilesCommand}.
 */
export interface ListFilesCommandInput extends ListFilesInput {}
/**
 * @public
 *
 * The output of {@link ListFilesCommand}.
 */
export interface ListFilesCommandOutput extends ListFilesOutput, __MetadataBearer {}

/**
 * file を探す（新しい順が既定）。どの条件も、書いた物だけで絞る（重ねれば、どれにも合う物）。
 * - `q` は前後の空白を落とし、空なら絞らない。名（`<語>.<拡張子>`）に、小文字にした `q` を含む物。
 * - `actor` は送り手の castlist のアクターの id（castlist の答えの無い送り手の file には当たらない）。
 * - 頁は `createdAt` と行の順で続ける（ListPages と同じ）。`nextToken` は同じ `sort` の答えの物を渡す。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, ListFilesCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, ListFilesCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // ListFilesInput
 *   project: "STRING_VALUE",
 *   key: "STRING_VALUE",
 *   role: "STRING_VALUE",
 *   workspace: "STRING_VALUE",
 *   q: "STRING_VALUE",
 *   actor: "STRING_VALUE",
 *   sort: "STRING_VALUE",
 *   maxResults: Number("int"),
 *   nextToken: "STRING_VALUE",
 * };
 * const command = new ListFilesCommand(input);
 * const response = await client.send(command);
 * // { // ListFilesOutput
 * //   files: [ // Files // required
 * //     { // File
 * //       project: "STRING_VALUE", // required
 * //       key: "STRING_VALUE", // required
 * //       name: "STRING_VALUE", // required
 * //       ext: "STRING_VALUE", // required
 * //       n: "STRING_VALUE", // required
 * //       type: "STRING_VALUE", // required
 * //       size: Number("long"), // required
 * //       sha256: "STRING_VALUE", // required
 * //       role: "STRING_VALUE", // required
 * //       workspace: "STRING_VALUE", // required
 * //       createdAt: new Date("TIMESTAMP"), // required
 * //       path: "STRING_VALUE", // required
 * //       sender: { // Sender
 * //         issuer: "STRING_VALUE", // required
 * //         ref: "STRING_VALUE", // required
 * //         actor: { // ActorSummary
 * //           id: "STRING_VALUE", // required
 * //           name: "STRING_VALUE", // required
 * //           kind: "STRING_VALUE", // required
 * //         },
 * //         resolvedAt: new Date("TIMESTAMP"),
 * //       },
 * //     },
 * //   ],
 * //   nextToken: "STRING_VALUE",
 * // };
 *
 * ```
 *
 * @param ListFilesCommandInput - {@link ListFilesCommandInput}
 * @returns {@link ListFilesCommandOutput}
 * @see {@link ListFilesCommandInput} for command's `input` shape.
 * @see {@link ListFilesCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
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
 * @throws {@link PagetrayServiceException}
 * <p>Base exception class for all service exceptions from Pagetray service.</p>
 *
 *
 * @public
 */
export class ListFilesCommand extends command<ListFilesCommandInput, ListFilesCommandOutput>(
  _ep0,
  _mw0,
  "ListFiles",
  ListFiles$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: ListFilesInput;
      output: ListFilesOutput;
    };
    sdk: {
      input: ListFilesCommandInput;
      output: ListFilesCommandOutput;
    };
  };
}
