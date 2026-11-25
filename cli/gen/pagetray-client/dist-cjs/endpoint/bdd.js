"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bdd = void 0;
// smithy-typescript generated code
const endpoints_1 = require("@smithy/core/endpoints");
const a = { "ref": "endpoint" };
const _data = {
    conditions: [
        ["isSet", [a]]
    ],
    results: [
        [-1],
        [a, {}],
        [-1, "(default endpointRuleSet) endpoint is not set - you must configure an endpoint."]
    ]
};
const root = 2;
const r = 100_000_000;
const nodes = new Int32Array([
    -1, 1, -1,
    0, r + 1, r + 2,
]);
exports.bdd = endpoints_1.BinaryDecisionDiagram.from(nodes, root, _data.conditions, _data.results);
