import { Raftnode } from "../node";
import { MemoryNetwork, MemoryPeer, MemoryServer } from "../peer";
import { LocalStateMachine } from "../state-machine";
import { MemoryStore } from "../store";

export const createNode = async (id: string, path:string="test/mem", leader=false) => {
  const state = new LocalStateMachine(id, path);
  const server = new MemoryServer();
  const network = new MemoryNetwork();
  const node = await Raftnode.start(
    id,
    state,
    new MemoryStore(),
    server,
    (id) => new MemoryPeer(id, network),
    {
      min: 150,
      max: 300
    },
    {
      min: 150,
      max: 300
    },
    leader
  )
  return {state,server,network,node};
}