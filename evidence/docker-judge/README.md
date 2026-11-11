# Dockerfile.judge clean-container run (FG-01, FG-13), 2026-11-11, tree 402423f plus the Dockerfile fixes below

Host: Docker 29.5.2 (colima, aarch64). Commands: `docker build -f Dockerfile.judge -t kruxa-judge-fg01 .` then `docker run --rm --network none kruxa-judge-fg01`.

Result: `JUDGE PREBUILT GREEN`, 12 of 12 steps, wall 109 s (L1 narrated lifecycle on the real core wasm 100 s), run with `--network none`. `run.log`.

Three attempts, two real Dockerfile bugs found and fixed (the file had never been built):
1. `build-attempt1-FAILED-libudev.log`: `cargo install cargo-near` failed, hidapi needs libudev. Fix: add `libudev-dev` to apt.
2. `build-attempt2-bookworm-built-but-sandbox-glibc.log`, `run-attempt2-bookworm-L1-RED.log`, `L1-failure.log`: the image built but step L1 was RED, the
   near-sandbox 2.14.0 binary needs glibc 2.39 and bookworm has 2.36. Fix: base image `rust:1.95.0-trixie`.
3. `build.log`, `run.log`: GREEN.

Limits: the wasm in the image is a NON-reproducible build made inside the image (artifacts/BUILD-KIND says so), not the testnet hash. The base tag is not
digest pinned. The prebuilt run claims no tracks. The image and container were removed after the run. The build needs the network once.
