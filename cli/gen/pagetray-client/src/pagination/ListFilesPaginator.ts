// smithy-typescript generated code
import { createPaginator } from "@smithy/core";
import type { Paginator } from "@smithy/types";

import { ListFilesCommand, ListFilesCommandInput, ListFilesCommandOutput } from "../commands/ListFilesCommand";
import { PagetrayClient } from "../PagetrayClient";
import type { PagetrayPaginationConfiguration } from "./Interfaces";

/**
 * @public
 */
export const paginateListFiles: (
  config: PagetrayPaginationConfiguration,
  input: ListFilesCommandInput,
  ...rest: any[]
) => Paginator<ListFilesCommandOutput> = createPaginator<
  PagetrayPaginationConfiguration,
  ListFilesCommandInput,
  ListFilesCommandOutput
>(PagetrayClient, ListFilesCommand, "nextToken", "nextToken", "maxResults");
