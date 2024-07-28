import type { LogEntry } from "../Log";

export class AppendEntryRequest {
  public term: number;
  public leaderId: string;
  public prevLogIndex: number;
  public prevLogTerm: number;
  public entries: LogEntry[];
  public leaderCommit: number;
  constructor(
    term: number,
    leaderId: string,
    prevLogIndex: number,
    prevLogTerm: number,
    entries: LogEntry[],
    leaderCommit: number
  ){
    this.term = term
    this.leaderId = leaderId
    this.prevLogIndex = prevLogIndex
    this.prevLogTerm = prevLogTerm
    this.entries = entries
    this.leaderCommit = leaderCommit
  }
}

export class AppendEntryResponse {
  public term: number;
  public success:boolean
  constructor(
    term: number,
    success:boolean
  ){
    this.term = term
    this.success = success
  }
}