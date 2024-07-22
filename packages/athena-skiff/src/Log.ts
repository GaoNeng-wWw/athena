import type { Node } from "./node";

interface Entry {
  index: number;
  term: number;
  comitted: boolean;
  responses: {
    address: string;
    ack: boolean
  }[];
  command: object;
}
interface EntryInfo {
  index: number;
  term: number;
  comittedIndex: number;
}


interface Storgae<KD=string,VD=string> {
  set: <K=KD, V=VD>(key: K, value: V) => void | Promise<void>;
  setMany: <K=KD,V=VD>(data: {key:K,value:V}[]) => V[];

  del: <K=KD, V=VD>(key: K) => void | V;
  delMany: <K=KD[],V=VD>() => V[];
  
  update: <K=KD, V=VD>(key: K, val:V) => V;  

  get: <K=KD, V=VD>(key: K) => V
  getStart: <V=VD>(start: number) => V;

  // [start,end)
  getRange: <V=VD>(start: number, end: number) => V;
  getLast: <V=VD>() => V;
  getFirst: <V=VD>()=> V;
  getEntriesAfter: (index:number) => Promise<Entry> | Entry
  delAfter: (idx: number)=> void | Promise<void>;
  has: (idx: number) => boolean;
}

export class Log {
  private node:Node;
  private committedIndex: number;
  private storage: Storgae;
  constructor(
    node:Node,
    storage: Storgae
  ){
    this.node = node;
    this.committedIndex = 0;
    this.storage = storage;
  }
}