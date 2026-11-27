// smithy-typescript generated code
import type { BlobPayloadInputTypes, MetadataBearer as __MetadataBearer } from "@smithy/types";

import { _ep0, _mw0, command } from "../commandBuilder";
import type { CreateFileInput, CreateFileOutput } from "../models/models_0";
import { CreateFile$ } from "../schemas/schemas_0";

/**
 * @public
 */
export type { __MetadataBearer };
/**
 * @public
 */
export type CreateFileCommandInputType = Omit<CreateFileInput, "body"> & {
  body: BlobPayloadInputTypes;
};

/**
 * @public
 *
 * The input for {@link CreateFileCommand}.
 */
export interface CreateFileCommandInput extends CreateFileCommandInputType {}
/**
 * @public
 *
 * The output of {@link CreateFileCommand}.
 */
export interface CreateFileCommandOutput extends CreateFileOutput, __MetadataBearer {}

/**
 * file を 1 つ置く。本文は中身をそのまま（`Content-Type` は拡張子の種類と同じ。`;` の後ろと大小は問わない）。答えに中身は入らない。
 * 受ける拡張子は png・jpg・jpeg・gif・webp・pdf・txt・log・md・csv・json。ほかの拡張子・拡張子と合わない
 * `Content-Type`・頭が拡張子の形でない中身（字の file は UTF-8 で NUL の無い物）は 415。
 * 番号（`n`）を書かなければ、同じ project・key・語・拡張子の置いた番号と消した番号の最大 + 1（初めは 1）。
 * 書けば（取り込み）その番号で置き、置いた・消した番号なら 409（何も替えない）。
 * 送り手は CreatePage と同じ（castlist には、ほかの検査（400・415）の後に聞く）。
 * `role` は、いつも要る（無ければ 400）。browser の中のページからは置けない（守りの層が `Origin` の付いた要求を断る）。
 * 画面（callboard）の form から上げた file は、callboard が `Origin` を付けずに、役割 `product-manager` で置く。
 * @example
 * Use a bare-bones client and the command you need to make an API call.
 * ```javascript
 * import { PagetrayClient, CreateFileCommand } from "pagetray-client"; // ES Modules import
 * // const { PagetrayClient, CreateFileCommand } = require("pagetray-client"); // CommonJS import
 * // import type { PagetrayClientConfig } from "pagetray-client";
 * const config = {}; // type is PagetrayClientConfig
 * const client = new PagetrayClient(config);
 * const input = { // CreateFileInput
 *   project: "STRING_VALUE", // required
 *   key: "STRING_VALUE", // required
 *   name: "STRING_VALUE", // required
 *   role: "STRING_VALUE",
 *   workspace: "STRING_VALUE",
 *   n: "STRING_VALUE",
 *   createdAt: new Date("TIMESTAMP"),
 *   actorIssuer: "STRING_VALUE",
 *   actorRef: "STRING_VALUE",
 *   contentType: "STRING_VALUE", // required
 *   body: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")   // required
 * };
 * const command = new CreateFileCommand(input);
 * const response = await client.send(command);
 * // { // CreateFileOutput
 * //   project: "STRING_VALUE", // required
 * //   key: "STRING_VALUE", // required
 * //   name: "STRING_VALUE", // required
 * //   ext: "STRING_VALUE", // required
 * //   n: "STRING_VALUE", // required
 * //   type: "STRING_VALUE", // required
 * //   size: Number("long"), // required
 * //   sha256: "STRING_VALUE", // required
 * //   role: "STRING_VALUE", // required
 * //   workspace: "STRING_VALUE", // required
 * //   createdAt: new Date("TIMESTAMP"), // required
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
 * @param CreateFileCommandInput - {@link CreateFileCommandInput}
 * @returns {@link CreateFileCommandOutput}
 * @see {@link CreateFileCommandInput} for command's `input` shape.
 * @see {@link CreateFileCommandOutput} for command's `response` shape.
 * @see {@link PagetrayClientResolvedConfig | config} for PagetrayClient's `config` shape.
 *
 * @throws {@link ValidationException} (client fault)
 *  A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
 *
 * @throws {@link UnsupportedMediaType} (client fault)
 *  file の種類を受けない: 受けない拡張子・拡張子と合わない `Content-Type`・頭が拡張子の形でない中身（CreateFile）。
 * 生成した層が返す `UnsupportedMediaTypeException`（操作の決めた `Content-Type` でない要求）とは別。
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
export class CreateFileCommand extends command<CreateFileCommandInput, CreateFileCommandOutput>(
  _ep0,
  _mw0,
  "CreateFile",
  CreateFile$
) {
  /** @internal type navigation helper, not in runtime. */
  protected declare static __types: {
    api: {
      input: CreateFileInput;
      output: CreateFileOutput;
    };
    sdk: {
      input: CreateFileCommandInput;
      output: CreateFileCommandOutput;
    };
  };
}
