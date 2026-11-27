// smithy-typescript generated code
import { createPaginator } from "@smithy/core";
import type { Paginator } from "@smithy/types";

import { CastlistClient } from "../CastlistClient";
import { ListUsageCommand, ListUsageCommandInput, ListUsageCommandOutput } from "../commands/ListUsageCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";

/**
 * @public
 */
export const paginateListUsage: (
  config: CastlistPaginationConfiguration,
  input: ListUsageCommandInput,
  ...rest: any[]
) => Paginator<ListUsageCommandOutput> = createPaginator<
  CastlistPaginationConfiguration,
  ListUsageCommandInput,
  ListUsageCommandOutput
>(CastlistClient, ListUsageCommand, "nextToken", "nextToken", "maxResults");
