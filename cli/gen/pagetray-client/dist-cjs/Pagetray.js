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
const ListFilesCommand_1 = require("./commands/ListFilesCommand");
const ListPagesCommand_1 = require("./commands/ListPagesCommand");
const SetReplyStateCommand_1 = require("./commands/SetReplyStateCommand");
const PagetrayClient_1 = require("./PagetrayClient");
const ListFilesPaginator_1 = require("./pagination/ListFilesPaginator");
const ListPagesPaginator_1 = require("./pagination/ListPagesPaginator");
const commands = {
    AddReviewMarksCommand: AddReviewMarksCommand_1.AddReviewMarksCommand,
    CreateFileCommand: CreateFileCommand_1.CreateFileCommand,
    CreatePageCommand: CreatePageCommand_1.CreatePageCommand,
    DeleteFilesCommand: DeleteFilesCommand_1.DeleteFilesCommand,
    DeletePagesCommand: DeletePagesCommand_1.DeletePagesCommand,
    GetHealthCommand: GetHealthCommand_1.GetHealthCommand,
    ListFilesCommand: ListFilesCommand_1.ListFilesCommand,
    ListPagesCommand: ListPagesCommand_1.ListPagesCommand,
    SetReplyStateCommand: SetReplyStateCommand_1.SetReplyStateCommand,
};
const paginators = {
    paginateListFiles: ListFilesPaginator_1.paginateListFiles,
    paginateListPages: ListPagesPaginator_1.paginateListPages,
};
/**
 * @public
 */
class Pagetray extends PagetrayClient_1.PagetrayClient {
}
exports.Pagetray = Pagetray;
(0, client_1.createAggregatedClient)(commands, Pagetray, { paginators });
