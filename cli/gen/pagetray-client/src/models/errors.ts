// smithy-typescript generated code
import type { ExceptionOptionType as __ExceptionOptionType } from "@smithy/core/client";

import type { ValidationExceptionField } from "./models_0";
import { PagetrayServiceException as __BaseException } from "./PagetrayServiceException";

/**
 * server の中で失敗した（DB の誤りなど）。送り直しても直らない見込みなので、@retryable は付けない。
 * 訳は server の記録に書き、答えの `message` は決まった字にする（中の誤りの字を外に出さない）。
 * @public
 */
export class InternalError extends __BaseException {
  public static readonly shapeId: string = "ai.common#InternalError";
  readonly name = "InternalError" as const;
  readonly $fault = "server" as const;
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<InternalError, __BaseException>) {
    super({
      name: "InternalError",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

/**
 * 名指した物が無い。
 * @public
 */
export class NotFound extends __BaseException {
  public static readonly shapeId: string = "ai.common#NotFound";
  readonly name = "NotFound" as const;
  readonly $fault = "client" as const;
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<NotFound, __BaseException>) {
    super({
      name: "NotFound",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, NotFound.prototype);
  }
}

/**
 * 混んでいる・時間がかかりすぎた・呼ぶ先が答えない。少し待って送り直す。
 * 時間切れは、どの操作の前でも効く（server の守りの層）。
 * @public
 */
export class Unavailable extends __BaseException {
  public static readonly shapeId: string = "ai.common#Unavailable";
  readonly name = "Unavailable" as const;
  readonly $fault = "server" as const;
  $retryable = {};
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<Unavailable, __BaseException>) {
    super({
      name: "Unavailable",
      $fault: "server",
      ...opts,
    });
    Object.setPrototypeOf(this, Unavailable.prototype);
  }
}

/**
 * A standard error for input validation failures.
 * This should be thrown by services when a member of the input structure
 * falls outside of the modeled or documented constraints.
 * @public
 */
export class ValidationException extends __BaseException {
  public static readonly shapeId: string = "smithy.framework#ValidationException";
  readonly name = "ValidationException" as const;
  readonly $fault = "client" as const;
  /**
   * A list of specific failures encountered while validating the input.
   * A member can appear in this list more than once if it failed to satisfy multiple constraints.
   * @public
   */
  fieldList?: ValidationExceptionField[] | undefined;

  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<ValidationException, __BaseException>) {
    super({
      name: "ValidationException",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, ValidationException.prototype);
    this.fieldList = opts.fieldList;
  }
}

/**
 * 同じ id の物がもうあり、中身が違う。
 * @public
 */
export class Conflict extends __BaseException {
  public static readonly shapeId: string = "ai.common#Conflict";
  readonly name = "Conflict" as const;
  readonly $fault = "client" as const;
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<Conflict, __BaseException>) {
    super({
      name: "Conflict",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, Conflict.prototype);
  }
}

/**
 * 受けない要求。castlist を動かす機械の外からの名（`Host`）と、browser の中のページからの書く要求（`Origin` の付いた
 * `GET`・`HEAD` のほか）を断る。どの操作の前でも効く（server の守りの層）。
 * @public
 */
export class Forbidden extends __BaseException {
  public static readonly shapeId: string = "ai.common#Forbidden";
  readonly name = "Forbidden" as const;
  readonly $fault = "client" as const;
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<Forbidden, __BaseException>) {
    super({
      name: "Forbidden",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, Forbidden.prototype);
  }
}

/**
 * 本文が上限より大きい。どの操作の前でも効く（server の守りの層。上限は server が決める）。
 * @public
 */
export class PayloadTooLarge extends __BaseException {
  public static readonly shapeId: string = "ai.common#PayloadTooLarge";
  readonly name = "PayloadTooLarge" as const;
  readonly $fault = "client" as const;
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<PayloadTooLarge, __BaseException>) {
    super({
      name: "PayloadTooLarge",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, PayloadTooLarge.prototype);
  }
}

/**
 * file の種類を受けない: 受けない拡張子・拡張子と合わない `Content-Type`・頭が拡張子の形でない中身（CreateFile）。
 * 生成した層が返す `UnsupportedMediaTypeException`（操作の決めた `Content-Type` でない要求）とは別。
 * @public
 */
export class UnsupportedMediaType extends __BaseException {
  public static readonly shapeId: string = "ai.pagetray#UnsupportedMediaType";
  readonly name = "UnsupportedMediaType" as const;
  readonly $fault = "client" as const;
  /**
   * @internal
   */
  constructor(opts: __ExceptionOptionType<UnsupportedMediaType, __BaseException>) {
    super({
      name: "UnsupportedMediaType",
      $fault: "client",
      ...opts,
    });
    Object.setPrototypeOf(this, UnsupportedMediaType.prototype);
  }
}
