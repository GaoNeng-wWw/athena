use std::{collections::BTreeSet, sync::{Arc, Mutex}};

use openraft::{error::{NetworkError, RPCError, RemoteError, Unreachable}, RaftMetrics, TryAsRef};
use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{store::Request, typ, NodeId, TypeConfig};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Empty {}

#[doc = "just for test"]
pub struct RaftClient {
    pub leader: Arc<Mutex<(NodeId, String)>>,
    pub http_sender: reqwest::Client
}


impl RaftClient {
    pub fn new(
        leader: NodeId,
        leader_addr: String
    ) -> Self{
        Self {
            leader: Arc::new(Mutex::new((leader,leader_addr))),
            http_sender: Client::new()
        }
    }
    pub async fn write(&self, req: &Request) -> Result<typ::ClientWriteResponse, typ::RPCError<typ::ClientWriteError>> {
        self.send_rpc_to_leader("api/write", Some(req)).await
    }

    /// Read value by key, in an inconsistent mode.
    ///
    /// This method may return stale value because it does not force to read on a legal leader.
    pub async fn read(&self, req: &String) -> Result<String, typ::RPCError> {
        self.do_send_rpc_to_leader("api/read", Some(req)).await
    }

    /// Consistent Read value by key, in an inconsistent mode.
    ///
    /// This method MUST return consistent value or CheckIsLeaderError.
    pub async fn consistent_read(&self, req: &String) -> Result<String, typ::RPCError<typ::CheckIsLeaderError>> {
        self.do_send_rpc_to_leader("api/consistent_read", Some(req)).await
    }

    // --- Cluster management API

    /// Initialize a cluster of only the node that receives this request.
    ///
    /// This is the first step to initialize a cluster.
    /// With a initialized cluster, new node can be added with [`write`].
    /// Then setup replication with [`add_learner`].
    /// Then make the new node a member with [`change_membership`].
    pub async fn init(&self) -> Result<(), typ::RPCError<typ::InitializeError>> {
        self.do_send_rpc_to_leader("cluster/init", Some(&Empty {})).await
    }

    /// Add a node as learner.
    ///
    /// The node to add has to exist, i.e., being added with `write(ExampleRequest::AddNode{})`
    pub async fn add_learner(
        &self,
        req: (NodeId, String, String),
    ) -> Result<typ::ClientWriteResponse, typ::RPCError<typ::ClientWriteError>> {
        self.send_rpc_to_leader("cluster/add-learner", Some(&req)).await
    }

    /// Change membership to the specified set of nodes.
    ///
    /// All nodes in `req` have to be already added as learner with [`add_learner`],
    /// or an error [`LearnerNotFound`] will be returned.
    pub async fn change_membership(
        &self,
        req: &BTreeSet<NodeId>,
    ) -> Result<typ::ClientWriteResponse, typ::RPCError<typ::ClientWriteError>> {
        self.send_rpc_to_leader("cluster/change-membership", Some(req)).await
    }

    /// Get the metrics about the cluster.
    ///
    /// Metrics contains various information about the cluster, such as current leader,
    /// membership config, replication status etc.
    /// See [`RaftMetrics`].
    pub async fn metrics(&self) -> Result<RaftMetrics<TypeConfig>, typ::RPCError> {
        self.do_send_rpc_to_leader("cluster/metrics", None::<&()>).await
    }
    async fn do_send_rpc_to_leader<Req, Resp, Err>(
        &self,
        uri: &str,
        req: Option<&Req>,
    ) -> Result<Resp, RPCError<TypeConfig, Err>>
    where
    Req: Serialize + 'static,
    Resp: Serialize + DeserializeOwned,
    Err: std::error::Error + Serialize + DeserializeOwned,
    {
        let (leader_id, url) = {
            let t = self.leader.lock().unwrap();
            let addr = &t.1;
            (t.0, format!("http://{}/{}", addr, uri))
        };
        let resp = if let Some(r) = req {
            self.http_sender.post(url.clone()).json(r)
        } else {
            self.http_sender.get(url.clone())
        }
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                return RPCError::<TypeConfig,Err>::Unreachable(
                    Unreachable::new(&e)
                );
            }
            RPCError::Network(
                NetworkError::new(&e)
            )
        })?;
        let res:Result<Resp, Err> = resp.json()
        .await
        .map_err(|e|{
            RPCError::Network(
                NetworkError::new(&e)
            )
        })?;
        res.map_err(|e| {
            RPCError::RemoteError(RemoteError::new(leader_id, e))
        })
    }
    async fn send_rpc_to_leader<
        Req,
        Resp,
        Err
    >(
        &self,
        uri: &str,
        req: Option<&Req>
    ) -> Result<Resp, typ::RPCError<Err>>
    where
        Req: Serialize + 'static,
        Resp: Serialize + DeserializeOwned,
        Err: std::error::Error + Serialize + DeserializeOwned + TryAsRef<typ::ForwardToLeader> + Clone,
    {
        let mut retry = 3;
        loop {
            let res: Result<Resp, typ::RPCError<Err>> = self.do_send_rpc_to_leader(uri, req).await;
            let rpc_err = match res {
                Ok(x) => return Ok(x),
                Err(err) => err
            };
            if let RPCError::RemoteError(remote_err) = &rpc_err {
                let raft_err:&typ::RaftError<_> = &remote_err.source;
                if let Some(
                    typ::ForwardToLeader{
                        leader_id: Some(leader_id),
                        leader_node: Some(leader_node),
                        ..
                    }
                ) = raft_err.forward_to_leader() {
                    let mut t = self.leader.lock().unwrap();
                    let api_addr = leader_node.api_addr.clone();
                    *t = (*leader_id, api_addr);
                }
                retry -= 1;
                if retry > 0{
                    continue;
                }
            }
            return Err(rpc_err)
        }
    }
}