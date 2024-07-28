import type { AppendEntryRequest, AppendEntryResponse } from "packages/raft/rpc/AppendEntries";
import type { AddServer, MemberShipChangeResponse, LeaveServer } from "packages/raft/rpc/membership";
import type { RequestVote, RequestVoteResponse } from "packages/raft/rpc/RequestVote";
import type { Peer } from "../../node";
import type { BaseNetwork } from "../network";
import type { ClientQueryResponse, ClientRequestResponse, Query } from "packages/raft/query";
import type { Command } from "packages/raft/command";

export class MemoryPeer implements Peer {
    id: string;
    private network: BaseNetwork;
    constructor(
      id: string,
      network: BaseNetwork
    ){
      this.id = id;
      this.network = network;
    }
    async requestVote(req: RequestVote, f: (response: RequestVoteResponse) => void): Promise<void> {
      f(
        await this.network.requestVoteFromNode(
          this.id,
          req
        )
      )
    }
    async appendEntries(req: AppendEntryRequest, f: (response: AppendEntryResponse) => void): Promise<void> {
      f(
        await this.network.appendEntriesToNode(
          this.id,
          req
        )
      )
    }
    async addServer(req: AddServer): Promise<MemberShipChangeResponse> {
      return this.network.addServerToNode(
        this.id,
        req
      )
    }
    leaveServer(req: LeaveServer): Promise<MemberShipChangeResponse> {
      return this.network.removeServerFromNode(this.id,req);
    }
    
    public async clientQuery(query: Query): Promise<ClientQueryResponse<any>> {
      const response = this.network.clientQueryToNode(this.id, query);
      return response;
    }
    public async clientRequest(
      request: Command<any>
    ): Promise<ClientRequestResponse> {
      const response = await this.network.clientRequestToNode(
        this.id,
        request
      );
      return response;
    }
}