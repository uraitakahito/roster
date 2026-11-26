import type { MetadataBearer as __MetadataBearer } from "@smithy/types";
import type { ListMessagesInput, ListMessagesOutput } from "../models/models_0";
/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 *
 * The input for {@link ListMessagesCommand}.
 */
export interface ListMessagesCommandInput extends ListMessagesInput {
}
/**
 * @public
 *
 * The output of {@link ListMessagesCommand}.
 */
export interface ListMessagesCommandOutput extends ListMessagesOutput, __MetadataBearer {
}
declare const ListMessagesCommand_base: {
    new (input: ListMessagesCommandInput): import("@smithy/core/client").CommandImpl<ListMessagesCommandInput, ListMessagesCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    new (...[input]: [] | [ListMessagesCommandInput]): import("@smithy/core/client").CommandImpl<ListMessagesCommandInput, ListMessagesCommandOutput, import("..").PagetrayClientResolvedConfig, import("..").ServiceInputTypes, import("..").ServiceOutputTypes>;
    getEndpointParameterInstructions(): import("@smithy/types").EndpointParameterInstructions;
};
/**
 * メッセージの記録を探す（送った時刻の新しい順が既定）。どの条件も、書いた物だけで絞る（重ねれば、どれにも合う物）。
 * - `to`・`from`・`state`・`heading`・`project`・`key` は、同じ値の物。
 * - `q` は前後の空白を落とし、空なら絞らない。本文か `from` か `to` に、`q` を含む物（大小を分ける）。
 * - 頁は `sentAt` と行の順で続ける（ListPages と同じ作り）。`nextToken` は同じ `sort` の答えの物を渡す（違えば 400）。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, ListMessagesCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, ListMessagesCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // ListMessagesInput
 *   project: "STRING_VALUE",
 *   key: "STRING_VALUE",
 *   to: "STRING_VALUE",
 *   from: "STRING_VALUE",
 *   state: "STRING_VALUE",
 *   heading: "STRING_VALUE",
 *   q: "STRING_VALUE",
 *   sort: "STRING_VALUE",
 *   maxResults: Number("int"),
 *   nextToken: "STRING_VALUE",
 * };
 * const command = new ListMessagesCommand(input);
 * const response = await client.send(command);
 * // { // ListMessagesOutput
 * //   messages: [ // Messages // required
 * //     { // Message
 * //       project: "STRING_VALUE", // required
 * //       id: "STRING_VALUE", // required
 * //       key: "STRING_VALUE",
 * //       heading: "STRING_VALUE", // required
 * //       from: "STRING_VALUE", // required
 * //       to: "STRING_VALUE", // required
 * //       text: "STRING_VALUE", // required
 * //       sentAt: new Date("TIMESTAMP"), // required
 * //       state: "STRING_VALUE", // required
 * //       deliveredAt: new Date("TIMESTAMP"),
 * //       via: "STRING_VALUE",
 * //       deliveries: Number("int"),
 * //       replyTo: "STRING_VALUE",
 * //       createdAt: new Date("TIMESTAMP"), // required
 * //       updatedAt: new Date("TIMESTAMP"), // required
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
 * @param ListMessagesCommandInput - {@link ListMessagesCommandInput}
 * @returns {@link ListMessagesCommandOutput}
 * @see {@link ListMessagesCommandInput} for command's `input` shape.
 * @see {@link ListMessagesCommandOutput} for command's `response` shape.
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
export declare class ListMessagesCommand extends ListMessagesCommand_base {
    /** @internal type navigation helper, not in runtime. */
    protected static __types: {
        api: {
            input: ListMessagesInput;
            output: ListMessagesOutput;
        };
        sdk: {
            input: ListMessagesCommandInput;
            output: ListMessagesCommandOutput;
        };
    };
}
