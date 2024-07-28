import type { Command } from "packages/raft/command";
import type { ClientQueryResponse, ClientRequestResponse, Query } from "packages/raft/query";
import type { AppendEntryRequest, AppendEntryResponse } from "packages/raft/rpc/AppendEntries";
import type { AddServer, LeaveServer, MemberShipChangeResponse } from "packages/raft/rpc/membership";
import type { RequestVote, RequestVoteResponse } from "packages/raft/rpc/RequestVote";
import type { MemoryServer } from "./memory-server";

export class MemoryNetwork {
  public nodes: Record<string, MemoryServer> = {};
  private static instance: MemoryNetwork | undefined = undefined;
  private constructor() {}

  public static getNetwork() {
    if (!this.instance) {
      this.instance = new MemoryNetwork();
    }
    return this.instance;
  }

  // return new instance each time its called
  public static getTestNetwork() {
    this.instance = new MemoryNetwork();
    return this.instance;
  }

  public async requestVoteFromNode(
    nodeId: string,
    request: RequestVote
  ): Promise<RequestVoteResponse> {
    const response = await this.nodes[nodeId].RequestVote(request);
    return response;
  }

  public async appendEntriesToNode(
    nodeId: string,
    request: AppendEntryRequest
  ): Promise<AppendEntryResponse> {
    const response = await this.nodes[nodeId].AppendEntries(request);
    return response;
  }

  public async addServerToNode(
    nodeId: string,
    request: AddServer
  ): Promise<MemberShipChangeResponse> {
    const response = await this.nodes[nodeId].AddServer(request);
    return response;
  }

  public async removeServerFromNode(
    nodeId: string,
    request: LeaveServer
  ): Promise<MemberShipChangeResponse> {
    const response = await this.nodes[nodeId].RemoveServer(request);
    return response;
  }

  public async clientQueryToNode(
    nodeId: string,
    query: Query
  ): Promise<ClientQueryResponse<any>> {
    const response = this.nodes[nodeId].ClientQuery(query);
    return response;
  }

  public async clientRequestToNode(
    nodeId: string,
    request: Command<any>
  ): Promise<ClientRequestResponse> {
    const response = await this.nodes[nodeId].ClientRequest(request);
    return response;
  }

  
  public async addServer(nodeId: string, server: MemoryServer) {
    this.nodes[nodeId] = server;
  }
}
