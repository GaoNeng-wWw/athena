use std::collections::BTreeMap;
use std::{fmt::Display, sync::Arc};
use std::io::Cursor;
use openraft::Config;
use tokio::sync::RwLock;

use crate::store::{Request, Response};
mod store;
mod network;
mod raft;
mod client;

fn main() {
    println!("Hello, world!");
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct Node {
    pub rpc_addr: String,
    pub api_addr: String,
}

pub type SnapshotData = Cursor<Vec<u8>>;
pub type NodeId = u64;

openraft::declare_raft_types!{
    #[derive(serde::Serialize, serde::Deserialize)]
    pub TypeConfig:
        D = Request,
        R = Response,
        Node = Node
}

impl Display for Node {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Node {{ rpc_addr: {}, api_addr: {} }}", self.rpc_addr, self.api_addr)
    }
}

pub mod typ {
    use openraft::error::Infallible;

    use crate::TypeConfig;

    pub type Entry = openraft::Entry<TypeConfig>;

    pub type RaftError<E = Infallible> = openraft::error::RaftError<TypeConfig, E>;
    pub type RPCError<E = Infallible> = openraft::error::RPCError<TypeConfig, RaftError<E>>;

    pub type ClientWriteError = openraft::error::ClientWriteError<TypeConfig>;
    pub type CheckIsLeaderError = openraft::error::CheckIsLeaderError<TypeConfig>;
    pub type ForwardToLeader = openraft::error::ForwardToLeader<TypeConfig>;
    pub type InitializeError = openraft::error::InitializeError<TypeConfig>;

    pub type ClientWriteResponse = openraft::raft::ClientWriteResponse<TypeConfig>;
}

pub type OpenRaft = openraft::Raft<TypeConfig>;

pub struct App {
    id:NodeId,
    api_addr: String,
    rpc_addr: String,
    raft: OpenRaft,
    kv: Arc<RwLock<BTreeMap<String, String>>>,
    conf: Arc<Config>
}