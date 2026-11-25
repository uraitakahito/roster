import type { Paginator } from "@smithy/types";
import { ListPagesCommandInput, ListPagesCommandOutput } from "../commands/ListPagesCommand";
import type { PagetrayPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListPages: (config: PagetrayPaginationConfiguration, input: ListPagesCommandInput, ...rest: any[]) => Paginator<ListPagesCommandOutput>;
