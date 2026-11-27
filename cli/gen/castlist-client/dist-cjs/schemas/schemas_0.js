"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Setting$ = exports.ResolveActorsOutput$ = exports.ResolveActorsInput$ = exports.Resolution$ = exports.RequestedSettings$ = exports.RegisterActorOutput$ = exports.RegisterActorInput$ = exports.PutSettingOutput$ = exports.PutSettingInput$ = exports.PutLinkOutput$ = exports.PutLinkInput$ = exports.PutEventOutput$ = exports.PutEventInput$ = exports.ListSettingsOutput$ = exports.ListSettingsInput$ = exports.ListEventsOutput$ = exports.ListEventsInput$ = exports.ListActorsOutput$ = exports.ListActorsInput$ = exports.ListActorSettingsOutput$ = exports.ListActorSettingsInput$ = exports.Link$ = exports.GraphNode$ = exports.GetTimelineOutput$ = exports.GetTimelineInput$ = exports.GetLineageOutput$ = exports.GetLineageInput$ = exports.GetHealthOutput$ = exports.GetHealthInput$ = exports.GetGraphOutput$ = exports.GetGraphInput$ = exports.GetActorSettingAtOutput$ = exports.GetActorSettingAtInput$ = exports.GetActorOutput$ = exports.GetActorInput$ = exports.EventRow$ = exports.Event$ = exports.Binding$ = exports.ActorState$ = exports.ActorRow$ = exports.ActorBinding$ = exports.errorTypeRegistries = exports.ValidationException$ = exports.Unavailable$ = exports.PayloadTooLarge$ = exports.NotFound$ = exports.InternalError$ = exports.Forbidden$ = exports.Conflict$ = exports.CastlistServiceException$ = void 0;
exports.ResolveActors$ = exports.RegisterActor$ = exports.PutSetting$ = exports.PutLink$ = exports.PutEvent$ = exports.ListSettings$ = exports.ListEvents$ = exports.ListActorSettings$ = exports.ListActors$ = exports.GetTimeline$ = exports.GetLineage$ = exports.GetHealth$ = exports.GetGraph$ = exports.GetActorSettingAt$ = exports.GetActor$ = exports.ValidationExceptionField$ = exports.ActorSummary$ = exports.TimelineEvent$ = exports.SettingRow$ = void 0;
const _AB = "ActorBinding";
const _ABc = "ActorBindings";
const _AR = "ActorRow";
const _ARc = "ActorRows";
const _AS = "ActorState";
const _ASc = "ActorSummary";
const _B = "Binding";
const _Bi = "Bindings";
const _C = "Conflict";
const _E = "Event";
const _ER = "EventRow";
const _ERv = "EventRows";
const _Ev = "Events";
const _F = "Forbidden";
const _GA = "GetActor";
const _GAI = "GetActorInput";
const _GAO = "GetActorOutput";
const _GASA = "GetActorSettingAt";
const _GASAI = "GetActorSettingAtInput";
const _GASAO = "GetActorSettingAtOutput";
const _GG = "GetGraph";
const _GGI = "GetGraphInput";
const _GGO = "GetGraphOutput";
const _GH = "GetHealth";
const _GHI = "GetHealthInput";
const _GHO = "GetHealthOutput";
const _GL = "GetLineage";
const _GLI = "GetLineageInput";
const _GLO = "GetLineageOutput";
const _GN = "GraphNode";
const _GNr = "GraphNodes";
const _GT = "GetTimeline";
const _GTI = "GetTimelineInput";
const _GTO = "GetTimelineOutput";
const _IE = "InternalError";
const _L = "Link";
const _LA = "ListActors";
const _LAI = "ListActorsInput";
const _LAO = "ListActorsOutput";
const _LAS = "ListActorSettings";
const _LASI = "ListActorSettingsInput";
const _LASO = "ListActorSettingsOutput";
const _LE = "ListEvents";
const _LEI = "ListEventsInput";
const _LEO = "ListEventsOutput";
const _LS = "ListSettings";
const _LSI = "ListSettingsInput";
const _LSO = "ListSettingsOutput";
const _Li = "Links";
const _NF = "NotFound";
const _PE = "PutEvent";
const _PEI = "PutEventInput";
const _PEO = "PutEventOutput";
const _PL = "PutLink";
const _PLI = "PutLinkInput";
const _PLO = "PutLinkOutput";
const _PS = "PutSetting";
const _PSI = "PutSettingInput";
const _PSO = "PutSettingOutput";
const _PTL = "PayloadTooLarge";
const _R = "Resolution";
const _RA = "RegisterActor";
const _RAI = "RegisterActorInput";
const _RAIe = "ResolveActorsInput";
const _RAO = "RegisterActorOutput";
const _RAOe = "ResolveActorsOutput";
const _RAe = "ResolveActors";
const _RS = "RequestedSettings";
const _Re = "Resolutions";
const _S = "Setting";
const _SR = "SettingRow";
const _SRe = "SettingRows";
const _Se = "Settings";
const _TE = "TimelineEvent";
const _TEi = "TimelineEvents";
const _U = "Unavailable";
const _VE = "ValidationException";
const _VEF = "ValidationExceptionField";
const _VEFL = "ValidationExceptionFieldList";
const _a = "at";
const _aF = "activeFrom";
const _aI = "actorId";
const _aN = "actorName";
const _aO = "asOf";
const _aT = "activeTo";
const _ac = "active";
const _act = "actors";
const _acto = "actor";
const _b = "bindings";
const _bi = "binding";
const _by = "by";
const _c = "client";
const _cB = "currentBindings";
const _cS = "clockSkew";
const _cSu = "currentSettings";
const _cr = "created";
const _d = "detail";
const _de = "depth";
const _di = "direction";
const _e = "error";
const _eA = "enteredAt";
const _eAx = "exitedAt";
const _eI = "eventId";
const _ed = "edges";
const _ef = "effort";
const _ev = "events";
const _f = "from";
const _fEA = "firstEnteredAt";
const _fL = "fieldList";
const _h = "http";
const _hE = "httpError";
const _hQ = "httpQuery";
const _i = "issuer";
const _iK = "isKey";
const _id = "id";
const _in = "inferred";
const _k = "kind";
const _l = "labels";
const _lB = "launchedBy";
const _lEA = "lastExitedAt";
const _lET = "lastExitType";
const _lI = "linksIn";
const _lIi = "linkId";
const _lO = "linksOut";
const _la = "label";
const _m = "message";
const _mR = "maxResults";
const _mi = "mismatch";
const _mo = "model";
const _n = "name";
const _nP = "namePrefix";
const _nT = "nextToken";
const _no = "nodes";
const _now = "now";
const _o = "order";
const _p = "present";
const _pa = "path";
const _pr = "presence";
const _r = "reason";
const _rA = "receivedAt";
const _re = "ref";
const _ref = "refs";
const _res = "results";
const _s = "smithy.ts.sdk.synthetic.ai.castlist";
const _sA = "sentAt";
const _sI = "settingId";
const _se = "server";
const _set = "settings";
const _sett = "setting";
const _sk = "skewed";
const _so = "sort";
const _sou = "source";
const _st = "state";
const _sta = "status";
const _t = "type";
const _ti = "time";
const _to = "to";
const _u = "url";
const _v = "value";
const _ve = "version";
const n0 = "ai.common";
const n1 = "smithy.framework";
const n2 = "ai.castlist";
// smithy-typescript generated code
const schema_1 = require("@smithy/core/schema");
const CastlistServiceException_1 = require("../models/CastlistServiceException");
const errors_1 = require("../models/errors");
/* eslint no-var: 0 */
const _s_registry = new schema_1.TypeRegistry(_s);
exports.CastlistServiceException$ = [-3, _s, "CastlistServiceException", 0, [], []];
_s_registry.registerError(exports.CastlistServiceException$, CastlistServiceException_1.CastlistServiceException);
const n0_registry = new schema_1.TypeRegistry(n0);
const n1_registry = new schema_1.TypeRegistry(n1);
exports.Conflict$ = [-3, n0, _C,
    { [_e]: _c, [_hE]: 409 },
    [_m],
    [0], 1
];
n0_registry.registerError(exports.Conflict$, errors_1.Conflict);
exports.Forbidden$ = [-3, n0, _F,
    { [_e]: _c, [_hE]: 403 },
    [_m],
    [0], 1
];
n0_registry.registerError(exports.Forbidden$, errors_1.Forbidden);
exports.InternalError$ = [-3, n0, _IE,
    { [_e]: _se, [_hE]: 500 },
    [_m],
    [0], 1
];
n0_registry.registerError(exports.InternalError$, errors_1.InternalError);
exports.NotFound$ = [-3, n0, _NF,
    { [_e]: _c, [_hE]: 404 },
    [_m],
    [0], 1
];
n0_registry.registerError(exports.NotFound$, errors_1.NotFound);
exports.PayloadTooLarge$ = [-3, n0, _PTL,
    { [_e]: _c, [_hE]: 413 },
    [_m],
    [0], 1
];
n0_registry.registerError(exports.PayloadTooLarge$, errors_1.PayloadTooLarge);
exports.Unavailable$ = [-3, n0, _U,
    { [_e]: _se, [_hE]: 503 },
    [_m],
    [0], 1
];
n0_registry.registerError(exports.Unavailable$, errors_1.Unavailable);
exports.ValidationException$ = [-3, n1, _VE,
    { [_e]: _c },
    [_m, _fL],
    [0, () => ValidationExceptionFieldList], 1
];
n1_registry.registerError(exports.ValidationException$, errors_1.ValidationException);
/**
 * TypeRegistry instances containing modeled errors.
 * @internal
 *
 */
