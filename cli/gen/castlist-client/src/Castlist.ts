// smithy-typescript generated code
import { createAggregatedClient } from "@smithy/core/client";
import type {
  HttpHandlerOptions as __HttpHandlerOptions,
  MetricsRecorder as __MetricsRecorder,
  PaginationConfiguration,
  Paginator,
} from "@smithy/types";

import { CastlistClient } from "./CastlistClient";
import { type GetActorCommandInput, type GetActorCommandOutput, GetActorCommand } from "./commands/GetActorCommand";
import {
  type GetActorSettingAtCommandInput,
  type GetActorSettingAtCommandOutput,
  GetActorSettingAtCommand,
} from "./commands/GetActorSettingAtCommand";
import { type GetGraphCommandInput, type GetGraphCommandOutput, GetGraphCommand } from "./commands/GetGraphCommand";
import { type GetHealthCommandInput, type GetHealthCommandOutput, GetHealthCommand } from "./commands/GetHealthCommand";
import {
  type GetLineageCommandInput,
  type GetLineageCommandOutput,
  GetLineageCommand,
} from "./commands/GetLineageCommand";
import {
  type GetTimelineCommandInput,
  type GetTimelineCommandOutput,
  GetTimelineCommand,
} from "./commands/GetTimelineCommand";
import {
  type ListActorsCommandInput,
  type ListActorsCommandOutput,
  ListActorsCommand,
} from "./commands/ListActorsCommand";
import {
  type ListActorSettingsCommandInput,
  type ListActorSettingsCommandOutput,
  ListActorSettingsCommand,
} from "./commands/ListActorSettingsCommand";
import {
  type ListEventsCommandInput,
  type ListEventsCommandOutput,
  ListEventsCommand,
} from "./commands/ListEventsCommand";
import {
  type ListSettingsCommandInput,
  type ListSettingsCommandOutput,
  ListSettingsCommand,
} from "./commands/ListSettingsCommand";
import { type PutEventCommandInput, type PutEventCommandOutput, PutEventCommand } from "./commands/PutEventCommand";
import { type PutLinkCommandInput, type PutLinkCommandOutput, PutLinkCommand } from "./commands/PutLinkCommand";
import {
  type PutSettingCommandInput,
  type PutSettingCommandOutput,
  PutSettingCommand,
} from "./commands/PutSettingCommand";
import {
  type RegisterActorCommandInput,
  type RegisterActorCommandOutput,
  RegisterActorCommand,
} from "./commands/RegisterActorCommand";
import {
  type ResolveActorsCommandInput,
  type ResolveActorsCommandOutput,
  ResolveActorsCommand,
} from "./commands/ResolveActorsCommand";
import { paginateListActors } from "./pagination/ListActorsPaginator";
import { paginateListEvents } from "./pagination/ListEventsPaginator";
import { paginateListSettings } from "./pagination/ListSettingsPaginator";

const commands = {
  GetActorCommand,
  GetActorSettingAtCommand,
  GetGraphCommand,
  GetHealthCommand,
  GetLineageCommand,
  GetTimelineCommand,
  ListActorsCommand,
  ListActorSettingsCommand,
  ListEventsCommand,
  ListSettingsCommand,
  PutEventCommand,
  PutLinkCommand,
  PutSettingCommand,
  RegisterActorCommand,
  ResolveActorsCommand,
};
const paginators = {
  paginateListActors,
  paginateListEvents,
  paginateListSettings,
};

/**
 * @public
 */
export interface CastlistRequestOptions extends __HttpHandlerOptions {
  metricsRecorder?: __MetricsRecorder<unknown>;
}

