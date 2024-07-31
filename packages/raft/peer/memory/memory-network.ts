import type { Server } from "../../server";
import type { Command } from "../../command";
import type { ClientQueryResponse, ClientRequestResponse, Query } from "../../query";
import type { AppendEntryRequest, AppendEntryResponse } from "../../rpc/AppendEntries";
import type { AddServer, LeaveServer, MemberShipChangeResponse } from "../../rpc/membership";
import type { RequestVote, RequestVoteResponse } from "../../rpc/RequestVote";
import type { BaseNetwork } from "../network";
import type { MemoryServer } from "./memory-server";

export class MemoryNetwork implements BaseNetwork {
  public nodes: Map<string, Server> = new Map();
  public static instance: MemoryNetwork | undefined = undefined;

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
    const response = await this.nodes.get(nodeId)!.RequestVote(request);
    return response;
  }

  public async appendEntriesToNode(
    nodeId: string,
    request: AppendEntryRequest
  ): Promise<AppendEntryResponse> {
    const response = await this.nodes.get(nodeId)!.AppendEntries(request);
    return response;
  }

  public async addServerToNode(
    nodeId: string,
    request: AddServer
  ): Promise<MemberShipChangeResponse> {
    const response = await this.nodes.get(nodeId)!.AddServer(request);
    return response;
  }

  public async removeServerFromNode(
    nodeId: string,
    request: LeaveServer
  ): Promise<MemberShipChangeResponse> {
    const response = await this.nodes.get(nodeId)!.RemoveServer(request);
    return response;
  }

  public async clientQueryToNode(
    nodeId: string,
    query: Query
  ): Promise<ClientQueryResponse<string | boolean>> {
    const response = this.nodes.get(nodeId)!.ClientQuery(query);
    return response;
  }

  public async clientRequestToNode(
    nodeId: string,
    request: Command<any>
  ): Promise<ClientRequestResponse> {
    const response = await this.nodes.get(nodeId)!.ClientRequest(request);
    return response;
  }

  
  public async addServer(nodeId: string, server: Server) {
    this.nodes.set(nodeId, server);
  }
}
