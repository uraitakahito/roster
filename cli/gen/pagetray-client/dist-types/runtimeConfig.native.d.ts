import type { PagetrayClientConfig } from "./PagetrayClient";
/**
 * @internal
 */
export declare const getRuntimeConfig: (config: PagetrayClientConfig) => {
    runtime: string;
    requestHandler: import("@smithy/types").NodeHttpHandlerOptions | import("@smithy/types").FetchHttpHandlerOptions | Record<string, unknown> | import("@smithy/core/protocols").HttpHandler<any> | import("@smithy/fetch-http-handler").FetchHttpHandler;
    cacheMiddleware?: boolean;
    protocol: import("@smithy/types").ClientProtocol<any, any> | import("@smithy/types").ClientProtocolCtor<any, any> | typeof import("@aws-sdk/core/protocols").AwsRestJsonProtocol;
    protocolSettings: {
        defaultNamespace?: string;
        [setting: string]: unknown;
    };
    apiVersion: string;
    sha256: import("@smithy/types").HashConstructor;
    urlParser: import("@smithy/types").UrlParser;
    bodyLengthChecker: import("@smithy/types").BodyLengthCalculator;
    streamCollector: (stream: import("node:stream").Readable | import("node:stream/web").ReadableStream | ReadableStream | Blob) => Promise<Uint8Array>;
    base64Decoder: import("@smithy/types").Decoder;
    base64Encoder: (_input: Uint8Array | string) => string;
    utf8Decoder: import("@smithy/types").Decoder;
    utf8Encoder: (input: Uint8Array | string) => string;
    disableHostPrefix: boolean;
    maxAttempts: number | import("@smithy/types").Provider<number>;
    retryMode: string | import("@smithy/types").Provider<string>;
    logger: import("@smithy/types").Logger;
    extensions: import("./runtimeExtensions").RuntimeExtension[];
    defaultsMode: import("@smithy/core/client").DefaultsMode | import("@smithy/types").Provider<import("@smithy/core/client").DefaultsMode>;
    profile?: string;
    defaultUserAgentProvider: (config?: import("@aws-sdk/core/client").PreviouslyResolved) => Promise<import("@smithy/types").UserAgent>;
    retryStrategy?: import("@smithy/types").RetryStrategy | import("@smithy/types").RetryStrategyV2;
    endpoint: (string | import("@smithy/types").Endpoint | import("@smithy/types").Provider<import("@smithy/types").Endpoint> | import("@smithy/types").EndpointV2 | import("@smithy/types").Provider<import("@smithy/types").EndpointV2> | undefined) & ((string | import("@smithy/types").Endpoint | import("@smithy/types").Provider<import("@smithy/types").Endpoint> | import("@smithy/types").EndpointV2 | import("@smithy/types").Provider<import("@smithy/types").EndpointV2>) & (string | import("@smithy/types").Provider<string> | import("@smithy/types").Endpoint | import("@smithy/types").Provider<import("@smithy/types").Endpoint> | import("@smithy/types").EndpointV2 | import("@smithy/types").Provider<import("@smithy/types").EndpointV2> | undefined));
    endpointProvider: (endpointParams: import("./endpoint/EndpointParameters").EndpointParameters, context?: {
        logger?: import("@smithy/types").Logger;
    }) => import("@smithy/types").EndpointV2;
    tls?: boolean;
    useDualstackEndpoint?: boolean | import("@smithy/types").Provider<boolean | undefined>;
    useFipsEndpoint?: boolean | import("@smithy/types").Provider<boolean | undefined>;
    ignoreConfiguredEndpointUrls?: boolean;
    serviceConfiguredEndpoint?: never;
    customUserAgent?: string | import("@smithy/types").UserAgent;
    userAgentAppId?: string | undefined | import("@smithy/types").Provider<string | undefined>;
    authSchemePreference?: string[] | import("@smithy/types").Provider<string[]>;
    httpAuthSchemes: import("@smithy/types").HttpAuthScheme[] | {
        schemeId: string;
        identityProvider: (ipc: import("@smithy/types").IdentityProviderConfig) => import("@smithy/types").IdentityProvider<import("@smithy/types").Identity> | (() => Promise<{}>);
        signer: import("@smithy/core").NoAuthSigner;
    }[];
    httpAuthSchemeProvider: import("./auth/httpAuthSchemeProvider").PagetrayHttpAuthSchemeProvider;
};
