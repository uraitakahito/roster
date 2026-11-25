"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commonParams = exports.resolveClientEndpointParameters = void 0;
/**
 * @internal
 */
const resolveClientEndpointParameters = (options) => {
    return Object.assign(options, {
        defaultSigningName: "",
    });
};
exports.resolveClientEndpointParameters = resolveClientEndpointParameters;
/**
 * @internal
 */
exports.commonParams = {
    endpoint: { type: "builtInParams", name: "endpoint" },
};