export interface Castlist {
  /**
   * @see {@link GetActorCommand}
   */
  getActor(
    args: GetActorCommandInput,
    options?: CastlistRequestOptions
  ): Promise<GetActorCommandOutput>;
  getActor(
    args: GetActorCommandInput,
    cb: (err: any, data?: GetActorCommandOutput) => void
  ): void;
  getActor(
    args: GetActorCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: GetActorCommandOutput) => void
  ): void;

  /**
   * @see {@link GetActorSettingAtCommand}
   */
  getActorSettingAt(
    args: GetActorSettingAtCommandInput,
    options?: CastlistRequestOptions
  ): Promise<GetActorSettingAtCommandOutput>;
  getActorSettingAt(
    args: GetActorSettingAtCommandInput,
    cb: (err: any, data?: GetActorSettingAtCommandOutput) => void
  ): void;
  getActorSettingAt(
    args: GetActorSettingAtCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: GetActorSettingAtCommandOutput) => void
  ): void;

  /**
   * @see {@link GetGraphCommand}
   */
  getGraph(): Promise<GetGraphCommandOutput>;
  getGraph(
    args: GetGraphCommandInput,
    options?: CastlistRequestOptions
  ): Promise<GetGraphCommandOutput>;
  getGraph(
    args: GetGraphCommandInput,
    cb: (err: any, data?: GetGraphCommandOutput) => void
  ): void;
  getGraph(
    args: GetGraphCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: GetGraphCommandOutput) => void
  ): void;

  /**
   * @see {@link GetHealthCommand}
   */
  getHealth(): Promise<GetHealthCommandOutput>;
  getHealth(
    args: GetHealthCommandInput,
    options?: CastlistRequestOptions
  ): Promise<GetHealthCommandOutput>;
  getHealth(
    args: GetHealthCommandInput,
    cb: (err: any, data?: GetHealthCommandOutput) => void
  ): void;
  getHealth(
    args: GetHealthCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: GetHealthCommandOutput) => void
  ): void;

  /**
   * @see {@link GetLineageCommand}
   */
  getLineage(
    args: GetLineageCommandInput,
    options?: CastlistRequestOptions
  ): Promise<GetLineageCommandOutput>;
  getLineage(
    args: GetLineageCommandInput,
    cb: (err: any, data?: GetLineageCommandOutput) => void
  ): void;
  getLineage(
    args: GetLineageCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: GetLineageCommandOutput) => void
  ): void;

  /**
   * @see {@link GetTimelineCommand}
   */
  getTimeline(): Promise<GetTimelineCommandOutput>;
  getTimeline(
    args: GetTimelineCommandInput,
    options?: CastlistRequestOptions
  ): Promise<GetTimelineCommandOutput>;
  getTimeline(
    args: GetTimelineCommandInput,
    cb: (err: any, data?: GetTimelineCommandOutput) => void
  ): void;
  getTimeline(
    args: GetTimelineCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: GetTimelineCommandOutput) => void
  ): void;

  /**
   * @see {@link ListActorsCommand}
   */
  listActors(): Promise<ListActorsCommandOutput>;
  listActors(
    args: ListActorsCommandInput,
    options?: CastlistRequestOptions
  ): Promise<ListActorsCommandOutput>;
  listActors(
    args: ListActorsCommandInput,
    cb: (err: any, data?: ListActorsCommandOutput) => void
  ): void;
  listActors(
    args: ListActorsCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: ListActorsCommandOutput) => void
  ): void;

  /**
   * @see {@link ListActorSettingsCommand}
   */
  listActorSettings(
    args: ListActorSettingsCommandInput,
    options?: CastlistRequestOptions
  ): Promise<ListActorSettingsCommandOutput>;
  listActorSettings(
    args: ListActorSettingsCommandInput,
    cb: (err: any, data?: ListActorSettingsCommandOutput) => void
  ): void;
  listActorSettings(
    args: ListActorSettingsCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: ListActorSettingsCommandOutput) => void
  ): void;

  /**
   * @see {@link ListEventsCommand}
   */
  listEvents(): Promise<ListEventsCommandOutput>;
  listEvents(
    args: ListEventsCommandInput,
    options?: CastlistRequestOptions
  ): Promise<ListEventsCommandOutput>;
  listEvents(
    args: ListEventsCommandInput,
    cb: (err: any, data?: ListEventsCommandOutput) => void
  ): void;
  listEvents(
    args: ListEventsCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: ListEventsCommandOutput) => void
  ): void;

  /**
   * @see {@link ListSettingsCommand}
   */
  listSettings(): Promise<ListSettingsCommandOutput>;
  listSettings(
    args: ListSettingsCommandInput,
    options?: CastlistRequestOptions
  ): Promise<ListSettingsCommandOutput>;
  listSettings(
    args: ListSettingsCommandInput,
    cb: (err: any, data?: ListSettingsCommandOutput) => void
  ): void;
  listSettings(
    args: ListSettingsCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: ListSettingsCommandOutput) => void
  ): void;

  /**
   * @see {@link PutEventCommand}
   */
  putEvent(
    args: PutEventCommandInput,
    options?: CastlistRequestOptions
  ): Promise<PutEventCommandOutput>;
  putEvent(
    args: PutEventCommandInput,
    cb: (err: any, data?: PutEventCommandOutput) => void
  ): void;
  putEvent(
    args: PutEventCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: PutEventCommandOutput) => void
  ): void;

  /**
   * @see {@link PutLinkCommand}
   */
  putLink(
    args: PutLinkCommandInput,
    options?: CastlistRequestOptions
  ): Promise<PutLinkCommandOutput>;
  putLink(
    args: PutLinkCommandInput,
    cb: (err: any, data?: PutLinkCommandOutput) => void
  ): void;
  putLink(
    args: PutLinkCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: PutLinkCommandOutput) => void
  ): void;

  /**
   * @see {@link PutSettingCommand}
   */
  putSetting(
    args: PutSettingCommandInput,
    options?: CastlistRequestOptions
  ): Promise<PutSettingCommandOutput>;
  putSetting(
    args: PutSettingCommandInput,
    cb: (err: any, data?: PutSettingCommandOutput) => void
  ): void;
  putSetting(
    args: PutSettingCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: PutSettingCommandOutput) => void
  ): void;

  /**
   * @see {@link RegisterActorCommand}
   */
  registerActor(
    args: RegisterActorCommandInput,
    options?: CastlistRequestOptions
  ): Promise<RegisterActorCommandOutput>;
  registerActor(
    args: RegisterActorCommandInput,
    cb: (err: any, data?: RegisterActorCommandOutput) => void
  ): void;
  registerActor(
    args: RegisterActorCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: RegisterActorCommandOutput) => void
  ): void;

  /**
   * @see {@link ResolveActorsCommand}
   */
  resolveActors(
    args: ResolveActorsCommandInput,
    options?: CastlistRequestOptions
  ): Promise<ResolveActorsCommandOutput>;
  resolveActors(
    args: ResolveActorsCommandInput,
    cb: (err: any, data?: ResolveActorsCommandOutput) => void
  ): void;
  resolveActors(
    args: ResolveActorsCommandInput,
    options: CastlistRequestOptions,
    cb: (err: any, data?: ResolveActorsCommandOutput) => void
  ): void;

  /**
   * @see {@link ListActorsCommand}
   * @param args - command input.
   * @param paginationConfig - optional pagination config.
   * @returns AsyncIterable of {@link ListActorsCommandOutput}.
   */
  paginateListActors(
    args?: ListActorsCommandInput,
    paginationConfig?: Omit<PaginationConfiguration, "client">
  ): Paginator<ListActorsCommandOutput>;

  /**
   * @see {@link ListEventsCommand}
   * @param args - command input.
   * @param paginationConfig - optional pagination config.
   * @returns AsyncIterable of {@link ListEventsCommandOutput}.
   */
  paginateListEvents(
    args?: ListEventsCommandInput,
    paginationConfig?: Omit<PaginationConfiguration, "client">
  ): Paginator<ListEventsCommandOutput>;

  /**
   * @see {@link ListSettingsCommand}
   * @param args - command input.
   * @param paginationConfig - optional pagination config.
   * @returns AsyncIterable of {@link ListSettingsCommandOutput}.
   */
  paginateListSettings(
    args?: ListSettingsCommandInput,
    paginationConfig?: Omit<PaginationConfiguration, "client">
  ): Paginator<ListSettingsCommandOutput>;
}

/**
 * @public
 */
export class Castlist extends CastlistClient implements Castlist {}
createAggregatedClient(commands, Castlist, { paginators });
