//! swarm-sim CLI.
//!   swarm-sim run [--seed N] [--json PATH] [--quiet]   one recorded scenario, table to stdout
//!   swarm-sim sweep [FROM TO]                           invariants over many seeds, no table
//!   swarm-sim verify-recorded DIR [SEEDS...]            regenerate and compare against committed JSON
use std::process::ExitCode;
use swarm_sim::{report, sim};

fn arg_after(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

fn run_one(seed: u64) -> Result<(sim::Run, report::Summary), String> {
    let run = sim::run(&sim::Config::for_seed(seed))?;
    let sm = report::summarize(&run);
    Ok((run, sm))
}

fn cmd_run(args: &[String]) -> ExitCode {
    let seed = arg_after(args, "--seed").and_then(|s| s.parse().ok()).unwrap_or(1);
    let (run, sm) = match run_one(seed) {
        Ok(x) => x,
        Err(e) => return fail(&format!("setup failed: {e}")),
    };
    if !args.iter().any(|a| a == "--quiet") {
        report::print_run(&run, &sm);
    }
    if let Some(path) = arg_after(args, "--json") {
        let text = serde_json::to_string_pretty(&report::to_json(&run, &sm)).expect("json") + "\n";
        if let Err(e) = std::fs::write(&path, text) {
            return fail(&format!("cannot write {path}: {e}"));
        }
        println!("wrote {path}");
    }
    verdict_line(run.violations().len(), run.rounds.len())
}

fn cmd_sweep(args: &[String]) -> ExitCode {
    let from: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let to: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(200);
    let (mut bad, mut flips, mut fails) = (0, 0, 0);
    for seed in from..=to {
        let (run, sm) = match run_one(seed) {
            Ok(x) => x,
            Err(e) => return fail(&format!("seed {seed}: {e}")),
        };
        flips += sm.flip_succeeded as u32;
        fails += !sm.passed as u32;
        for v in run.violations() {
            bad += 1;
            println!("seed {seed} round {} {} {}", v.round, v.id, v.detail);
        }
    }
    println!("sweep seeds {from}..={to}: {} violations, {fails} FAIL verdicts, {flips} successful walk-flips", bad);
    if bad == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn cmd_verify(args: &[String]) -> ExitCode {
    let dir = args.get(2).cloned().unwrap_or_else(|| "swarm/runs".to_string());
    let seeds: Vec<u64> = if args.len() > 3 { args[3..].iter().filter_map(|s| s.parse().ok()).collect() } else { vec![1, 2, 3] };
    for seed in seeds {
        let (run, sm) = match run_one(seed) {
            Ok(x) => x,
            Err(e) => return fail(&e),
        };
        let fresh = serde_json::to_string_pretty(&report::to_json(&run, &sm)).expect("json") + "\n";
        let path = format!("{dir}/run-{seed}.json");
        match std::fs::read_to_string(&path) {
            Ok(old) if old == fresh => println!("recorded run-{seed}.json reproduces byte-for-byte"),
            Ok(_) => return fail(&format!("{path} differs from a fresh run of seed {seed} (re-record with scripts/swarm-record.sh)")),
            Err(e) => return fail(&format!("cannot read {path}: {e}")),
        }
    }
    ExitCode::SUCCESS
}

fn verdict_line(violations: usize, rounds: usize) -> ExitCode {
    if violations == 0 {
        println!("\nINVARIANTS HELD in {rounds} of {rounds} rounds and at settlement\nSWARM GREEN");
        ExitCode::SUCCESS
    } else {
        println!("\n{violations} INVARIANT VIOLATIONS\nSWARM RED");
        ExitCode::FAILURE
    }
}

fn fail(msg: &str) -> ExitCode {
    eprintln!("{msg}");
    ExitCode::FAILURE
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("run") => cmd_run(&args),
        Some("sweep") => cmd_sweep(&args),
        Some("verify-recorded") => cmd_verify(&args),
        _ => fail("usage: swarm-sim run [--seed N] [--json PATH] [--quiet] | sweep [FROM TO] | verify-recorded DIR [SEEDS]"),
    }
}
