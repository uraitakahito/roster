"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagetrayClient = exports.__Client = void 0;
// smithy-typescript generated code
const client_1 = require("@aws-sdk/core/client");
const core_1 = require("@smithy/core");
const client_2 = require("@smithy/core/client");
Object.defineProperty(exports, "__Client", { enumerable: true, get: function () { return client_2.Client; } });
const endpoints_1 = require("@smithy/core/endpoints");
const protocols_1 = require("@smithy/core/protocols");
const retry_1 = require("@smithy/core/retry");
const schema_1 = require("@smithy/core/schema");
const httpAuthSchemeProvider_1 = require("./auth/httpAuthSchemeProvider");
const EndpointParameters_1 = require("./endpoint/EndpointParameters");
const runtimeConfig_1 = require("./runtimeConfig");
const runtimeExtensions_1 = require("./runtimeExtensions");
/**
 * @public
 */
class PagetrayClient extends client_2.Client {
    /**
     * The resolved configuration of PagetrayClient class. This is resolved and normalized from the {@link PagetrayClientConfig | constructor configuration interface}.
     */
    config;
    constructor(...[configuration]) {
        const _config_0 = (0, runtimeConfig_1.getRuntimeConfig)(configuration || {});
        super(_config_0);
        this.initConfig = _config_0;
        const _config_1 = (0, EndpointParameters_1.resolveClientEndpointParameters)(_config_0);
        const _config_2 = (0, retry_1.resolveRetryConfig)(_config_1);
        const _config_3 = (0, client_1.resolveHostHeaderConfig)(_config_2);
        const _config_4 = (0, endpoints_1.resolveEndpointConfig)(_config_3);
        const _config_5 = (0, endpoints_1.resolveEndpointRequiredConfig)(_config_4);
        const _config_6 = (0, client_1.resolveUserAgentConfig)(_config_5);
        const _config_7 = (0, httpAuthSchemeProvider_1.resolveHttpAuthSchemeConfig)(_config_6);
        const _config_8 = (0, runtimeExtensions_1.resolveRuntimeExtensions)(_config_7, configuration?.extensions || []);
        this.config = _config_8;
        this.middlewareStack.use((0, schema_1.getSchemaSerdePlugin)(this.config));
        this.middlewareStack.use((0, retry_1.getRetryPlugin)(this.config));
        this.middlewareStack.use((0, protocols_1.getContentLengthPlugin)(this.config));
        this.middlewareStack.use((0, core_1.getHttpSigningPlugin)(this.config));
        this.middlewareStack.use((0, client_1.getHostHeaderPlugin)(this.config));
        this.middlewareStack.use((0, client_1.getLoggerPlugin)(this.config));
        this.middlewareStack.use((0, client_1.getRecursionDetectionPlugin)(this.config));
        this.middlewareStack.use((0, client_1.getUserAgentPlugin)(this.config));
        this.middlewareStack.use((0, core_1.getHttpAuthSchemeEndpointRuleSetPlugin)(this.config, {
            httpAuthSchemeParametersProvider: httpAuthSchemeProvider_1.defaultPagetrayHttpAuthSchemeParametersProvider,
            identityProviderConfigProvider: async (config) => new core_1.DefaultIdentityProviderConfig({}),
        }));
    }
    /**
     * Destroy underlying resources, like sockets. It's usually not necessary to do this.
     * However in Node.js, it's best to explicitly shut down the client's agent when it is no longer needed.
     * Otherwise, sockets might stay open for quite a long time before the server terminates them.
     */
    destroy() {
        super.destroy();
    }
}
exports.PagetrayClient = PagetrayClient;
