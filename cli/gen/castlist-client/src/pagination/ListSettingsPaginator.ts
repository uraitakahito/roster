// smithy-typescript generated code
import { createPaginator } from "@smithy/core";
import type { Paginator } from "@smithy/types";

import { CastlistClient } from "../CastlistClient";
import {
  ListSettingsCommand,
  ListSettingsCommandInput,
  ListSettingsCommandOutput,
} from "../commands/ListSettingsCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";

/**
 * @public
 */
export const paginateListSettings: (
  config: CastlistPaginationConfiguration,
  input: ListSettingsCommandInput,
  ...rest: any[]
) => Paginator<ListSettingsCommandOutput> = createPaginator<
  CastlistPaginationConfiguration,
  ListSettingsCommandInput,
  ListSettingsCommandOutput
>(CastlistClient, ListSettingsCommand, "nextToken", "nextToken", "maxResults");
