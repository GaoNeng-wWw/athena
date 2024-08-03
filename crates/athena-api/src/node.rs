use std::sync::Arc;

use axum::Json;
use serde::{Deserialize, Serialize};

pub struct GetNodesParam {
    page: Option<u64>
}

#[derive(Deserialize,Serialize)]
pub struct Members {
    id: u64,
    rpc_addr: String,
    api_addr: String
}

#[axum::debug_handler]
pub async fn get_nodes(
    axum::extract::State(app): axum::extract::State<Arc<athena_raft::RaftApp>>,
) -> Json<Vec<Members>>{
  let metrices = app.raft.metrics().borrow().clone();
  let nodes: Vec<Members> = metrices.membership_config.membership().nodes()
  .map(|n| {
    let id = n.0;
    let node = n.1;
    return Members {
        id: *id,
        rpc_addr: node.rpc_addr.clone(),
        api_addr: node.api_addr.clone()
    }
  }) 
  .collect();
  axum::Json(nodes)
}

#[doc = "Add node to cluster"]
pub fn add_node(){
    todo!();
}

#[doc = "Remove node to clear"]
pub fn remove_node(){
    todo!()
}

#[doc = "update node info by node id or rpc_addr"]
#[doc = "if exists will return new node config else will retrun 404 status code"]
pub fn patch_node(){
    todo!()
}
