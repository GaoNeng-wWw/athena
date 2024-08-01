use std::collections::BTreeMap;
use std::fmt::Debug;
use std::io::Cursor;
use std::ops::RangeBounds;
use std::path::Path;
use std::sync::Arc;

use byteorder::BigEndian;
use byteorder::ReadBytesExt;
use byteorder::WriteBytesExt;
use openraft::storage::LogFlushed;
use openraft::storage::RaftLogStorage;
use openraft::storage::RaftStateMachine;
use openraft::storage::Snapshot;
use openraft::AnyError;

use openraft::Entry;
use openraft::EntryPayload;
use openraft::ErrorSubject;
use openraft::ErrorVerb;
use openraft::LogId;
use openraft::LogState;
use openraft::OptionalSend;

use openraft::RaftLogReader;
use openraft::RaftSnapshotBuilder;
use openraft::SnapshotMeta;
use openraft::StorageError;
use openraft::StorageIOError;
use openraft::StoredMembership;
use openraft::Vote;
use rocksdb::ColumnFamily;
use rocksdb::ColumnFamilyDescriptor;
use rocksdb::Options;
use rocksdb::DB;
use serde::Deserialize;
use serde::Serialize;
use tokio::sync::RwLock;
use crate::{typ, NodeId, SnapshotData, TypeConfig};

#[derive(Serialize,Deserialize,Debug,Clone)]
pub enum Request {
    Set {
        key:String,
        value:String
    }
}

#[derive(Serialize,Deserialize,Debug,Clone)]
pub struct Response{
    pub value: Option<String>
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StoredSnapshot {
    pub meta: SnapshotMeta<TypeConfig>,

    /// The data of the state machine at the time of this snapshot.
    pub data: Vec<u8>,
}

#[derive(Debug,Clone)]
pub struct StateMachineData {
    pub last_applied_log_id: Option<LogId<NodeId>>,
    pub last_membership: StoredMembership<TypeConfig>,
    pub kv: Arc<RwLock<BTreeMap<String, String>>>,
}

#[derive(Debug,Clone)]
pub struct StateMachineStore {
    pub data: StateMachineData,
    pub snapshot_idx: u64,
    pub db: Arc<DB>,
}

type StorageResult<T> = Result<T, StorageError<NodeId>>;

impl StateMachineStore {
    async fn new(db: Arc<DB>) -> Result<StateMachineStore, StorageIOError<NodeId>>{
        let mut sm = Self {
            data: StateMachineData {
                last_applied_log_id: None,
                last_membership: Default::default(),
                kv: Arc::new(Default::default())
            },
            snapshot_idx: 0,
            db
        };
        let snapshot = sm.get_current_snapshot_().unwrap();
        if let Some(snap) = snapshot {
            sm.update_state_machine(snap).await;
        }
        Ok(sm)
    }
    async fn update_state_machine(
        &mut self,
        snapshot: StoredSnapshot
    ) -> Result<(), StorageIOError<NodeId>>{
        let kvs:BTreeMap<String,String> = serde_json::from_slice(&snapshot.data)
            .map_err(|e| StorageIOError::read_snapshot(Some(snapshot.meta.signature()), &e)).unwrap();

        self.data.last_applied_log_id=snapshot.meta.last_log_id;
        self.data.last_membership = snapshot.meta.last_membership.clone();

        let mut x = self.data.kv.write().await;
        *x = kvs;

        Ok(())
    }
    fn get_current_snapshot_(&self) -> StorageResult<Option<StoredSnapshot>>{
        Ok(self
            .db
            .get_cf(self.store(), b"snapshot")
            .map_err(|e| StorageError::IO {
                source: StorageIOError::read(&e),
            })?
            .and_then(|v| serde_json::from_slice(&v).ok()))
    }
    fn set_current_snapshot_(&self, snap: StoredSnapshot) -> StorageResult<()> {
        self.db
            .put_cf(self.store(), b"snapshot", serde_json::to_vec(&snap).unwrap().as_slice())
            .map_err(|e| StorageError::IO {
                source: StorageIOError::write_snapshot(Some(snap.meta.signature()), &e),
            })?;
        self.flush(ErrorSubject::Snapshot(Some(snap.meta.signature())), ErrorVerb::Write)?;
        Ok(())
    }
    fn flush(&self, subject: ErrorSubject<NodeId>, verb: ErrorVerb) -> Result<(), StorageIOError<NodeId>> {
        self.db.flush_wal(true).map_err(|e| StorageIOError::new(subject, verb, AnyError::new(&e)))?;
        Ok(())
    }

