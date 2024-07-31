import { existsSync, rmSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNode } from "./createNode";
import { sleep } from "./sleep";
import { Command, CommandType } from "../command";
import { QueryType } from "../query";

// console.log = vi.fn(()=>{})

describe('Store', ()=>{

  beforeEach(()=>{
    if (existsSync('store-test-db')){
      rmSync('store-test-db', {recursive: true,force:true})
    }
  })
  it('reject request if not is leader', async ()=>{
    const nodes = []
    nodes.push(await createNode('NODE1', 'store-test-db/mem', true))
    await sleep(150);
    nodes.push(
      await createNode('NODE2', 'store-test-db/mem', false),
      await createNode('NODE3', 'store-test-db/mem', false)
    )
    const [{server,network, node}] = nodes;

    network.addServer('NODE2', nodes[1].server);
    server.AddServer({server: 'NODE2'});
    network.addServer('NODE3', nodes[2].server);
    server.AddServer({server: 'NODE3'});
    
    await sleep(150);

    await server.ClientRequest({
      type: CommandType.STORE_SET,
      data: {
        key: 'k',
        value: 'v'
      }
    })

    await sleep(150);

    const qrep = await server.ClientQuery({
      type: QueryType.GET,
      data: {
        key: 'k'
      }
    })

    expect(qrep.response).toBe('v')

    nodes.forEach(({node})=> {
      node.stopListen();
    })
  })
  describe('allow request if is leader', async ()=>{
    it('set string', async ()=>{
      const nodes = []
      nodes.push(await createNode('NODE1', 'store-test-db/mem', true))
      await sleep(300);
      nodes.push(
        await createNode('NODE2', 'store-test-db/mem', false),
        await createNode('NODE3', 'store-test-db/mem', false)
      )
      const [
        {server,network},
        {server:s2}
      ] = nodes;
  
      network.addServer('NODE2', nodes[1].server);
      network.addServer('NODE3', nodes[2].server);
      server.AddServer({server: 'NODE2'});
      server.AddServer({server: 'NODE3'});
      await sleep(150);

      const rep = await server.ClientRequest({
        type: CommandType.STORE_SET,
        data: {
          key: 'foo',
          value: 'bar'
        }
      })

      await sleep(150);

      expect(rep.status).toBeTruthy();

      const qrep = await s2.ClientQuery({
        type: QueryType.GET,
        data:{
          key:'foo'
        }
      })
      // Linear reading should be independent of the core
      expect(qrep.status).toBe(false);
    },{timeout: Infinity})
    it.only('set hash', async ()=>{
      const nodes = []
      nodes.push(await createNode('NODE1', 'store-test-db/mem', true))
      await sleep(500);
      nodes.push(
        await createNode('NODE2', 'store-test-db/mem', false),
        await createNode('NODE3', 'store-test-db/mem', false)
      )
      const [
        {server,network},
      ] = nodes;
  
      network.addServer('NODE2', nodes[1].server);
      network.addServer('NODE3', nodes[2].server);

      server.AddServer({server: 'NODE2'});
      server.AddServer({server: 'NODE3'});

      await sleep(300);

      const rep = await server.ClientRequest(
        new Command(
          CommandType.STORE_HSET,
          {
            ns: 'key',
            pairs: [
              "k1:v1",
              "k2:v2"
            ]
          }
        )
      )
      console.log('sleep');
      await sleep(500)
      console.log('sleep finish');

      const queryResponse = await server.ClientQuery({
        type: QueryType.HGET,
        data: { ns: "hash", key: "key1" },
      });
      const queryResponse2 = await server.ClientQuery({
        type: QueryType.HGET,
        data: { ns: "hash", key: "key2" },
      });

      expect((queryResponse).response).toBe('v1')
      expect((queryResponse2).response).toBe('v2')

      await server.ClientRequest({
        type: CommandType.STORE_HDEL,
        data: { hashKey: "hash", keys: ["key1", "key2"] },
      });

      const queryResponse3 = server.ClientQuery({
        type: QueryType.HGET,
        data: { hashKey: "hash", key: "key2" },
      });
      const queryResponse4 = server.ClientQuery({
        type: QueryType.HGET,
        data: { hashKey: "hash", key: "key1" },
      });
      expect((await queryResponse3).response).toEqual("");
      expect((await queryResponse4).response).toEqual("");


      nodes.forEach(({node}) => node.stopListen());
    },{timeout: Infinity})
  })
})