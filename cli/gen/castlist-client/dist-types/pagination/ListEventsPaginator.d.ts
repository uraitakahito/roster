import type { Paginator } from "@smithy/types";
import { ListEventsCommandInput, ListEventsCommandOutput } from "../commands/ListEventsCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListEvents: (config: CastlistPaginationConfiguration, input: ListEventsCommandInput, ...rest: any[]) => Paginator<ListEventsCommandOutput>;
