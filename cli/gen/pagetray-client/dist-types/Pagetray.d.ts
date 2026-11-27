import type { HttpHandlerOptions as __HttpHandlerOptions, MetricsRecorder as __MetricsRecorder, PaginationConfiguration, Paginator } from "@smithy/types";
import { type AddReviewMarksCommandInput, type AddReviewMarksCommandOutput } from "./commands/AddReviewMarksCommand";
import { type CreateFileCommandInput, type CreateFileCommandOutput } from "./commands/CreateFileCommand";
import { type CreatePageCommandInput, type CreatePageCommandOutput } from "./commands/CreatePageCommand";
import { type DeleteFilesCommandInput, type DeleteFilesCommandOutput } from "./commands/DeleteFilesCommand";
import { type DeletePagesCommandInput, type DeletePagesCommandOutput } from "./commands/DeletePagesCommand";
import { type GetFileRulesCommandInput, type GetFileRulesCommandOutput } from "./commands/GetFileRulesCommand";
import { type GetHealthCommandInput, type GetHealthCommandOutput } from "./commands/GetHealthCommand";
import { type GetMessageFacetsCommandInput, type GetMessageFacetsCommandOutput } from "./commands/GetMessageFacetsCommand";
import { type GetPageFacetsCommandInput, type GetPageFacetsCommandOutput } from "./commands/GetPageFacetsCommand";
import { type ListFilesCommandInput, type ListFilesCommandOutput } from "./commands/ListFilesCommand";
import { type ListMessagesCommandInput, type ListMessagesCommandOutput } from "./commands/ListMessagesCommand";
import { type ListPagesCommandInput, type ListPagesCommandOutput } from "./commands/ListPagesCommand";
import { type ListReviewsCommandInput, type ListReviewsCommandOutput } from "./commands/ListReviewsCommand";
import { type PutMessageCommandInput, type PutMessageCommandOutput } from "./commands/PutMessageCommand";
import { type SetReplyStateCommandInput, type SetReplyStateCommandOutput } from "./commands/SetReplyStateCommand";
import { PagetrayClient } from "./PagetrayClient";
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
    addReviewMarks(args: AddReviewMarksCommandInput, options?: PagetrayRequestOptions): Promise<AddReviewMarksCommandOutput>;
    addReviewMarks(args: AddReviewMarksCommandInput, cb: (err: any, data?: AddReviewMarksCommandOutput) => void): void;
    addReviewMarks(args: AddReviewMarksCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: AddReviewMarksCommandOutput) => void): void;
    /**
     * @see {@link CreateFileCommand}
     */
    createFile(args: CreateFileCommandInput, options?: PagetrayRequestOptions): Promise<CreateFileCommandOutput>;
    createFile(args: CreateFileCommandInput, cb: (err: any, data?: CreateFileCommandOutput) => void): void;
    createFile(args: CreateFileCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: CreateFileCommandOutput) => void): void;
    /**
     * @see {@link CreatePageCommand}
     */
    createPage(args: CreatePageCommandInput, options?: PagetrayRequestOptions): Promise<CreatePageCommandOutput>;
    createPage(args: CreatePageCommandInput, cb: (err: any, data?: CreatePageCommandOutput) => void): void;
    createPage(args: CreatePageCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: CreatePageCommandOutput) => void): void;
    /**
     * @see {@link DeleteFilesCommand}
     */
    deleteFiles(args: DeleteFilesCommandInput, options?: PagetrayRequestOptions): Promise<DeleteFilesCommandOutput>;
    deleteFiles(args: DeleteFilesCommandInput, cb: (err: any, data?: DeleteFilesCommandOutput) => void): void;
    deleteFiles(args: DeleteFilesCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: DeleteFilesCommandOutput) => void): void;
    /**
     * @see {@link DeletePagesCommand}
     */
    deletePages(args: DeletePagesCommandInput, options?: PagetrayRequestOptions): Promise<DeletePagesCommandOutput>;
    deletePages(args: DeletePagesCommandInput, cb: (err: any, data?: DeletePagesCommandOutput) => void): void;
    deletePages(args: DeletePagesCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: DeletePagesCommandOutput) => void): void;
    /**
     * @see {@link GetFileRulesCommand}
     */
    getFileRules(): Promise<GetFileRulesCommandOutput>;
    getFileRules(args: GetFileRulesCommandInput, options?: PagetrayRequestOptions): Promise<GetFileRulesCommandOutput>;
    getFileRules(args: GetFileRulesCommandInput, cb: (err: any, data?: GetFileRulesCommandOutput) => void): void;
    getFileRules(args: GetFileRulesCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: GetFileRulesCommandOutput) => void): void;
    /**
     * @see {@link GetHealthCommand}
     */
    getHealth(): Promise<GetHealthCommandOutput>;
    getHealth(args: GetHealthCommandInput, options?: PagetrayRequestOptions): Promise<GetHealthCommandOutput>;
    getHealth(args: GetHealthCommandInput, cb: (err: any, data?: GetHealthCommandOutput) => void): void;
    getHealth(args: GetHealthCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: GetHealthCommandOutput) => void): void;
    /**
     * @see {@link GetMessageFacetsCommand}
     */
    getMessageFacets(): Promise<GetMessageFacetsCommandOutput>;
    getMessageFacets(args: GetMessageFacetsCommandInput, options?: PagetrayRequestOptions): Promise<GetMessageFacetsCommandOutput>;
    getMessageFacets(args: GetMessageFacetsCommandInput, cb: (err: any, data?: GetMessageFacetsCommandOutput) => void): void;
    getMessageFacets(args: GetMessageFacetsCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: GetMessageFacetsCommandOutput) => void): void;
    /**
     * @see {@link GetPageFacetsCommand}
     */
    getPageFacets(): Promise<GetPageFacetsCommandOutput>;
    getPageFacets(args: GetPageFacetsCommandInput, options?: PagetrayRequestOptions): Promise<GetPageFacetsCommandOutput>;
    getPageFacets(args: GetPageFacetsCommandInput, cb: (err: any, data?: GetPageFacetsCommandOutput) => void): void;
    getPageFacets(args: GetPageFacetsCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: GetPageFacetsCommandOutput) => void): void;
    /**
     * @see {@link ListFilesCommand}
     */
    listFiles(): Promise<ListFilesCommandOutput>;
    listFiles(args: ListFilesCommandInput, options?: PagetrayRequestOptions): Promise<ListFilesCommandOutput>;
    listFiles(args: ListFilesCommandInput, cb: (err: any, data?: ListFilesCommandOutput) => void): void;
    listFiles(args: ListFilesCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: ListFilesCommandOutput) => void): void;
    /**
     * @see {@link ListMessagesCommand}
     */
    listMessages(): Promise<ListMessagesCommandOutput>;
    listMessages(args: ListMessagesCommandInput, options?: PagetrayRequestOptions): Promise<ListMessagesCommandOutput>;
    listMessages(args: ListMessagesCommandInput, cb: (err: any, data?: ListMessagesCommandOutput) => void): void;
    listMessages(args: ListMessagesCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: ListMessagesCommandOutput) => void): void;
    /**
     * @see {@link ListPagesCommand}
     */
    listPages(): Promise<ListPagesCommandOutput>;
    listPages(args: ListPagesCommandInput, options?: PagetrayRequestOptions): Promise<ListPagesCommandOutput>;
    listPages(args: ListPagesCommandInput, cb: (err: any, data?: ListPagesCommandOutput) => void): void;
    listPages(args: ListPagesCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: ListPagesCommandOutput) => void): void;
    /**
     * @see {@link ListReviewsCommand}
     */
    listReviews(args: ListReviewsCommandInput, options?: PagetrayRequestOptions): Promise<ListReviewsCommandOutput>;
    listReviews(args: ListReviewsCommandInput, cb: (err: any, data?: ListReviewsCommandOutput) => void): void;
    listReviews(args: ListReviewsCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: ListReviewsCommandOutput) => void): void;
    /**
     * @see {@link PutMessageCommand}
     */
    putMessage(args: PutMessageCommandInput, options?: PagetrayRequestOptions): Promise<PutMessageCommandOutput>;
    putMessage(args: PutMessageCommandInput, cb: (err: any, data?: PutMessageCommandOutput) => void): void;
    putMessage(args: PutMessageCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: PutMessageCommandOutput) => void): void;
    /**
     * @see {@link SetReplyStateCommand}
     */
    setReplyState(args: SetReplyStateCommandInput, options?: PagetrayRequestOptions): Promise<SetReplyStateCommandOutput>;
    setReplyState(args: SetReplyStateCommandInput, cb: (err: any, data?: SetReplyStateCommandOutput) => void): void;
    setReplyState(args: SetReplyStateCommandInput, options: PagetrayRequestOptions, cb: (err: any, data?: SetReplyStateCommandOutput) => void): void;
    /**
     * @see {@link ListFilesCommand}
     * @param args - command input.
     * @param paginationConfig - optional pagination config.
     * @returns AsyncIterable of {@link ListFilesCommandOutput}.
     */
    paginateListFiles(args?: ListFilesCommandInput, paginationConfig?: Omit<PaginationConfiguration, "client">): Paginator<ListFilesCommandOutput>;
    /**
     * @see {@link ListMessagesCommand}
     * @param args - command input.
     * @param paginationConfig - optional pagination config.
     * @returns AsyncIterable of {@link ListMessagesCommandOutput}.
     */
    paginateListMessages(args?: ListMessagesCommandInput, paginationConfig?: Omit<PaginationConfiguration, "client">): Paginator<ListMessagesCommandOutput>;
    /**
     * @see {@link ListPagesCommand}
     * @param args - command input.
     * @param paginationConfig - optional pagination config.
     * @returns AsyncIterable of {@link ListPagesCommandOutput}.
     */
    paginateListPages(args?: ListPagesCommandInput, paginationConfig?: Omit<PaginationConfiguration, "client">): Paginator<ListPagesCommandOutput>;
}
/**
 * @public
 */
export declare class Pagetray extends PagetrayClient implements Pagetray {
}
