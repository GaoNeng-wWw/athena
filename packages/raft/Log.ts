import type { Term } from "./state-machine";

export interface LogEntry<T=any> {
  term: Term;
  command: any
}