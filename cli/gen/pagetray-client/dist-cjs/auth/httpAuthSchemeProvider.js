"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveHttpAuthSchemeConfig = exports.defaultPagetrayHttpAuthSchemeProvider = exports.defaultPagetrayHttpAuthSchemeParametersProvider = void 0;
// smithy-typescript generated code
const client_1 = require("@smithy/core/client");
/**
 * @internal
 */
const defaultPagetrayHttpAuthSchemeParametersProvider = async (config, context, input) => {
    return {
        operation: (0, client_1.getSmithyContext)(context).operation,
    };
};
exports.defaultPagetrayHttpAuthSchemeParametersProvider = defaultPagetrayHttpAuthSchemeParametersProvider;
function createSmithyApiNoAuthHttpAuthOption(authParameters) {
    return {
        schemeId: "smithy.api#noAuth",
    };
}
/**
 * @internal
 */
const defaultPagetrayHttpAuthSchemeProvider = (authParameters) => {
    const options = [];
    switch (authParameters.operation) {
        default: {
            options.push(createSmithyApiNoAuthHttpAuthOption(authParameters));
        }
    }
    return options;
};
exports.defaultPagetrayHttpAuthSchemeProvider = defaultPagetrayHttpAuthSchemeProvider;
/**
 * @internal
 */
const resolveHttpAuthSchemeConfig = (config) => {
    return Object.assign(config, {
        authSchemePreference: (0, client_1.normalizeProvider)(config.authSchemePreference ?? []),
    });
};
exports.resolveHttpAuthSchemeConfig = resolveHttpAuthSchemeConfig;
