# CAP-0 report — Mumbai Civic Lens v1.2.3 (Windows-host run)

**Verdict: `CAP0_PASS`**
**Date:** 2026-11-20 (IST) · **Operator:** Claude Sonnet 5.5, High effort · **Package:** v1.2.3 · **Opus not invoked.**

**Reason:** every mandatory gate passed on the real Windows host. The first run ended `CAP0_BLOCKED` because no Podman machine could start; after the user updated WSL to 3.0.5.0 and approved NAT networking, a rootless Podman machine runs PostgreSQL 17.5 + PostGIS 3.5.2 healthy, SRID 32643 is present and the image digest is resolved. This is **not** a release approval: P-13 and P-14 stay open, and a medium finding (`CAP0-F08`, host workarounds) remains open. P1 may begin.

## 0. Evidence-environment key

| Tag | Meaning |
|---|---|
| `WIN-HOST` | Command ran on the real Windows host. PowerShell 5.1 for the prescribed cmdlets; Git Bash (MSYS) invoking native Windows executables for everything else. |
| `WSL2/PODMAN` | Command inspected WSL2 or the Podman machine distro from the host. |
| `UI-HUMAN` | Value reported by the user from the visible model selector; not command evidence. |
| `SANDBOX-PRIOR` | From the earlier Linux-sandbox session. Not host evidence and satisfies no gate. |
| `REGISTRY-OBSERVED` | Read over the network from a registry. Not a local image; not used in `PACKAGE_LOCK.json`. |

Raw command logs were kept outside the repository; this report holds the concise outputs.

## 1. Execution-mode gate (WIN-HOST) — PASS

| Command | Result |
|---|---|
| `Get-Location` | `C:\Projects\Mumbai Civic Lens\mumbai-civic-lens` |
| `$PSVersionTable` | PSVersion 5.1.22621.6345, Desktop |
| `cmd /c ver` | `Microsoft Windows [Version 10.0.22631.6649]` |
| `Get-Command git` / `wsl` | `C:\Program Files\Git\mingw64\bin\git.exe` 2.51.2.1 / `C:\Windows\system32\wsl.exe` |
| `Get-Command podman` | **not on session PATH** (found later at `%LOCALAPPDATA%\Programs\Podman\podman.exe`, user-scope install) |
| `Get-Command cargo` / `pnpm` / `python` | `~\.cargo\bin\cargo.exe` / `%APPDATA%\npm\pnpm.ps1` / `C:\Python313\python.exe` |

## 2. Evidence matrix