exports.errorTypeRegistries = [
    _s_registry,
    n0_registry,
    n1_registry,
];
exports.ActorBinding$ = [3, n2, _AB,
    0,
    [_i, _t, _v, _iK, _sA, _rA],
    [0, 0, 0, 2, 5, 5], 6
];
exports.ActorRow$ = [3, n2, _AR,
    0,
    [_id, _n, _k, _i, _sA, _rA, _cS, _l, _p, _in, _u, _fEA, _lEA, _lET, _pr, _sk, _mo, _ef],
    [0, 0, 0, 0, 5, 5, 2, 128 | 0, 2, 2, 0, 5, 5, 0, 0, 2, 0, 0], 11
];
exports.ActorState$ = [3, n2, _AS,
    0,
    [_p, _in, _pr, _eA, _eAx],
    [2, 2, 0, 5, 5], 2
];
exports.Binding$ = [3, n2, _B,
    0,
    [_t, _v],
    [0, 0], 2
];
exports.Event$ = [3, n2, _E,
    0,
    [_id, _aI, _t, _d, _sA, _rA, _cS],
    [0, 0, 0, 15, 5, 5, 2], 7
];
exports.EventRow$ = [3, n2, _ER,
    0,
    [_id, _aI, _t, _d, _sA, _rA, _cS, _aN],
    [0, 0, 0, 15, 5, 5, 2, 0], 8
];
exports.GetActorInput$ = [3, n2, _GAI,
    0,
    [_aI],
    [[0, 1]], 1
];
exports.GetActorOutput$ = [3, n2, _GAO,
    0,
    [_id, _n, _k, _i, _sA, _rA, _cS, _l, _b, _cB, _ev, _set, _lI, _lO, _st, _aO, _cSu],
    [0, 0, 0, 0, 5, 5, 2, 128 | 0, () => ActorBindings, () => ActorBindings, () => Events, () => Settings, () => Links, () => Links, () => exports.ActorState$, 5, () => exports.Setting$], 16
];
exports.GetActorSettingAtInput$ = [3, n2, _GASAI,
    0,
    [_aI, _ti],
    [[0, 1], [5, { [_hQ]: _ti }]], 2
];
exports.GetActorSettingAtOutput$ = [3, n2, _GASAO,
    0,
    [_aO, _aI, _a, _sett],
    [5, 0, 5, () => exports.Setting$], 3
];
exports.GetGraphInput$ = [3, n2, _GGI,
    0,
    [_la, _f, _to],
    [[0, { [_hQ]: _la }], [5, { [_hQ]: _f }], [5, { [_hQ]: _to }]]
];
exports.GetGraphOutput$ = [3, n2, _GGO,
    0,
    [_aO, _no, _ed],
    [5, () => GraphNodes, () => Links], 3
];
exports.GetHealthInput$ = [3, n2, _GHI,
    0,
    [],
    []
];
exports.GetHealthOutput$ = [3, n2, _GHO,
    0,
    [_sta, _ve, _now],
    [0, 0, 5], 3
];
exports.GetLineageInput$ = [3, n2, _GLI,
    0,
    [_aI, _di, _de, _t],
    [[0, 1], [0, { [_hQ]: _di }], [1, { [_hQ]: _de }], [0, { [_hQ]: _t }]], 1
];
exports.GetLineageOutput$ = [3, n2, _GLO,
    0,
    [_aO, _aI, _no, _ed],
    [5, 0, () => ActorRows, () => Links], 4
];
exports.GetTimelineInput$ = [3, n2, _GTI,
    0,
    [_la, _f, _to],
    [[0, { [_hQ]: _la }], [5, { [_hQ]: _f }], [5, { [_hQ]: _to }]]
];
exports.GetTimelineOutput$ = [3, n2, _GTO,
    0,
    [_aO, _no, _ed, _ev, _set],
    [5, () => GraphNodes, () => Links, () => TimelineEvents, () => Settings], 5
];
exports.GraphNode$ = [3, n2, _GN,
    0,
    [_id, _n, _k, _i, _sA, _rA, _cS, _st, _cSu],
    [0, 0, 0, 0, 5, 5, 2, () => exports.ActorState$, () => exports.Setting$], 8
];
exports.Link$ = [3, n2, _L,
    0,
    [_id, _t, _f, _to, _sA, _rA, _cS],
    [0, 0, 0, 0, 5, 5, 2], 7
];
exports.ListActorSettingsInput$ = [3, n2, _LASI,
    0,
    [_aI],
    [[0, 1]], 1
];
exports.ListActorSettingsOutput$ = [3, n2, _LASO,
    0,
    [_aO, _aI, _set],
    [5, 0, () => Settings], 3
];
exports.ListActorsInput$ = [3, n2, _LAI,
    0,
    [_la, _bi, _a, _aF, _aT, _k, _mo, _ef, _ac, _lB, _sk, _so, _o, _mR, _nT],
    [[64 | 0, { [_hQ]: _la }], [0, { [_hQ]: _bi }], [5, { [_hQ]: _a }], [5, { [_hQ]: _aF }], [5, { [_hQ]: _aT }], [0, { [_hQ]: _k }], [0, { [_hQ]: _mo }], [0, { [_hQ]: _ef }], [2, { [_hQ]: _ac }], [0, { [_hQ]: _lB }], [2, { [_hQ]: _sk }], [0, { [_hQ]: _so }], [0, { [_hQ]: _o }], [1, { [_hQ]: _mR }], [0, { [_hQ]: _nT }]]
];
exports.ListActorsOutput$ = [3, n2, _LAO,
    0,
    [_aO, _act, _nT],
    [5, () => ActorRows, 0], 2
];
exports.ListEventsInput$ = [3, n2, _LEI,
    0,
    [_t, _acto, _f, _to, _r, _sou, _sk, _mR, _nT],
    [[64 | 0, { [_hQ]: _t }], [0, { [_hQ]: _acto }], [5, { [_hQ]: _f }], [5, { [_hQ]: _to }], [0, { [_hQ]: _r }], [0, { [_hQ]: _sou }], [2, { [_hQ]: _sk }], [1, { [_hQ]: _mR }], [0, { [_hQ]: _nT }]]
];
exports.ListEventsOutput$ = [3, n2, _LEO,
    0,
    [_aO, _ev, _nT],
    [5, () => EventRows, 0], 2
];
exports.ListSettingsInput$ = [3, n2, _LSI,
    0,
    [_mo, _ef, _sou, _f, _to, _mi, _sk, _mR, _nT],
    [[0, { [_hQ]: _mo }], [0, { [_hQ]: _ef }], [0, { [_hQ]: _sou }], [5, { [_hQ]: _f }], [5, { [_hQ]: _to }], [2, { [_hQ]: _mi }], [2, { [_hQ]: _sk }], [1, { [_hQ]: _mR }], [0, { [_hQ]: _nT }]]
];
exports.ListSettingsOutput$ = [3, n2, _LSO,
    0,
    [_aO, _set, _nT],
    [5, () => SettingRows, 0], 2
];
exports.PutEventInput$ = [3, n2, _PEI,
    0,
    [_eI, _i, _by, _t, _sA, _d],
    [[0, 1], 0, 0, 0, 5, 15], 5
];
exports.PutEventOutput$ = [3, n2, _PEO,
    0,
    [_id, _aI, _t, _d, _sA, _rA, _cS, _sta],
    [0, 0, 0, 15, 5, 5, 2, [1, 32]], 8
];
exports.PutLinkInput$ = [3, n2, _PLI,
    0,
    [_lIi, _i, _t, _f, _to, _sA],
    [[0, 1], 0, 0, 0, 0, 5], 6
];
exports.PutLinkOutput$ = [3, n2, _PLO,
    0,
    [_id, _t, _f, _to, _sA, _rA, _cS, _sta],
    [0, 0, 0, 0, 5, 5, 2, [1, 32]], 8
];
exports.PutSettingInput$ = [3, n2, _PSI,
    0,
    [_sI, _i, _by, _mo, _ef, _sou, _sA],
    [[0, 1], 0, 0, 0, 0, 0, 5], 7
];
exports.PutSettingOutput$ = [3, n2, _PSO,
    0,
    [_aI, _mo, _ef, _sou, _sA, _rA, _cS, _sta, _id],
    [0, 0, 0, 0, 5, 5, 2, [1, 32], 0], 8
];
exports.RegisterActorInput$ = [3, n2, _RAI,
    0,
    [_i, _k, _nP, _b, _sA, _l, _set],
    [0, 0, 0, () => Bindings, 5, 128 | 0, () => exports.RequestedSettings$], 5
];
exports.RegisterActorOutput$ = [3, n2, _RAO,
    0,
    [_acto, _cr, _sta],
    [() => exports.ActorSummary$, 2, [1, 32]], 3
];
exports.RequestedSettings$ = [3, n2, _RS,
    0,
    [_mo, _ef],
    [0, 0], 2
];
exports.Resolution$ = [3, n2, _R,
    0,
    [_re, _acto],
    [0, () => exports.ActorSummary$], 1
];
exports.ResolveActorsInput$ = [3, n2, _RAIe,
    0,
    [_i, _ref],
    [0, 64 | 0], 2
];
exports.ResolveActorsOutput$ = [3, n2, _RAOe,
    0,
    [_aO, _res],
    [5, () => Resolutions], 2
];
exports.Setting$ = [3, n2, _S,
    0,
    [_aI, _mo, _ef, _sou, _sA, _rA, _cS, _id],
    [0, 0, 0, 0, 5, 5, 2, 0], 7
];
exports.SettingRow$ = [3, n2, _SR,
    0,
    [_aI, _mo, _ef, _sou, _sA, _rA, _cS, _aN, _id],
    [0, 0, 0, 0, 5, 5, 2, 0, 0], 8
];
exports.TimelineEvent$ = [3, n2, _TE,
    0,
    [_aI, _t, _rA, _in, _r],
    [0, 0, 5, 2, 0], 4
];
exports.ActorSummary$ = [3, n0, _ASc,
    0,
    [_id, _n, _k],
    [0, 0, 0], 3
];
exports.ValidationExceptionField$ = [3, n1, _VEF,
    0,
    [_pa, _m],
    [0, 0], 2
];
var ActorBindings = [1, n2, _ABc,
    0, () => exports.ActorBinding$
];
var ActorRefs = 64 | 0;
var ActorRows = [1, n2, _ARc,
    0, () => exports.ActorRow$
];
var Bindings = [1, n2, _Bi,
    0, () => exports.Binding$
];
var EventRows = [1, n2, _ERv,
    0, () => exports.EventRow$
];
var Events = [1, n2, _Ev,
    0, () => exports.Event$
];
var EventTypes = 64 | 0;
var GraphNodes = [1, n2, _GNr,
    0, () => exports.GraphNode$
];
var LabelFilters = 64 | 0;
var Links = [1, n2, _Li,
    0, () => exports.Link$
];
var Resolutions = [1, n2, _Re,
    0, () => exports.Resolution$
];
var SettingRows = [1, n2, _SRe,
    0, () => exports.SettingRow$
];
var Settings = [1, n2, _Se,
    0, () => exports.Setting$
];
var TimelineEvents = [1, n2, _TEi,
    0, () => exports.TimelineEvent$
];
var ValidationExceptionFieldList = [1, n1, _VEFL,
    0, () => exports.ValidationExceptionField$
];
var Labels = 128 | 0;
exports.GetActor$ = [9, n2, _GA,
    { [_h]: ["GET", "/api/actors/{actorId}", 200] }, () => exports.GetActorInput$, () => exports.GetActorOutput$
];
exports.GetActorSettingAt$ = [9, n2, _GASA,
    { [_h]: ["GET", "/api/actors/{actorId}/settings/at", 200] }, () => exports.GetActorSettingAtInput$, () => exports.GetActorSettingAtOutput$
];
exports.GetGraph$ = [9, n2, _GG,
    { [_h]: ["GET", "/api/graph", 200] }, () => exports.GetGraphInput$, () => exports.GetGraphOutput$
];
exports.GetHealth$ = [9, n2, _GH,
    { [_h]: ["GET", "/healthz", 200] }, () => exports.GetHealthInput$, () => exports.GetHealthOutput$
];
exports.GetLineage$ = [9, n2, _GL,
    { [_h]: ["GET", "/api/actors/{actorId}/lineage", 200] }, () => exports.GetLineageInput$, () => exports.GetLineageOutput$
];
exports.GetTimeline$ = [9, n2, _GT,
    { [_h]: ["GET", "/api/timeline", 200] }, () => exports.GetTimelineInput$, () => exports.GetTimelineOutput$
];
exports.ListActors$ = [9, n2, _LA,
    { [_h]: ["GET", "/api/actors", 200] }, () => exports.ListActorsInput$, () => exports.ListActorsOutput$
];
exports.ListActorSettings$ = [9, n2, _LAS,
    { [_h]: ["GET", "/api/actors/{actorId}/settings", 200] }, () => exports.ListActorSettingsInput$, () => exports.ListActorSettingsOutput$
];
exports.ListEvents$ = [9, n2, _LE,
    { [_h]: ["GET", "/api/events", 200] }, () => exports.ListEventsInput$, () => exports.ListEventsOutput$
];
exports.ListSettings$ = [9, n2, _LS,
    { [_h]: ["GET", "/api/settings", 200] }, () => exports.ListSettingsInput$, () => exports.ListSettingsOutput$
];
exports.PutEvent$ = [9, n2, _PE,
    { [_h]: ["PUT", "/api/events/{eventId}", 200] }, () => exports.PutEventInput$, () => exports.PutEventOutput$
];
exports.PutLink$ = [9, n2, _PL,
    { [_h]: ["PUT", "/api/links/{linkId}", 200] }, () => exports.PutLinkInput$, () => exports.PutLinkOutput$
];
exports.PutSetting$ = [9, n2, _PS,
    { [_h]: ["PUT", "/api/settings/{settingId}", 200] }, () => exports.PutSettingInput$, () => exports.PutSettingOutput$
];
exports.RegisterActor$ = [9, n2, _RA,
    { [_h]: ["POST", "/api/actors", 200] }, () => exports.RegisterActorInput$, () => exports.RegisterActorOutput$
];
exports.ResolveActors$ = [9, n2, _RAe,
    { [_h]: ["POST", "/api/resolve", 200] }, () => exports.ResolveActorsInput$, () => exports.ResolveActorsOutput$
];
