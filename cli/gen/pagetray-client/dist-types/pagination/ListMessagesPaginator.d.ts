import type { Paginator } from "@smithy/types";
import { ListMessagesCommandInput, ListMessagesCommandOutput } from "../commands/ListMessagesCommand";
import type { PagetrayPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListMessages: (config: PagetrayPaginationConfiguration, input: ListMessagesCommandInput, ...rest: any[]) => Paginator<ListMessagesCommandOutput>;
