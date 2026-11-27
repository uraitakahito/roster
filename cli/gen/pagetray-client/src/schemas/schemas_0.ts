const _ARM = "AddReviewMarks";
const _ARMI = "AddReviewMarksInput";
const _ARMO = "AddReviewMarksOutput";
const _AS = "ActorSummary";
const _C = "Conflict";
const _CF = "CreateFile";
const _CFI = "CreateFileInput";
const _CFO = "CreateFileOutput";
const _CP = "CreatePage";
const _CPI = "CreatePageInput";
const _CPO = "CreatePageOutput";
const _CT = "Content-Type";
const _DF = "DeleteFiles";
const _DFI = "DeleteFilesInput";
const _DFO = "DeleteFilesOutput";
const _DP = "DeletePages";
const _DPI = "DeletePagesInput";
const _DPO = "DeletePagesOutput";
const _F = "Forbidden";
const _FC = "FacetCount";
const _FCa = "FacetCounts";
const _FT = "FileType";
const _FTi = "FileTypes";
const _Fi = "File";
const _Fil = "Files";
const _GFR = "GetFileRules";
const _GFRI = "GetFileRulesInput";
const _GFRO = "GetFileRulesOutput";
const _GH = "GetHealth";
const _GHI = "GetHealthInput";
const _GHO = "GetHealthOutput";
const _GMF = "GetMessageFacets";
const _GMFI = "GetMessageFacetsInput";
const _GMFO = "GetMessageFacetsOutput";
const _GPF = "GetPageFacets";
const _GPFI = "GetPageFacetsInput";
const _GPFO = "GetPageFacetsOutput";
const _H = "Html";
const _IE = "InternalError";
const _L = "Location";
const _LF = "ListFiles";
const _LFI = "ListFilesInput";
const _LFO = "ListFilesOutput";
const _LM = "ListMessages";
const _LMI = "ListMessagesInput";
const _LMO = "ListMessagesOutput";
const _LP = "ListPages";
const _LPI = "ListPagesInput";
const _LPO = "ListPagesOutput";
const _LR = "ListReviews";
const _LRI = "ListReviewsInput";
const _LRO = "ListReviewsOutput";
const _M = "Message";
const _Me = "Messages";
const _NF = "NotFound";
const _P = "Page";
const _PM = "PutMessage";
const _PMI = "PutMessageInput";
const _PMO = "PutMessageOutput";
const _PTL = "PayloadTooLarge";
const _Pa = "Pages";
const _RO = "ReviewOf";
const _ROe = "ReviewsOf";
const _S = "Sender";
const _SRS = "SetReplyState";
const _SRSI = "SetReplyStateInput";
const _SRSO = "SetReplyStateOutput";
const _U = "Unavailable";
const _UMT = "UnsupportedMediaType";
const _VE = "ValidationException";
const _VEF = "ValidationExceptionField";
const _VEFL = "ValidationExceptionFieldList";
const _a = "answered";
const _aA = "askedAt";
const _aAn = "answeredAt";
const _aI = "actorIssuer";
const _aR = "actorRef";
const _ac = "actor";
const _b = "body";
const _c = "client";
const _cA = "createdAt";
const _cT = "contentType";
const _co = "count";
const _d = "deliveries";
const _dA = "deliveredAt";
const _e = "error";
const _es = "escalated";
const _ex = "ext";
const _f = "from";
const _fL = "fieldList";
const _fi = "files";
const _h = "heading";
const _hE = "httpError";
const _hH = "httpHeader";
const _hQ = "httpQuery";
const _ht = "http";
const _i = "id";
const _is = "issuer";
const _k = "kind";
const _ke = "key";
const _key = "keys";
const _ki = "kinds";
const _l = "location";
const _m = "message";
const _mB = "maxBytes";
const _mR = "maxResults";
const _mT = "mediaType";
const _me = "messages";
const _n = "name";
const _nT = "nextToken";
const _n_ = "n";
const _no = "note";
const _o = "on";
const _p = "project";
const _pa = "path";
const _pag = "pages";
const _pr = "projects";
const _q = "q";
const _r = "role";
const _rA = "resolvedAt";
const _rT = "replyTo";
const _rW = "reviewWaiting";
const _re = "removed";
const _ref = "ref";
const _rep = "reply";
const _rev = "reviews";
const _ro = "roles";
const _s = "smithy.ts.sdk.synthetic.ai.pagetray";
const _sA = "sentAt";
const _se = "server";
const _sen = "sender";
const _send = "senders";
const _sh = "sha256";
const _si = "size";
const _so = "sort";
const _st = "status";
const _sta = "states";
const _stat = "state";
const _t = "text/html";
const _ta = "targets";
const _tar = "target";
const _te = "text";
const _ti = "title";
const _to = "to";
const _ty = "type";
const _typ = "types";
const _u = "url";
const _uA = "updatedAt";
const _v = "verdict";
const _va = "value";
const _ve = "version";
const _ver = "verdicts";
const _vi = "via";
const _w = "workspace";
const _wO = "waitsOn";
const _wa = "waiting";
const _wo = "workspaces";
const n0 = "ai.common";
const n1 = "ai.pagetray";
const n2 = "smithy.framework";

