import { describe, expect, it, vi } from "vitest";
import { one } from "../src/once";

describe('one', ()=>{
  it('should to be function',() => {
    expect(one).toBeDefined();
  })
  it('ret should to be funcion', ()=>{
    const f = one(()=>{

    });
    expect(f).toBeTypeOf('function');
  })
  it('return type should not callback', ()=>{
    const f1 = vi.fn();
    const f = one(f1);
    expect(f).not.toBe(f1);
  })
  it('cacahe value', ()=>{
    const f = (a: number, b:number) => {
      return a + b;
    }
    const exec = one(f);
    expect(exec(1,2)).toBe(3);
    expect(exec(2,2)).toBe(3); // becuase cached
  })
})