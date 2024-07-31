import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalStateMachine } from "../state-machine";
import { existsSync, mkdirSync, rmSync } from "fs";
import { Command, CommandType } from "../command";
import { before } from "node:test";

describe('LocalStateMachine', ()=>{
  let stateMachine:LocalStateMachine;
  beforeEach(async ()=>{
    if (existsSync('stateMachine-test')) {
      rmSync('stateMachine-test', {recursive: true})
      mkdirSync('stateMachine-test', {recursive: true});
    }
    stateMachine = new LocalStateMachine(
      'NODE1',
      'test/memdb'
    )
    await stateMachine.start();
  })
  it('start', async () => {
    await stateMachine.start()
    expect(existsSync('test/memdb')).toBeTruthy();
    expect(
      await stateMachine.getCurrentTerm()
    ).toBe(-1)
    expect(
      await stateMachine.getLog()
    ).toHaveLength(0)
    expect(
      await stateMachine.getVotedFor()
    ).toBe(null);
  })
  it('#IncrementCurrentTerm',async ()=>{
    expect(
      await stateMachine.getCurrentTerm()
    ).toBe(-1)
    await stateMachine.IncrementCurrentTerm();
    expect(await stateMachine.getCurrentTerm()).toBe(0)
  })
  it('#setCurrentTerm', async ()=>{
    await stateMachine.setCurrentTerm(1);
    expect(await stateMachine.getCurrentTerm()).toBe(1)
  })
  it('#setVotedFor', async()=>{
    await stateMachine.setVotedFor('node2');
    expect(await stateMachine.getVotedFor()).toBe('node2');
  })
  it('#getLog', async ()=>{
    expect(await stateMachine.getLog()).toHaveLength(0);
    await stateMachine.appendEntries(
      [
        {
          command: new Command(
            CommandType.STORE_SET,
            'hello-world'
          ),
          term: await stateMachine.getCurrentTerm()
        }
      ]
    )
    expect(await stateMachine.getLog()).toHaveLength(1);
  })
  it('#getLogAtIndex', async ()=>{
    for (let i=0;i<10;i++){
      await stateMachine.appendEntries(
        [
          {
            command: new Command(
              CommandType.STORE_SET,
              `hello-world ${i}`
            ),
            term: await stateMachine.getCurrentTerm()
          }
        ]
      )
    }
    expect((await stateMachine.getLogAtIndex(1)).command.data).toBe('hello-world 1')
  })
  it('#deleteFromIndexMovingForward',async ()=>{
    for (let i=0;i<10;i++){
      await stateMachine.appendEntries(
        [
          {
            command: new Command(
              CommandType.STORE_SET,
              `hello-world ${i}`
            ),
            term: await stateMachine.getCurrentTerm()
          }
        ]
      )
    }
    await stateMachine.deleteFromIndexMovingForward(0);
    expect(await stateMachine.getLog()).toHaveLength(0)
  })
  it('#getLastLogEntry',async ()=>{
    for (let i=0;i<10;i++){
      await stateMachine.appendEntries(
        [
          {
            command: new Command(
              CommandType.STORE_SET,
              `hello-world ${i}`
            ),
            term: await stateMachine.getCurrentTerm()
          }
        ]
      )
    }
    expect((await stateMachine.getLastLogEntry()).command.data).toBe('hello-world 9')
  })
  it('#getLastIndex',async ()=>{
    for (let i=0;i<10;i++){
      await stateMachine.appendEntries(
        [
          {
            command: new Command(
              CommandType.STORE_SET,
              `hello-world ${i}`
            ),
            term: await stateMachine.getCurrentTerm()
          }
        ]
      )
    }
    expect((await stateMachine.getLastIndex())).toBe(9)
  })
})