import type { Command } from "./command";
import { CommandType, membershipAddCommand, membershipRemoveCommand, noopCommand } from "./command";
import type { LogEntry } from "./Log";
import type { ClientQueryResponse, ClientRequestResponse, Query } from "./query";
import { QueryType } from "./query";
import type { AppendEntryResponse } from "./rpc/AppendEntries";
import { AppendEntryRequest } from "./rpc/AppendEntries";
import { MEMBERSHIP_CHANGE_RESPONSE_STATUS, type AddServer, type LeaveServer, type MemberShipChangeResponse } from "./rpc/membership";
import type { RequestVoteResponse } from "./rpc/RequestVote";
import { RequestVote } from "./rpc/RequestVote";
import type { Server } from "./server";
import type { StateMachine } from "./state-machine";
import type { BaseStore, Pair } from "./store";

export enum State {
  FOLLOWER='FOLLOWER',
  CANDIDATE='CANDIDATE',
  LEADER='LEADER'
}

export interface ElectionOptions {
  min: number;
  max: number;
}

export interface HeartBeatOptions {
  min: number;
  max: number
}

export const getRandomTimeout = (min: number, max: number) => Math.round(Math.random() * min + (max - min));

export abstract class Peer {
  abstract id: string;
  constructor(id: string){}
  abstract requestVote(
    req: RequestVote,
    f: (response: RequestVoteResponse) => void
  ):void;
  abstract appendEntries(
    req: AppendEntryRequest,
    f: (response: AppendEntryResponse) => void
  ): void;

  abstract addServer(req: AddServer): Promise<MemberShipChangeResponse>;
  abstract leaveServer(req: LeaveServer): Promise<MemberShipChangeResponse>;
  abstract clientQuery(request: Query): Promise<ClientQueryResponse<any>>;
  abstract clientRequest(request: Command<any>): Promise<ClientRequestResponse>;
}

