"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginateListSettings = void 0;
// smithy-typescript generated code
const core_1 = require("@smithy/core");
const CastlistClient_1 = require("../CastlistClient");
const ListSettingsCommand_1 = require("../commands/ListSettingsCommand");
/**
 * @public
 */
exports.paginateListSettings = (0, core_1.createPaginator)(CastlistClient_1.CastlistClient, ListSettingsCommand_1.ListSettingsCommand, "nextToken", "nextToken", "maxResults");
