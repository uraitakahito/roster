// smithy-typescript generated code
import type { MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { DeleteFilesInput, DeleteFilesOutput } from "../models/models_0";
import { DeleteFiles$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link DeleteFilesCommand}.
 */
export interface DeleteFilesCommandInput extends DeleteFilesInput {}
/**
 * @public
 *
 * The output of {@link DeleteFilesCommand}.
 */
export interface DeleteFilesCommandOutput extends DeleteFilesOutput, __MetadataBearer {}

/**
 * 合う file をみな消す（戻せない）。`project` は要り、`key`・`name`・`n` は書けば絞る（`n` には `key` と `name` が要る。
 * `name` だけなら project の中のその名をみな）。番号は消した時刻と残し、2 度使わない（消した file の URL は 410）。
 * ページは消えない。答えは消した file の path（置いた順）。合う物が無ければ空。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, DeleteFilesCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, DeleteFilesCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // DeleteFilesInput
 *   project: "STRING_VALUE", // required
 *   key: "STRING_VALUE",
 *   name: "STRING_VALUE",
 *   n: "STRING_VALUE",
 * };
 * const command = new DeleteFilesCommand(input);
 * const response = await client.send(command);
 * // { // DeleteFilesOutput
 * //   removed: [ // Paths // required
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param DeleteFilesCommandInput - {@link DeleteFilesCommandInput}
 * @returns {@link DeleteFilesCommandOutput}
 * @see {@link DeleteFilesCommandInput} for command's `input` shape.
 * @see {@link DeleteFilesCommandOutput} for command's `response` shape.
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
export class DeleteFilesCommand extends command<DeleteFilesCommandInput, DeleteFilesCommandOutput>(
  _ep0,
  _mw0,
  "DeleteFiles",
  DeleteFiles$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: DeleteFilesInput;
      output: DeleteFilesOutput;
    };
    sdk: {
      input: DeleteFilesCommandInput;
      output: DeleteFilesCommandOutput;
    };
  };
}
