// smithy-typescript generated code
import { createAggregatedClient } from "@smithy/core/client";
import type {
  HttpHandlerOptions as __HttpHandlerOptions,
  MetricsRecorder as __MetricsRecorder,
  PaginationConfiguration,
  Paginator,
} from "@smithy/types";

import {
  type AddReviewMarksCommandInput,
  type AddReviewMarksCommandOutput,
  AddReviewMarksCommand,
} from "./commands/AddReviewMarksCommand";
import {
  type CreateFileCommandInput,
  type CreateFileCommandOutput,
  CreateFileCommand,
} from "./commands/CreateFileCommand";
import {
  type CreatePageCommandInput,
  type CreatePageCommandOutput,
  CreatePageCommand,
} from "./commands/CreatePageCommand";
import {
  type DeleteFilesCommandInput,
  type DeleteFilesCommandOutput,
  DeleteFilesCommand,
} from "./commands/DeleteFilesCommand";
import {
  type DeletePagesCommandInput,
  type DeletePagesCommandOutput,
  DeletePagesCommand,
} from "./commands/DeletePagesCommand";
import { type GetHealthCommandInput, type GetHealthCommandOutput, GetHealthCommand } from "./commands/GetHealthCommand";
import { type ListFilesCommandInput, type ListFilesCommandOutput, ListFilesCommand } from "./commands/ListFilesCommand";
import {
  type ListMessagesCommandInput,
  type ListMessagesCommandOutput,
  ListMessagesCommand,
} from "./commands/ListMessagesCommand";
import { type ListPagesCommandInput, type ListPagesCommandOutput, ListPagesCommand } from "./commands/ListPagesCommand";
import {
  type PutMessageCommandInput,
  type PutMessageCommandOutput,
  PutMessageCommand,
} from "./commands/PutMessageCommand";
import {
  type SetReplyStateCommandInput,
  type SetReplyStateCommandOutput,
  SetReplyStateCommand,
} from "./commands/SetReplyStateCommand";
import { PagetrayClient } from "./PagetrayClient";
import { paginateListFiles } from "./pagination/ListFilesPaginator";
import { paginateListMessages } from "./pagination/ListMessagesPaginator";
import { paginateListPages } from "./pagination/ListPagesPaginator";

const commands = {
  AddReviewMarksCommand,
  CreateFileCommand,
  CreatePageCommand,
  DeleteFilesCommand,
  DeletePagesCommand,
  GetHealthCommand,
  ListFilesCommand,
  ListMessagesCommand,
  ListPagesCommand,
  PutMessageCommand,
  SetReplyStateCommand,
};
const paginators = {
  paginateListFiles,
  paginateListMessages,
  paginateListPages,
};

/**
 * @public
 */
export interface PagetrayRequestOptions extends __HttpHandlerOptions {
  metricsRecorder?: __MetricsRecorder<unknown>;
}

export interface Pagetray {
  /**
   * @see {@link AddReviewMarksCommand}
   */
  addReviewMarks(
    args: AddReviewMarksCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<AddReviewMarksCommandOutput>;
  addReviewMarks(
    args: AddReviewMarksCommandInput,
    cb: (err: any, data?: AddReviewMarksCommandOutput) => void
  ): void;
  addReviewMarks(
    args: AddReviewMarksCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: AddReviewMarksCommandOutput) => void
  ): void;

  /**
   * @see {@link CreateFileCommand}
   */
  createFile(
    args: CreateFileCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<CreateFileCommandOutput>;
  createFile(
    args: CreateFileCommandInput,
    cb: (err: any, data?: CreateFileCommandOutput) => void
  ): void;
  createFile(
    args: CreateFileCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: CreateFileCommandOutput) => void
  ): void;

  /**
   * @see {@link CreatePageCommand}
   */
  createPage(
    args: CreatePageCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<CreatePageCommandOutput>;
  createPage(
    args: CreatePageCommandInput,
    cb: (err: any, data?: CreatePageCommandOutput) => void
  ): void;
  createPage(
    args: CreatePageCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: CreatePageCommandOutput) => void
  ): void;

  /**
   * @see {@link DeleteFilesCommand}
   */
  deleteFiles(
    args: DeleteFilesCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<DeleteFilesCommandOutput>;
  deleteFiles(
    args: DeleteFilesCommandInput,
    cb: (err: any, data?: DeleteFilesCommandOutput) => void
  ): void;
  deleteFiles(
    args: DeleteFilesCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: DeleteFilesCommandOutput) => void
  ): void;

