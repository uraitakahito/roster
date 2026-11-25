"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListActors = void 0;
// smithy-typescript generated code
const core_1 = require("@smithy/core");
const CastlistClient_1 = require("../CastlistClient");
const ListActorsCommand_1 = require("../commands/ListActorsCommand");
/**
 * @public
 */
exports.paginateListActors = (0, core_1.createPaginator)(CastlistClient_1.CastlistClient, ListActorsCommand_1.ListActorsCommand, "nextToken", "nextToken", "maxResults");
