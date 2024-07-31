import type { Command } from "../command";
import type { ClientQueryResponse, ClientRequestResponse, Query } from "../query";
import type { AppendEntryRequest, AppendEntryResponse } from "../rpc/AppendEntries";
import type { AddServer, LeaveServer, MemberShipChangeResponse } from "../rpc/membership";
import type { RequestVote, RequestVoteResponse } from "../rpc/RequestVote";
import type { Server } from "../server";

export abstract class BaseNetwork {
  abstract nodes: Map<string, Server>;
  abstract requestVoteFromNode(
    nodeId: string,
    request: RequestVote
  ): Promise<RequestVoteResponse>
  abstract appendEntriesToNode(
    nodeId: string,
    request: AppendEntryRequest
  ): Promise<AppendEntryResponse>
  abstract addServerToNode(
    nodeId: string,
    request: AddServer
  ): Promise<MemberShipChangeResponse>
  abstract removeServerFromNode(
    nodeId: string,
    request: LeaveServer
  ): Promise<MemberShipChangeResponse>
  abstract clientQueryToNode(
    nodeId: string,
    query: Query
  ): Promise<ClientQueryResponse<any>>;
  abstract clientRequestToNode(
    nodeId: string,
    request: Command<any>
  ): Promise<ClientRequestResponse>;
}