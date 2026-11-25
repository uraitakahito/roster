"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedMediaType = exports.PayloadTooLarge = exports.Forbidden = exports.Conflict = exports.ValidationException = exports.Unavailable = exports.NotFound = exports.InternalError = void 0;
const PagetrayServiceException_1 = require("./PagetrayServiceException");
/**
 * server の中で失敗した（DB の誤りなど）。送り直しても直らない見込みなので、@retryable は付けない。
 * 訳は server の記録に書き、答えの `message` は決まった字にする（中の誤りの字を外に出さない）。
 * @public
 */
class InternalError extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "ai.common#InternalError";
    name = "InternalError";
    $fault = "server";
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "InternalError",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, InternalError.prototype);
    }
}
exports.InternalError = InternalError;
/**
 * 名指した物が無い。
 * @public
 */
class NotFound extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "ai.common#NotFound";
    name = "NotFound";
    $fault = "client";
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "NotFound",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, NotFound.prototype);
    }
}
exports.NotFound = NotFound;
/**
 * 混んでいる・時間がかかりすぎた・呼ぶ先が答えない。少し待って送り直す。
 * 時間切れは、どの操作の前でも効く（server の守りの層）。
 * @public
 */
class Unavailable extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "ai.common#Unavailable";
    name = "Unavailable";
    $fault = "server";
    $retryable = {};
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "Unavailable",
            $fault: "server",
            ...opts,
        });
        Object.setPrototypeOf(this, Unavailable.prototype);
    }
}
exports.Unavailable = Unavailable;
/**
 * A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
 * @public
 */
class ValidationException extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "smithy.framework#ValidationException";
    name = "ValidationException";
    $fault = "client";
    /**
     * A list of specific failures encountered while validating the input.
     * A member can appear in this list more than once if it failed to satisfy multiple constraints.
     * @public
     */
    fieldList;
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "ValidationException",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, ValidationException.prototype);
        this.fieldList = opts.fieldList;
    }
}
exports.ValidationException = ValidationException;
/**
 * 同じ id の物がもうあり、中身が違う。
 * @public
 */
class Conflict extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "ai.common#Conflict";
    name = "Conflict";
    $fault = "client";
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "Conflict",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, Conflict.prototype);
    }
}
exports.Conflict = Conflict;
/**
 * 受けない要求。castlist を動かす機械の外からの名（`Host`）と、browser の中のページからの書く要求（`Origin` の付いた
 * `GET`・`HEAD` のほか）を断る。どの操作の前でも効く（server の守りの層）。
 * @public
 */
class Forbidden extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "ai.common#Forbidden";
    name = "Forbidden";
    $fault = "client";
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "Forbidden",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, Forbidden.prototype);
    }
}
exports.Forbidden = Forbidden;
/**
 * 本文が上限より大きい。どの操作の前でも効く（server の守りの層。上限は server が決める）。
 * @public
 */
class PayloadTooLarge extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "ai.common#PayloadTooLarge";
    name = "PayloadTooLarge";
    $fault = "client";
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "PayloadTooLarge",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, PayloadTooLarge.prototype);
    }
}
exports.PayloadTooLarge = PayloadTooLarge;
/**
 * file の種類を受けない: 受けない拡張子・拡張子と合わない `Content-Type`・頭が拡張子の形でない中身（CreateFile）。
 * 生成した層が返す `UnsupportedMediaTypeException`（操作の決めた `Content-Type` でない要求）とは別。
 * @public
 */
class UnsupportedMediaType extends PagetrayServiceException_1.PagetrayServiceException {
    static shapeId = "ai.pagetray#UnsupportedMediaType";
    name = "UnsupportedMediaType";
    $fault = "client";
    /**
     * @internal
     */
    constructor(opts) {
        super({
            name: "UnsupportedMediaType",
            $fault: "client",
            ...opts,
        });
        Object.setPrototypeOf(this, UnsupportedMediaType.prototype);
    }
}
exports.UnsupportedMediaType = UnsupportedMediaType;
