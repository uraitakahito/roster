"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListPages = void 0;
// smithy-typescript generated code
const core_1 = require("@smithy/core");
const ListPagesCommand_1 = require("../commands/ListPagesCommand");
const PagetrayClient_1 = require("../PagetrayClient");
/**
 * @public
 */
exports.paginateListPages = (0, core_1.createPaginator)(PagetrayClient_1.PagetrayClient, ListPagesCommand_1.ListPagesCommand, "nextToken", "nextToken", "maxResults");
