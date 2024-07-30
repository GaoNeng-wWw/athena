import type { Command } from "../../command";
import type { Raftnode } from "../../node";
import type { ClientQueryResponse, ClientRequestResponse, Query } from "../../query";
import type { AppendEntryRequest, AppendEntryResponse } from "../../rpc/AppendEntries";
import type { AddServer, MemberShipChangeResponse, LeaveServer } from "../../rpc/membership";
import type { RequestVote, RequestVoteResponse } from "../../rpc/RequestVote";
import type { Server } from "../../server";

export class MemoryServer implements Server {
  async listen(node: Raftnode): Promise<void> {
    this.node = node;
    console.log(`[MEMORY Server: ${node.id}]: Started`);
  }
  async RequestVote(request: RequestVote): Promise<RequestVoteResponse> {
    const response = await this.node.requestVoteHandler(request);
    return response;
  }
  async AppendEntries(request: AppendEntryRequest): Promise<AppendEntryResponse> {
    const response = await this.node.appendEntry(request);
    return response;
  }
  async AddServer(request: AddServer): Promise<MemberShipChangeResponse> {
    return this.node.addServer(request);
  }
  async RemoveServer(request: LeaveServer): Promise<MemberShipChangeResponse> {
    return this.node.removeServer(request);
  }
  async ClientRequest(
    request: Command<any>
  ): Promise<ClientRequestResponse> {
    return await this.node.handleClientReq(request);
  }
  async ClientQuery(query: Query): Promise<ClientQueryResponse<string|boolean>> {
    return this.node.handleClientQuery(query);
  }
  private node!: Raftnode;
}