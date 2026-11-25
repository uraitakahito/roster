import type { Paginator } from "@smithy/types";
import { ListFilesCommandInput, ListFilesCommandOutput } from "../commands/ListFilesCommand";
import type { PagetrayPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListFiles: (config: PagetrayPaginationConfiguration, input: ListFilesCommandInput, ...rest: any[]) => Paginator<ListFilesCommandOutput>;
