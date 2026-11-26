// smithy-typescript generated code
import { createPaginator } from "@smithy/core";
import type { Paginator } from "@smithy/types";

import {
  ListMessagesCommand,
  ListMessagesCommandInput,
  ListMessagesCommandOutput,
} from "../commands/ListMessagesCommand";
import { PagetrayClient } from "../PagetrayClient";
import type { PagetrayPaginationConfiguration } from "./Interfaces";

/**
 * @public
 */
export const paginateListMessages: (
  config: PagetrayPaginationConfiguration,
  input: ListMessagesCommandInput,
  ...rest: any[]
) => Paginator<ListMessagesCommandOutput> = createPaginator<
  PagetrayPaginationConfiguration,
  ListMessagesCommandInput,
  ListMessagesCommandOutput
>(PagetrayClient, ListMessagesCommand, "nextToken", "nextToken", "maxResults");
