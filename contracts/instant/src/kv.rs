//! Minimal persistent map and set over the raw storage host functions. `near_sdk::store` collections keep a BTreeMap cache
//! that costs about 18 KB of wasm; the launcher touches each record at most twice per call, so it does not need one.
use core::marker::PhantomData;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::env;

#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Map<K, V> {
    prefix: u8,
    #[borsh(skip)]
    _t: PhantomData<(K, V)>,
}

impl<K: BorshSerialize, V: BorshSerialize + BorshDeserialize> Map<K, V> {
    pub fn new(prefix: u8) -> Self {
        Map { prefix, _t: PhantomData }
    }

    fn path(&self, k: &K) -> Vec<u8> {
        let mut p = vec![self.prefix];
        k.serialize(&mut p).unwrap_or_else(|_| env::panic_str("R_MATH: key"));
        p
    }

    pub fn get(&self, k: &K) -> Option<V> {
        env::storage_read(&self.path(k)).map(|b| V::try_from_slice(&b).unwrap_or_else(|_| env::panic_str("R_MATH: stored value")))
    }

    pub fn insert(&mut self, k: K, v: V) {
        let bytes = borsh::to_vec(&v).unwrap_or_else(|_| env::panic_str("R_MATH: value"));
        env::storage_write(&self.path(&k), &bytes);
    }

    pub fn remove(&mut self, k: &K) {
        env::storage_remove(&self.path(k));
    }

    pub fn contains(&self, k: &K) -> bool {
        env::storage_has_key(&self.path(k))
    }
}
