use std::{borrow::Borrow, sync::Arc};

use athena_raft::Node;
use axum::Json;
use serde::{Deserialize, Serialize};

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
pub async fn add_node(
    axum::extract::State(app): axum::extract::State<Arc<athena_raft::RaftApp>>,
    axum::Json(body): axum::Json<Members>
) -> Json<Node>{
    let node = Node {
        rpc_addr: body.rpc_addr,
        api_addr: body.api_addr
    };
    app.raft.add_learner(body.id, node.clone(), true).await.unwrap();
    Json(node)
}
