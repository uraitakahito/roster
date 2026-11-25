import { type ServiceExceptionOptions as __ServiceExceptionOptions, ServiceException as __ServiceException } from "@smithy/core/client";
export type { __ServiceExceptionOptions };
export { __ServiceException };
/**
 * @public
 *
 * Base exception class for all service exceptions from Castlist service.
 */
export declare class CastlistServiceException extends __ServiceException {
    static readonly shapeId: string;
    /**
     * @internal
     */
    constructor(options: __ServiceExceptionOptions);
}
