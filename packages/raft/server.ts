import type { RequestVote, RequestVoteResponse } from "./rpc/RequestVote";
import type { AppendEntryRequest, AppendEntryResponse } from "./rpc/AppendEntries";
import type { AddServer, LeaveServer, MemberShipChangeResponse } from "./rpc/membership";
import type { Command } from "./command";
import type { Raftnode } from "./node";
import type { ClientQueryResponse, ClientRequestResponse, Query } from "./query";

export abstract class Server {
  abstract listen(node:Raftnode): Promise<void>;
  abstract RequestVote(request: RequestVote): Promise<RequestVoteResponse> 
  abstract AppendEntries(request: AppendEntryRequest): Promise<AppendEntryResponse>
  abstract AddServer(request: AddServer): Promise<MemberShipChangeResponse>
  abstract RemoveServer(request: LeaveServer): Promise<MemberShipChangeResponse>
  abstract ClientRequest(request: Command<any>): Promise<ClientRequestResponse>
  abstract ClientQuery(query: Query): Promise<ClientQueryResponse<any>>
}