    fn store(&self) -> &ColumnFamily{
        self.db.cf_handle("store").unwrap()
    }
}

impl RaftSnapshotBuilder<TypeConfig> for StateMachineStore {
    async fn build_snapshot(&mut self) -> Result<Snapshot<TypeConfig>, StorageError<NodeId>> {
        let last_applied_log = self.data.last_applied_log_id;
        let last_membership = self.data.last_membership.clone();
        let kv = {
            let kvs = self.data.kv.read().await;
            serde_json::to_vec(
                &*kvs
            )
            .map_err(|e| StorageIOError::read_state_machine(&e))?
        };
        let snapshot_id = if let Some(last) = last_applied_log {
            format!("{}-{}-{}", last.leader_id, last.index, self.snapshot_idx)
        } else {
            format!("--{}", self.snapshot_idx)
        };

        let meta = SnapshotMeta {
            last_log_id: last_applied_log,
            last_membership,
            snapshot_id,
        };

        let snapshot = StoredSnapshot {
            meta: meta.clone(),
            data: kv.clone(),
        };

        self.set_current_snapshot_(snapshot)?;

        Ok(Snapshot {
            meta,
            snapshot: Box::new(Cursor::new(kv)),
        })
    }
}

impl RaftStateMachine<TypeConfig> for StateMachineStore {
    #[doc = " Snapshot builder type."]
    type SnapshotBuilder = Self;

    #[doc = " Returns the last applied log id which is recorded in state machine, and the last applied"]
#[doc = " membership config."]
#[doc = ""]
#[doc = " ### Correctness requirements"]
#[doc = ""]
#[doc = " It is all right to return a membership with greater log id than the"]
#[doc = " last-applied-log-id."]
    async fn applied_state(
        &mut self
    ) -> Result<(Option<LogId<NodeId>>, StoredMembership<TypeConfig>), StorageError<NodeId>>{
        Ok(
            (
                self.data.last_applied_log_id,
                self.data.last_membership.clone()
            )
        )
    }

    #[doc = " Apply the given payload of entries to the state machine."]
#[doc = ""]
#[doc = " The Raft protocol guarantees that only logs which have been _committed_, that is, logs which"]
#[doc = " have been replicated to a quorum of the cluster, will be applied to the state machine."]
#[doc = ""]
#[doc = " This is where the business logic of interacting with your application\'s state machine"]
#[doc = " should live. This is 100% application specific. Perhaps this is where an application"]
#[doc = " specific transaction is being started, or perhaps committed. This may be where a key/value"]
#[doc = " is being stored."]
#[doc = ""]
#[doc = " For every entry to apply, an implementation should:"]
#[doc = " - Store the log id as last applied log id."]
#[doc = " - Deal with the business logic log."]
#[doc = " - Store membership config if `RaftEntry::get_membership()` returns `Some`."]
#[doc = ""]
#[doc = " Note that for a membership log, the implementation need to do nothing about it, except"]
#[doc = " storing it."]
#[doc = ""]
#[doc = " An implementation may choose to persist either the state machine or the snapshot:"]
#[doc = ""]
#[doc = " - An implementation with persistent state machine: persists the state on disk before"]
#[doc = "   returning from `apply_to_state_machine()`. So that a snapshot does not need to be"]
#[doc = "   persistent."]
#[doc = ""]
#[doc = " - An implementation with persistent snapshot: `apply_to_state_machine()` does not have to"]
#[doc = "   persist state on disk. But every snapshot has to be persistent. And when starting up the"]
#[doc = "   application, the state machine should be rebuilt from the last snapshot."]
    async fn apply<I>(&mut self, entries: I) -> Result<Vec<Response>, StorageError<NodeId>>
    where
        I: IntoIterator<Item = typ::Entry> + OptionalSend,
        I::IntoIter: OptionalSend,
    {
        let entries = entries.into_iter();
        let mut replies = Vec::with_capacity(
            entries.size_hint().0
        );

        for ent in entries {
            self.data.last_applied_log_id = Some(ent.log_id);
            let mut rep = None;

            match ent.payload {
                EntryPayload::Blank => todo!(),
                EntryPayload::Normal(req) => {
                    match req {
                        Request::Set { key, value } => {
                            rep = Some(value.clone());

                            let mut st = self.data.kv.write().await;
                            st.insert(key, value);
                        }
                    }
                },
                EntryPayload::Membership(mem) => {
                    self.data.last_membership = StoredMembership::new(
                        Some(ent.log_id),
                        mem
                    )
                },
            }
            replies.push(Response {
                value: rep
            })
        }
        Ok(replies)
    }