export class Raftnode {
  public state!: State;
  public peers: Peer[] = [];
  public electionOptions: ElectionOptions;
  public heartBeatOptions: HeartBeatOptions;
  public leader: boolean;
  public id: string;
  public server: Server;
  public stateMachine: StateMachine;
  public store: BaseStore<any, any>;
  public electionTimeout: NodeJS.Timeout | null = null;
  public heartbeatInterval: NodeJS.Timeout | null = null;
  public vote: number = 0;
  public voteCount: number = 0;
  public factory: (id: string) => Peer
  constructor(
    id: string,
    stateMachine: StateMachine,
    store: BaseStore<any, any>,
    server: Server,
    factory: (id: string) => Peer,
    electionOptions: ElectionOptions = {
      min: 150,
      max: 300
    },
    heartBeatOptions: HeartBeatOptions = {
      min: 100,
      max: 100
    },
    leader: boolean=false,
  ){
    this.id = id;
    this.server = server;
    this.stateMachine = stateMachine;
    this.leader = leader;
    this.store = store;
    this.electionOptions = electionOptions;
    this.heartBeatOptions = heartBeatOptions;
    this.server = server;
    this.server.listen(this);
    if (this.leader){
      this.becomeFollower();
    }
    this.factory=factory;
  }
  private resetElectionTimeout(){
    if (this.electionTimeout){
      clearTimeout(this.electionTimeout);
    }
    this.electionTimeout = setTimeout(async () => {
      this.becomeCandidate()
    }, /*TODO: random in [electionOptions.min, electionOptions.max]*/150);
  }
  private async leaderHeartbeats(){
    this.heartbeatInterval = setInterval(async ()=>{
      await this.sendHeartBeats();
    }, /*TODO: random get*/150)
  }
  private async becomeCandidate(){
    this.clearHeartbeatInterval()
    this.changeState(State.CANDIDATE);
    await this.stateMachine.IncrementCurrentTerm();
    this.vote = 0;
    this.voteCount = 0;
    // vote for itself:
    this.vote++;
    await this.stateMachine.setVotedFor(this.id);
    this.resetElectionTimeout();
    // request votes:
    this.requestVote();
  }
  private async becomeLeader(){
    this.clearTimeout();
    this.changeState(State.LEADER);
    await this.stateMachine.reset();
    
    await this.stateMachine.appendEntries([
      {
        term: await this.stateMachine.getCurrentTerm(),
        command: noopCommand(this.id)
      }
    ]);
    await this.leaderHeartbeats();
  }
  private async higherTerm(term: number){
    await this.stateMachine.setVotedFor(null);
    await this.stateMachine.setCurrentTerm(term);
    this.becomeFollower();
  }
  private becomeFollower(){
    this.clearHeartbeatInterval()
    this.changeState(State.FOLLOWER);
    this.resetElectionTimeout();
  }
  private async requestVote(){
    const term = await this.stateMachine.getCurrentTerm();
    const lastLog = await this.stateMachine.getLastLogEntry();
    const lastLogIndex = await this.stateMachine.getLastIndex();
    const request = new RequestVote(
      term,
      this.id,
      lastLogIndex,
      lastLog.term
    );
    for (const peer of this.peers){
      peer.requestVote(
        request,
        this.voteRceive(term).bind(this)
      )
    }
  }
  private voteRceive(
    electionTerm: number
  ): (res: RequestVoteResponse)=>Promise<void>{
    return async (res: RequestVoteResponse) => {
      const term = await this.stateMachine.getCurrentTerm();
      if (
        electionTerm !== term || this.state !== State.CANDIDATE
      ) {
        return;
      }
      if (res.voteGranted){
        this.vote++;
      } else {
        this.voteCount ++;
      }
      if (res.term > electionTerm) {
        await this.higherTerm(res.term);
      }
      if (
        this.vote >= this.quorum() && this.state === State.CANDIDATE
      ) {
        await this.becomeLeader()
      }
    }
  }
  async sendHeartBeats(){
    const term = await this.stateMachine.getCurrentTerm();
    const leaderCommit = this.stateMachine.getCommitIndex();

    for (let i=0;this.peers.length;i++){
      const peer = this.peers[i];
      const logs = await this.stateMachine.getLog();
      let prevLogTerm = -1;
      const nextIndex = this.stateMachine.getNextIndex(peer.id);
      const prevLogIndex = nextIndex - 1;
      if (prevLogIndex >= 0){
        const log = await this.stateMachine.getLogAtIndex(prevLogIndex);
        prevLogTerm = log.term;
      }
      const entries: LogEntry[] = logs.length > nextIndex ? [logs[nextIndex]] : [];
      const request = new AppendEntryRequest(
        term,
        this.id,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit
      )
      if (entries.length) {
        // 
      }
      peer.appendEntries(
        request,
        this.appendEntryResponseReceived(
          request.entries,
          peer.id,
          term
        ).bind(this)
      )
    }


    const currentTerm = await this.stateMachine.getCurrentTerm();
    if (this.state === State.LEADER && term === currentTerm) {
      const commitIdx = this.stateMachine.getCommitIndex();
      const logs = await this.stateMachine.getLog();
      for (let i=commitIdx + 1; i < logs.length; i++){
        const log = logs[i];
        if (log.term === currentTerm){
          let matched = 1;
          for (let i=0;i<this.peers.length;i++){
            const matchedIndex = this.stateMachine.getMatchIndex(
              this.peers[i].id
            );
            if (matchedIndex >= i){
              matched ++;
            }
            if (matched >= this.quorum()){
              this.stateMachine.setCommitIndex(i);
            }
          }
        }
      }
      await this.applyLogs()
    }
  }

  public async addServer(
    req: AddServer
  ){
    const leader = this.stateMachine.getLeaderId()??'';
    const res:MemberShipChangeResponse = {
      status: MEMBERSHIP_CHANGE_RESPONSE_STATUS.OK,
      leaderHit: leader
    };
    if (this.state !== State.LEADER){
      res.status = MEMBERSHIP_CHANGE_RESPONSE_STATUS.NOT_LEADER;
      return res;
    }
    const term = await this.stateMachine.getCurrentTerm();
    await this.stateMachine.appendEntries([
      {
        term: term,
        command: membershipAddCommand(req.server)
      }
    ])
    this.addPeer(req.server);
    return res;
  }
  public async removeServer(
    req: LeaveServer
  ){
    const leader = this.stateMachine.getLeaderId() ?? '';
    const response:MemberShipChangeResponse = {
      status: MEMBERSHIP_CHANGE_RESPONSE_STATUS.OK,
      leaderHit: leader,
    };
    if (this.state !== State.LEADER){
      response.leaderHit = leader;
      response.status= MEMBERSHIP_CHANGE_RESPONSE_STATUS.NOT_LEADER;
      return response;
    }

    const term = await this.stateMachine.getCurrentTerm();
    await this.stateMachine.appendEntries([
      {
        term,
        command: membershipRemoveCommand(req.server)
      }
    ]);
    this.removePeer(req.server);
    return response;
  }

