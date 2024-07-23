import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Tick, Timer } from '../src/timer';
import ms from "ms";

describe('timer',()=>{
  let tick:Tick;
  beforeEach(()=>{
    tick = new Tick();
  })
  afterEach(()=>{
    tick.end();
  })
  it('should be instanceof Tick', ()=>{
    expect(tick).instanceof(Tick);
  })
  it('#taken', async ()=>{
    const timer = new Timer(undefined, undefined, 100, undefined);
    
    await (async ()=>{
      return new Promise((resolve)=>{
        setTimeout(() => {
          expect(timer.taken()).lte(15).and.gte(5);
          resolve(0);
        }, 10)
      })
    })()
  })
  it('remaining', async ()=>{
    const timer = new Timer(undefined, undefined, 100, undefined);
    expect(timer.remaining()).lte(100).and.gte(99);
     await (async()=>{
      return new Promise((resolve)=>{
        setTimeout(() => {
          expect(timer.remaining()).lte(35).and.gte(20);
          resolve(0);
        }, 70);
      })
    })();
  })
  describe('tock', ()=>{
    it('curry',()=>{
      expect(tick.tock('name', false)).is.a('function');
    })
    it('save to execute', ()=>{
      tick.tock('name', false)()
    })
    it('execute timers', ()=>{
      let called = false;
      tick.setTimeout('f', ()=>{
        called = true;
      }, 0);
      expect(called).toBeFalsy();
      tick.tock('f', false)();
      expect(called).toBeTruthy();
    })
    describe('setInterval', ()=>{
      it('add', async ()=>{
        const start = Date.now();
        let i =0;
        await (async ()=>{
          return new Promise((resolve)=>{
            tick.setInterval('test', () => {
              const taken = Date.now() - start;
              if (!i){
                expect(taken).is.above(5)
                expect(taken).is.below(110);
              } else {
                resolve(0);
              }
              i++;
            }, 10)
          })
        })()
      })

      it('custom ctx', async ()=>{
        const ctx = {foo: 'bar'};
        const tick = new Tick(ctx);
        await (async ()=>{
          return new Promise((resolve)=>{
            tick.setInterval('test', function() {
              // eslint-disable-next-line ts/ban-ts-comment, ts/prefer-ts-expect-error
              // @ts-ignore
              expect(this).deep.equal(ctx);
              tick.clear();
              resolve(0);
            }, 10);
          })
        })()
      })

      it('run with the same timeout if a known name is provided', async ()=>{
        const f = vi.fn();
        let i =0;
        let j =0;
        await (async ()=>{
          return new Promise((resolve) => {
            tick.setInterval('test', ()=>{
              i += 1;
            }, 100);
            setTimeout(() => {
              tick.setInterval('test',()=>{
                j += 1;
                if (i === 10){
                  expect(i).equals(j);
                  resolve(0)
                }
              }, 100);
            }, 0);
          })
        })()
      })

      it('updates the start time of the timer instance', async ()=>{
        await (async () => {
          tick.setInterval('timer', ()=>{}, 100);
          return new Promise((r)=>{
            setTimeout(() => {
              expect(
                tick.timers.get('timer')?.remaining()
              ).is.within(40,65);
              r(0);
            }, 250);
          })
        })()
      })
    })
    describe('setImmediate', ()=>{
      it('add', async ()=>{
        return new Promise((resolve)=>{
          const s = Date.now();
          tick.setImmediate('test', ()=>{
            expect(Date.now() - s).is.below(5);
            resolve(0);
          })
        })
      })
      it('custom ctx', async ()=>{
        return new Promise((resolve)=>{
          const t = new Tick({val: 1});
          t.setImmediate('test', function (){
            // eslint-disable-next-line ts/ban-ts-comment, ts/prefer-ts-expect-error
            // @ts-ignore
            expect(this).toStrictEqual({val: 1});
            resolve(0);
          })
        })
      })
      it('clear', async ()=>{
        return new Promise((resolve) => {
          let i = 0;
          tick.setImmediate('test', ()=>{
            i ++;
          })
          tick.clear('test');
          setTimeout(() => {
            expect(i).toBe(0);
            resolve(0);
          }, 100);
        })
      })
      it('names', async ()=>{
        return new Promise((resolve) => {
          const i=0;
          const ticks:number[] = [];
          tick.setImmediate('test', ()=>{
            ticks.push(1)
          })
          tick.setImmediate('test', ()=>{
            ticks.push(2);
            expect(ticks.join(',')).toBe('1,2')
            resolve(0);
          })
        })
      })
    })
    describe('timeout', ()=>{
      it('add', async ()=>{
        return new Promise((resolve) => {
          const a = Date.now();
          tick.setTimeout('', ()=>{
            const b = Date.now();
            expect(b-a).within(0,110)
            resolve(0);
          }, 100);
        })
      })
      it('names', async ()=>{
        const start = Date.now();
        return new Promise((next)=>{
          tick.setTimeout('test', function () {
            const taken = Date.now() - start;

            expect(taken).is.above(95);
            expect(taken).is.below(110);
          }, '100 ms');

          setTimeout(function () {
            tick.setTimeout('test', function () {
              const taken = Date.now() - start;

              expect(taken).is.above(95);
              expect(taken).is.below(110);

              next(0);
            }, '100 ms');
          }, 20);
        })
      })
    })
    describe('clear', ()=>{
      const fail = ()=> {throw new Error('fail')}
      it('clear multiple timeout', async ()=>{
        return new Promise((r)=>{
          tick.setTimeout('t', fail, '1s')
          tick.setTimeout('t', fail, '1s')
          tick.setTimeout('t2', fail, '10ms')
          tick.setTimeout('t2', fail, 0)
          tick.clear('t', 't2', 'not-exists');
          setTimeout(() => {
            r(0)
          }, ms('1s') + ms('1s') + ms('10ms'));
        })
      })
      it('clear all if name is empty', async ()=>{
        return new Promise((r)=>{
          tick.setTimeout('t', fail, '1s')
          tick.setTimeout('t', fail, '1s')
          tick.setTimeout('t2', fail, '10ms')
          tick.setTimeout('t2', fail, 0)
          tick.clear();
          setTimeout(() => {
            r(0)
          }, ms('1s') + ms('1s') + ms('10ms'));
        })
      })
    })
    it('active', ()=>{
      tick.setTimeout('test', ()=>{}, 0);
      expect(tick.active('test')).toBeTruthy();
    })
    describe('adjust', () =>{
      const fail = ()=>{throw new Error('fail')}
      it('adjust timer not exists', ()=>{
        tick.adjust('not exists', '1s');
      })
      it('adjust timeout', async ()=>{
        return new Promise((resolve)=>{
          tick.setTimeout('timer', fail, 10);
          tick.adjust('timer', '1s');
          setTimeout(() => {
            tick.clear();
            resolve(1);
          }, 500);
        })
      })
      it('interval', async ()=>{
        const s = Date.now();
        let counter=0;
        let elapsed;
        return new Promise((r)=>{
          tick.setInterval('foo',()=>{
            elapsed = Date.now() - s;
            if (++counter === 1){
              expect(elapsed).is.below(30);
              tick.adjust('foo', '100ms')
            } else if (counter === 3){
              expect(elapsed).is.within(200,250);
              tick.clear();
              r(0);
            }
          }, 0)
        })
      })
    })
  })
})