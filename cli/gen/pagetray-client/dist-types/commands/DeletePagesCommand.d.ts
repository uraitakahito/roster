import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { DeletePagesInput, DeletePagesOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link DeletePagesCommand}.
 */
export interface DeletePagesCommandInput extends DeletePagesInput {
}
/**
 * @public
 *
 * The output of {@link DeletePagesCommand}.
 */
export interface DeletePagesCommandOutput extends DeletePagesOutput, __MetadataBearer {
}
declare const DeletePagesCommand_base: {
    new (input: DeletePagesCommandInput): import("@smithy/core/client").CommandImpl<DeletePagesCommandInput, DeletePagesCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (input: DeletePagesCommandInput): import("@smithy/core/client").CommandImpl<DeletePagesCommandInput, DeletePagesCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * 合うページをみな消す（戻せない）。`project` は要り、`key`・`kind`・`n` は書けば絞る（`n` には `key` と `kind` が要る）。
 * 番号は消した時刻と残し、2 度使わない（消したページの URL は 410）。全文の索引の行と見た物も消え、送り手の行は残る。
 * 答えは消したページの path（置いた順）。合う物が無ければ空。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, DeletePagesCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, DeletePagesCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // DeletePagesInput
 *   project: "STRING_VALUE", // required
 *   key: "STRING_VALUE",
 *   kind: "STRING_VALUE",
 *   n: "STRING_VALUE",
 * };
 * const command = new DeletePagesCommand(input);
 * const response = await client.send(command);
 * // { // DeletePagesOutput
 * //   removed: [ // Paths // required
 * //     "STRING_VALUE",
 * //   ],
 * // };
 *
 * ```
 *
 * @param DeletePagesCommandInput - {@link DeletePagesCommandInput}
 * @returns {@link DeletePagesCommandOutput}
 * @see {@link DeletePagesCommandInput} for command's `input` shape.
 * @see {@link DeletePagesCommandOutput} for command's `response` shape.
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
export declare class DeletePagesCommand extends DeletePagesCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: DeletePagesInput;
            output: DeletePagesOutput;
        };
        sdk: {
            input: DeletePagesCommandInput;
            output: DeletePagesCommandOutput;
        };
    };
}
