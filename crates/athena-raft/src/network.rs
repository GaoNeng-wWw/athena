use std::any::Any;
use std::fmt::format;
use std::fmt::Display;

use openraft::error::InstallSnapshotError;
use openraft::error::NetworkError;
use openraft::error::RPCError;
use openraft::error::RaftError;
use openraft::error::RemoteError;
use openraft::network::RPCOption;
use openraft::network::RaftNetwork;
use openraft::network::RaftNetworkFactory;
use openraft::raft::AppendEntriesRequest;
use openraft::raft::AppendEntriesResponse;
use openraft::raft::InstallSnapshotRequest;
use openraft::raft::InstallSnapshotResponse;
use openraft::raft::VoteRequest;
use openraft::raft::VoteResponse;
use openraft::AnyError;
use serde::de::DeserializeOwned;
use toy_rpc::pubsub::AckModeNone;
use toy_rpc::Client;

use crate::raft::RaftClientStub;
use crate::Node;
use crate::NodeId;
use crate::TypeConfig;


pub struct Network {}

pub struct NetworkConnection {
    addr: String,
    client: Option<Client<AckModeNone>>,
    target: NodeId
}

impl NetworkConnection {
    async fn client<E: std::error::Error + DeserializeOwned>(
        &mut self,
    ) -> Result<&Client<AckModeNone>, RPCError<TypeConfig, E>>{
        if self.client.is_none() {
            self.client = Client::dial_websocket(&self.addr).await.ok();
        }
        self.client
        .as_ref()
        .ok_or_else(|| {
            RPCError::Network(
                NetworkError::from(
                    AnyError::default()
                )
            )
        })
    }
}


impl RaftNetworkFactory<TypeConfig> for Network {
    type Network = NetworkConnection;
    async fn new_client(
        &mut self,
        target: NodeId,
        node: &Node
    ) -> Self::Network{
        let addr = format!("ws://{}", node.rpc_addr);
        let client = Client::dial_websocket(&addr).await.ok();

        NetworkConnection {
            addr,
            client,
            target
        }
    }
}

#[derive(Debug)]
struct ErrWrap(Box<dyn std::error::Error>);

impl Display for ErrWrap {
    fn fmt(
        &self,
        f: &mut std::fmt::Formatter<'_>
    ) -> std::fmt::Result{
        self.0.fmt(f)
    }
}

impl std::error::Error for ErrWrap {}

fn to_error<E: std::error::Error + 'static + Clone>(e: toy_rpc::Error, target: NodeId) -> RPCError<TypeConfig, E> {
    match e {
        toy_rpc::Error::IoError(e) => RPCError::Network(NetworkError::new(&e)),
        toy_rpc::Error::ParseError(e) => RPCError::Network(NetworkError::new(&ErrWrap(e))),
        toy_rpc::Error::Internal(e) => {
            let any: &dyn Any = &e;
            let error: &E = any.downcast_ref().unwrap();
            RPCError::RemoteError(RemoteError::new(target, error.clone()))
        }
        e @ (toy_rpc::Error::InvalidArgument
        | toy_rpc::Error::ServiceNotFound
        | toy_rpc::Error::MethodNotFound
        | toy_rpc::Error::ExecutionError(_)
        | toy_rpc::Error::Canceled(_)
        | toy_rpc::Error::Timeout(_)
        | toy_rpc::Error::MaxRetriesReached(_)) => RPCError::Network(NetworkError::new(&e)),
    }
}

impl RaftNetwork<TypeConfig> for NetworkConnection {
    #[doc = " Send an AppendEntries RPC to the target."]
    async fn append_entries(
        &mut self,
        req: AppendEntriesRequest<TypeConfig>,
        _option: RPCOption,
    ) -> Result<AppendEntriesResponse<TypeConfig>, RPCError<TypeConfig, RaftError<TypeConfig>>> {
        let c = self.client().await?;
        let raft: crate::raft::RaftClient<AckModeNone> = c.raft();
        raft.append(req)
            .await
            .map_err(|e| to_error(e, self.target))
    }

    #[doc = " Send an InstallSnapshot RPC to the target."]
    #[cfg(not(feature = "generic-snapshot-data"))]
    async fn install_snapshot(
        &mut self,
        req: InstallSnapshotRequest<TypeConfig>,
        _option: RPCOption,
    ) -> Result<InstallSnapshotResponse<TypeConfig>, RPCError<TypeConfig, RaftError<TypeConfig, InstallSnapshotError>>>{
        self.client()
            .await?
            .raft()
            .snapshot(req)
            .await
            .map_err(|e| to_error(e, self.target))
    }

    #[doc = " Send a RequestVote RPC to the target."]
    async fn vote(
        &mut self,
        rpc:VoteRequest<TypeConfig>,
        _option:RPCOption
    ) -> Result<VoteResponse<TypeConfig>, RPCError<TypeConfig, RaftError<TypeConfig>>>{
        self.client()
            .await?
            .raft()
            .vote(rpc)
            .await
            .map_err(|e| to_error(e, self.target))
    }
}