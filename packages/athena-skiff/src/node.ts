import { EventEmitter } from "events";
import {v7 as uuid} from 'uuid';
import ms from 'ms';
import type { IEntry, Log } from "./Log";
import {Tick} from './timer';
import { one } from "./once";
interface Election {
  max: number;
  min: number;
}
interface Votes {
  for: string | null;
  granted: number
}

type MessageCallback = (
  errors: {
    [x:string]: Error
  },
  results: {
    [x:string]: object
  }
) => void;

interface Options {
  address: string;
  heartbea: number;
  election: Election;
  threshold: number;
  state: any;
  write: (data: object, cb: (error: Error,data:object)=>void)=>void;
}
interface ClonOptions extends Partial<Options> {
  log: Log
}

export enum State {
  STOPPED,
  LEADER,
  CANDIDATE,
  FOLLOWER,
  CHILD
}
interface Packet {
  state: State;
  term: number;
  address: string,
  type: string,
  leader: string,
  last: any;
  data: {
    [x:string | number]: any
  } | null
}
interface WrappedPacket<T=any,D=object> {
  state: State,
  term: number,
  address:string,
  type: string,
  leader: string,
  last?: { index: number; term: number; committedIndex: number; },
  data?: D
}
export class Node extends EventEmitter {
  public votes: Votes;
  public address: string;
  public election: {
    max: number;
    min: number;
  };
  public write: Options['write'] | null;
  public threshold: number;
  public timer: Tick;
  public change: any;
  public emits: any;
  public latency: number;
  public log!: Log;
  public nodes: Node[];
  public state: State;
  public leader: string;
  public term: number;
  public beat: number;
  constructor(
    address?: string,
    opts: Partial<Options> = {},
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
    this.nodes= [];
    this.state = opts.state ?? State.FOLLOWER;
    this.leader = '';
    this.term = 0;
    this._init(opts);
  }
  private _init(options: Partial<Options> = {}){
    this.on('term change', ()=>{
      this.votes.for = null;
      this.votes.granted = 0;
    })
    this.on('state change', (state)=>{
      this.timer.clear('heartbeat', 'election');
      this.heartbeat(
        this.state === State.LEADER ? this.beat : this.timeout()
      );
      this.emit(
        State[state].toLowerCase()
      );
    })
    this.on('data', async (packet:Packet, write)=>{
      write = write ?? (()=>{});
      let reason;
      if (this.type(packet) !== 'object'){
        reason = 'Invalid packet';
        this.emit('error', new Error(reason));
        return write(await this.packet('error', reason))
      }
      if (packet.term > this.term) {
        this.change({
          leader: packet.state === State.LEADER ? packet.address : packet.leader ?? this.leader,
          state: State.FOLLOWER,
          term: packet.term,
        })
      }
      if (packet.term < this.term){
        reason = `Received term ${packet.term}, but we are at ${this.term}`;
        this.emit('error', new Error(reason));
        return write(this.packet('error', reason));
      }
      if (packet.state === State.LEADER) {
        if (this.state !== State.FOLLOWER){
          this.change({state:State.FOLLOWER});
        }
        if(packet.address !== this.leader){
          this.change({leader: packet.address})
        }
        this.heartbeat(this.timeout());
      }
      switch (packet.type.toLowerCase()) {
        case 'vote': {
          if (this.votes.for && this.votes.for !== packet.address){
            this.emit('vote', packet);
            return write(await this.packet('voted', { granted: false }), false)
          }

          if (this.log) {
            const {index,term} = await this.log.getLastInfo();
            if (index > packet.last.index && term > packet.last.term){
              this.emit('vote', packet, false);
              return write(await this.packet('voted', { granted: false }));
            }
          }

          this.votes.for = packet.address;
          this.emit('vote', packet, true);
          this.change({leader: packet.address, term: packet.term});
          write(await this.packet('voted', { granted: true }));

          this.heartbeat(this.timeout());
          break;
        }

        case 'voted': {
          if (this.state !== State.CANDIDATE){
            return write(await this.packet('error', 'No longer a candidate, ignoring vote'));
          }

          if (packet.data?.granted){
            this.votes.granted ++;
          }

          if (this.quorum(this.votes.granted)){
            this.change({leader: this.address, state: State.LEADER});
            this.message(State.FOLLOWER, await this.packet('append'), ()=>{});
          }


          write();
          break
        }

        case 'error': {
          this.emit('error', new Error(JSON.stringify(packet.data)));
        }

        case 'append': {
          const {index} = await this.log.getLastInfo();
          if (index !== packet.last.index && packet.last.index !== 0){
            const hasLog = await this.log.has(packet.last.index);
            if (hasLog){
              this.log.remoevEntriesAfter(packet.last.index);
            } else {
              const appendFail = await this.packet('append fail', {
                term: packet.last.term,
                index: packet.last.index
              })
              return this.message(State.LEADER, await this.packet('append fail', appendFail), ()=>{});
            }
          }

          if (packet.data){
            const entry = packet.data[0];
            await this.log.saveCommand(entry.command, entry.term, entry.index);

            const appendAck = await this.packet('append ack', {
              term: entry.term,
              index: entry.index
            })
            this.message(this.leader, appendAck, ()=>{});
          }

          if (this.log.committedIndex < packet.last.committedIndex) {
            const entries = await this.log.getUncommittedEntriesUpToIndex(packet.last.committedIndex);
            this.commitEntries(entries);
          }

          break;
        }

        case 'append ack': {
          const entry = await this.log.commandAck(packet.data!.index, packet.address);
          if (this.quorum(entry.response.length) && !entry.committed){
            const entries = await this.log.getUncommittedEntriesUpToIndex(entry.index);
            this.commitEntries(entries);
          }
          break;
        }

        case 'append fail': {
          const prevEntry = await this.log.get<any>(packet.data!.index);
          const append = await this.appendPacket(prevEntry);
          write(append);
          break;
        }

        case 'exec': {
          break;
        }

        default: {
          if (this.listeners('rpc').length){
            this.emit('rpc', packet, write);
          } else {
            write(await this.packet('error', `Unknown message type: ${packet.type}`));
          }
          break;
        }
      }
    })
    if (this.state === State.CHILD) {
      return this.emit('initialize')
    }
    
    this.emit('initialize')
    this.heartbeat(this.timeout())
  }
  setLog(log: Log){
    this.log = log;
  }
  type(of: any) {
    return Object.prototype.toString.call(of).slice(0,-1).toLowerCase();
  }
  quorum(responses: number) {
    if (!this.nodes.length || !responses){
      return false;
    }
    return responses >= this.majority();
  }
  majority() {
    return Math.ceil(this.nodes.length / 2)+1;
  }
  indefinitely(attempt?: Function, fn?: Function, timeout?: number) {
    this.try(attempt, fn, timeout)
  }
  private try(attempt?:Function ,fn?: Function, timeout?: number | number){
    const uid = uuid();
    const next = one((err:Error, data: any)=>{
      if (!this.timer){
        return;
      }
      this.timer.setImmediate(`${uid}@async`, ()=>{
        if (err){
          this.emit('error', err);
          return this.try();
        }
        fn?.(data);
      })
    })
    attempt?.call(this,next);
    this.timer.setTimeout(uid, ()=>{
      next(
        new Error('Timeout, please try agin')
      )
    }, +(timeout ?? this.timeout()));
  }
  heartbeat(duration: string|number) {
    if (this.timer.active('heartbeat')){
      this.timer.adjust('heartbeat', duration);
      return this;
    }
    this.timer.setTimeout('heartbeat', async ()=>{
      if (this.state === State.LEADER) {
        this.emit('heartbeat timeout');
        return this.promote();
      }
      const appendPacket = await this.packet('append');
      this.emit('heartbeat', appendPacket);
      this.message(State.FOLLOWER,appendPacket,()=>{})
      .heartbeat(this.beat);
    }, duration)
    return this;
  }
  message(to: State|string, data: any, callback: MessageCallback) {
    const nodes=[]
    const latency:number[] = [];
    const output:{
      errors: {
        [x:string]:Error
      },
      results: {
        [x:string]: object
      }
    } = {
      errors: {},
      results: {}
    }
    let errors = false;
    if (typeof to === 'number'){
      if (to === State.LEADER){
        nodes.push(
          ...this.nodes.filter(node => this.leader === node.address)
        )
      }
      if (to === State.FOLLOWER){
        nodes.push(
          ...this.nodes.filter(node => this.leader !== node.address)
        )
      }
      if (to === State.CHILD){
        nodes.push(...this.nodes);
      }
    } else if (typeof to === 'string') {
      nodes.push(
        ...this.nodes.filter(node => to === node.address)
      )
    }

    const wrapper = (client:Node,data:any) => {
      const start = +new Date();
      client.write?.(data, (err, res) => {
        latency.push(+new Date() - start);
        if (err){
          errors = true;
          output.errors[client.address] = err;
        } else {
          output.results[client.address] = res;
        }

        if (err){
          this.emit('error', err);
        } else if (data){
          this.emit('data', data);
        }

        if (latency.length === this.nodes.length){
          this.timing(latency);
          callback?.(output.errors, output.results);
          latency.length = 0;
          nodes.length = 0;
        }
      })
    }
    for (const node of nodes){
      wrapper(node, data);
    }
    return this;
  }
  timeout() {
    const {max,min} = this.election;
    return Math.floor(Math.random() * (max - min + 1) + min);
  }
  timing(latency: number[]=[]) {
    if (this.state === State.STOPPED) {
      return false;
    }
    const sum = latency.reduce((pre,cur) => pre+cur, 0);
    this.latency = Math.floor(sum / Math.max(latency.length, 1));
    if (this.latency > this.election.min * this.threshold){
      this.emit('threshold');
    }
    return true
  }
  async promote() {
    this.change({
      state: State.CANDIDATE,
      term: this.term + 1,
      leader: ''
    })
    this.votes.for = this.address;
    this.votes.granted = 1;

    const packet = await this.packet('vote');

    this.message(State.FOLLOWER,packet,()=>{});

    this.timer
    .clear('heartbeat', 'election')
    .setTimeout('election', this.promote, this.timeout())

    return this
  }
  async packet(type: string, data?: any) {
    const wrapped:WrappedPacket = {
      state: this.state,
      term: this.term,
      address: this.address,
      type,
      leader: this.leader,
    };
    if (this.log){
      wrapped.last = await this.log.getLastInfo();
    }
    if (data){
      wrapped.data = data;
    }
    return wrapped;
  }
  async appendPacket (entry: IEntry) {
    const last = this.log.getEntryBefore(entry);
    return {
      state: this.state,
      term: this.term,
      address: this.address,
      type: 'append',
      leader: this.leader,
      data: [entry],
      last
    }
  }
  clone(options: ClonOptions) {
    const node = new Node(
      this.address,
      options,
    );
    node.setLog(
      options.log
    )
    return node;
  }
  join(
    node:Node
  ) {
    if (node.address === this.address) {
      return;
    }
    node.once('end', ()=>{
      this.leave(node);
    });

    this.nodes.push(node);
    this.emit('join',node);
    return node;
  }
  leave(node: Node) {
    const i = this.nodes.indexOf(node);
    this.nodes.splice(i, 1);
    node.end();
    this.emit('leave', node);
    return node;
  }
  end() {
    if (this.state === State.STOPPED){
      return false;
    }
    this.change({state: State.STOPPED});
    if (this.nodes.length){
      for (const node of this.nodes){
        this.leave(
          node
        )
      }
    }

    this.emit('end');
    this.timer.end();
    this.removeAllListeners();
    if (this.log){
      this.log.end();
    }
    return true;
  }
  async command(command: any) {
    if (this.state !== State.LEADER){
      // throw NOT_LEADER ERROR
      return;
    }
    const entry = await this.log.saveCommand(command, this.term);
    const appendPacket = this.appendPacket(entry);
    this.message(State.FOLLOWER, appendPacket,()=>{});
  }
  async commitEntries (entries:IEntry[]) {
    entries.forEach(async (entry) => {
      await this.log.commit(entry.index);
      this.emit('commit', entry.command);
    })
  }
}