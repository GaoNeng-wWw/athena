use std::sync::Arc;

use athena_raft::RaftApp;
use axum::routing::get;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod node;

#[tokio::main]
async fn main(){
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8081").await.unwrap();
    tracing::info!("Server will listening http://0.0.0.0:8081");
    let router = axum::Router::new();
    let (raft, handle) = athena_raft::raft::create_raft_node(
        1,
        "db",
        "127.0.0.1:8081".to_string(),
        "127.0.0.1:8082".to_string()
    )
    .await
    .unwrap();
    let app =router
    .route(
        "/",
        get(||async {
            "hello-world"
        })
    )
    .route("/node", get(node::get_nodes))
    .with_state(raft);
    axum::serve(listener, app).await.unwrap();
    let _ = handle.await;
}
