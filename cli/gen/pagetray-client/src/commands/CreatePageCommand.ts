// smithy-typescript generated code
import type { BlobPayloadInputTypes, MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { CreatePageInput, CreatePageOutput } from "../models/models_0";
import { CreatePage$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 */
export type CreatePageCommandInputType = Omit<CreatePageInput, "body"> & {
  body: BlobPayloadInputTypes;
};

/**
 * @public
 *
 * The input for {@link CreatePageCommand}.
 */
export interface CreatePageCommandInput extends CreatePageCommandInputType {}
/**
 * @public
 *
 * The output of {@link CreatePageCommand}.
 */
export interface CreatePageCommandOutput extends CreatePageOutput, __MetadataBearer {}

/**
 * ページを 1 枚置く。本文は HTML をそのまま（`Content-Type: text/html`）。答えに本文は入らない。
 * 番号（`n`）を書かなければ、同じ project・key・kind の置いた番号と消した番号の最大 + 1（初めは 1）。
 * 書けば（取り込み）その番号で置き、置いた・消した番号なら 409（何も替えない）。
 * 題は本文の初めの `<title>`（無ければ空）。
 * 付随する id（`actorIssuer`・`actorRef`）を書けば、送り手を castlist に聞き（書く前に。1 秒・送り直さない）、答えと一緒に残す。
 * castlist に登録の無い送り手は 400、castlist に聞けなければ 503（どちらも何も残さない）。castlist の無い pagetray は、聞かずに付随する id だけを残す。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, CreatePageCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, CreatePageCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // CreatePageInput
 *   project: "STRING_VALUE", // required
 *   key: "STRING_VALUE", // required
 *   kind: "STRING_VALUE", // required
 *   role: "STRING_VALUE", // required
 *   workspace: "STRING_VALUE",
 *   n: "STRING_VALUE",
 *   createdAt: new Date("TIMESTAMP"),
 *   actorIssuer: "STRING_VALUE",
 *   actorRef: "STRING_VALUE",
 *   body: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")   // required
 * };
 * const command = new CreatePageCommand(input);
 * const response = await client.send(command);
 * // { // CreatePageOutput
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
 * //   url: "STRING_VALUE", // required
 * //   location: "STRING_VALUE", // required
 * // };
 *
 * ```
 *
 * @param CreatePageCommandInput - {@link CreatePageCommandInput}
 * @returns {@link CreatePageCommandOutput}
 * @see {@link CreatePageCommandInput} for command's `input` shape.
 * @see {@link CreatePageCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
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
 * @throws {@link PagetrayServiceException}
 * <p>Base exception class for all service exceptions from Pagetray service.</p>
 *
 *
 * @public
 */
export class CreatePageCommand extends command<CreatePageCommandInput, CreatePageCommandOutput>(
  _ep0,
  _mw0,
  "CreatePage",
  CreatePage$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: CreatePageInput;
      output: CreatePageOutput;
    };
    sdk: {
      input: CreatePageCommandInput;
      output: CreatePageCommandOutput;
    };
  };
}
