import type { LogEntry } from "./Log";

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