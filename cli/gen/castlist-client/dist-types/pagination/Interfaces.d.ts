import type { PaginationConfiguration } from "@smithy/types";
import { CastlistClient } from "../CastlistClient";
/**
 * @public
 */
export interface CastlistPaginationConfiguration extends PaginationConfiguration {
    client: CastlistClient;
}
