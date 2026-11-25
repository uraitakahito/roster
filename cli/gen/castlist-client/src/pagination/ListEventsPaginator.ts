// smithy-typescript generated code
import { createPaginator } from "@smithy/core";
import type { Paginator } from "@smithy/types";

import { CastlistClient } from "../CastlistClient";
import { ListEventsCommand, ListEventsCommandInput, ListEventsCommandOutput } from "../commands/ListEventsCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";

/**
 * @public
 */
export const paginateListEvents: (
  config: CastlistPaginationConfiguration,
  input: ListEventsCommandInput,
  ...rest: any[]
) => Paginator<ListEventsCommandOutput> = createPaginator<
  CastlistPaginationConfiguration,
  ListEventsCommandInput,
  ListEventsCommandOutput
>(CastlistClient, ListEventsCommand, "nextToken", "nextToken", "maxResults");