// smithy-typescript generated code
import { TypeRegistry } from "@smithy/core/schema";
import type {
  StaticErrorSchema,
  StaticListSchema,
  StaticOperationSchema,
  StaticSimpleSchema,
  StaticStructureSchema,
} from "@smithy/types";

import {
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  PayloadTooLarge,
  Unavailable,
  UnsupportedMediaType,
  ValidationException,
} from "../models/errors";
import { PagetrayServiceException } from "../models/PagetrayServiceException";

/* eslint no-var: 0 */
const _s_registry = new TypeRegistry(_s);
export var PagetrayServiceException$: StaticErrorSchema = [-3, _s, "PagetrayServiceException", 0, [], []];
_s_registry.registerError(PagetrayServiceException$, PagetrayServiceException);
const n0_registry = new TypeRegistry(n0);
const n1_registry = new TypeRegistry(n1);
const n2_registry = new TypeRegistry(n2);
export var Conflict$: StaticErrorSchema = [-3, n0, _C,
  { [_e]: _c, [_hE]: 409 },
  [_m],
  [0], 1
];
n0_registry.registerError(Conflict$, Conflict);
export var Forbidden$: StaticErrorSchema = [-3, n0, _F,
  { [_e]: _c, [_hE]: 403 },
  [_m],
  [0], 1
];
n0_registry.registerError(Forbidden$, Forbidden);
export var InternalError$: StaticErrorSchema = [-3, n0, _IE,
  { [_e]: _se, [_hE]: 500 },
  [_m],
  [0], 1
];
n0_registry.registerError(InternalError$, InternalError);
export var NotFound$: StaticErrorSchema = [-3, n0, _NF,
  { [_e]: _c, [_hE]: 404 },
  [_m],
  [0], 1
];
n0_registry.registerError(NotFound$, NotFound);
export var PayloadTooLarge$: StaticErrorSchema = [-3, n0, _PTL,
  { [_e]: _c, [_hE]: 413 },
  [_m],
  [0], 1
];
n0_registry.registerError(PayloadTooLarge$, PayloadTooLarge);
export var Unavailable$: StaticErrorSchema = [-3, n0, _U,
  { [_e]: _se, [_hE]: 503 },
  [_m],
  [0], 1
];
n0_registry.registerError(Unavailable$, Unavailable);
export var UnsupportedMediaType$: StaticErrorSchema = [-3, n1, _UMT,
  { [_e]: _c, [_hE]: 415 },
  [_m],
  [0], 1
];
n1_registry.registerError(UnsupportedMediaType$, UnsupportedMediaType);
export var ValidationException$: StaticErrorSchema = [-3, n2, _VE,
  { [_e]: _c },
  [_m, _fL],
  [0, () => ValidationExceptionFieldList], 1
];
n2_registry.registerError(ValidationException$, ValidationException);
/**
 * TypeRegistry instances containing modeled errors.
 * @internal
 *
 */
