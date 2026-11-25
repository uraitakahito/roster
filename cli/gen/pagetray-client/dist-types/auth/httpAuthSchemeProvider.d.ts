import type { HandlerExecutionContext, HttpAuthScheme, HttpAuthSchemeParameters, HttpAuthSchemeParametersProvider, HttpAuthSchemeProvider, Provider } from "@smithy/types";
import type { PagetrayClientResolvedConfig } from "../PagetrayClient";
/**
 * @internal
 */
export interface PagetrayHttpAuthSchemeParameters extends HttpAuthSchemeParameters {
}
/**
 * @internal
 */
export interface PagetrayHttpAuthSchemeParametersProvider extends HttpAuthSchemeParametersProvider<PagetrayClientResolvedConfig, HandlerExecutionContext, PagetrayHttpAuthSchemeParameters, object> {
}
/**
 * @internal
 */
export declare const defaultPagetrayHttpAuthSchemeParametersProvider: (config: PagetrayClientResolvedConfig, context: HandlerExecutionContext, input: object) => Promise<PagetrayHttpAuthSchemeParameters>;
/**
 * @internal
 */
export interface PagetrayHttpAuthSchemeProvider extends HttpAuthSchemeProvider<PagetrayHttpAuthSchemeParameters> {
}
/**
 * @internal
 */
export declare const defaultPagetrayHttpAuthSchemeProvider: PagetrayHttpAuthSchemeProvider;
/**
 * @public
 */
export interface HttpAuthSchemeInputConfig {
    /**
     * A comma-separated list of case-sensitive auth scheme names.
     * An auth scheme name is a fully qualified auth scheme ID with the namespace prefix trimmed.
     * For example, the auth scheme with ID aws.auth#sigv4 is named sigv4.
     * @public
     */
    authSchemePreference?: string[] | Provider<string[]>;
    /**
     * Configuration of HttpAuthSchemes for a client which provides default identity providers and signers per auth scheme.
     * @internal
     */
    httpAuthSchemes?: HttpAuthScheme[];
    /**
     * Configuration of an HttpAuthSchemeProvider for a client which resolves which HttpAuthScheme to use.
     * @internal
     */
    httpAuthSchemeProvider?: PagetrayHttpAuthSchemeProvider;
}
/**
 * @internal
 */
export interface HttpAuthSchemeResolvedConfig {
    /**
     * A comma-separated list of case-sensitive auth scheme names.
     * An auth scheme name is a fully qualified auth scheme ID with the namespace prefix trimmed.
     * For example, the auth scheme with ID aws.auth#sigv4 is named sigv4.
     * @public
     */
    readonly authSchemePreference: Provider<string[]>;
    /**
     * Configuration of HttpAuthSchemes for a client which provides default identity providers and signers per auth scheme.
     * @internal
     */
    readonly httpAuthSchemes: HttpAuthScheme[];
    /**
     * Configuration of an HttpAuthSchemeProvider for a client which resolves which HttpAuthScheme to use.
     * @internal
     */
    readonly httpAuthSchemeProvider: PagetrayHttpAuthSchemeProvider;
}
/**
 * @internal
 */
export declare const resolveHttpAuthSchemeConfig: <T>(config: T & HttpAuthSchemeInputConfig) => T & HttpAuthSchemeResolvedConfig;
