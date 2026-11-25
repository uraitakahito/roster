"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListFiles = void 0;
// smithy-typescript generated code
const core_1 = require("@smithy/core");
const ListFilesCommand_1 = require("../commands/ListFilesCommand");
const PagetrayClient_1 = require("../PagetrayClient");
/**
 * @public
 */
exports.paginateListFiles = (0, core_1.createPaginator)(PagetrayClient_1.PagetrayClient, ListFilesCommand_1.ListFilesCommand, "nextToken", "nextToken", "maxResults");
