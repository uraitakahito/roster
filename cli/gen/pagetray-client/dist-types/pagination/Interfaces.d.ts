import type { PaginationConfiguration } from "@smithy/types";
import { PagetrayClient } from "../PagetrayClient";
/**
 * @public
 */
export interface PagetrayPaginationConfiguration extends PaginationConfiguration {
    client: PagetrayClient;
}
