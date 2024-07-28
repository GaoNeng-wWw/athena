export enum MEMBERSHIP_CHANGE_RESPONSE_STATUS {
  OK,
  NOT_LEADER,
}

export class AddServer {
  server: string;
  constructor(server: string){
    this.server = server;
  }
}

export class LeaveServer {
  server: string;
  constructor(server: string){
    this.server = server;
  }
}

export class MemberShipChangeResponse {
  status: MEMBERSHIP_CHANGE_RESPONSE_STATUS;
  leaderHit: string;
  constructor(
    status: MEMBERSHIP_CHANGE_RESPONSE_STATUS,
    leaderHit: string
  ){
    this.status = status;
    this.leaderHit = leaderHit;
  }
}