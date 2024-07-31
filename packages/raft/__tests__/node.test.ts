import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BaseNetwork} from "../peer";
import { MemoryNetwork, MemoryPeer, MemoryServer } from "../peer";
import { Peer, Raftnode, State } from "../node";
import { LocalStateMachine } from "../state-machine";
import { MemoryStore } from "../store";
import { existsSync, readdirSync, rmdirSync, rmSync, statSync, unlinkSync } from "fs";
import { MEMBERSHIP_CHANGE_RESPONSE_STATUS } from "../rpc/membership";
import { join } from "path";
import { Command, CommandType } from "../command";
import { createNode } from "./createNode";

const sleep = (time: number) => {
  return new Promise((resolve)=>{
    setTimeout(() => {
      resolve(null);
    }, time);
  })
}
beforeAll(()=>{
  if (existsSync('testdb')){
    rmSync('testdb',{ recursive: true, force: true, })
  }
})
describe('Node', () => {
  describe('Single node', ()=>{
    it('should tobe leader', async ()=>{
      const network = MemoryNetwork.getTestNetwork();
      const server = new MemoryServer();
      network.addServer('node-1', server);
      const state = new LocalStateMachine('node-1', 'test/a');
      const node = await Raftnode.start(
        'node1',
        state,
        new MemoryStore(),
        server,
        (id: string) => new MemoryPeer(id, network),
        {
          max: 300,
          min: 150
        },
        {
          max: 300,
          min: 150
        },
        true
      )
      await sleep(500);
      const firstLog = await node.stateMachine.getLogAtIndex(0);
      expect(node.state).toBe(State.LEADER);
      expect(firstLog.term).toBe(0);
      expect(firstLog.command.data).toBe('node1');
      node.stopListen();
    })
  })
  it('reject add/remove not if it is not leader',async ()=>{
    const network = MemoryNetwork.getTestNetwork();
    const server = new MemoryServer();
    network.addServer('node-1', server);
    const state = new LocalStateMachine('node-1', 'test/a');
    const node = await Raftnode.start(
      'node-1',
      state,
      new MemoryStore(),
      server,
      (id: string) => new MemoryPeer(id, network),
      {
        max: 300,
        min: 150
      },
      {
        max: 300,
        min: 150
      },
      true
    )
    await sleep(1000)

    const server2 = new MemoryServer();
    network.addServer('node-1', server);
    network.addServer('node-2', server2);
    const state2 = new LocalStateMachine('node-2', 'test/a');
    const node2 = await Raftnode.start(
      'node-2',
      state2,
      new MemoryStore(),
      server2,
      (id: string) => new MemoryPeer(id, network),
      {
        max: 300,
        min: 150
      },
      {
        max: 300,
        min: 150
      },
      false
    )
    server.AddServer({server: 'node-2'});
    await sleep(500);
    const rep = await server2.AddServer({server: 'node-2'});
    expect(rep.status).toBe(MEMBERSHIP_CHANGE_RESPONSE_STATUS.NOT_LEADER);
    expect(rep.leaderHit).toEqual(node.id);
    const removeRep = await server2.RemoveServer({server: 'node-2'});
    expect(removeRep.status).toEqual(MEMBERSHIP_CHANGE_RESPONSE_STATUS.NOT_LEADER)
    expect(removeRep.leaderHit).toEqual(node.id);
    node.stopListen();
    node2.stopListen();
  })
  it('logs should be replicated', async ()=>{
    const nodes = [];
    const networks = [];
    const servers = [];
    for (let i=0;i<3;i++){
      const network = MemoryNetwork.getTestNetwork();
      const server = new MemoryServer();
      const state = new LocalStateMachine(`NODE${i+1}`, 'testdb/mem');
      const node = await Raftnode.start(
        `NODE${i+1}`,
        state,
        new MemoryStore(),
        server,
        (id:string) => new MemoryPeer(id, network),
        {
          max: 300,
          min: 150
        },
        {
          max: 300,
          min: 150
        },
        i===0
      );
      nodes.push(node);
      networks.push(network);
      servers.push(server);
      networks[0].addServer(`NODE${i+1}`,server);
      if (i !== 0){
        servers[0].AddServer({server: `NODE${i+1}`})
      }
      await sleep(1000);
    }
    await servers[0].ClientRequest(
      new Command(
        CommandType.STORE_SET,
        { key: 'test', value: 'working' }
      )
    );
    await sleep(300);
    expect(await nodes[0].stateMachine.getCurrentTerm())
    .equal(await nodes[1].stateMachine.getCurrentTerm())
    .equal(await nodes[2].stateMachine.getCurrentTerm())
    
    expect(
      await nodes[0].stateMachine.getLastLogEntry()
    ).toStrictEqual(
      await nodes[1].stateMachine.getLastLogEntry()
    );
    expect(
      await nodes[0].stateMachine.getLastLogEntry()
    ).toStrictEqual(
      await nodes[2].stateMachine.getLastLogEntry()
    );

    nodes.forEach(node=>node.stopListen());
  }, {timeout: 60 * 1000})

  it('should not be replicated twice', async () => {
    const nodes = [
      await createNode('NODE1',true),
      await createNode('NODE2',true),
      await createNode('NODE3',true),
    ]
    nodes[0].network.addServer('NODE2', nodes[1].server);
    nodes[0].server.AddServer({server: 'NODE2'});
    nodes[0].network.addServer('NODE3', nodes[2].server);
    nodes[0].server.AddServer({server: 'NODE3'});
    await sleep(300);
    nodes[0].server.AddServer({server: 'NODE3'});
    await sleep(300);
    nodes[0].server.RemoveServer({server: 'NODE3'});
    await sleep(300);
    nodes[0].server.AddServer({server: 'NODE3'});

    nodes.forEach(node=>{
      node.node.stopListen()
    })
  })
  it(
    'Nodes that are not in the cluster should not have any records after leaving',
    async ()=>{
    const nodes = [
      await createNode('NODE1',true),
      await createNode('NODE2',true),
      await createNode('NODE3',true),
    ]
    nodes[0].network.addServer('NODE2', nodes[1].server);
    nodes[0].server.AddServer({server: 'NODE2'});
    nodes[0].network.addServer('NODE3', nodes[2].server);
    nodes[0].server.AddServer({server: 'NODE3'});
    await sleep(300);
    nodes[0].server.RemoveServer({server: 'NODE3'})
    await sleep(300);
    nodes[0].server.ClientRequest(
      new Command(
        CommandType.STORE_SET,
        {
          foo: 'bar'
        }
      )
    )
    await sleep(300);
    const leaderEntry = await nodes[0].node.stateMachine.getLastLogEntry()
    const leaveNodeEntry = await nodes[2].node.stateMachine.getLastLogEntry()
    expect(leaveNodeEntry.command).not.toEqual(leaderEntry.command)
    nodes.forEach(({node}) => node.stopListen());
  })
})