    #[doc = " Get the snapshot builder for the state machine."]
#[doc = ""]
#[doc = " Usually it returns a snapshot view of the state machine(i.e., subsequent changes to the"]
#[doc = " state machine won\'t affect the return snapshot view), or just a copy of the entire state"]
#[doc = " machine."]
#[doc = ""]
#[doc = " The method is intentionally async to give the implementation a chance to use"]
#[doc = " asynchronous sync primitives to serialize access to the common internal object, if"]
#[doc = " needed."]
    async fn get_snapshot_builder(&mut self) -> Self::SnapshotBuilder {
        self.snapshot_idx += 1;
        self.clone()
    }

    #[doc = " Create a new blank snapshot, returning a writable handle to the snapshot object."]
#[doc = ""]
#[doc = " Openraft will use this handle to receive snapshot data."]
#[doc = ""]
#[doc = " See the [storage chapter of the guide][sto] for details on log compaction / snapshotting."]
#[doc = ""]
#[doc = " [sto]: crate::docs::getting_started#3-implement-raftlogstorage-and-raftstatemachine"]
async fn begin_receiving_snapshot(&mut self) -> Result<Box<Cursor<Vec<u8>>>, StorageError<NodeId>> {
        Ok(
            Box::new(
                Cursor::new(
                    Vec::new()
                )
            )
        )
    }

    #[doc = " Install a snapshot which has finished streaming from the leader."]
#[doc = ""]
#[doc = " Before this method returns:"]
#[doc = " - The state machine should be replaced with the new contents of the snapshot,"]
#[doc = " - the input snapshot should be saved, i.e., [`Self::get_current_snapshot`] should return it."]
#[doc = " - and all other snapshots should be deleted at this point."]
#[doc = ""]
#[doc = " ### snapshot"]
#[doc = ""]
#[doc = " A snapshot created from an earlier call to `begin_receiving_snapshot` which provided the"]
#[doc = " snapshot."]
    async fn install_snapshot(
        &mut self,
        meta: &SnapshotMeta<TypeConfig>,
        snapshot: Box<SnapshotData>,
    ) -> Result<(), StorageError<NodeId>> {
        let new_snapshot = StoredSnapshot {
            meta: meta.clone(),
            data: snapshot.into_inner()
        };
        self.update_state_machine(new_snapshot.clone()).await?;
        self.set_current_snapshot_(new_snapshot)?;
        
        Ok(())
    }

