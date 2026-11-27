"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListUsage = void 0;
// smithy-typescript generated code
const core_1 = require("@smithy/core");
const CastlistClient_1 = require("../CastlistClient");
const ListUsageCommand_1 = require("../commands/ListUsageCommand");
/**
 * @public
 */
exports.paginateListUsage = (0, core_1.createPaginator)(CastlistClient_1.CastlistClient, ListUsageCommand_1.ListUsageCommand, "nextToken", "nextToken", "maxResults");
