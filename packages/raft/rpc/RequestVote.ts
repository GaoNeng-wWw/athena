export class RequestVote {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
  constructor(
    term: number,
    candidateId: string,
    lastLogIndex: number,
    lastLogTerm: number,
  ){
    this.term = term;
    this.candidateId = candidateId;
    this.lastLogIndex = lastLogIndex;
    this.lastLogTerm = lastLogTerm;
  }
}

export class RequestVoteResponse {
  term: number;
  voteGranted: boolean
  constructor(
    term: number,
    voteGranted: boolean
  ) {
    this.term = term;
    this.voteGranted = voteGranted;
  }
}