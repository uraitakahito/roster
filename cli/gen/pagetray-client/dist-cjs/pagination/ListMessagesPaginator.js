"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListMessages = void 0;
// smithy-typescript generated code
const core_1 = require("@smithy/core");
const ListMessagesCommand_1 = require("../commands/ListMessagesCommand");
const PagetrayClient_1 = require("../PagetrayClient");
/**
 * @public
 */
exports.paginateListMessages = (0, core_1.createPaginator)(PagetrayClient_1.PagetrayClient, ListMessagesCommand_1.ListMessagesCommand, "nextToken", "nextToken", "maxResults");
