use std::fmt::Display;
use std::io::Cursor;
use std::path::Path;
use std::sync::Arc;

use openraft::Config;
use tokio::net::TcpListener;
use tokio::task;


use crate::store::{Request, Response};
mod store;

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