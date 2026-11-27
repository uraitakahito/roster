import type { Paginator } from "@smithy/types";
import { ListUsageCommandInput, ListUsageCommandOutput } from "../commands/ListUsageCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListUsage: (config: CastlistPaginationConfiguration, input: ListUsageCommandInput, ...rest: any[]) => Paginator<ListUsageCommandOutput>;
