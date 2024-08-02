use std::{path::Path, sync::Arc};

use openraft::{raft::{AppendEntriesRequest, AppendEntriesResponse, InstallSnapshotRequest, VoteRequest, VoteResponse}, Config, Raft};
use toy_rpc::macros::export_impl;

use crate::{network::Network, store::create_store, App, NodeId, TypeConfig};

pub struct RaftNode {
    app: Arc<App>
}

fn create_rpc_internal_err(
    e:Box<dyn std::error::Error + Send + Sync>
) -> toy_rpc::Error{
    toy_rpc::Error::Internal(e)
}

#[export_impl]
impl RaftNode {
    pub fn new(app: Arc<App>) -> Self{
        Self {app}
    }
    #[export_method]
    pub async fn vote(
        &self,
        vote: VoteRequest<TypeConfig>
    ) -> Result<VoteResponse<TypeConfig>, toy_rpc::Error>
    {
        self.app.raft.vote(vote)
        .await
        .map_err(
            |e| {
                create_rpc_internal_err(
                    Box::new(e)
                )
            }
        )
    }
    #[export_method]
    pub async fn append(
        &self,
        req: AppendEntriesRequest<TypeConfig>
    ) -> Result<
        AppendEntriesResponse<
            TypeConfig
        >,
        toy_rpc::Error
    >{
        self.app.raft.append_entries(
            req
        )
        .await
        .map_err(|e| create_rpc_internal_err(
            Box::new(e)
        ))
    }
    #[export_method]
    pub async fn snapshot(
        &self,
        req: InstallSnapshotRequest<TypeConfig>
    ) -> Result<openraft::raft::InstallSnapshotResponse<TypeConfig>, toy_rpc::Error>{
        self.app.raft.install_snapshot(req)
        .await
        .map_err(|e|{
            create_rpc_internal_err(
                Box::new(e)
            )
        })
    }
}

pub async fn create_raft_node<P>(
    node_id: NodeId,
    dir: P,
    http_addr: String,
    rpc_addr: String,
) -> std::io::Result<Arc<App>>
where
    P: AsRef<Path>,
{
    let config = Config {
        heartbeat_interval: 250,
        election_timeout_min: 300,
        ..Default::default()
    };
    let config = Arc::new(config.validate().unwrap());
    let (log_store,state_machine_store) = create_store(&dir).await;
    let kv = state_machine_store.data.kv.clone();
    let network = Network {};

    let raft = openraft::Raft::new(
        node_id,
        config.clone(),
        network,
        log_store,
        state_machine_store
    ).await.unwrap();
    let app = Arc::new(
        App {
            id:node_id,
            api_addr:http_addr.clone(),
            rpc_addr:rpc_addr.clone(),
            raft,
            kv: kv.clone(),
            conf:config
        }
    );
    let heartbeat_service = Arc::new(
        RaftNode::new(app.clone())
    );
    let server = toy_rpc::Server::builder().register(heartbeat_service).build();
    let listener = tokio::net::TcpListener::bind(rpc_addr).await.unwrap();
    let handle = tokio::task::spawn(async move {
        server.accept_websocket(listener).await.unwrap();
    });
    _ = handle.await;
    Ok(
        app
    )
}