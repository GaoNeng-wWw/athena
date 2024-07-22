import { time } from "console";
import ms from "ms";

function unsetTimeout(id: string | number | NodeJS.Timeout | undefined) { clearTimeout(id); }
function unsetInterval(id: string | number | NodeJS.Timeout | undefined) { clearInterval(id); }
function unsetImmediate(id: NodeJS.Immediate | undefined) { clearImmediate(id); }

class Timer {
  public start: number;
  public duration: any;
  public clear:Function | null;
  public timer: object | null;
  public fns: Function[] | null
  constructor(
    timer: object,
    clear: Function,
    duration: any,
    fn: Function
  ) {
    this.start = new Date().getTime();
    this.timer = timer;
    this.clear = clear;
    this.fns =[fn];
    this.duration = duration;
  }
  remaining(){
    return this.duration - this.taken();
  }
  taken(){
    return new Date().getTime() - this.start;
  }
}

export class Tick{
  private ctx: object;
  private timers: Map<string, Timer>
  constructor(
    ctx?: object
  ){
    this.ctx=ctx??this;
    this.timers = new Map();
  }
  private tock(
    name:string,
    clear:boolean
  ){
    return ()=>{
      if(!this.timers.has(name)){
        return;
      }
      const timer = this.timers.get(name)!;
      const fns = [...timer.fns ?? []];
      if (clear){
      }else{
        timer.start = new Date().getTime();
      }
      for (let i=0;i<fns.length;i++){
        fns[i].call(this.ctx);
      }
    }
  }
  setTimeout(name:string,fn:Function,time: string){
    if (this.timers.get(name)){
      this.timers.get(name)?.fns?.push(fn);
      return this;
    }
    const d = ms(time);
    this.timers.set(
      name,
      new Timer(
        setTimeout(() => {
          this.tock(name,true)
        }, d),
        unsetTimeout,
        d,
        fn
      )
    )
  }
  setInterval(name:string,fn:Function,time: string){
    if (this.timers.get(name)){
      this.timers.get(name)?.fns?.push(fn);
      return this;
    }
    const d = ms(time);
    this.timers.set(
      name,
      new Timer(
        setInterval(() => {
          this.tock(name,true)
        }, d),
        unsetInterval,
        d,
        fn
      )
    )
  }
  setImmediate(name: string, fn:Function) {
    if (this.timers.get(name)){
      this.timers.get(name)?.fns?.push(fn);
      return this;
    }
    this.timers.set(
      name,
      new Timer(
        setImmediate(this.tock(name, true)),
        unsetImmediate,
        0,
        fn
      )
    )
  }
  active(name: string){
    return this.timers.has(name);
  }
  adjust(name: string, time: string){
    const timer = this.timers.get(name);
    if (!timer){
      return this;
    }
    const interval = timer.clear === unsetInterval;
    timer.clear?.(timer.timer);
    timer.start = new Date().getTime();
    timer.duration = ms(time);
    const f = interval ? setInterval : setTimeout;
    timer.timer = f(this.tock(name, !interval), timer.duration);
    return this;
  }
  end(){
    if (!this.ctx){
      return false;
    }
    this.clear();
    this.ctx = {};
    this.timers.clear();
    return true;
  }
  public clear(..._names: string[]){
    const names:string[] = [..._names];
    if (!names.length){
      for (const timer in this.timers) {
        if (Object.hasOwn(this.timers, timer)){
          names.push(timer);
        }
      }
    }
    for (let i=0;i<names.length;i++){
      const name = names[i];
      const timer = this.timers.get(name);
      if (!timer){
        continue;
      }
      timer.clear?.(timer.timer);
      timer.fns = timer.timer = timer.clear = null;
      this.timers.delete(name);
    }
    return this;
  }
}