import type { Paginator } from "@smithy/types";
import { ListSettingsCommandInput, ListSettingsCommandOutput } from "../commands/ListSettingsCommand";
import type { CastlistPaginationConfiguration } from "./Interfaces";
/**
 * @public
 */
export declare const paginateListSettings: (config: CastlistPaginationConfiguration, input: ListSettingsCommandInput, ...rest: any[]) => Paginator<ListSettingsCommandOutput>;
