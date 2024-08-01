use std::sync::Arc;

use openraft::raft::{AppendEntriesRequest, AppendEntriesResponse, InstallSnapshotRequest, VoteRequest, VoteResponse};
use toy_rpc::macros::export_impl;

use crate::{App, TypeConfig};

pub struct Raft {
    app: Arc<App>
}

fn create_rpc_internal_err(
    e:Box<dyn std::error::Error + Send + Sync>
) -> toy_rpc::Error{
    toy_rpc::Error::Internal(e)
}

#[export_impl]
impl Raft {
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