  /**
   * @see {@link DeletePagesCommand}
   */
  deletePages(
    args: DeletePagesCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<DeletePagesCommandOutput>;
  deletePages(
    args: DeletePagesCommandInput,
    cb: (err: any, data?: DeletePagesCommandOutput) => void
  ): void;
  deletePages(
    args: DeletePagesCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: DeletePagesCommandOutput) => void
  ): void;

  /**
   * @see {@link GetHealthCommand}
   */
  getHealth(): Promise<GetHealthCommandOutput>;
  getHealth(
    args: GetHealthCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<GetHealthCommandOutput>;
  getHealth(
    args: GetHealthCommandInput,
    cb: (err: any, data?: GetHealthCommandOutput) => void
  ): void;
  getHealth(
    args: GetHealthCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: GetHealthCommandOutput) => void
  ): void;

  /**
   * @see {@link ListFilesCommand}
   */
  listFiles(): Promise<ListFilesCommandOutput>;
  listFiles(
    args: ListFilesCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<ListFilesCommandOutput>;
  listFiles(
    args: ListFilesCommandInput,
    cb: (err: any, data?: ListFilesCommandOutput) => void
  ): void;
  listFiles(
    args: ListFilesCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: ListFilesCommandOutput) => void
  ): void;

  /**
   * @see {@link ListMessagesCommand}
   */
  listMessages(): Promise<ListMessagesCommandOutput>;
  listMessages(
    args: ListMessagesCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<ListMessagesCommandOutput>;
  listMessages(
    args: ListMessagesCommandInput,
    cb: (err: any, data?: ListMessagesCommandOutput) => void
  ): void;
  listMessages(
    args: ListMessagesCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: ListMessagesCommandOutput) => void
  ): void;

  /**
   * @see {@link ListPagesCommand}
   */
  listPages(): Promise<ListPagesCommandOutput>;
  listPages(
    args: ListPagesCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<ListPagesCommandOutput>;
  listPages(
    args: ListPagesCommandInput,
    cb: (err: any, data?: ListPagesCommandOutput) => void
  ): void;
  listPages(
    args: ListPagesCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: ListPagesCommandOutput) => void
  ): void;

  /**
   * @see {@link PutMessageCommand}
   */
  putMessage(
    args: PutMessageCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<PutMessageCommandOutput>;
  putMessage(
    args: PutMessageCommandInput,
    cb: (err: any, data?: PutMessageCommandOutput) => void
  ): void;
  putMessage(
    args: PutMessageCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: PutMessageCommandOutput) => void
  ): void;

  /**
   * @see {@link SetReplyStateCommand}
   */
  setReplyState(
    args: SetReplyStateCommandInput,
    options?: PagetrayRequestOptions
  ): Promise<SetReplyStateCommandOutput>;
  setReplyState(
    args: SetReplyStateCommandInput,
    cb: (err: any, data?: SetReplyStateCommandOutput) => void
  ): void;
  setReplyState(
    args: SetReplyStateCommandInput,
    options: PagetrayRequestOptions,
    cb: (err: any, data?: SetReplyStateCommandOutput) => void
  ): void;

  /**
   * @see {@link ListFilesCommand}
   * @param args - command input.
   * @param paginationConfig - optional pagination config.
   * @returns AsyncIterable of {@link ListFilesCommandOutput}.
   */
  paginateListFiles(
    args?: ListFilesCommandInput,
    paginationConfig?: Omit<PaginationConfiguration, "client">
  ): Paginator<ListFilesCommandOutput>;

  /**
   * @see {@link ListMessagesCommand}
   * @param args - command input.
   * @param paginationConfig - optional pagination config.
   * @returns AsyncIterable of {@link ListMessagesCommandOutput}.
   */
  paginateListMessages(
    args?: ListMessagesCommandInput,
    paginationConfig?: Omit<PaginationConfiguration, "client">
  ): Paginator<ListMessagesCommandOutput>;

  /**
   * @see {@link ListPagesCommand}
   * @param args - command input.
   * @param paginationConfig - optional pagination config.
   * @returns AsyncIterable of {@link ListPagesCommandOutput}.
   */
  paginateListPages(
    args?: ListPagesCommandInput,
    paginationConfig?: Omit<PaginationConfiguration, "client">
  ): Paginator<ListPagesCommandOutput>;
}

/**
 * @public
 */
export class Pagetray extends PagetrayClient implements Pagetray {}
createAggregatedClient(commands, Pagetray, { paginators });