    #[doc = " Get a readable handle to the current snapshot."]
#[doc = ""]
#[doc = " ### implementation algorithm"]
#[doc = ""]
#[doc = " Implementing this method should be straightforward. Check the configured snapshot"]
#[doc = " directory for any snapshot files. A proper implementation will only ever have one"]
#[doc = " active snapshot, though another may exist while it is being created. As such, it is"]
#[doc = " recommended to use a file naming pattern which will allow for easily distinguishing between"]
#[doc = " the current live snapshot, and any new snapshot which is being created."]
#[doc = ""]
#[doc = " A proper snapshot implementation will store last-applied-log-id and the"]
#[doc = " last-applied-membership config as part of the snapshot, which should be decoded for"]
#[doc = " creating this method\'s response data."]
    async fn get_current_snapshot(&mut self) -> Result<Option<Snapshot<TypeConfig>>, StorageError<NodeId>> {
        let x = self.get_current_snapshot_()?;
        Ok(
            x.map(
                |s| Snapshot {
                    meta:s.meta.clone(),
                    snapshot: Box::new(Cursor::new(s.data.clone()))
                }
            )
        )
    }
}

#[derive(Debug, Clone)]
pub struct LogStore {
    db: Arc<DB>,
}

/// converts an id to a byte vector for storing in the database.
/// Note that we're using big endian encoding to ensure correct sorting of keys
fn id_to_bin(id: u64) -> Vec<u8> {
    let mut buf = Vec::with_capacity(8);
    buf.write_u64::<BigEndian>(id).unwrap();
    buf
}

fn bin_to_id(buf: &[u8]) -> u64 {
    (&buf[0..8]).read_u64::<BigEndian>().unwrap()
}

impl LogStore {
    fn store(&self) -> &ColumnFamily{
        self.db.cf_handle("store").unwrap()
    }
    fn logs(&self) -> &ColumnFamily {
        self.db.cf_handle("logs").unwrap()
    }
    fn flush(
        &self,
        subjects: ErrorSubject<NodeId>,
        verb: ErrorVerb
    ) -> Result<(), StorageError<NodeId>> {
        self.db.flush_wal(true)
            .map_err(|e| {
                let err = Err(e.to_string()).unwrap();
                StorageError::from_io_error(subjects, verb, err)
            })?;
        Ok(())
    }
    fn get_last_purged_(&self) -> StorageResult<Option<LogId<u64>>>{
        Ok(
            self.db
                .get_cf(self.store(), b"last_purged_log_id")
                .map_err(|e| StorageIOError::read(AnyError::new(&e)))?
                .and_then(|v| serde_json::from_slice(&v).ok())
        )
    }
    fn set_last_purged_(&self, log_id: LogId<NodeId>) -> StorageResult<()> {
        self.db
            .put_cf(
                self.store(),
                b"last_purged_log_id",
                serde_json::to_vec(&log_id)
                    .unwrap()
                    .as_slice()
            )
            .map_err(|e| StorageIOError::write(&e))?;

        self.flush(ErrorSubject::Store, ErrorVerb::Write)?;
        Ok(())
    }
    fn set_committed_(&self, committed: &Option<LogId<NodeId>>) -> Result<(), StorageError<NodeId>> {
        let json = serde_json::to_vec(committed).unwrap();

        self.db.put_cf(self.store(), b"committed", json).map_err(|e| StorageIOError::write(&e))?;

        self.flush(ErrorSubject::Store, ErrorVerb::Write)?;
        Ok(())
    }
    fn get_committed_(&self) -> StorageResult<Option<LogId<NodeId>>> {
        Ok(self
            .db
            .get_cf(self.store(), b"committed")
            .map_err(|e| StorageIOError::read(&e))?
            .and_then(|v| serde_json::from_slice(&v).ok()))
    }
    fn set_vote_(&self, vote: &Vote<NodeId>) -> StorageResult<()> {
        self.db
            .put_cf(self.store(), b"vote", serde_json::to_vec(vote).unwrap())
            .map_err(|e| StorageIOError::write_vote(&e))?;

        self.flush(ErrorSubject::Vote, ErrorVerb::Write)?;
        Ok(())
    }

    fn get_vote_(&self) -> StorageResult<Option<Vote<NodeId>>> {
        Ok(self
            .db
            .get_cf(self.store(), b"vote")
            .map_err(|e| StorageIOError::write_vote(&e))?
            .and_then(|v| serde_json::from_slice(&v).ok()))
    }
}

impl RaftLogReader<TypeConfig> for LogStore {
    #[doc = " Get a series of log entries from storage."]
    #[doc = ""]
    #[doc = " ### Correctness requirements"]
    #[doc = ""]
    #[doc = " - The absence of an entry is tolerated only at the beginning or end of the range. Missing"]
    #[doc = "   entries within the range (i.e., holes) are not permitted and should result in a"]
    #[doc = "   `StorageError`."]
    #[doc = ""]
    #[doc = " - The read operation must be transactional. That is, it should not reflect any state changes"]
    #[doc = "   that occur after the read operation has commenced."]
    async fn try_get_log_entries<RB: RangeBounds<u64> + Clone + Debug + OptionalSend>(
        &mut self,
        range: RB,
    ) -> StorageResult<Vec<Entry<TypeConfig>>> {
        let start = match range.start_bound() {
            std::ops::Bound::Included(x) => id_to_bin(*x),
            std::ops::Bound::Excluded(x) => id_to_bin(*x + 1),
            std::ops::Bound::Unbounded => id_to_bin(0),
        };
        self.db
            .iterator_cf(self.logs(), rocksdb::IteratorMode::From(&start, rocksdb::Direction::Forward))
            .map(|res| {
                let (id, val) = res.unwrap();
                let entry: StorageResult<Entry<_>> = serde_json::from_slice(&val).map_err(|e| StorageError::IO {
                    source: StorageIOError::read_logs(&e),
                });
                let id = bin_to_id(&id);

                assert_eq!(Ok(id), entry.as_ref().map(|e| e.log_id.index));
                (id, entry)
            })
            .take_while(|(id, _)| range.contains(id))
            .map(|x| x.1)
            .collect()
    }