export const errorTypeRegistries = [
  _s_registry,
  n0_registry,
  n1_registry,
  n2_registry,
]
var Html: StaticSimpleSchema = [0, n1, _H, { [_mT]: _t }, 21];
export var ActorSummary$: StaticStructureSchema = [3, n0, _AS,
  0,
  [_i, _n, _k],
  [0, 0, 0], 3
];
export var AddReviewMarksInput$: StaticStructureSchema = [3, n1, _ARMI,
  0,
  [_p, _ke, _k, _n_, _v, _ta],
  [[0, 1], [0, 1], [0, 1], [0, 1], 0, 64 | 0], 4
];
export var AddReviewMarksOutput$: StaticStructureSchema = [3, n1, _ARMO,
  0,
  [_p, _ke, _k, _n_, _ti, _r, _w, _cA, _si, _pa, _sen, _aA, _aAn, _wO, _v, _ta],
  [0, 0, 0, 0, 0, 0, 0, 5, 1, 0, () => Sender$, 5, 5, 0, 0, 64 | 0], 10
];
export var CreateFileInput$: StaticStructureSchema = [3, n1, _CFI,
  0,
  [_p, _ke, _n, _cT, _b, _r, _w, _n_, _cA, _aI, _aR],
  [[0, 1], [0, 1], [0, { [_hQ]: _n }], [0, { [_hH]: _CT }], [21, 16], [0, { [_hQ]: _r }], [0, { [_hQ]: _w }], [0, { [_hQ]: _n_ }], [5, { [_hQ]: _cA }], [0, { [_hQ]: _aI }], [0, { [_hQ]: _aR }]], 5
];
export var CreateFileOutput$: StaticStructureSchema = [3, n1, _CFO,
  0,
  [_p, _ke, _n, _ex, _n_, _ty, _si, _sh, _r, _w, _cA, _pa, _u, _l, _sen],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 5, 0, 0, [0, { [_hH]: _L }], () => Sender$], 14
];
export var CreatePageInput$: StaticStructureSchema = [3, n1, _CPI,
  0,
  [_p, _ke, _k, _r, _b, _w, _n_, _cA, _aI, _aR],
  [[0, 1], [0, 1], [0, 1], [0, { [_hQ]: _r }], [() => Html, 16], [0, { [_hQ]: _w }], [0, { [_hQ]: _n_ }], [5, { [_hQ]: _cA }], [0, { [_hQ]: _aI }], [0, { [_hQ]: _aR }]], 5
];
export var CreatePageOutput$: StaticStructureSchema = [3, n1, _CPO,
  0,
  [_p, _ke, _k, _n_, _ti, _r, _w, _cA, _si, _pa, _u, _l, _sen],
  [0, 0, 0, 0, 0, 0, 0, 5, 1, 0, 0, [0, { [_hH]: _L }], () => Sender$], 12
];
export var DeleteFilesInput$: StaticStructureSchema = [3, n1, _DFI,
  0,
  [_p, _ke, _n, _n_],
  [[0, { [_hQ]: _p }], [0, { [_hQ]: _ke }], [0, { [_hQ]: _n }], [0, { [_hQ]: _n_ }]], 1
];
export var DeleteFilesOutput$: StaticStructureSchema = [3, n1, _DFO,
  0,
  [_re],
  [64 | 0], 1
];
export var DeletePagesInput$: StaticStructureSchema = [3, n1, _DPI,
  0,
  [_p, _ke, _k, _n_],
  [[0, { [_hQ]: _p }], [0, { [_hQ]: _ke }], [0, { [_hQ]: _k }], [0, { [_hQ]: _n_ }]], 1
];
export var DeletePagesOutput$: StaticStructureSchema = [3, n1, _DPO,
  0,
  [_re],
  [64 | 0], 1
];
export var FacetCount$: StaticStructureSchema = [3, n1, _FC,
  0,
  [_va, _co, _no],
  [0, 1, 0], 2
];
export var File$: StaticStructureSchema = [3, n1, _Fi,
  0,
  [_p, _ke, _n, _ex, _n_, _ty, _si, _sh, _r, _w, _cA, _pa, _sen],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 5, 0, () => Sender$], 12
];
export var FileType$: StaticStructureSchema = [3, n1, _FT,
  0,
  [_ex, _ty],
  [0, 0], 2
];
export var GetFileRulesInput$: StaticStructureSchema = [3, n1, _GFRI,
  0,
  [],
  []
];
export var GetFileRulesOutput$: StaticStructureSchema = [3, n1, _GFRO,
  0,
  [_typ, _mB],
  [() => FileTypes, 1], 2
];
export var GetHealthInput$: StaticStructureSchema = [3, n1, _GHI,
  0,
  [],
  []
];
export var GetHealthOutput$: StaticStructureSchema = [3, n1, _GHO,
  0,
  [_st, _ve],
  [0, 0], 2
];
export var GetMessageFacetsInput$: StaticStructureSchema = [3, n1, _GMFI,
  0,
  [_to, _f, _ke],
  [[0, { [_hQ]: _to }], [0, { [_hQ]: _f }], [0, { [_hQ]: _ke }]]
];
export var GetMessageFacetsOutput$: StaticStructureSchema = [3, n1, _GMFO,
  0,
  [_sta, _to, _f, _key, _pr],
  [() => FacetCounts, () => FacetCounts, () => FacetCounts, () => FacetCounts, () => FacetCounts], 5
];
export var GetPageFacetsInput$: StaticStructureSchema = [3, n1, _GPFI,
  0,
  [],
  []
];
export var GetPageFacetsOutput$: StaticStructureSchema = [3, n1, _GPFO,
  0,
  [_wa, _a, _rW, _es, _send, _ro, _wo, _ki, _key, _pr, _ver],
  [1, 1, 1, 1, () => FacetCounts, () => FacetCounts, () => FacetCounts, () => FacetCounts, () => FacetCounts, () => FacetCounts, () => FacetCounts], 11
];
export var ListFilesInput$: StaticStructureSchema = [3, n1, _LFI,
  0,
  [_p, _ke, _r, _w, _q, _ac, _so, _mR, _nT],
  [[0, { [_hQ]: _p }], [0, { [_hQ]: _ke }], [0, { [_hQ]: _r }], [0, { [_hQ]: _w }], [0, { [_hQ]: _q }], [0, { [_hQ]: _ac }], [0, { [_hQ]: _so }], [1, { [_hQ]: _mR }], [0, { [_hQ]: _nT }]]
];
export var ListFilesOutput$: StaticStructureSchema = [3, n1, _LFO,
  0,
  [_fi, _nT],
  [() => Files, 0], 1
];
export var ListMessagesInput$: StaticStructureSchema = [3, n1, _LMI,
  0,
  [_p, _ke, _to, _f, _stat, _h, _q, _so, _mR, _nT],
  [[0, { [_hQ]: _p }], [0, { [_hQ]: _ke }], [0, { [_hQ]: _to }], [0, { [_hQ]: _f }], [0, { [_hQ]: _stat }], [0, { [_hQ]: _h }], [0, { [_hQ]: _q }], [0, { [_hQ]: _so }], [1, { [_hQ]: _mR }], [0, { [_hQ]: _nT }]]
];
export var ListMessagesOutput$: StaticStructureSchema = [3, n1, _LMO,
  0,
  [_me, _nT],
  [() => Messages, 0], 1
];
export var ListPagesInput$: StaticStructureSchema = [3, n1, _LPI,
  0,
  [_p, _ke, _k, _r, _w, _q, _rep, _o, _v, _ac, _so, _mR, _nT],
  [[0, { [_hQ]: _p }], [0, { [_hQ]: _ke }], [0, { [_hQ]: _k }], [0, { [_hQ]: _r }], [0, { [_hQ]: _w }], [0, { [_hQ]: _q }], [0, { [_hQ]: _rep }], [0, { [_hQ]: _o }], [0, { [_hQ]: _v }], [0, { [_hQ]: _ac }], [0, { [_hQ]: _so }], [1, { [_hQ]: _mR }], [0, { [_hQ]: _nT }]]
];
export var ListPagesOutput$: StaticStructureSchema = [3, n1, _LPO,
  0,
  [_pag, _nT],
  [() => Pages, 0], 1
];
export var ListReviewsInput$: StaticStructureSchema = [3, n1, _LRI,
  0,
  [_tar],
  [[64 | 0, { [_hQ]: _tar }]], 1
];
export var ListReviewsOutput$: StaticStructureSchema = [3, n1, _LRO,
  0,
  [_rev],
  [() => ReviewsOf], 1
];
export var Message$: StaticStructureSchema = [3, n1, _M,
  0,
  [_p, _i, _h, _f, _to, _te, _sA, _stat, _cA, _uA, _ke, _dA, _vi, _d, _rT, _sen],
  [0, 0, 0, 0, 0, 0, 5, 0, 5, 5, 0, 5, 0, 1, 0, () => Sender$], 10
];
export var Page$: StaticStructureSchema = [3, n1, _P,
  0,
  [_p, _ke, _k, _n_, _ti, _r, _w, _cA, _si, _pa, _sen, _aA, _aAn, _wO, _v, _ta],
  [0, 0, 0, 0, 0, 0, 0, 5, 1, 0, () => Sender$, 5, 5, 0, 0, 64 | 0], 10
];
export var PutMessageInput$: StaticStructureSchema = [3, n1, _PMI,
  0,
  [_p, _i, _h, _f, _to, _te, _sA, _stat, _aI, _aR, _ke, _dA, _vi, _d, _rT],
  [[0, 1], [0, 1], 0, 0, 0, 0, 5, 0, [0, { [_hQ]: _aI }], [0, { [_hQ]: _aR }], 0, 5, 0, 1, 0], 8
];
export var PutMessageOutput$: StaticStructureSchema = [3, n1, _PMO,
  0,
  [_p, _i, _h, _f, _to, _te, _sA, _stat, _cA, _uA, _st, _ke, _dA, _vi, _d, _rT, _sen],
  [0, 0, 0, 0, 0, 0, 5, 0, 5, 5, [1, 32], 0, 5, 0, 1, 0, () => Sender$], 11
];
export var ReviewOf$: StaticStructureSchema = [3, n1, _RO,
  0,
  [_tar, _pa, _v],
  [0, 0, 0], 2
];
export var Sender$: StaticStructureSchema = [3, n1, _S,
  0,
  [_is, _ref, _ac, _rA],
  [0, 0, () => ActorSummary$, 5], 2
];
export var SetReplyStateInput$: StaticStructureSchema = [3, n1, _SRSI,
  0,
  [_p, _ke, _k, _n_, _stat, _o],
  [[0, 1], [0, 1], [0, 1], [0, 1], 0, 0], 5
];
export var SetReplyStateOutput$: StaticStructureSchema = [3, n1, _SRSO,
  0,
  [_p, _ke, _k, _n_, _ti, _r, _w, _cA, _si, _pa, _sen, _aA, _aAn, _wO, _v, _ta],
  [0, 0, 0, 0, 0, 0, 0, 5, 1, 0, () => Sender$, 5, 5, 0, 0, 64 | 0], 10
];
export var ValidationExceptionField$: StaticStructureSchema = [3, n2, _VEF,
  0,
  [_pa, _m],
  [0, 0], 2
];
var FacetCounts: StaticListSchema = [1, n1, _FCa,
  0, () => FacetCount$
];
var Files: StaticListSchema = [1, n1, _Fil,
  0, () => File$
];
var FileTypes: StaticListSchema = [1, n1, _FTi,
  0, () => FileType$
];
var Messages: StaticListSchema = [1, n1, _Me,
  0, () => Message$
];
var Pages: StaticListSchema = [1, n1, _Pa,
  0, () => Page$
];
var Paths = 64 | 0;
var ReviewsOf: StaticListSchema = [1, n1, _ROe,
  0, () => ReviewOf$
];
var ReviewTargets = 64 | 0;
var Targets = 64 | 0;
var ValidationExceptionFieldList: StaticListSchema = [1, n2, _VEFL,
  0, () => ValidationExceptionField$
];
export var AddReviewMarks$: StaticOperationSchema = [9, n1, _ARM,
  { [_ht]: ["POST", "/api/projects/{project}/keys/{key}/kinds/{kind}/pages/{n}/review", 200] }, () => AddReviewMarksInput$, () => AddReviewMarksOutput$
];
export var CreateFile$: StaticOperationSchema = [9, n1, _CF,
  { [_ht]: ["POST", "/api/projects/{project}/keys/{key}/files", 201] }, () => CreateFileInput$, () => CreateFileOutput$
];
export var CreatePage$: StaticOperationSchema = [9, n1, _CP,
  { [_ht]: ["POST", "/api/projects/{project}/keys/{key}/kinds/{kind}/pages", 201] }, () => CreatePageInput$, () => CreatePageOutput$
];
export var DeleteFiles$: StaticOperationSchema = [9, n1, _DF,
  { [_ht]: ["DELETE", "/api/files", 200] }, () => DeleteFilesInput$, () => DeleteFilesOutput$
];
export var DeletePages$: StaticOperationSchema = [9, n1, _DP,
  { [_ht]: ["DELETE", "/api/pages", 200] }, () => DeletePagesInput$, () => DeletePagesOutput$
];
export var GetFileRules$: StaticOperationSchema = [9, n1, _GFR,
  { [_ht]: ["GET", "/api/files/rules", 200] }, () => GetFileRulesInput$, () => GetFileRulesOutput$
];
export var GetHealth$: StaticOperationSchema = [9, n1, _GH,
  { [_ht]: ["GET", "/healthz", 200] }, () => GetHealthInput$, () => GetHealthOutput$
];
export var GetMessageFacets$: StaticOperationSchema = [9, n1, _GMF,
  { [_ht]: ["GET", "/api/messages/facets", 200] }, () => GetMessageFacetsInput$, () => GetMessageFacetsOutput$
];
export var GetPageFacets$: StaticOperationSchema = [9, n1, _GPF,
  { [_ht]: ["GET", "/api/pages/facets", 200] }, () => GetPageFacetsInput$, () => GetPageFacetsOutput$
];
export var ListFiles$: StaticOperationSchema = [9, n1, _LF,
  { [_ht]: ["GET", "/api/files", 200] }, () => ListFilesInput$, () => ListFilesOutput$
];
export var ListMessages$: StaticOperationSchema = [9, n1, _LM,
  { [_ht]: ["GET", "/api/messages", 200] }, () => ListMessagesInput$, () => ListMessagesOutput$
];
export var ListPages$: StaticOperationSchema = [9, n1, _LP,
  { [_ht]: ["GET", "/api/pages", 200] }, () => ListPagesInput$, () => ListPagesOutput$
];
export var ListReviews$: StaticOperationSchema = [9, n1, _LR,
  { [_ht]: ["GET", "/api/reviews", 200] }, () => ListReviewsInput$, () => ListReviewsOutput$
];
export var PutMessage$: StaticOperationSchema = [9, n1, _PM,
  { [_ht]: ["PUT", "/api/projects/{project}/messages/{id}", 200] }, () => PutMessageInput$, () => PutMessageOutput$
];
export var SetReplyState$: StaticOperationSchema = [9, n1, _SRS,
  { [_ht]: ["PUT", "/api/projects/{project}/keys/{key}/kinds/{kind}/pages/{n}/reply", 200] }, () => SetReplyStateInput$, () => SetReplyStateOutput$
];
