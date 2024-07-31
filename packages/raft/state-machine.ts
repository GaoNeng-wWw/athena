import { readdirSync, unlinkSync } from "fs";
import type { LogEntry } from "./Log";
import {Config, JsonDB} from 'node-json-db';
import { join } from "path";

export type Term = number;
export abstract class StateMachine {
  abstract start(): Promise<void>
  abstract getCurrentTerm(): Promise<Term>;
  abstract setCurrentTerm(term: Term): Promise<void>;
  abstract IncrementCurrentTerm(): Promise<void>;
  abstract getVotedFor(): Promise<string>;
  abstract setVotedFor(nodeId: string | null): Promise<void>;
  abstract getLog(): Promise<LogEntry[]>;
  abstract deleteFromIndexMovingForward(index: number): Promise<void>;
  abstract appendEntries(logs: LogEntry[]): Promise<void>;
  abstract getLogAtIndex(index: number): Promise<LogEntry>;
  abstract getLastLogEntry(): Promise<LogEntry>;
  abstract getLastIndex(): Promise<number>;
  abstract getCommitIndex(): number;
  abstract setCommitIndex(index: number): void;
  abstract getLeaderId(): string | null;
  abstract setLeaderId(leaderId: string): void;
  abstract getLastApplied(): number;
  abstract setLastApplied(index: number): void;
  abstract getNextIndexes(): Record<string, number>;
  abstract getNextIndex(nodeId: string): number;
  abstract setNextIndex(nodeId: string, value: number): void;
  abstract getMatchIndex(nodeId: string): number;
  abstract getMatchIndexes(): Record<string, number>;
  abstract setMatchIndex(nodeId: string, value: number): void;
  abstract reset(): Promise<void>;
}

const persistentKeys = {
  CURRENT_TERM: "db.currentTerm",
  LOG: "db.log",
  VOTED_FOR: "db.votedFor",
};

export class LocalStateMachine implements StateMachine {
  private db!: JsonDB;
  private volatile: {
    leaderId: string | null;
    commitIndex: number;
    lastApplied: number;
    nextIndex: Record<string, number>;
    matchIndex: Record<string, number>;
  } = {
    commitIndex: -1,
    lastApplied: -1,
    nextIndex: {},
    matchIndex: {},
    leaderId: null,
  };
  constructor(private nodeId: string, private path = "db") {
    this.nodeId = nodeId;
    this.path = path;
  }

  public async start() {
    const directory = `./${this.path}`;
    try {
      const dirList = readdirSync(directory);
      if (dirList && dirList.length > 0) {
        for (const file of dirList) {
          unlinkSync(join(directory, file));
        }
      }
    } catch (error) {}
    this.db = new JsonDB(
      new Config(`${directory}/` + this.nodeId, true, false, ".")
    );
    await this.db.push(persistentKeys.CURRENT_TERM, -1);
    await this.db.push(persistentKeys.LOG, []);
    await this.db.push(persistentKeys.VOTED_FOR, null);
  }

  ///// Persistent /////
  public async getCurrentTerm(): Promise<number> {
    return await this.db.getData(persistentKeys.CURRENT_TERM);
  }
  public async setCurrentTerm(term: number): Promise<void> {
    return await this.db.push(persistentKeys.CURRENT_TERM, term);
  }
  public async IncrementCurrentTerm(): Promise<void> {
    return await this.db.push(
      persistentKeys.CURRENT_TERM,
      (await this.db.getData(persistentKeys.CURRENT_TERM)) + 1
    );
  }
  public async getVotedFor(): Promise<string> {
    return await this.db.getData(persistentKeys.VOTED_FOR);
  }
  public async setVotedFor(nodeId: string | null): Promise<void> {
    return await this.db.push(persistentKeys.VOTED_FOR, nodeId);
  }

  public async getLog(): Promise<LogEntry[]> {
    return await this.db.getData(persistentKeys.LOG);
  }

  public async getLogAtIndex(index: number): Promise<LogEntry> {
    const log = await this.db.getData(persistentKeys.LOG);
    const logEntry = log[index];
    if (!logEntry && index == -1) {
      return { term: -1, command: "" };
    }
    return log[index];
  }
  public async deleteFromIndexMovingForward(index: number): Promise<void> {
    console.log(
      `${this.nodeId} is deleting logs from index ${index} moving forward`
    );
    const log: Array<LogEntry> = await this.db.getData(persistentKeys.LOG);
    log.splice(index);
    await this.db.push(persistentKeys.LOG, log);
  }

  public async getLastLogEntry(): Promise<LogEntry> {
    const log = await this.db.getData(persistentKeys.LOG);
    console.log(`${this.nodeId} accessing last log entry`, log[log.length - 1]);
    const lastLog = log[log.length - 1];
    if (!lastLog) {
      return { term: -1, command: "" };
    }
    return log[log.length - 1];
  }

  public async getLastIndex(): Promise<number> {
    const log = await this.db.getData(persistentKeys.LOG);
    console.log(`${this.nodeId} accessing lastIndex`, log.length - 1);
    return log.length - 1;
  }

  public async appendEntries(logs: LogEntry[]): Promise<void> {
    if (logs.length) {
      console.log(`${this.nodeId} is appending entries`, JSON.stringify(logs, null, 2))
    }
    
    const _logs =[];
    try {
      const log = await this.db.getData(persistentKeys.LOG);
      if (log.length){
        _logs.push(...log)
      }
    } catch {}

    _logs.push(...logs);
    await this.db.push(persistentKeys.LOG, _logs);
  }

  ///// Volatile /////
  public getLeaderId(): string | null {
    return this.volatile.leaderId;
  }
  public setLeaderId(leaderId: string): void {
    this.volatile.leaderId = leaderId;
  }

  public getCommitIndex(): number {
    return this.volatile.commitIndex;
  }
  public setCommitIndex(index: number): void {
    this.volatile.commitIndex = index;
  }
  public getLastApplied(): number {
    return this.volatile.lastApplied;
  }
  public setLastApplied(index: number): void {
    this.volatile.lastApplied = index;
  }

  ///// Volatile Leader /////
  public getNextIndex(nodeId: string): number {
    return this.volatile.nextIndex[nodeId] !== undefined
      ? this.volatile.nextIndex[nodeId]
      : 0;
  }
  public getNextIndexes(): Record<string, number> {
    return this.volatile.nextIndex;
  }
  public setNextIndex(nodeId: string, value: number): void {
    console.log(`${this.nodeId} setting next of node ${nodeId} to ${value}`)
    this.volatile.nextIndex[nodeId] = value;
  }
  public getMatchIndex(nodeId: string): number {
    return this.volatile.matchIndex[nodeId] !== undefined
      ? this.volatile.matchIndex[nodeId]
      : -1;
  }
  public getMatchIndexes(): Record<string, number> {
    return this.volatile.matchIndex;
  }
  public setMatchIndex(nodeId: string, value: number): void {
    this.volatile.matchIndex[nodeId] = value;
  }
  public async reset(): Promise<void> {
    this.volatile.matchIndex = {};

    const lastIndex = await this.getLastIndex();
    for (const key in this.volatile.nextIndex) {
      this.volatile.nextIndex[key] = lastIndex + 1;
    }
  }
}