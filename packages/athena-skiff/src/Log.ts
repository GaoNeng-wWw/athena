import { rejects } from 'assert';
import type {Node} from './node';
export interface Response {
  address:string;
  ack: boolean
}
export interface IEntry<T=object> {
  index: number;
  term: number;
  committed: boolean;
  response: Response[];
  command: T
}

export interface StreamCondition {
  gt: number,
  reverse: boolean,
  limit: number,
  lt: number,
  gte: number;
  lte: number;
}
export interface ReadStream<V=string,E=Error> {
  data: (data: {value:V})=>void;
  error: (error: E) => void;
  end: () => void
}
export interface On<V=string,E=Error> {
  on: (
    (
      (type: 'data', f: (data: {value: V})=>void) => On<V,E>
    ) & 
    (
      (type: 'error', f: (err: E) => void) => On<V,E>
    ) & 
    (
      (type: 'end', f: ()=>void) => On<V,E>
    )
  )
}

export abstract class Storage<K=any, V=any, E=Error> {
  abstract get(key: K):Promise<V> | V;
  abstract put(key:K, value: V): Promise<V> | V;
  abstract getMany(start?:number, limit?:number):Promise<V[]> | V[];
  abstract readStream<V, E=Error>(condition: Partial<StreamCondition>):On<V,E>;
  abstract close():Promise<boolean> | boolean;
  abstract remove(key:K):Promise<void>|void;
  abstract has(key:K):Promise<boolean>|boolean
};

export class Entry<U> implements IEntry<U> {
  index: number;
  term: number;
  committed: boolean;
  response: Response[];
  command: U;
  constructor(
    index: number,
    term: number,
    committed: boolean,
    response: Response[],
    command: U,
  ){
    this.index=index;
    this.term = term;
    this.committed = committed;
    this.response = response;
    this.command=command;
  }
  static of<T>(
    data: {
      index: number,
      term: number,
      committed: boolean,
      response: Response[],
      command: T,
    }
  ){
    return new Entry(
      data.index,
      data.term,
      data.committed,
      data.response,
      data.command
    )
  }
}

export class Log<K=any,V=any,E=Error> {
  public node:Node;
  public storage:Storage;
  public committedIndex: number=0;
  constructor(
    node:Node,
    storage:Storage
  ){
    this.node = node;
    this.storage = storage;
  }
  async saveCommand<T>(command: T, term: number, idx?: number){
    const entry = Entry.of({
      term,
      command,
      index:idx ? idx : (await this.getLastInfo()).index + 1,
      committed:false,
      response: [
        {
          address: this.node.address,
          ack: true
        }
      ]
    });
    return await this.put<T>(entry);
  }
  async put<T>(entry: IEntry<T>){
    return this.storage.put(entry.index, entry);
  }

  async getEntriesAfter<T=unknown>(idx: number){
    const entries:Entry<T>[] = [];
    return new Promise<Entry<T>[]>((resolve, reject) =>{
      this.storage.readStream<Entry<T>, Error>({gt: idx})
      .on('data', (data)=>{
        entries.push(data.value);
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('end', ()=>{
        resolve(entries);
      })
    })
  }
  async removeEntriesAfter(index: number){
    const entries = await this.getEntriesAfter(index);
    return Promise.all(
      entries.map(entry => {
        return this.storage.remove(entry.index);
      })
    )
  }
  async has(index: number){
    return await this.storage.has(index);
  }
  async get<T>(index: number): Promise<T>{
    return this.storage.get(index);
  }
  async getLastInfo(){
    const {index, term} = await this.getLastEntry();
    return {
      index,
      term,
      committedIndex: this.committedIndex
    }
  }
  async getLastEntry(){
    return new Promise<IEntry<any>>((resolve,reject) => {
      let hasResolved = false;
      let entry:IEntry<any>;
      this.storage.readStream<IEntry<any>, Error>({
        reverse: true,
        limit: 1
      })
        .on('data', data => {
          hasResolved = true;
          entry = data.value;
        })
        .on('error', err => {
          hasResolved = true;
          reject(err)
        })
        .on('end', () => {
          resolve(entry);
        })
    })
  }
  async getEntryBefore(entry: IEntry<any>){
    const info:IEntry<any> = {
      index: 0,
      term: this.node.term,
      committed: false,
      response: [],
      command: undefined
    };
    if (entry.index === 1){
      return Promise.resolve(info);
    }
    return new Promise<IEntry<any>>((resolve,reject) => {
      let hasResolved = false;
      this.storage.readStream<IEntry<any>>({
        reverse: true,
        limit: 1,
        lt: entry.index
      })
      .on('data', (data) => {
        hasResolved = true;
        resolve(data.value);
      })
      .on('error', (err) => {
        hasResolved = true;
        reject(err);
      })
      .on('end', () => {
        if (!hasResolved) {
          resolve(info);
        }
      });
    })
  }
  async getEntryInfoBefore(entry: IEntry<any>) {
    const {index, term} = await this.getEntryBefore(entry);
    return {
      index,
      term,
      committedIndex: this.committedIndex
    }
  }
  async commandAck(index: number, address: string){
    let entry;
    try {
      entry = await this.get<Entry<any>>(index);
    } catch {
      return new Entry(index, 0, false, [], '');
    }

    const entryIndex = entry.response.findIndex(resp => resp.address === address);
    if (entryIndex !== -1){
      entry.response.push({
        address,
        ack: true
      });
    }
    await this.put(entry);
    return entry;
  }
  async commit(idx: number){

    const entry = await this.storage.get(idx) as IEntry;
    entry.committed = true;
    this.committedIndex = entry.index;
    return this.put(entry);
  }
  end(){
    return this.storage.close()
  }
  clone(node:Node, storage:Storage){
    return new Log(node, storage);
  }
  getUncommittedEntriesUpToIndex(index: number){
    return new Promise<Entry<any>[]>((resolve,reject) => {
      const entries: Entry<any>[] = [];
      this.storage.readStream<Entry<any>, Error>({
        gt: this.committedIndex,
        lte: index
      })
      .on('data', (data)=>{
        if (!data.value.committed){
          entries.push(data.value);
        }
      })
      .on('error', (err)=>{
        reject(err);
      })
      .on('end',()=>{
        resolve(entries);
      })
    })
  }
}