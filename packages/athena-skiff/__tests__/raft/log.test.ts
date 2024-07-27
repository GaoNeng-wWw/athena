import { EventEmitter } from "stream";
import { Entry, Log, type On, type StreamCondition } from "../../src/Log";
import type { IEntry, Storage } from "../../src/Log";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Node } from "../../src/node";

describe('mem', ()=>{
  let mem:MemStorage<number, string>;
  let log:Log<number, string, Error>;
  beforeEach(()=>{
    mem = new MemStorage();
    log = new Log<number, string, Error>(
      new Node('127.0.0.1'),
      mem
    )
  })
  class MemStorage<K=number,V=string|undefined> extends EventEmitter implements Storage {
    private map: Map<number,V> = new Map();
    private _condition: Partial<StreamCondition> = {};
    private lock: boolean = false;
    constructor(){
      super();
    }
    private _read(condition: Partial<StreamCondition>){
      const {
        lt = undefined,
        lte = undefined,
        limit = Infinity,
        gt = undefined,
        gte = undefined,
        reverse=false
      } = condition;
      const low = gt ?? gte ?? 0;
      const high = lt ?? lte ?? Infinity;
      const lowEq = gt === undefined;
      const highEq = lt === undefined;
      let count = 0;
      const entriesArray = Array.from(this.map.entries()).sort((a,b) => a[0] - b[0]);
      const entries = reverse ? entriesArray.toReversed() : entriesArray;
      for (const [idx, value] of entries){
        if (count === limit){
          this.emit('end');
          this.lock = false;
          return;
        }
        if (
          (lowEq ? idx >= low : idx > low) && (highEq ? idx <= high : idx < high)
        ) {
          this.emit('data', value);
          count ++;
        }
      }
      this.emit('end');
      this.lock = false;
    }
    get(key: number): Promise<Awaited<V> | undefined>{
      const val = Promise.resolve(this.map.get(key));
      return val;
    }
    put(key: number, value: V) {
      this.map.set(key, value);
    }
    getMany(start?: number, limit?: number): V[] | Promise<V[]> {
      const _start = start ?? 0;
      const _limit = limit ?? 0;
      const values:V[] = [];
      for (const [idx, value] of this.map.entries()){
        if (idx >= _start && idx < _limit){
          values.push(value);
        }
      }
      return values;
    }
    readStream<V, E = Error>(condition: Partial<StreamCondition>): On<V, E> {
      this._condition = condition;
      return {
        on: (name, fn) => {
          this.on(name, (val: V | E) => {
            if (name === 'data'){
              (fn as (value: {value: V})=>void)({value: val as V})
            }
            if (name === 'error'){
              (fn as (err: E) => void)(val as E);
            }
            if (name === 'end'){
              (fn as ()=>void)();
            }
          })
          if (name === 'end' && !this.lock){
            this.lock = true;
            try {
              this._read(this._condition);
            } catch (e) {
              this.emit('error', e);
            }
          }
          return this.readStream(condition);
        }
      };
    }
    close(): Promise<boolean> | boolean {
      return true;
    }
    remove(key: any): Promise<void> | void {
      this.map.delete(key);
    }
    has(key: any): Promise<boolean> | boolean {
      return this.map.has(key);
    }
  }
  it('should to be defined', ()=>{
    const mem = new MemStorage();
    expect(mem).toBeDefined();
  })
  it('put', ()=>{
    mem.put(1,'2');
    expect(mem.has(1)).toBeTruthy();
  })
  it('remove', ()=>{
    mem.put(1, '2');
    expect(mem.has(1)).toBeTruthy();
    mem.remove(1);
    expect(mem.has(1)).toBeFalsy();
  })
  it('getMany', async () => {
    for (let i=0;i<100;i++){
      mem.put(i, i.toString());
    }
    const res = await mem.getMany(0, 10);
    expect(res).toHaveLength(10);
    expect(res.at(9)).toBeDefined();
    expect(res.at(10)).toBeUndefined();
    expect(res.at(9)).toBe('9')
    const res2 = await mem.getMany(10,20);
    expect(res2).toBeDefined();
    expect(res2).toHaveLength(10);
    expect(res2[0]).toBe('10');
    expect(res2[9]).toBe('19');
  })
  describe('readStream', () =>{
    it('default limit 1', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream<string,Error>({
        lt: 10,
        limit: 1
      })
      .on('data', f)
      .on('end', () => {})
      expect(f).toHaveBeenCalledTimes(1);
    })
    it('[10,20]', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream<string,Error>({
        lte: 20,
        gte: 10,
      })
      .on('data', f)
      .on('end', () => {})
      expect(f).toBeCalledTimes(11);
    })
    it('(10,20]', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream<string,Error>({
        lte: 20,
        gt: 10,
      })
      .on('data', f)
      .on('end', () => {})
      expect(f).toBeCalledTimes(10);
    })
    it('[10,20)', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream<string,Error>({
        lte: 20,
        gt: 10,
      })
      .on('data', f)
      .on('end', () => {})
      expect(f).toBeCalledTimes(10);
      expect(f.mock.calls.at(-1)).toBeDefined()
      expect(f.mock.calls.at(-1)![0]).toStrictEqual({value: '20'})
      expect(f.mock.calls.at(0)![0]).toStrictEqual({value: '11'})
    })
    it('(10,20)', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream<string,Error>({
        lt: 20,
        gt: 10,
      })
      .on('data', f)
      .on('end', () => {})
      expect(f).toBeCalledTimes(9);
      expect(f.mock.calls.at(-1)).toBeDefined()
      expect(f.mock.calls.at(-1)![0]).toStrictEqual({value: '19'})
      expect(f.mock.calls.at(0)![0]).toStrictEqual({value: '11'})
    })
    it('(0, inf)', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream<string,Error>({
      })
      .on('data', f)
      .on('end', () => {})
      expect(f).toBeCalledTimes(100);
      expect(f.mock.calls.at(-1)).toBeDefined()
      expect(f.mock.calls.at(-1)![0]).toStrictEqual({value: '99'})
      expect(f.mock.calls.at(0)![0]).toStrictEqual({value: '0'})
    })
    it('(inf, inf)', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream<string,Error>({
        gte: 100
      })
      .on('data', f)
      .on('end', () => {})
      expect(f).toBeCalledTimes(0);
      expect(f.mock.calls.at(-1)).toBeUndefined();
    })
    it('reverse', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      mem.readStream({
        reverse: true,
        limit: 1
      })
      .on('data', (data) => {
        expect(data.value).toBe('99')
      })
      .on('end', () => {})
    })
    it('#end', ()=>{
      for (let i=0;i<100;i++){
        mem.put(i, i.toString());
      }
      const f = vi.fn();
      mem.readStream({
        reverse: true,
        limit: 1
      })
      .on('data', (data) => {
        expect(data.value).toBe('99')
      })
      .on('end', f);
      expect(f).toBeCalled();
    })
  })

  describe('log', ()=>{
    it('new Log() should to be defined', ()=>{
      expect(
        new Log(
          new Node('127.0.0.1'),
          mem
        )
      ).toBeDefined()
    })
    it('getEntriesAfter', async ()=>{
      for (let i=0;i<10;i++){
        const entry = new Entry(i,0,false,[],'');
        await log.put(entry)
      }
      expect(await log.getEntriesAfter(0)).toHaveLength(9);
      expect(await log.getEntriesAfter(4)).toHaveLength(5);
      expect(await log.getEntriesAfter(9)).toHaveLength(0);
    })
    it('removeEntriesAfter', async ()=>{
      for (let i=0;i<10;i++){
        const entry = new Entry(i,0,false,[],'');
        await log.put(entry)
      }
      await log.removeEntriesAfter(0);
      expect(log.has(0)).resolves.toBeTruthy();
      expect(log.has(1)).resolves.toBeFalsy();
      expect(log.has(9)).resolves.toBeFalsy();
    })
    describe('#get', ()=>{
      it('not exists', ()=>{
        expect(log.get<undefined>(-1)).resolves.toBeUndefined();
      })
      it('exists', async ()=>{
        const entry = new Entry(0,0,false,[],'');
        await log.put(entry)
        expect(log.get(0)).resolves.toStrictEqual(entry);
      })
    })
    it('#has', async ()=>{
      expect(log.has(0)).resolves.toBeFalsy();
      const entry = new Entry(0,0,false,[],'');
      await log.put(entry)
      expect(log.has(0)).resolves.toBeTruthy();
    })
    it('#saveCommand', async ()=>{
      await log.put(new Entry(0,0,false,[],''))
      await log.put(new Entry(1,0,false,[],''))
      await log.saveCommand('', 123);
      expect(log.has(0)).resolves.toBeTruthy();
      expect(log.has(2)).resolves.toBeTruthy();
      expect((await log.get<Entry<any>>(2)).term).toBe(123)
    })
    it('#getLastInfo', async () => {
      await log.put(new Entry(0,0,false,[],''))
      await log.put(new Entry(1,0,false,[],''))
      expect((await log.getLastInfo()).index).toBe(1);
      await log.removeEntriesAfter(0);
      expect((await log.getLastInfo()).index).toBe(0);
    })
    it.fails('#getLastInfo - empty', async ()=>{
      /**
       * FIXME:
       *  Cannot destructure property 'index' of '(intermediate value)' as it is undefined.
       */
      expect((await log.getLastInfo()).index).toBeUndefined();
    })
    it('#getLastEntry', async ()=>{
      await log.put(new Entry(0,0,false,[],''))
      await log.put(new Entry(1,0,false,[],''))
      expect(log.getLastEntry()).resolves.toBeInstanceOf(Entry);
    })
    it('#getEntryBefore', async ()=>{
      await log.put(new Entry(0,0,false,[],''))
      await log.put(new Entry(1,0,false,[],''))
      expect((await log.getEntryBefore(new Entry(1,0,false,[],''))).index).toBe(0);
    })
    it('#getEntryInfoBefore', async ()=>{
      await log.put(new Entry(0,0,false,[],''))
      await log.put(new Entry(1,0,false,[],''))
      expect(((await log.getEntryInfoBefore(new Entry(1,0,false,[],''))) as any).response).toBeUndefined();
      expect(((await log.getEntryInfoBefore(new Entry(1,0,false,[],''))) as any).committedIndex).toBeDefined();
    })
    describe('#commandAck', ()=>{
      it('not found entry', async ()=>{
        await log.put(new Entry(0,0,false,[],''))
        expect(
          (await log.commandAck(0, '')).response
        ).toHaveLength(0)
      })
      it('found entry', async ()=>{
        await log.put(
          new Entry(
            0,
            0,
            false,
            [
              {
                address: '127.0.0.1',
                ack: false
              }
            ],
            ''
          )
        )
        expect(
          (await log.commandAck(0, '127.0.0.1')).response[1].ack
        ).toBeTruthy()
      })
    })
    it('#commit', async ()=>{
      await log.put(new Entry(0,0,false,[],''))
      await log.put(new Entry(1,0,false,[],''))
      expect(await log.commit(0));
      expect((await log.get<IEntry<any>>(0)).committed).toBeTruthy();
    })
    it.skip('#end', () => {});
    it.skip('#clone', ()=>{})
    it('#getUncommittedEntriesUpToIndex', async ()=>{
      for (let i=0;i<100;i++){
        await log.put(new Entry(i ,0,false,[],''))
      }
      for (let i=0;i<50;i++){
        await log.commit(i);
      }
      const entries = await log.getUncommittedEntriesUpToIndex(100);
      expect(entries).toHaveLength(50)
      expect(entries[0].index).toBe(50);
    })
  })
})