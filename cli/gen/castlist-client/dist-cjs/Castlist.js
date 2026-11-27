"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Castlist = void 0;
// smithy-typescript generated code
const client_1 = require("@smithy/core/client");
const CastlistClient_1 = require("./CastlistClient");
const GetActorCommand_1 = require("./commands/GetActorCommand");
const GetActorSettingAtCommand_1 = require("./commands/GetActorSettingAtCommand");
const GetGraphCommand_1 = require("./commands/GetGraphCommand");
const GetHealthCommand_1 = require("./commands/GetHealthCommand");
const GetLineageCommand_1 = require("./commands/GetLineageCommand");
const GetTimelineCommand_1 = require("./commands/GetTimelineCommand");
const ListActorsCommand_1 = require("./commands/ListActorsCommand");
const ListActorSettingsCommand_1 = require("./commands/ListActorSettingsCommand");
const ListEventsCommand_1 = require("./commands/ListEventsCommand");
const ListSettingsCommand_1 = require("./commands/ListSettingsCommand");
const PutEventCommand_1 = require("./commands/PutEventCommand");
const PutLinkCommand_1 = require("./commands/PutLinkCommand");
const PutSettingCommand_1 = require("./commands/PutSettingCommand");
const RegisterActorCommand_1 = require("./commands/RegisterActorCommand");
const ResolveActorsCommand_1 = require("./commands/ResolveActorsCommand");
const ListActorsPaginator_1 = require("./pagination/ListActorsPaginator");
const ListEventsPaginator_1 = require("./pagination/ListEventsPaginator");
const ListSettingsPaginator_1 = require("./pagination/ListSettingsPaginator");
const commands = {
    GetActorCommand: GetActorCommand_1.GetActorCommand,
    GetActorSettingAtCommand: GetActorSettingAtCommand_1.GetActorSettingAtCommand,
    GetGraphCommand: GetGraphCommand_1.GetGraphCommand,
    GetHealthCommand: GetHealthCommand_1.GetHealthCommand,
    GetLineageCommand: GetLineageCommand_1.GetLineageCommand,
    GetTimelineCommand: GetTimelineCommand_1.GetTimelineCommand,
    ListActorsCommand: ListActorsCommand_1.ListActorsCommand,
    ListActorSettingsCommand: ListActorSettingsCommand_1.ListActorSettingsCommand,
    ListEventsCommand: ListEventsCommand_1.ListEventsCommand,
    ListSettingsCommand: ListSettingsCommand_1.ListSettingsCommand,
    PutEventCommand: PutEventCommand_1.PutEventCommand,
    PutLinkCommand: PutLinkCommand_1.PutLinkCommand,
    PutSettingCommand: PutSettingCommand_1.PutSettingCommand,
    RegisterActorCommand: RegisterActorCommand_1.RegisterActorCommand,
    ResolveActorsCommand: ResolveActorsCommand_1.ResolveActorsCommand,
};
const paginators = {
    paginateListActors: ListActorsPaginator_1.paginateListActors,
    paginateListEvents: ListEventsPaginator_1.paginateListEvents,
    paginateListSettings: ListSettingsPaginator_1.paginateListSettings,
};
/**
 * @public
 */
class Castlist extends CastlistClient_1.CastlistClient {
}
exports.Castlist = Castlist;
(0, client_1.createAggregatedClient)(commands, Castlist, { paginators });