    #[doc = " Return the last saved vote by [`RaftLogStorage::save_vote`]."]
    #[doc = ""]
    #[doc = " A log reader must also be able to read the last saved vote by [`RaftLogStorage::save_vote`],"]
    #[doc = " See: [log-stream](`crate::docs::protocol::replication::log_stream`)"]
    async fn read_vote(&mut self) -> Result<Option<Vote<NodeId>>, StorageError<NodeId>> {
        self.get_vote_()
    }
}

impl RaftLogStorage<TypeConfig> for LogStore {
    type LogReader = Self;
    async fn get_log_state(
        &mut self
    ) -> StorageResult<LogState<TypeConfig>>{
        let last = self.db.iterator_cf(
            self.logs(),
            rocksdb::IteratorMode::End
        )
        .next()
        .and_then(
            |res| {
                let (_,err) = res.unwrap();
                Some(
                    serde_json::from_slice::<Entry<TypeConfig>>(&err)
                    .ok()?
                    .log_id
                )
            }
        );

        let last_purged_log_id = self.get_last_purged_()?;

        let last_log_id = match last {
            None => last_purged_log_id,
            Some(x) => Some(x)
        };

        Ok(
            LogState {
                last_log_id,
                last_purged_log_id
            }
        )
    }
    async fn save_committed(
        &mut self,
        _comitted:Option<LogId<NodeId>>,
    ) -> Result<(), StorageError<NodeId>>{
        self.set_committed_(&_comitted);
        Ok(())
    }
    async fn read_committed(
        &mut self,
    ) -> StorageResult<Option<LogId<NodeId>>>{
        Ok(
            self.get_committed_()?
        )
    }

    async fn save_vote(
        &mut self,
        vote: &Vote<NodeId>
    ) -> StorageResult<()>{
        self.set_vote_(vote)
    }
    async fn append<I>(
        &mut self,
        entries: I,
        callback: LogFlushed<TypeConfig>
    ) -> StorageResult<()>
    where 
        I: IntoIterator<Item = Entry<TypeConfig>> + Send,
        I::IntoIter: Send,
    {
        for entry in entries {
            let id = id_to_bin(entry.log_id.index);
            assert_eq!(bin_to_id(&id), entry.log_id.index);
            self.db
                .put_cf(
                    self.logs(),
                    id,
                    serde_json::to_vec(&entry)
                        .map_err(|e| StorageIOError::write_logs(&e))?,
                )
                .map_err(|e| StorageIOError::write_logs(&e))?;
        }
        callback.log_io_completed(Ok(()));
        Ok(())
    }

    #[doc = " Truncate logs since `log_id`, inclusive"]
    #[doc = ""]
    #[doc = " ### To ensure correctness:"]
    #[doc = ""]
    #[doc = " - It must not leave a **hole** in logs."]
    async fn truncate(&mut self,log_id:LogId<NodeId>) -> StorageResult<()> {
        let from = id_to_bin(log_id.index);
        let to = id_to_bin(0xff_ff_ff_ff_ff_ff_ff_ff);
        self.db.delete_range_cf(
            self.logs(),
            &from,
            &to
        )
            .map_err(|e| StorageIOError::write_logs(&e).into())
    }

    async fn purge(
        &mut self,
        log_id: LogId<NodeId>
    ) -> StorageResult<()>{
        self.set_last_purged_(log_id)?;
        let from = id_to_bin(0);
        let to = id_to_bin(log_id.index + 1);
        self.db.delete_range_cf(self.logs(), &from, &to)
            .map_err(|e| StorageIOError::write_logs(&e).into())
    }
    
    #[doc = " Get the log reader."]
    #[doc = ""]
    #[doc = " The method is intentionally async to give the implementation a chance to use asynchronous"]
    #[doc = " primitives to serialize access to the common internal object, if needed."]
    async fn get_log_reader(&mut self) -> Self::LogReader {
        self.clone()
    }    
}

pub async  fn create_store<P: AsRef<Path>>(
    db_path: P
) -> (LogStore, StateMachineStore){
    let mut opts = Options::default();
    opts.create_missing_column_families(true);
    opts.create_if_missing(true);

    let store = ColumnFamilyDescriptor::new("store", Options::default());
    let logs = ColumnFamilyDescriptor::new("logs", Options::default());

    let db = DB::open_cf_descriptors(&opts, db_path, vec![store,logs]).unwrap();
    let db = Arc::new(db);

    let log_store = LogStore {
        db: db.clone()
    };
    let sm_store = StateMachineStore::new(db).await.unwrap();

    (log_store, sm_store)
}