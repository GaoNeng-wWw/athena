import ms from "ms";

function unsetTimeout(id: string | number | NodeJS.Timeout | undefined) { clearTimeout(id); }
function unsetInterval(id: string | number | NodeJS.Timeout | undefined) { clearInterval(id); }
function unsetImmediate(id: NodeJS.Immediate | undefined) { clearImmediate(id); }

export class Timer {
  public start: number;
  public duration: any;
  public clear:Function | null;
  public timer: object | null;
  public fns: Function[] | null
  constructor(
    timer?: object,
    clear?: Function,
    duration?: any,
    fn?: Function
  ) {
    this.start = +new Date();
    this.timer = timer ?? null;
    this.clear = clear ?? null;
    this.fns = fn ? [fn] : [];
    this.duration = duration;
  }
  remaining(){
    return this.duration - this.taken();
  }
  taken(){
    return +new Date() - this.start;
  }
}

export class Tick{
  public ctx: object;
  public timers: Map<string, Timer>
  constructor(
    ctx?: object
  ){
    this.ctx=ctx??this;
    this.timers = new Map();
  }
  tock(
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
        this.clear(name);
      }else{
        timer.start = +new Date()
      }
      for (let i=0;i<fns.length;i++){
        fns[i].call(this.ctx);
      }
    }
  }
  setTimeout(name:string,fn:Function,time: string | number){
    if (this.timers.get(name)){
      this.timers.get(name)?.fns?.push(fn);
      return this;
    }
    const d = typeof time === 'string' ? ms(time) : time;
    this.timers.set(
      name,
      new Timer(
        setTimeout(this.tock(name,false), d),
        unsetTimeout,
        d,
        fn
      )
    )
  }
  setInterval(name:string,fn:Function,time: string | number){
    if (this.timers.get(name)){
      this.timers.get(name)?.fns?.push(fn);
      return this;
    }
    const d = typeof time === 'string' ? ms(time) : time;
    this.timers.set(
      name,
      new Timer(
        setInterval(this.tock(name,false), d),
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
  adjust(name: string, time: string | number){
    const timer = this.timers.get(name);
    if (!timer){
      return this;
    }
    const interval = timer.clear === unsetInterval;
    timer.clear?.(timer.timer);
    timer.start = +new Date()
    timer.duration = typeof time === 'string' ? ms(time) : time;
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
      names.push(...Array.from(this.timers.keys()));
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