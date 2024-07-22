import { EventEmitter } from "events";
import {v7 as uuid} from 'uuid';
import ms from 'ms';
import type { Log } from "./Log";
import {Tick} from './timer';
interface Election {
  max: number;
  min: number;
}
interface Votes {
  for: string | null;
  granted: number
}
interface Options {
  address: string;
  heartbea: number;
  election: Election;
  threshold: number;
  Log: any;
  state: any;
  write: ()=>void
}

export enum STATES {
  STOPPED,
  LEADER,
  CANDIDATE,
  FOLLOWER,
  CHILD
}

export class Node extends EventEmitter {
  public votes: Votes;
  public address: string;
  public election: {
    max: number;
    min: number;
  };
  public write: null | (()=>void);
  public threshold: number;
  public timer: Tick;
  public change: any;
  public emits: any;
  public latency: number;
  public log: Log | null;
  public nodes: Node[];
  public state: STATES;
  public leader: string;
  public term: number;
  public beat: number;
  constructor(
    address?: string,
    opts: Partial<Options> = {}
  ){
    super();
    this.election = {
      min: opts.election?.min ?? ms('150ms'),
      max: opts.election?.max ?? ms('150ms')
    };
    this.votes = {
      for: null,
      granted: 0
    }
    this.beat = opts.heartbea ?? ms('50ms')
    this.write = opts.write || null;
    this.threshold = opts.threshold ?? 0.8;
    this.address = address ?? uuid();
    this.timer = new Tick();
    this.latency = 0;
    this.log = null;
    this.nodes= [];
    this.state = opts.state ?? STATES.FOLLOWER;
    this.leader = '';
    this.term = 0;
    this.on('term change', ()=>{
      this.votes.for = null;
      this.votes.granted = 0;
    })
    this.on('state change', (state)=>{

    })
  }
  heartbeat(duration: number){
    duration = duration ?? this.beat;
    
  }
}