  public async requestVoteHandler(
    req: RequestVote
  ){
    this.resetElectionTimeout();
    let term = await this.stateMachine.getCurrentTerm();
    const lastLog = await this.stateMachine.getLastLogEntry();
    const lastLogTerm = lastLog.term;
    const lastLogIdx = await this.stateMachine.getLastIndex();

    const res: RequestVoteResponse = {
      voteGranted: false,
      term: 0
    };
    if (req.term < term){
      res.voteGranted = false;
    } else {
      if (req.term > term) {
        await this.higherTerm(req.term);
      }
      term = req.term;

      const votedFor = await this.stateMachine.getVotedFor();
      if (!votedFor || votedFor === req.candidateId){
        if ( req.lastLogTerm > lastLogTerm ||
          (req.lastLogTerm === lastLogTerm &&
            req.lastLogIndex >= lastLogIdx) 
          ) {
            res.voteGranted =true;
            if (votedFor === null){
              await this.stateMachine.setVotedFor(req.candidateId);
            }
          } else {
            res.voteGranted = false;
          }
      } else {
        res.voteGranted = false;
      }
    }
    res.term = term;
    return res;
  }

  async appendEntry(req: AppendEntryRequest):Promise<AppendEntryResponse> {
    this.resetElectionTimeout();
    const term = await this.stateMachine.getCurrentTerm();
    const commitIndex = this.stateMachine.getCommitIndex();
    const prevLogEntry = await this.stateMachine.getLogAtIndex(
      req.prevLogIndex
    );
    const response:AppendEntryResponse = {
      term,
      success: true
    };
    if (
      req.term > term ||
      (req.term === term && this.state !== State.FOLLOWER )
    ){
      await this.stateMachine.setCurrentTerm(req.term);
      this.becomeFollower();
    } else if (term > req.term) {
      response.success=false;
      return response;
    }

    if (!prevLogEntry){
      response.success = false;
      return response;
    }

    if (
      this.stateMachine.getLeaderId() !== req.leaderId
    ) {
      this.stateMachine.setLeaderId(req.leaderId);
    }
    if (prevLogEntry.term !== req.prevLogTerm) {
      await this.stateMachine.deleteFromIndexMovingForward(
        req.prevLogIndex
      );
    }
    await this.stateMachine.appendEntries(req.entries);

    const lastIndex = await this.stateMachine.getLastIndex();

    if (req.leaderCommit > commitIndex) {
      this.stateMachine.setCommitIndex(
        Math.min(req.leaderCommit, lastIndex)
      )
    }
    await this.applyLogs();
    return response;
  } 

