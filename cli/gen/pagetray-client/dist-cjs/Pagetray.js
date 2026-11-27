"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pagetray = void 0;
// smithy-typescript generated code
const client_1 = require("@smithy/core/client");
const AddReviewMarksCommand_1 = require("./commands/AddReviewMarksCommand");
const CreateFileCommand_1 = require("./commands/CreateFileCommand");
const CreatePageCommand_1 = require("./commands/CreatePageCommand");
const DeleteFilesCommand_1 = require("./commands/DeleteFilesCommand");
const DeletePagesCommand_1 = require("./commands/DeletePagesCommand");
const GetHealthCommand_1 = require("./commands/GetHealthCommand");
const GetMessageFacetsCommand_1 = require("./commands/GetMessageFacetsCommand");
const ListFilesCommand_1 = require("./commands/ListFilesCommand");
const ListMessagesCommand_1 = require("./commands/ListMessagesCommand");
const ListPagesCommand_1 = require("./commands/ListPagesCommand");
const PutMessageCommand_1 = require("./commands/PutMessageCommand");
const SetReplyStateCommand_1 = require("./commands/SetReplyStateCommand");
const PagetrayClient_1 = require("./PagetrayClient");
const ListFilesPaginator_1 = require("./pagination/ListFilesPaginator");
const ListMessagesPaginator_1 = require("./pagination/ListMessagesPaginator");
const ListPagesPaginator_1 = require("./pagination/ListPagesPaginator");
const commands = {
    AddReviewMarksCommand: AddReviewMarksCommand_1.AddReviewMarksCommand,
    CreateFileCommand: CreateFileCommand_1.CreateFileCommand,
    CreatePageCommand: CreatePageCommand_1.CreatePageCommand,
    DeleteFilesCommand: DeleteFilesCommand_1.DeleteFilesCommand,
    DeletePagesCommand: DeletePagesCommand_1.DeletePagesCommand,
    GetHealthCommand: GetHealthCommand_1.GetHealthCommand,
    GetMessageFacetsCommand: GetMessageFacetsCommand_1.GetMessageFacetsCommand,
    ListFilesCommand: ListFilesCommand_1.ListFilesCommand,
    ListMessagesCommand: ListMessagesCommand_1.ListMessagesCommand,
    ListPagesCommand: ListPagesCommand_1.ListPagesCommand,
    PutMessageCommand: PutMessageCommand_1.PutMessageCommand,
    SetReplyStateCommand: SetReplyStateCommand_1.SetReplyStateCommand,
};
const paginators = {
    paginateListFiles: ListFilesPaginator_1.paginateListFiles,
    paginateListMessages: ListMessagesPaginator_1.paginateListMessages,
    paginateListPages: ListPagesPaginator_1.paginateListPages,
};
/**
 * @public
 */
class Pagetray extends PagetrayClient_1.PagetrayClient {
}
exports.Pagetray = Pagetray;
(0, client_1.createAggregatedClient)(commands, Pagetray, { paginators });
