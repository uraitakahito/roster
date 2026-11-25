"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._mw0 = exports._ep0 = exports.command = void 0;
// smithy-typescript generated code
const client_1 = require("@smithy/core/client");
const endpoints_1 = require("@smithy/core/endpoints");
const EndpointParameters_1 = require("./endpoint/EndpointParameters");
/**
 * @internal
 */
exports.command = (0, client_1.makeBuilder)(EndpointParameters_1.commonParams, "Pagetray", "PagetrayClient", endpoints_1.getEndpointPlugin);
/**
 * @internal
 */
exports._ep0 = {};
/**
 * @internal
 */
const _mw0 = (Command, cs, config, o) => [];
exports._mw0 = _mw0;
