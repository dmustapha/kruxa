//! FG-24: proves which core bytes the sandbox suites deploy. With `KXI_CORE_WASM=artifacts/kruxa_core.wasm` the deployed code hash
//! must equal that file's sha256; with `KXI_CORE_WASM_SHA256=<hex>` the file itself must also equal the pinned hash (the testnet wasm).
use kruxa_tests::*;
use sha2::{Digest, Sha256};

fn sha256_hex(bytes: &[u8]) -> String {
    kruxa_logic::hex(&Sha256::digest(bytes))
}

#[tokio::test]
async fn sandbox_core_runs_the_bytes_named_by_the_override() -> anyhow::Result<()> {
    let wanted = sha256_hex(&core_wasm_bytes());
    if let Ok(pin) = std::env::var("KXI_CORE_WASM_SHA256") {
        assert_eq!(wanted, pin, "the core wasm the suites load is not the pinned one");
    }
    let env = Env::new().await?;
    let deployed = sha256_hex(&env.worker.view_code(env.core.id()).await?);
    assert_eq!(deployed, wanted, "the sandbox deployed different bytes than core_wasm_bytes()");
    eprintln!("CORE_WASM_SHA256 {deployed}");
    Ok(())
}