  private clearHeartbeatInterval(){
    if (this.heartbeatInterval){
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  private clearTimeout(){
    if (this.electionTimeout){
      clearTimeout(this.electionTimeout);
      this.electionTimeout = null;
    }
  }
  private quorum(){
    return Math.floor((this.peers.length + 1) / 2) + 1;
  }
  private changeState(state:State){
    this.state = state;
  }
  private appendEntryResponseReceived(
    entries: LogEntry[],
    peerId: string,
    sentAtTerm: number
  ){
    return async (
      res: AppendEntryResponse
    ) => {
      const term = await this.stateMachine.getCurrentTerm();
      if (
        this.state !== State.LEADER || term !== sentAtTerm
      ) {
        return;
      }
      if (res.term > term) {
        this.becomeFollower();
        return;
      }
      if (!res.success){
        this.stateMachine.setNextIndex(
          peerId,
          this.stateMachine.getNextIndex(peerId) - 1
        )
        return;
      }
      if (!entries.length){
        return;
      }
      const nextIdx = this.stateMachine.getNextIndex(peerId) + entries.length;
      this.stateMachine.setNextIndex(
        peerId,
        nextIdx
      );
      this.stateMachine.setMatchIndex(peerId, nextIdx - 1);
    }
  }
  private async applyLogs(){
    const commitIndex = this.stateMachine.getCommitIndex();
    let lastApplied = this.stateMachine.getLastApplied();
    if (commitIndex > lastApplied) {
      const logs = await this.stateMachine.getLog();
      const logsToBeApplied = logs.slice(lastApplied + 1);

      for (let i = 0; i < logsToBeApplied.length; i++) {
        const log = logsToBeApplied[i];
        this.logApplier(log);
        lastApplied += 1;
        this.stateMachine.setLastApplied(lastApplied);
      }
    }
  }

  async start(){
    await this.server.listen(this);
    if (this.leader) {
      await this.stateMachine.appendEntries([
        {
          term: 0,
          command: membershipAddCommand(this.id) // 
        }
      ])
    }
  }

  private addPeer(serverIdentifier: string) {
    const peerIndex = this.peers.findIndex(
      (peer) => peer.id == serverIdentifier
    );
    if (peerIndex > -1) {
      this.peers.splice(peerIndex, 1);
    }

    const peer = this.factory(serverIdentifier);

    this.stateMachine.setNextIndex(peer.id, 0);
    this.stateMachine.setMatchIndex(peer.id, -1);
    this.peers.push(peer);
  }

  private removePeer(serverIdentifier: string) {
    const peerIndex = this.peers.findIndex(
      (peer) => peer.id == serverIdentifier
    );
    if (peerIndex > -1) {
      this.peers.splice(peerIndex, 1);
    }
  }
  private membershipAdd(id: string){
    const peerIdx = this.peers.findIndex(peer => peer.id === id);
    if (peerIdx > -1){
      this.peers = this.peers.toSpliced(peerIdx, 1);
    }
    const peer = this.factory(id);
    this.peers.push(peer);
  }
  private membershipRemove(id: string){
    const peerIndex = this.peers.findIndex(
      (peer) => peer.id == id
    );
    if (peerIndex > -1) {
      this.peers.splice(peerIndex, 1);
    }
  }
  private isLeader(){
    return this.state === State.LEADER;
  }
  public async handleClientReq(
    command: Command<any>
  ): Promise<ClientRequestResponse>{
    const leaderId = this.stateMachine.getLeaderId() ?? '';
    if (this.isLeader()){
      const term = await this.stateMachine.getCurrentTerm();
      await this.stateMachine.appendEntries(
        [
          {
            term: term,
            command
          }
        ]
      );
      return {
        status: true,
        leaderHint: leaderId
      }
    }
    return {status: false, leaderHint: leaderId}
  }

  public async handleClientQuery(
    query: Query
  ):Promise<ClientQueryResponse<string | boolean>>{
    const leaderId = this.stateMachine.getLeaderId() ?? '';
    if (this.isLeader()){
      let value: string | boolean = '';
      switch (query.type) {
        case QueryType.GET:
          value = await this.store.get(query.data.key);
          break
        case QueryType.HGET:
          value = await this.store.hget(query.data.ns, query.data.key);
          break;
        case QueryType.SHAS:
          value = await this.store.shas(query.data.ns, query.data.value);
          break;
      }
      return {
        status: true,
        leaderHint: leaderId,
        response: value === null ? '' : value
      }
    }
    return {
      status: false,
      leaderHint: leaderId,
      response: ''
    }
  }

  stopListen(){
    this.clearTimeout();
    this.clearHeartbeatInterval
  }

  private logApplier(
    logEntry: LogEntry<
      string &
      {key: string, value:string} &
      {key: string} &
      {ns: string, pairs: Pair} &
      {ns: string, keys: string[]} & 
      {ns: string, values: string[]}
    >
  ){
    switch (logEntry.command.type) {
      case CommandType.STORE_SET: {
        const {command} = logEntry;
        const data = command.data as {key: string, value:string};
        this.store.set(data.key, data.value)
        break;
      }
      case CommandType.STORE_DEL: {
        const data = logEntry.command.data;
        this.store.del(data.key);
        break;
      }
      case CommandType.STORE_HSET: {
        const pairs = logEntry.command.data.pairs;
        this.store.hset(logEntry.command.data.ns, pairs);
        break;
      }
      case CommandType.STORE_HDEL: {
        this.store.hdel(logEntry.command.data.ns, logEntry.command.data.keys);
        break;
      }
      case CommandType.NOOP:{
        break;
      }
      case CommandType.MEMBERSHIP_ADD:{
        if (logEntry.command.data !== this.id){
          this.membershipAdd(logEntry.command.data);
        }
        break;
      }
      case CommandType.MEMBERSHIP_REMOVE:{
        this.membershipRemove(logEntry.command.data);
        break;
      }
      case CommandType.STORE_SSET:{
        this.store.sdel(
          logEntry.command.data.ns,
          logEntry.command.data.values
        )
        break;
      }
      case CommandType.STORE_SEDEL:{
        const sdelValues = logEntry.command.data.values;
        this.store.sdel(logEntry.command.data.ns, sdelValues);
        break;
      }
      default:{
        throw new Error(`Unhandle command: ${logEntry.command}`);
      }
    }
  }
}