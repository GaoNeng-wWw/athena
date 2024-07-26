import {curry} from '@utils-plus/fp';

export const one =  (f: Function) => {
  let called = false;
  let value:unknown;
  return (...args: any[])=>{
    if (called){
      return value;
    }
    called = true;
    value = f(...args);
    return value;
  }
}