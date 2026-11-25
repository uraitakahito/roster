// smithy-typescript generated code
import { createPaginator } from "@smithy/core";
import type { Paginator } from "@smithy/types";

import { CastlistClient } from "../CastlistClient";
import { ListActorsCommand, ListActorsCommandInput, ListActorsCommandOutput } from "../commands/ListActorsCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";

/**
 * @public
 */
export const paginateListActors: (
  config: CastlistPaginationConfiguration,
  input: ListActorsCommandInput,
  ...rest: any[]
) => Paginator<ListActorsCommandOutput> = createPaginator<
  CastlistPaginationConfiguration,
  ListActorsCommandInput,
  ListActorsCommandOutput
>(CastlistClient, ListActorsCommand, "nextToken", "nextToken", "maxResults");
