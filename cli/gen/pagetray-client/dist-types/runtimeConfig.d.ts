import { NodeHttpHandler as RequestHandler } from "@smithy/node-http-handler";
import type { PagetrayClientConfig } from "./PagetrayClient";
/**
 * @internal
 */
export declare const getRuntimeConfig: (config: PagetrayClientConfig) => {
    runtime: string;
    defaultsMode: import("@smithy/types").Provider<import("@smithy/core/client").ResolvedDefaultsMode>;
    bodyLengthChecker: import("@smithy/types").BodyLengthCalculator;
    defaultUserAgentProvider: (config?: import("@aws-sdk/core/client").PreviouslyResolved) => Promise<import("@smithy/types").UserAgent>;
    maxAttempts: number | import("@smithy/types").Provider<number>;
    requestHandler: RequestHandler | import("@smithy/core/protocols").HttpHandler<any>;
    retryMode: string | import("@smithy/types").Provider<string>;
    streamCollector: (stream: import("node:stream").Readable | import("node:stream/web").ReadableStream | ReadableStream | Blob) => Promise<Uint8Array>;
    userAgentAppId: string | import("@smithy/types").Provider<string | undefined>;
    cacheMiddleware?: boolean | undefined;
    protocol: import("@smithy/types").ClientProtocol<any, any> | import("@smithy/types").ClientProtocolCtor<any, any> | typeof import("@aws-sdk/core/protocols").AwsRestJsonProtocol;
    protocolSettings: {
        defaultNamespace?: string;
        [setting: string]: unknown;
    };
    apiVersion: string;
    sha256: import("@smithy/types").HashConstructor;
    urlParser: import("@smithy/types").UrlParser;
    base64Decoder: import("@smithy/types").Decoder;
    base64Encoder: (_input: Uint8Array | string) => string;
    utf8Decoder: import("@smithy/types").Decoder;
    utf8Encoder: (input: Uint8Array | string) => string;
    disableHostPrefix: boolean;
    logger: import("@smithy/types").Logger;
    extensions: import("./runtimeExtensions").RuntimeExtension[];
    profile?: string;
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
    authSchemePreference?: string[] | import("@smithy/types").Provider<string[]>;
    httpAuthSchemes: import("@smithy/types").HttpAuthScheme[] | {
        schemeId: string;
        identityProvider: (ipc: import("@smithy/types").IdentityProviderConfig) => import("@smithy/types").IdentityProvider<import("@smithy/types").Identity> | (() => Promise<{}>);
        signer: import("@smithy/core").NoAuthSigner;
    }[];
    httpAuthSchemeProvider: import("./auth/httpAuthSchemeProvider").PagetrayHttpAuthSchemeProvider;
};