| Gate | Exact command | Env | Concise output | Exit | Status | Artifact | Remaining risk |
|---|---|---|---|---|---|---|---|
| A | `git --version` | WIN-HOST | `git version 2.51.2.windows.1` | 0 | PASS | — | — |
| A | `git rev-parse --show-toplevel` (before init) | WIN-HOST | `fatal: not a git repository` (no `.git` in folder or parents) | 128 | FAIL → resolved | — | — |
| A | `git init -b main` in canonical folder; `git config core.autocrlf false` (local) | WIN-HOST | Initialised; global `core.autocrlf=true` would rewrite LF files and break manifest hashes | 0 | PASS | `.git/` | Local-only setting; a clone must also keep LF |
| A | `git rev-parse --show-toplevel` / `git branch --show-current` / `git log -1 --oneline` | WIN-HOST | `C:/Projects/Mumbai Civic Lens/mumbai-civic-lens` / `main` / `099f36b chore: establish v1.2.3 pre-cap0 baseline` | 0 | PASS | — | — |
| A | `git check-ignore -v .env.local` / `git ls-files .env.local` | WIN-HOST | `.gitignore:1:.env.local` / empty | 0 / 0 | PASS | — | — |
| B | `Get-ComputerInfo \| Select WindowsProductName,WindowsVersion,OsBuildNumber,OsArchitecture` | WIN-HOST | "Windows 10 Enterprise" (product-name quirk), 2009, build 22631, 64-bit; `cmd /c ver` shows 10.0.22631.6649 (Windows 11 Enterprise) | 0 | PASS | — | — |
| B | `wsl --status` / `wsl --version` / `wsl -l -v` | WIN-HOST | Default distro Ubuntu, default v2; WSL 2.3.24.0, kernel 5.15.153.1-2; Ubuntu v2, docker-desktop v2 (both Stopped at capture) | 0 | PASS | — | WSL kernel is old (see CAP0-F04) |
| C | `podman --version` | WIN-HOST | `podman version 6.1.4` | 0 | PASS | — | Not on session PATH |
| C | `podman machine list` / `podman system connection list` | WIN-HOST | Empty before init. Default provider is `hyperv`; WSL machine needs `CONTAINERS_MACHINE_PROVIDER=wsl` | 0 | PASS (state recorded) | — | — |
| C | `podman machine init` (default provider) | WIN-HOST | Pulled `quay.io/podman/machine-os:6.1`, then `Error: no results found` / `elevated process failed` (Hyper-V) | 125 | FAIL | — | — |
| C | `podman machine init --provider wsl` (user approved) | WIN-HOST | `Machine init complete`; `podman-machine-default` (wsl, rootless, 6 CPU, 2 GiB, 100 GiB) | 0 | PASS | — | ~2.9 GB under `~\.local\share\containers` |
| C | `podman machine start` | WIN-HOST | `machine did not transition into running state: ssh error: machine not in running state` | 125 | **FAIL** | — | CAP0-F04 |
| C | `podman compose version`, `podman info` | WIN-HOST | `Cannot connect to Podman … dial tcp 127.0.0.1:56287 … refused`; `info` shows only `provider: wsl`, `version: 6.1.4` | 125 | FAIL (superseded by the later rows) | — | — |
| C-diag | `wsl -d podman-machine-default … systemd` | WSL2/PODMAN | Fedora 44 / systemd 259 exits rc=1 at once; distro cgroups hybrid v1 (`/sys/fs/cgroup/unified`, cpuset, cpu, …) | — | Diagnosed | — | — |
| C-diag | Added `kernelCommandLine=cgroup_no_v1=all` to `~/.wslconfig` (user approved), `wsl --shutdown`, `podman machine start` | WIN-HOST | systemd and sshd now run, sshd listens on 0.0.0.0:56287, but start still fails: `machine is not listening on ssh port`; Windows cannot connect (`Connection refused`, `Test-NetConnection` False) | 125 | FAIL | — | — |
| C-diag | Changed `networkingMode=mirrored` → `nat` (user approved), `wsl --shutdown`, `podman machine start` | WIN-HOST | Same failure. `ip addr` in both podman distro and Ubuntu shows **only `lo`**; `Get-NetAdapter -IncludeHidden`: `vEthernet (WSL (Hyper-V firewall))` and `vSwitch (…)` **Not Present**; a plain `http.server` in WSL is unreachable from Windows. Hyper-V firewall `DefaultInboundAction: Block` on the WSL VM. | 125 | FAIL | — | Needs elevated/OS action |
| C-diag | Restored `~/.wslconfig` to as-found (`cmp` identical to backup), `wsl --shutdown` | WIN-HOST | Backup kept at `~/.wslconfig.bak-cap0-20261120162547` | 0 | Restored | — | Machine distro left stopped, not deleted |
| D | `rustc -Vv` / `cargo -V` | WIN-HOST | `rustc 1.85.0 (4d91de4e4 2025-02-17)`, host `x86_64-pc-windows-msvc`, LLVM 19.1.7 / `cargo 1.85.0 (d73d2caf9 2024-12-31)` | 0 | PASS | — | Old stable; toolchain deliberately not changed |
| D | `rustup show` | WIN-HOST | Active `stable-x86_64-pc-windows-msvc` (override: repo `rust-toolchain.toml`); rustfmt and clippy installed | 0 | PASS | — | — |
| D | `cargo metadata --no-deps --format-version 1` | WIN-HOST | Workspace members `mcl-api`, `mcl-domain`, `mcl-application`, `mcl-infrastructure` | 0 | PASS | — | — |
| D/L | `cargo check --workspace` (first run, default sparse index) | WIN-HOST | `https://index.crates.io/config.json` → **HTTP 403** (corporate proxy page) | 101 | FAIL | — | — |
| D/L | `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo check --workspace` | WIN-HOST | Fresh resolution picked `time 0.3.55`, `uuid 1.29.3`, `icu_* 2.4.0` needing rustc 1.88–1.89 → `Either upgrade rustc or select compatible dependency versions` | 101 | FAIL | — | — |
| K | `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo generate-lockfile` | WIN-HOST | Wrote `Cargo.lock` (236 packages; axum 0.8.9, tokio 1.54.1, sqlx 0.8.6, time 0.3.45, uuid 1.26.1) | 0 | PASS | `Cargo.lock` | Toolchain-bound lock (CAP0-F05) |
| L | `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo check --workspace --locked` | WIN-HOST | `Finished dev profile … in 3m 46s`, no warnings or errors | 0 | **PASS** | — | — |
| E | `node --version` / `corepack --version` / `pnpm --version` | WIN-HOST | `v22.14.0` / `0.31.0` / `11.28.9` (global npm pnpm is 12.10.1; `packageManager` selected 11.28.9) | 0 | PASS | — | — |
| E | Inspect `package.json`, `pnpm-workspace.yaml`, `apps/web/package.json` | WIN-HOST | `packageManager: pnpm@11.28.9` unchanged; workspace `apps/*`; scripts `dev`, `build` (`tsc -b && vite build`), `test` (`vitest run`) | — | PASS | — | — |
| F | `python --version` / `Get-Command python` / `sys.executable` | WIN-HOST | `Python 3.13.1` / `C:\Python313\python.exe` / `C:\Python313\python.exe` | 0 | PASS | — | — |
| F | `import yaml` / `import jsonschema` | WIN-HOST | PyYAML `6.0.3` / jsonschema `4.24.0` (global site-packages; no venv needed) | 0 | PASS | — | — |
| G | `.env.local` creation (random 48-hex local password) and presence check | WIN-HOST | `POSTGRES_PASSWORD`, `DATABASE_URL`, `API_PORT`, `VITE_API_BASE_URL`, `DEMO_MODE` all PRESENT; no placeholder left; contents never printed | 0 | PASS | `.env.local` (ignored) | — |
| G | `git check-ignore -v .env.local`; `git ls-files .env.local` | WIN-HOST | `.gitignore:1:.env.local`; empty | 0 | PASS | — | — |
| G | `ANTHROPIC_API_KEY` (Process, User, Machine scope) | WIN-HOST | **ABSENT** in all three | 0 | PASS | — | — |
| G | Bounded secret-pattern grep (AWS, `sk-ant-`, private-key headers, `gh*_`, Slack, Google) over the repo and `docs/` | WIN-HOST | No matches; no hard-coded password assignments | 1 (no match) | PASS | — | Pattern scan, not exhaustive |
| H | `python -B scripts/validate_package.py` (on provisional state, before changes) | WIN-HOST | `PACKAGE VALID` | 0 | PASS | — | — |
| H | `python -B scripts/validate_package.py --release` | WIN-HOST | `PACKAGE INVALID`, only 6× `placeholder test tests/e2e/journey-{1..6}.spec.ts` | 1 | **EXPECTED_FAIL** | — | Placeholders stay until P-13; `TESTING.md`: placeholders block release mode |
| H/K | Final `python -B scripts/validate_package.py` after lockfiles, manifest refresh (90 entries) and all edits | WIN-HOST | `PACKAGE VALID` | 0 | **PASS** | `PACKAGE_MANIFEST.json` | — |
| H/K | Final `python -B scripts/validate_package.py --release` | WIN-HOST | `PACKAGE INVALID`, only the 6 placeholder journey specs | 1 | **EXPECTED_FAIL** | — | Release readiness is not claimed |
| M | `pnpm install` (first install, no lockfile) | WIN-HOST | `Packages: +117`, wrote `pnpm-lock.yaml` (lockfileVersion 9.0) | 1 | FAIL → fixed | `pnpm-lock.yaml` | `[ERR_PNPM_IGNORED_BUILDS] esbuild@0.25.12` (CAP0-F07) |
| M | `pnpm approve-builds '!esbuild'` | WIN-HOST | `allowBuilds: esbuild: false` added to `pnpm-workspace.yaml` | 0 | PASS | `pnpm-workspace.yaml` | — |
| M | `pnpm install --frozen-lockfile` | WIN-HOST | `Lockfile is up to date … Already up to date` | 0 | **PASS** | — | — |
| M | `pnpm --filter web build` | WIN-HOST | `tsc -b && vite build`: 26 modules, `dist/` produced; **but** `tsc -b` emitted `apps/web/src/main.js` and `tsconfig.tsbuildinfo` (CAP0-F06) | 0 | PASS → fixed | — | — |
| M | After `noEmit` + `tsBuildInfoFile` fix: `pnpm --filter web build` | WIN-HOST | Builds, nothing emitted outside `dist/` and `node_modules/` | 0 | **PASS** | `apps/web/tsconfig.json` | — |
| C | After WSL update to 3.0.5.0 (kernel 6.18): `podman machine start` (first attempt, old machine gone: `VM does not exist`); `podman machine init --provider wsl` | WIN-HOST | Machine re-created; `systemd` now runs (cgroup v2); still no Windows→WSL reachability under `networkingMode=mirrored` (only `lo`) | 0 / 125 | FAIL → fixed below | — | — |
| C | `networkingMode=nat` in `~/.wslconfig` (user approved a second time), `wsl --shutdown`, `wsl -d Ubuntu ip addr` | WIN-HOST | `wsl: Failed to configure network (networkingMode Nat), falling back to networkingMode Consomme.` then `eth0` 100.96.136.225/15; Windows `Connection` to the machine's sshd (`SSH-2.0-OpenSSH_10.2`) succeeds | 0 | PASS | `~/.wslconfig` (outside repo) | Config differs from as-found (CAP0-F08) |
| C | `podman machine start` (several runs) | WIN-HOST | Ends `exit 125` (`ssh handshake … forcibly closed`) after minutes, but `podman machine list` → `Currently running`; `win-sshproxy` needed TEMP on a non-8.3 path to bind its socket | 125 | PASS (machine running; command exit non-zero, CAP0-F08) | — | Start command unreliable |
| C | `podman info` (selected) / `podman machine inspect` | WSL2/PODMAN | `rootless: true`, `cgroupVersion: v2`, `rootlessNetworkCmd: pasta`, `rootlessPortForwarder: rootlessport`, API/Version 6.1.4; `Rootful: false`, `UserModeNetworking: false` | 0 | **PASS (rootless proven)** | — | — |
| C | `podman system connection list` | WIN-HOST | `podman-machine-default` → `ssh://user@127.0.0.1:52664/run/user/1000/podman/podman.sock` (default), plus a `-root` connection (unused) | 0 | PASS | — | — |
| C | `podman compose version` (default Docker Compose v5.7.0 provider) | WIN-HOST | Version prints, but `compose ps/pull` fail: `failed to connect to the docker API at npipe:////./pipe/podman-machine-default` | 1 | FAIL → provider changed | — | CAP0-F08 |
| C | `podman compose version` with `PODMAN_COMPOSE_PROVIDER=…/podman-compose.exe` (venv outside repo) | WIN-HOST | `podman version 6.1.4` / `podman-compose version 1.6.0` | 0 | **PASS** | — | — |
| I | `podman compose --env-file .env.local config` (password masked in capture) | WIN-HOST | Service `db`: image `docker.io/postgis/postgis:17-3.5`, `POSTGRES_DB=civic_lens`, `POSTGRES_USER=civic`, volume `mcl_pg`, healthcheck `pg_isready -U civic -d civic_lens`, port 5432 | 0 | PASS | — | — |
| I | `podman compose … pull db` (before CA trust) | WIN-HOST | `x509: certificate signed by unknown authority` (corporate TLS inspection) | 125 | FAIL → fixed | — | — |
| I | Exported the Zscaler Root CA (already trusted by Windows) and added it to the **Podman VM** trust store only (`update-ca-trust`) | WSL2/PODMAN | `CA_INSTALLED_IN_VM` | 0 | PASS | — | CAP0-F08; host trust store untouched |
| I | `podman compose --env-file .env.local pull db` / `up -d db` / `ps` | WIN-HOST | Pulled and started `mumbai-civic-lens_db_1`; `Up 8 seconds (healthy)`, `0.0.0.0:5432->5432/tcp` | 0 / 0 / 0 | **PASS** | — | — |
| I | `podman exec … pg_isready -U civic -d civic_lens` | WSL2/PODMAN | `/var/run/postgresql:5432 - accepting connections` | 0 | **PASS** | — | — |
| I | `podman inspect … State` | WSL2/PODMAN | `running health=healthy` | 0 | **PASS** | — | — |
| I | `select version();` | WSL2/PODMAN | `PostgreSQL 17.5 (Debian 17.5-1.pgdg110+1) on x86_64-pc-linux-gnu` | 0 | **PASS** | — | — |
| I | `pg_extension` / `postgis_full_version()` | WSL2/PODMAN | `postgis 3.5.2` (already created by the image's init); `POSTGIS="3.5.2 dea6d0a" [EXTENSION] PGSQL="170" GEOS="3.9.0" PROJ="7.2.1"` | 0 | **PASS** | — | `pgcrypto` not installed (migration never applied, not required) |
| I | `select srid, auth_name, auth_srid from spatial_ref_sys where srid=32643` | WSL2/PODMAN | `32643|EPSG|32643|PROJCS["WGS 84 / UTM zone 43N" …` | 0 | **PASS** | — | — |
| I | Windows-side `Test-NetConnection 127.0.0.1 -Port 5432`; `podman ps` | WIN-HOST | `TcpTestSucceeded True`; the only container is `mumbai-civic-lens_db_1` (API and web are host-native) | 0 | PASS | — | — |
| J | `grep image: compose.yaml` | WIN-HOST | `docker.io/postgis/postgis:17-3.5` (configured reference) | 0 | PASS | — | — |
| J | `podman image inspect docker.io/postgis/postgis:17-3.5` | WIN-HOST | Local image ID `2ed748fc602dd3031c6724db8cb289e1578c2deb552a4f6e291f6f7e5e6e4f69`; RepoDigests `docker.io/postgis/postgis@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6` (index) and `…@sha256:8dfee83d8bd4c2873dc4a233c13ba2799a44f2edb16a0552d58715917fac32ba` (amd64 platform manifest); arch amd64 | 0 | **PASS** | `PACKAGE_LOCK.json` | — |
| J | `podman inspect mumbai-civic-lens_db_1` | WIN-HOST | Running container image ID `2ed748fc…6e4f69` = local image ID | 0 | **PASS** | `PACKAGE_LOCK.json` | — |
| N | Model visibility | UI-HUMAN | See §3 | — | RECORDED | — | — |

## 3. Claude model visibility (Gate N) — UI-HUMAN, not CLI evidence

| Item | Value |
|---|---|
| Visible in the selector (user-reported) | Opus 5.5, Sonnet 5, Haiku 4.5, Haiku 5.5, Sonnet 5.5 |
| CAP-0 operator / effort | Sonnet 5.5 / High |
| Mechanical-work candidate | Haiku 5.5 (not used) |
| Independent architecture/security and final audit | Opus 5.5 at High — **not invoked**; the ≥ $60 (20 %) reserve of the $300 budget is untouched. Actual spend is not visible to this session. |
| Command-based model listing | None exists; none invented |

## 4. Provisional-change review (Phase B)

The earlier Linux-sandbox session left `audit/CAP0_REPORT.md`, `audit/OPEN_FINDINGS.json` and `PACKAGE_MANIFEST.json` modified. File timestamps show these (and the reference guide, added 14:42) as the only files newer than the package's 09:00 stamp. The as-found state was preserved as baseline commit `099f36b`.

| Question | Decision and evidence |
|---|---|
| Does `audit/CAP0_REPORT.md` belong in the package? | Yes. `CLAUDE.md` names it as the CAP-0 deliverable and a template exists. It stays manifested; its hash is refreshed after every rewrite. This file replaces the sandbox report. |
| Does the reference guide belong in the manifested package? | It is not one of the original 86 files, is user-supplied, and is historical v1.2.2 background. It cannot override v1.2.3. The validator requires every physical file to be manifested and must not be weakened, so the file is kept at `docs/reference/` and hash-pinned with `required: false` (supplementary). Alternative (moving it out of the repo) was rejected as touching unreviewed user work. |
| Are `docs/reference` exclusions allowed? | The v1.2.3 validator has no such exclusion. None was added. |
| Must `Cargo.lock` / `pnpm-lock.yaml` be manifested? | Yes. The validator's exclusions omit both. The guide's alternative validator (which skips them) is v1.2.2 history and was not applied. |
| Were CAP0-F01/F02/F03 accurate? | F01 true and now resolved on the host. F02's "resolved by manifesting" is kept only as re-derived above. F03 true; resolved with real lockfiles. |
| Sandbox-only claims retained? | None. Every sandbox value (Linux git 2.34.1, Node 22.23.4, Python 3.10.12, jsonschema 4.26.0) is `SANDBOX-PRIOR` and unused. Its "ANTHROPIC_API_KEY absent" statement is replaced by the host check above. |

## 5. Bounded corrections applied

| ID | Change | Rationale |
|---|---|---|
| C-1 | `git init` + baseline `099f36b`; local `core.autocrlf=false` | No repository existed; keeps LF so manifest hashes stay stable. |
| C-2 | `Cargo.lock` generated with the MSRV-aware resolver | Host rustc 1.85.0; toolchain not changed per instructions. |
| C-3 | `pnpm-lock.yaml` generated; `allowBuilds: esbuild: false` in `pnpm-workspace.yaml` | pnpm 11 strict build-script policy; the build passes without esbuild's script. |
| C-4 | `apps/web/tsconfig.json`: `noEmit: true`, `tsBuildInfoFile` under `node_modules/.tmp` | `tsc -b` otherwise emits files that fail package validation. |
| C-5 | `PACKAGE_MANIFEST.json`: lockfiles added; guide `required: false`; hashes refreshed | Package-boundary policy above. |
| C-6 | `PACKAGE_LOCK.json`, `audit/OPEN_FINDINGS.json`, this report | Host evidence only. `PACKAGE_LOCK.json` status `CAP0_PASS`. |
| C-7 | Podman machine `podman-machine-default` created, then re-created after the WSL update removed it (both user approved) | No machine or volume was deleted by me; the earlier machine disappeared with the WSL update. |
| C-8 | `~/.wslconfig`: `kernelCommandLine=cgroup_no_v1=all` and `networkingMode=nat` tried then reverted once; final state is `networkingMode=nat` only (user approved) | Needed for Windows to WSL reachability. As-found copy: `~/.wslconfig.bak-cap0-20261120162547`; nat-step backup: `~/.wslconfig.bak-cap0-b-*`. |
| C-9 | Outside the repo: `TEMP`/`TMP` set to `C:/Users/<LOCAL_USER>/pmtmp`; stale `%TEMP%/podman` renamed `podman.stale-cap0`; podman-compose 1.6.0 venv in `pmtmp/venv`; Zscaler root CA added to the Podman VM trust store | See `CAP0-F08`. Nothing in the repo or the Windows trust store changed. |

No validator, schema, test or guardrail was weakened. No push. No Opus call.

## 6. Environment notes the next operator needs

Use these in every shell that talks to Podman (Git Bash shown):

```bash
export PATH="/c/Users/<LOCAL_USER>/AppData/Local/Programs/Podman:$PATH"
export CONTAINERS_MACHINE_PROVIDER=wsl
export TEMP='C:\Users\<LOCAL_USER>\pmtmp' TMP='C:\Users\<LOCAL_USER>\pmtmp'
export PODMAN_COMPOSE_PROVIDER='C:\Users\<LOCAL_USER>\pmtmp\venv\Scripts\podman-compose.exe'
podman compose --env-file .env.local up -d db
```

* `podman.exe` lives at `%LOCALAPPDATA%\Programs\Podman` and was not on the session PATH. The default provider is `hyperv`, so `CONTAINERS_MACHINE_PROVIDER=wsl` is required.
* `podman machine start` returns a non-zero exit code on this host (ssh handshake reset) but the machine reaches `Currently running`. Verify with `podman machine list` and `podman info` before trusting the exit code.
* The default Docker Compose provider cannot use the machine's named pipe here; podman-compose talks to the `podman` CLI directly and works.
* `index.crates.io` is blocked (HTTP 403) by the corporate proxy. `static.crates.io`, `registry.npmjs.org`, `quay.io`, `registry-1.docker.io`, `github.com` and `pypi.org` are reachable. Cargo works with `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git`.
* Docker Desktop 4.99.0 is installed. It was **not** substituted for rootless Podman (frozen architecture); its compose binary was only the (failing) default provider.
* The database container `mumbai-civic-lens_db_1` was left running (healthy) with volume `mumbai-civic-lens_mcl_pg`. The `.env.local` password was never printed; `compose config` captures were masked.

## 7. Open findings (see `audit/OPEN_FINDINGS.json`)

`CAP-0` RESOLVED (CAP0_PASS) · `CAP0-F01/F02/F03/F04/F06/F07` RESOLVED · `CAP0-F05` MEDIUM OPEN (old rustc, MSRV-aware lock, proxy blocks crates index) · `CAP0-F08` MEDIUM OPEN (host Podman workarounds) · `P-13` BLOCKER OPEN · `P-14` BLOCKER OPEN. `audit/CONTRADICTIONS.json` unchanged (no genuine contradiction among controlling files).

## 8. Next step

CAP-0 closes with the commit `chore(cap-0): verify host toolchain lockfiles and postgis digest`. The independent Opus audit (P-14) is a separate session and is not self-approved here. Rerun any Podman gate with the environment in §6 if the machine is stopped.

## 9. Authorized next state

**P1 may begin.** CAP0_PASS is not a release approval; P-13 and P-14 stay open.
