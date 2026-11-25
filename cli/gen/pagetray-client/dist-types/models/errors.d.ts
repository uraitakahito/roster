import type { ExceptionOptionType as __ExceptionOptionType } from "@smithy/core/client";
import type { ValidationExceptionField } from "./models_0";
import { PagetrayServiceException as __BaseException } from "./PagetrayServiceException";
/**
 * server の中で失敗した（DB の誤りなど）。送り直しても直らない見込みなので、@retryable は付けない。
 * 訳は server の記録に書き、答えの `message` は決まった字にする（中の誤りの字を外に出さない）。
 * @public
 */
export declare class InternalError extends __BaseException {
    static readonly shapeId: string;
    readonly name: "InternalError";
    readonly $fault: "server";
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<InternalError, __BaseException>);
}
/**
 * 名指した物が無い。
 * @public
 */
export declare class NotFound extends __BaseException {
    static readonly shapeId: string;
    readonly name: "NotFound";
    readonly $fault: "client";
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<NotFound, __BaseException>);
}
/**
 * 混んでいる・時間がかかりすぎた・呼ぶ先が答えない。少し待って送り直す。
 * 時間切れは、どの操作の前でも効く（server の守りの層）。
 * @public
 */
export declare class Unavailable extends __BaseException {
    static readonly shapeId: string;
    readonly name: "Unavailable";
    readonly $fault: "server";
    $retryable: {};
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<Unavailable, __BaseException>);
}
/**
 * A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
 * @public
 */
export declare class ValidationException extends __BaseException {
    static readonly shapeId: string;
    readonly name: "ValidationException";
    readonly $fault: "client";
    /**
     * A list of specific failures encountered while validating the input.
     * A member can appear in this list more than once if it failed to satisfy multiple constraints.
     * @public
     */
    fieldList?: ValidationExceptionField[] | undefined;
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<ValidationException, __BaseException>);
}
/**
 * 同じ id の物がもうあり、中身が違う。
 * @public
 */
export declare class Conflict extends __BaseException {
    static readonly shapeId: string;
    readonly name: "Conflict";
    readonly $fault: "client";
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<Conflict, __BaseException>);
}
/**
 * 受けない要求。castlist を動かす機械の外からの名（`Host`）と、browser の中のページからの書く要求（`Origin` の付いた
 * `GET`・`HEAD` のほか）を断る。どの操作の前でも効く（server の守りの層）。
 * @public
 */
export declare class Forbidden extends __BaseException {
    static readonly shapeId: string;
    readonly name: "Forbidden";
    readonly $fault: "client";
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<Forbidden, __BaseException>);
}
/**
 * 本文が上限より大きい。どの操作の前でも効く（server の守りの層。上限は server が決める）。
 * @public
 */
export declare class PayloadTooLarge extends __BaseException {
    static readonly shapeId: string;
    readonly name: "PayloadTooLarge";
    readonly $fault: "client";
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<PayloadTooLarge, __BaseException>);
}
/**
 * file の種類を受けない: 受けない拡張子・拡張子と合わない `Content-Type`・頭が拡張子の形でない中身（CreateFile）。
 * 生成した層が返す `UnsupportedMediaTypeException`（操作の決めた `Content-Type` でない要求）とは別。
 * @public
 */
export declare class UnsupportedMediaType extends __BaseException {
    static readonly shapeId: string;
    readonly name: "UnsupportedMediaType";
    readonly $fault: "client";
    /**
     * @internal
     */
    constructor(opts: __ExceptionOptionType<UnsupportedMediaType, __BaseException>);
}
