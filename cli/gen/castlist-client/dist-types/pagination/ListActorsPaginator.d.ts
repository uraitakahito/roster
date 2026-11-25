import type { Paginator } from "@smithy/types";
import { ListActorsCommandInput, ListActorsCommandOutput } from "../commands/ListActorsCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListActors: (config: CastlistPaginationConfiguration, input: ListActorsCommandInput, ...rest: any[]) => Paginator<ListActorsCommandOutput>;
