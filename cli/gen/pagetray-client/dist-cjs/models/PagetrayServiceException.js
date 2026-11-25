"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagetrayServiceException = exports.__ServiceException = void 0;
// smithy-typescript generated code
const client_1 = require("@smithy/core/client");
Object.defineProperty(exports, "__ServiceException", { enumerable: true, get: function () { return client_1.ServiceException; } });
/**
 * @public
 *
 * Base exception class for all service exceptions from Pagetray service.
 */
class PagetrayServiceException extends client_1.ServiceException {
    static shapeId = "smithy.ts.sdk.synthetic.ai.pagetray#PagetrayServiceException";
    /**
     * @internal
     */
    constructor(options) {
        super(options);
        Object.setPrototypeOf(this, PagetrayServiceException.prototype);
    }
}
exports.PagetrayServiceException = PagetrayServiceException;
