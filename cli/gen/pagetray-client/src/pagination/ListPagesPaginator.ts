// smithy-typescript generated code
import { createPaginator } from "@smithy/core";
import type { Paginator } from "@smithy/types";

import { ListPagesCommand, ListPagesCommandInput, ListPagesCommandOutput } from "../commands/ListPagesCommand";
import { PagetrayClient } from "../PagetrayClient";
import type { PagetrayPaginationConfiguration } from "./Interfaces";

/**
 * @public
 */
export const paginateListPages: (
  config: PagetrayPaginationConfiguration,
  input: ListPagesCommandInput,
  ...rest: any[]
) => Paginator<ListPagesCommandOutput> = createPaginator<
  PagetrayPaginationConfiguration,
  ListPagesCommandInput,
  ListPagesCommandOutput
>(PagetrayClient, ListPagesCommand, "nextToken", "nextToken", "maxResults");
