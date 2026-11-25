"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListEvents = void 0;
// smithy-typescript generated code
const core_1 = require("@smithy/core");
const CastlistClient_1 = require("../CastlistClient");
const ListEventsCommand_1 = require("../commands/ListEventsCommand");
/**
 * @public
 */
exports.paginateListEvents = (0, core_1.createPaginator)(CastlistClient_1.CastlistClient, ListEventsCommand_1.ListEventsCommand, "nextToken", "nextToken", "maxResults");
