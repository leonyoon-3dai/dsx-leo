# Leo DSX Fresh Brev Runbook

This is the tested, repeatable path for a disposable NVIDIA Brev Ubuntu L40S server. It was last verified end-to-end on July 13, 2026, including a real NVIDIA-hosted LLM response:

1. Add your SSH public key.
2. Install Codex CLI.
3. Authenticate NGC and download the DSX content pack.
4. Run the DSX one-copy setup/start block.
5. Enable and verify the AI Agent API.

The runtime path uses `run_streaming.sh` for the Omniverse Kit streaming server and `run_web.sh` for the Vite web frontend. Docker Compose files remain in the repo for container work, but this runbook intentionally uses direct launch because it matches the current repo layout.

## Ports To Open

Open these inbound ports on the Brev server before using Mac Chrome:

| Purpose | Protocol | Port(s) |
| --- | --- | --- |
| Web frontend, Vite dev server | TCP | `8081` |
| Kit WebRTC signaling | TCP | `49100` |
| Kit control / health | TCP | `8111` |
| DSX AI agent API | TCP | `8012` |
| WebRTC media | TCP + UDP | `47995-48012` |
| Additional WebRTC media | TCP + UDP | `49000-49007` |
| WebRTC UDP helper | UDP | `1024` |

Use the Brev public IP or hostname in the browser URL. From Mac Chrome, `localhost` means the Mac, not the Brev server.

If UFW is enabled on the instance, apply the same rules at the OS level:

```bash
sudo ufw allow 8081/tcp
sudo ufw allow 49100/tcp
sudo ufw allow 8111/tcp
sudo ufw allow 8012/tcp
sudo ufw allow 47995:48012/tcp
sudo ufw allow 47995:48012/udp
sudo ufw allow 49000:49007/tcp
sudo ufw allow 49000:49007/udp
sudo ufw allow 1024/udp
sudo ufw status
```

The Brev firewall/security-group rules must also allow these ports. Opening only UFW is not sufficient when the cloud-side rule is closed.

## 1. Add SSH Key

On the fresh Brev server, paste your Mac `id_rsa.pub` public key into `authorized_keys`:

```bash
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys
```

Paste the full public key line, then save and exit:

```text
Ctrl+O
Enter
Ctrl+X
```

Set SSH permissions:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

## 2. Install Codex CLI

Copy and run this block on the Brev server:

```bash
set -euo pipefail

echo "1/4 Ensuring Node.js and npm are installed"
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v20\.'; then
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "2/4 Installing Codex CLI with npm"
sudo npm install -g @openai/codex

echo "3/4 Verifying installation"
codex --version

echo "4/4 Starting Codex"
echo "Run this in any repository directory:"
echo "  codex"
```

## 3. Fresh Brev Server Runbook

This block was tested in this session. It logs setup output to `~/dsx-setup-run.log`, downloads and prepares the DSX content pack, starts Kit in the background with startup logs at `~/dsx-kit-streaming.log`, then starts the web frontend on port `8081`.

The current runbook also includes the fixes verified in this session:

- Installs `libglu1-mesa`, required by Kit MDL/RTX libraries (`libGLU.so.1`).
- Uses public PyPI if the Brev pip cache returns license/payment errors.
- Installs the full NGC CLI directory under `/opt/ngc-cli`.
- Starts local Kit/WebRTC directly with `run_streaming.sh` and `run_web.sh`.
- Uses a URL with `?server=<Brev IP>&signalingPort=49100`, so Mac Chrome connects to the Brev Kit server instead of local Mac `localhost`.
- The streaming app disables the built-in `omni.kit.viewport.ready` loading overlay, which caused the blue RTX loading spinner to remain visible even after the scene appeared.
- The web client treats SDK stream `status` as authoritative, so a connected stream clears the loading UI even when SDK `action` is not exactly `start`.

The DSX Content Pack is large: approximately 33GB compressed and substantially larger after extraction. Confirm free space first:

```bash
df -h / /data
```

### 3.1 NGC authentication and prompt meanings

Create an NGC API key in your NVIDIA NGC account. Never paste the key into this README, a Git commit, a chat message, or shell history. Read it silently into the current shell instead:

```bash
read -rsp "NGC API key: " NGC_CLI_API_KEY
echo
export NGC_CLI_API_KEY
```

The setup block installs NGC CLI before downloading. If you prefer a saved NGC CLI configuration, run `ngc config set` after the CLI is installed. Its prompts mean:

- `Enter API key`: paste the NGC API key.
- `Enter CLI output format type [ascii]. Choices: ['ascii', 'csv', 'json']:` press `Enter` to keep the normal human-readable `ascii` output.
- `Enter org`: enter the exact NGC organization name associated with the key. A Brev instance name is not automatically an NGC organization.
- Team/ACE prompts: press `Enter` unless your NGC organization explicitly requires one.

`Invalid org. Please re-enter.` means the organization text is not available to that API key. Re-enter the exact organization shown by the NGC account selector; do not use the Brev machine name merely because it appears in the cloud console. The environment-variable method above is preferable for a disposable instance because it does not write the key to the repository.

Confirm authentication without printing the secret:

```bash
test -n "${NGC_CLI_API_KEY:-}" && echo "NGC key is set" || echo "NGC key is missing"
```

### 3.2 Optional NVIDIA AI Agent key

The viewer works without an AI key, but the Agent requires an API key from NVIDIA Build. Enter it silently before running the setup block:

```bash
read -rsp "NVIDIA API key: " NVIDIA_API_KEY
echo
export NVIDIA_API_KEY
export DSX_AGENT_PORT=8012
test -n "$NVIDIA_API_KEY" && echo "NVIDIA API key is set"
```

Do not type `export NVIDIA_API_KEY="nvapi-..."` directly on a shared machine: that form can remain in shell history. The setup never prints the key.

### 3.3 Install, download, build, and start

Copy and run this whole block on the Brev server:

```bash
set -euo pipefail

REPO_URL="https://github.com/leonyoon-3dai/dsx-leo.git"
REPO_DIR="$HOME/dsx-leo"
NGC_RESOURCE="nvidia/omniverse/dsx_dataset:2.1"
DSX_DOWNLOAD_DIR="$HOME/ngc-dsx-download"
DSX_ASSETS_DIR_HOST="/data/dsx"
DSX_USD_HOST="/data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda"
KIT_LOG="$HOME/dsx-kit-streaming.log"
WEB_LOG="$HOME/dsx-web.log"
SETUP_LOG="$HOME/dsx-setup-run.log"

mkdir -p "$(dirname "$SETUP_LOG")"
exec > >(tee -a "$SETUP_LOG") 2>&1
echo "Setup log: $SETUP_LOG"

echo "1/10 Checking GPU"
nvidia-smi

echo "2/10 Preparing /data/dsx"
sudo mkdir -p "$DSX_ASSETS_DIR_HOST"
sudo chown -R "$USER:$USER" "$DSX_ASSETS_DIR_HOST"

echo "3/10 Installing base packages needed before clone/download"
sudo apt-get update
sudo apt-get install -y curl unzip rsync git git-lfs ca-certificates libglu1-mesa tmux
git lfs install
BREV_HOST="${BREV_HOST:-$(curl -fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}' || hostname)}"

echo "3b/10 Using public PyPI for Kit dependency builds"
if [ -f /etc/pip.conf ] && grep -q "mcache-dsm.massedcompute.com" /etc/pip.conf; then
  sudo cp /etc/pip.conf /etc/pip.conf.dsx-mcache-backup
  printf '%s\n' '[global]' 'index-url = https://pypi.org/simple' | sudo tee /etc/pip.conf >/dev/null
fi

echo "4/10 Cloning or updating repo"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" pull --ff-only
fi

cd "$REPO_DIR"

echo "5/10 Bootstrapping Ubuntu, Docker, NVIDIA Container Toolkit, Node.js, and submodules"
./scripts/brev_bootstrap_ubuntu.sh

echo "6/10 Installing NGC CLI if needed"
if ! command -v ngc >/dev/null 2>&1; then
  rm -rf /tmp/ngccli /tmp/ngccli_linux.zip
  curl -L -o /tmp/ngccli_linux.zip https://ngc.nvidia.com/downloads/ngccli_linux.zip
  unzip -q /tmp/ngccli_linux.zip -d /tmp/ngccli
  sudo rm -rf /opt/ngc-cli
  sudo install -d /opt/ngc-cli
  sudo cp -a /tmp/ngccli/ngc-cli/. /opt/ngc-cli/
  sudo ln -sf /opt/ngc-cli/ngc /usr/local/bin/ngc
fi
ngc --version

echo "7/10 Downloading DSX Content Pack from NGC"
if [ ! -f "$DSX_USD_HOST" ]; then
  mkdir -p "$DSX_DOWNLOAD_DIR"
  ngc registry resource download-version "$NGC_RESOURCE" --dest "$DSX_DOWNLOAD_DIR"
fi

echo "8/10 Preparing downloaded files in /data/dsx"
if [ ! -f "$DSX_USD_HOST" ]; then
  DSX_USD_FOUND="$(find "$DSX_DOWNLOAD_DIR" -path "*/DSX_BP/Assembly/DSX_Main_BP.usda" -print -quit)"
  if [ -z "$DSX_USD_FOUND" ]; then
    ARCHIVE_FOUND="$(find "$DSX_DOWNLOAD_DIR" -type f \( -name "*.zip" -o -name "*.tar.gz" -o -name "*.tgz" \) -print -quit)"
    if [ -n "$ARCHIVE_FOUND" ]; then
      case "$ARCHIVE_FOUND" in
        *.zip) unzip -q -o "$ARCHIVE_FOUND" -d "$DSX_ASSETS_DIR_HOST" ;;
        *.tar.gz|*.tgz) tar -xzf "$ARCHIVE_FOUND" -C "$DSX_ASSETS_DIR_HOST" ;;
      esac
    fi
  fi
fi

if [ ! -f "$DSX_USD_HOST" ]; then
  DSX_USD_FOUND="$(find "$DSX_DOWNLOAD_DIR" "$DSX_ASSETS_DIR_HOST" -path "*/DSX_BP/Assembly/DSX_Main_BP.usda" -print -quit)"
  if [ -n "$DSX_USD_FOUND" ]; then
    DSX_ROOT="$(dirname "$(dirname "$(dirname "$DSX_USD_FOUND")")")"
    rsync -a "$DSX_ROOT"/ "$DSX_ASSETS_DIR_HOST"/
  fi
fi

if [ ! -f "$DSX_USD_HOST" ]; then
  echo "DSX Content Pack download finished, but the expected USD was not found:"
  echo "  $DSX_USD_HOST"
  echo "Check downloaded files under:"
  echo "  $DSX_DOWNLOAD_DIR"
  exit 1
fi

echo "9/10 Starting Kit streaming server in a persistent tmux session"
tmux kill-session -t dsx-kit 2>/dev/null || true
if [ -n "${NVIDIA_API_KEY:-}" ] && tmux has-session 2>/dev/null; then
  tmux set-environment -g NVIDIA_API_KEY "$NVIDIA_API_KEY"
  tmux set-environment -g DSX_AGENT_PORT "${DSX_AGENT_PORT:-8012}"
fi
tmux new-session -d -s dsx-kit \
  "cd '$REPO_DIR' && export USD_URL='$DSX_USD_HOST' && exec ./run_streaming.sh >> '$KIT_LOG' 2>&1"
if [ -n "${NVIDIA_API_KEY:-}" ]; then
  tmux set-environment -g NVIDIA_API_KEY "$NVIDIA_API_KEY"
  tmux set-environment -g DSX_AGENT_PORT "${DSX_AGENT_PORT:-8012}"
fi
echo "Kit log: $KIT_LOG"
echo "Kit internal logs: ~/.nvidia-omniverse/logs/Kit/DSX\\ Streaming/2.0/"

echo "10/10 Starting web frontend in a persistent tmux session"
tmux kill-session -t dsx-web 2>/dev/null || true
tmux new-session -d -s dsx-web \
  "cd '$REPO_DIR' && exec ./run_web.sh >> '$WEB_LOG' 2>&1"

for _ in $(seq 1 60); do
  if ss -lnt | grep -q ':8081 ' && ss -lnt | grep -q ':49100 '; then
    break
  fi
  sleep 1
done

tmux list-sessions
ss -lnt | grep -E ':(8081|49100|8012)\\b' || true
echo "Open from Mac Chrome:"
echo "http://${BREV_HOST}:8081/?server=${BREV_HOST}&signalingPort=49100"
echo "If VS Code forwards only port 8081:"
echo "http://localhost:8081/?server=${BREV_HOST}&signalingPort=49100"
```

When the web server is running, open:

```text
http://<brev-public-ip-or-hostname>:8081?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

If VS Code forwards the Vite web port `8081`, open this from Mac Chrome instead:

```text
http://localhost:8081?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

Useful checks:

```bash
tmux list-sessions
tail -f ~/dsx-setup-run.log
tail -f ~/dsx-kit-streaming.log
tail -f ~/dsx-web.log
ls -lt ~/.nvidia-omniverse/logs/Kit/DSX\ Streaming/2.0/kit_*.log | head
ls -lh /data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda
ss -lntup | grep -E ':(8081|49100|8111|8012)\b'
nvidia-smi
```

If the web UI loads but the stream does not connect, check that the browser URL includes the Brev host twice:

```text
http://<brev-public-ip-or-hostname>:8081?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

For VS Code port forwarding, only the web host becomes `localhost`; the `server=` value must still be the Brev public IP or hostname:

```text
http://localhost:8081?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

If the Kit process starts but no rendered frames appear, search the latest Kit internal log:

```bash
LATEST_KIT_LOG="$(ls -t ~/.nvidia-omniverse/logs/Kit/DSX\ Streaming/2.0/kit_*.log | head -1)"
grep -E 'libGLU|Failed to load MDL|HydraEngine rtx failed|app ready|livestream' "$LATEST_KIT_LOG" | tail -80
```

Stop DSX:

```bash
tmux kill-session -t dsx-kit 2>/dev/null || true
tmux kill-session -t dsx-web 2>/dev/null || true
```

## 4. AI Agent verification

The 3D viewer and configurator can run without an NVIDIA API key. The AI chat agent needs `NVIDIA_API_KEY`.

Check that Kit sees the key without displaying it:

```bash
curl -sS http://127.0.0.1:8012/api/agent/health
```

Expected fields:

```json
{"status":"healthy","agent":"DSX Agent AIQ","agent_available":true,"api_key_set":true}
```

Health alone does not prove that the LLM configuration can complete a request. Run a real chat test:

```bash
curl -sS --max-time 150 \
  -H 'Content-Type: application/json' \
  --data-binary '{"message":"한 문장으로 현재 지원 가능한 기능을 설명해줘.","user_id":"readme-test","history":[]}' \
  http://127.0.0.1:8012/api/agent/chat
```

A successful response has a non-empty `response`, an `actions` array, and HTTP 200.

### Add or replace the AI key while DSX is already running

Enter the new key silently, copy it into tmux's global environment, and restart only Kit:

```bash
cd ~/dsx-leo
read -rsp "NVIDIA API key: " NVIDIA_API_KEY
echo
export NVIDIA_API_KEY
export DSX_AGENT_PORT=8012
tmux kill-session -t dsx-kit 2>/dev/null || true
if tmux has-session 2>/dev/null; then
  tmux set-environment -g NVIDIA_API_KEY "$NVIDIA_API_KEY"
  tmux set-environment -g DSX_AGENT_PORT "$DSX_AGENT_PORT"
fi
tmux new-session -d -s dsx-kit \
  "cd '$HOME/dsx-leo' && export USD_URL=/data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda && exec ./run_streaming.sh >> '$HOME/dsx-kit-streaming.log' 2>&1"
tmux set-environment -g NVIDIA_API_KEY "$NVIDIA_API_KEY"
tmux set-environment -g DSX_AGENT_PORT "$DSX_AGENT_PORT"
```

Wait for port `8012`, then repeat the health and chat tests. The web session does not need to be restarted for an AI key change.

## 5. Reopen or restart a Brev instance

Stopping a cloud instance terminates the processes and tmux server. The silently exported API key is intentionally not persisted to disk, so enter it again after each instance reboot:

```bash
cd ~/dsx-leo
git pull --ff-only

read -rsp "NVIDIA API key: " NVIDIA_API_KEY
echo
export NVIDIA_API_KEY
export DSX_AGENT_PORT=8012

tmux kill-session -t dsx-kit 2>/dev/null || true
if tmux has-session 2>/dev/null; then
  tmux set-environment -g NVIDIA_API_KEY "$NVIDIA_API_KEY"
  tmux set-environment -g DSX_AGENT_PORT "$DSX_AGENT_PORT"
fi
tmux new-session -d -s dsx-kit \
  "cd '$HOME/dsx-leo' && export USD_URL=/data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda && exec ./run_streaming.sh >> '$HOME/dsx-kit-streaming.log' 2>&1"
tmux set-environment -g NVIDIA_API_KEY "$NVIDIA_API_KEY"
tmux set-environment -g DSX_AGENT_PORT "$DSX_AGENT_PORT"

tmux kill-session -t dsx-web 2>/dev/null || true
tmux new-session -d -s dsx-web \
  "cd '$HOME/dsx-leo' && exec ./run_web.sh >> '$HOME/dsx-web.log' 2>&1"

tmux list-sessions
ss -lnt | grep -E ':(8081|49100|8012)\b'
curl -sS http://127.0.0.1:8012/api/agent/health
```

The content pack under `/data/dsx` and the build under `~/dsx-leo/_build` are reused, so a normal restart is much faster than the first installation. If the Brev disk itself was deleted rather than merely stopped, repeat section 3 from the beginning.

## 6. Problems encountered and verified solutions

### The terminal closes or the server stops when SSH disconnects

Cause: Kit or Vite was launched in a foreground shell, or the command failed during startup. Use the `dsx-kit` and `dsx-web` tmux sessions from this runbook. Inspect them and the persistent logs with:

```bash
tmux list-sessions
tmux attach -t dsx-kit
# Detach without stopping it: Ctrl+B, then D
tail -n 200 ~/dsx-kit-streaming.log
tail -n 100 ~/dsx-web.log
```

### NGC asks for an output format or reports `Invalid org`

Press `Enter` at `[ascii]`. For the organization, use an exact organization available to the NGC key, not the Brev instance name. The silent `NGC_CLI_API_KEY` environment-variable method in section 3.1 avoids unnecessary saved configuration on disposable instances.

### The 33GB download succeeds but `DSX_Main_BP.usda` is missing

The NGC resource may contain a zip and an additional wrapper directory such as `DSX_BP_/DSX_BP`. The setup block searches both the download and extraction trees, then uses `rsync` to normalize the final location to:

```text
/data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda
```

Diagnose a partial or nested extraction with:

```bash
find ~/ngc-dsx-download /data/dsx -path '*/DSX_BP/Assembly/DSX_Main_BP.usda' -print
du -sh ~/ngc-dsx-download /data/dsx/* 2>/dev/null
```

An old wrapper directory can consume tens of gigabytes. Delete it only after the canonical USD above is present and Kit has loaded it successfully.

### Kit reports `libGLU.so.1`, MDL, Hydra, or RTX initialization failures

Install the missing runtime and restart Kit:

```bash
sudo apt-get update
sudo apt-get install -y libglu1-mesa
```

The setup block includes this package. Find the most relevant internal errors with:

```bash
LATEST_KIT_LOG="$(ls -t ~/.nvidia-omniverse/logs/Kit/DSX\ Streaming/2.0/kit_*.log | head -1)"
grep -E 'libGLU|Failed to load MDL|HydraEngine rtx failed|app ready|livestream' "$LATEST_KIT_LOG" | tail -80
```

### Dependency installation hits a Brev pip cache license or payment error

Some Brev images configure `/etc/pip.conf` with an internal cache. The setup block backs it up and switches to `https://pypi.org/simple` before the Kit build. The backup is `/etc/pip.conf.dsx-mcache-backup`.

### The browser says the site cannot be reached or waits indefinitely

Verify all three layers:

1. `dsx-web` is listening on TCP `8081`.
2. Kit is listening on TCP `49100`, and WebRTC UDP media ports are allowed.
3. Both the Brev cloud firewall and UFW contain the rules in `Ports To Open`.

```bash
tmux list-sessions
ss -lntup | grep -E ':(8081|49100|8012)\b'
sudo ufw status
```

Use the current Brev public IP in both the browser host and `server=` query parameter. A connected client produces signaling TCP traffic and video commonly uses UDP port `47998` within the allowed range. High GPU utilization while the page is connected is a useful indication that frames are rendering.

### The blue loading screen remains although the scene has loaded

The streaming app and web client in this repository contain the verified loading-state fixes: the obsolete Kit viewport-ready overlay is disabled, and a connected SDK stream status clears the web loading UI. Pull the latest repository revision and rebuild if an older clone still shows this symptom.

### Agent health is good but chat returns an invalid LLM/wrapper configuration

The root cause was a Python package collision: Kit preloaded `websockets` 12 while NAT required its newer bundled version (`backoff`, `InvalidProxyMessage`, and proxy-related APIs). The DSX extension now routes only `websockets.*` imports to NAT's own prebundle before NAT registers its NIM/LangChain providers. Successful startup contains:

```text
[omni.ai.aiq.dsx] Using NAT websockets from .../omni.ai.langchain.nat/pip_nat_prebundle/...
[omni.ai.aiq.dsx] NAT LLM and plugin registrations loaded
```

### Startup fails with `_TypedDictMeta.__new__()` and `extra_items`

The generated `langchain_protocol` uses a newer TypedDict declaration than Kit's bundled `typing_extensions`. `run_streaming.sh` now calls `scripts/apply_kit_compat_fixes.sh` after the build and on every restart. The patch is idempotent and prints `Kit Python compatibility patch verified.` when successful.

### Warnings about `platformdirs`, `nat.plugins.mcp`, audio, UDIM textures, or missing optional assets

These appeared during the verified run but were non-fatal when all of the following succeeded: Kit printed `app ready`, ports `49100` and `8012` listened, the health endpoint returned healthy, and a real chat request returned HTTP 200. Investigate them only if the related optional feature or visible asset is actually missing.

## 7. Security notes

- Never commit NGC or NVIDIA API keys. Keys normally begin with sensitive prefixes and must be treated as passwords.
- Use `read -rsp` so keys do not appear on screen or in shell history.
- Health checks show only `api_key_set: true`; they do not print the key.
- tmux environment variables survive SSH disconnects but not a full instance reboot.
- Rotate any key that was pasted into a public issue, chat, terminal recording, or Git history.

---

# NVIDIA Omniverse DSX Blueprint for AI Factory Digital Twins

#### Windows Explorer's native zip archiver may fail on deeply nested archives due to path length limitations. Use a third-party tool like 7-Zip to extract the content pack successfully.

## Overview

The NVIDIA Omniverse DSX Blueprint is the digital twin manifestation of the DSX reference design, demonstrating to developers how to use Omniverse libraries for design, simulation, and operations across AI factory facilities and their hardware–software ecosystem.

This experience demonstrates the type of interactive, realtime application a developer can build that allows an end user to change the configuration of an AI factory design and visualize simulation scenarios with that new design - including power and thermal visualizing inside the interactive viewport. The scene is composed on SimReady USD assets that show OEMs and CAD developers what an exemplar dataset is composed of, so that it's physical and non-physical data can be interchanged to a thermal or electrical application that will generate CFD data. We include sample CFD data and demonstrate how a developer can visualize that data inside the viewport alongside the rest of the digital twin as different simulation scenarios are run.

Please note that this blueprint is designed to provide an example of integrating the workflow for developers and demonstrate key concepts and patterns. It is not a turn-key application ready for production deployment without customization.

Developers are expected to use this guide as a starting point and extend the blueprint according to their specific requirements, potentially making significant architectural or implementation changes as needed for their particular use cases.

## Workflow
![Workflow Diagram](readme-assets/workflow-diagram.png)

For a comprehensive overview of the workflow and system architecture, see the [DSX Blueprint Guide](http://docs.omniverse.nvidia.com/dsx/latest/index.html).

### Platform Components

This repo contains:
1. Digital Twin set of geometry based on the entire DSX reference design for a 50 acre site including compute building and support infrastructure.
2. Front-end web application with user interface developed with Omnivere libraries, for interacting with digital twins, viewing simulations, and creating and saving build configurations.
3. Simulation-ready assets to accelerate digital twin creation:
    - Computational Fluid Dynamic Thermal hot aisle simulation.
    - Sample compute configurations for DSX such as GB200 and GB300 NVL72 designs.
    - Electrical loading simulation to test various loading configurations.

## Target Audience
Omniverse DSX Blueprint serves as the connective tissue for the ecosystem to build digital twins to design and optimize the AI factory lifecycle. Setting up the digital twin requires a technical team wiht expertise in different areas of the software stack:

1. Persona-1: End-User (e.g. design engineer)
2. Persona-2: CFD Engineer
3. Persona-3: Design Engineer/Creative Artist
4. Persona-4: Application Developer
5. Persona-5: AI Engineer

## Getting Started

The sections below cover what is needed to start using this blueprint, they consist of:
* Prerequisites
* Configuration
* Customization
* Evaluation

### Prerequisites

#### Hardware
- **GPU**: NVIDIA RTX Pro 6000 Blackwell
- **Driver**: Version 570.169
- **RAM**: 64GB (DDR5)
- **Storage**: 1TB NVMe or greater

Refer to the detailed [Technical Requirements](https://docs.omniverse.nvidia.com/dsx/latest/common/technical-requirements.html) for additional detail.

#### OS Requirements
- **Operating System**: Windows 10/11 or Linux (Ubuntu 22.04 or 24.04)

#### Software Requirements
- [**Git**](https://git-scm.com/downloads): For version control and repository management
- [**Git LFS**](https://git-lfs.com/): For managing large files within the repository
- [**(Linux) Docker**](https://docs.docker.com/engine/install/ubuntu/): For containerized development and deployment. **Ensure non-root users have Docker permissions.**
- [**(Linux) NVIDIA Container Toolkit**](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html): For GPU-accelerated containerized development and deployment
- [**VSCode**](https://code.visualstudio.com/download) (or your preferred IDE): For code editing and development
- **Archive Extrator - Windows**: Windows Explorer's native zip archiver may fail on deeply nested archives due to path length limitations. Use a third-party tool like 7-Zip to extract the content pack successfully.

##### Web Portal Development Requirements
- **Node.js and npm**: For frontend build and development

###### Linux
```bash
# Verify Installation
node --version  # Should be v20.x or higher
npm --version   # Should be 9.x or higher

# Install Node.js 20.x using NodeSource repository if not already installed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

###### Windows
```powershell
node --version  # Should be v20.x or higher
npm --version   # Should be 9.x or higher
```

If not installed:
1. Download Node.js installer from [nodejs.org](https://nodejs.org)
2. Run the installer and follow the setup wizard
3. Ensure "Add to PATH" option is selected during installation
4. Restart your terminal and verify installation:
```powershell
node --version
npm --version
```


##### Kit Application Development (C++) Requirements
- **(Windows) Microsoft Visual Studio 2019**: Install from [Visual Studio Downloads](https://visualstudio.microsoft.com/downloads/). Ensure **Desktop development with C++** workload is selected. VS2019 is required because the Kit-CAE extension links against Boost libraries built with the v142 toolset. [Additional configuration details](readme-assets/additional-docs/windows_developer_configuration.md)
- **(Windows) Windows SDK**: Install alongside MSVC via Visual Studio Installer
- **(Linux) build-essentials**: Install with `sudo apt-get install build-essential`

---

## Repository Structure

| Directory Item   | Purpose                                                    |
|------------------|------------------------------------------------------------|
| source/          | Kit applications and extensions source code                |
| web/             | React frontend for web portal                              |
| deps/            | Git submodules (kit-usd-agents)                            |
| templates/       | Template applications and extensions                       |
| helm/            | Kubernetes Helm charts for deployment                      |
| tools/           | Tooling settings and repository-specific tools             |
| readme-assets/   | Images and additional repository documentation             |
| .vscode/         | VS Code configuration and helper tasks                     |
| premake5.lua     | Build configuration for Kit applications                   |
| repo.sh / .bat   | Repository tool entry points (Linux/Windows)               |
| repo.toml        | Top level configuration of repo tools                      |
| ARCHITECTURE.md  | System architecture documentation                          |

---

## Quick Start

DSX provides convenient scripts to get up and running quickly. You'll need two terminal windows: one for the Kit application (streaming server) and one for the web frontend.

### 1. Clone the Repository

```bash
git clone <repository-url>
cd omniverse-dsx-blueprint-for-ai-factories
```

**First-time build:** The Kit application depends on the `deps/kit-cae` and `deps/kit-usd-agents` submodules. Both `./run_streaming.sh` and `./repo.sh build` automatically initialize submodules and build kit-cae on first run.

### 2. Download and Configure USD Scene Data

The blueprint requires a USD scene dataset that is hosted separately from the repository.

1. Download the [DSX Content Pack](https://catalog.ngc.nvidia.com/orgs/nvidia/teams/omniverse/resources/dsx_dataset) from NGC.

2. Extract the archive to a location on your disk, for example:

   **Linux:**
   ```
   /data/dsx/
   ```

   **Windows:**
   ```
   C:\data\dsx\
   ```

3. Open `source/apps/dsx.kit` and set the `auto_load_usd` path to point to your extracted USD scene file. For example, if you extracted the content pack to `/data/dsx/` (Linux) or `C:\data\dsx\` (Windows):

   ```ini
   [settings.app]
   auto_load_usd = "<your_extract_path>/DSX_BP/Assembly/DSX_Main_BP.usda"
   ```

   Replace `<your_extract_path>` with the location you chose in step 2.

> **Note:** The `auto_load_usd` value is empty by default. If you skip this step, the application will start but no scene will load.


### 3. Set Environment Variables (Optional)

The AI agent extension (`omni.ai.aiq.dsx`) requires an NVIDIA API key to communicate with the LLM backend. **The rest of the demo (3D viewer, camera controls, configurator) works without it.** If you want to use the AI chat agent, obtain a key from [build.nvidia.com](https://build.nvidia.com/) and set it as a persistent environment variable:

**Linux:**
```bash
echo 'export NVIDIA_API_KEY="nvapi-..."' >> ~/.bashrc
source ~/.bashrc
```

**Windows (PowerShell — run once):**
```powershell
[System.Environment]::SetEnvironmentVariable("NVIDIA_API_KEY", "nvapi-...", "User")
```

> **NOTE:** Restart your terminal after setting the variable. If `NVIDIA_API_KEY` is not set, the chat panel will display a message explaining how to enable the AI agent.

### 4. Start the Kit Application (Terminal 1)

The `run_streaming` script will build (if needed) and launch the Kit application with streaming enabled.

**Linux:**
```bash
./run_streaming.sh
```

**Windows:**
```powershell
.\run_streaming.bat
```

> **NOTE:** Initial startup may take 5-8 minutes for shader compilation. Subsequent launches will be much faster.

### 5. Start the Web Frontend (Terminal 2)

The `run_web` script will install dependencies and start the development server.

**Linux:**
```bash
./run_web.sh
```

**Windows:**
```powershell
.\run_web.bat
```

When the server starts, it will display a list of URLs. Select the third option (the streaming-related URL) to connect to the Kit application.

### Configuration Options

The streaming connection can be configured via URL query parameters or environment variables:

| Parameter | Env Variable | Default | Description |
|-----------|--------------|---------|-------------|
| `server` | `VITE_OMNIVERSE_SERVER` | `localhost` | Kit server address |
| `signalingPort` | `VITE_SIGNALING_PORT` | `49100` | Signaling port |
| `width` | - | `1920` | Stream width |
| `height` | - | `1080` | Stream height |
| `fps` | - | `60` | Target frame rate |

Example: `http://localhost:8080?server=192.168.1.100&width=1280&height=720`

If you experience build issues, see the [Usage and Troubleshooting](readme-assets/additional-docs/usage_and_troubleshooting.md) guide

---

## About the Omniverse Kit SDK

The Omniverse Kit SDK enables developers to build immersive, GPU-accelerated 3D applications. Key features include:

- **Language Support:** Develop with either Python or C++, offering flexibility for various developer preferences
- **OpenUSD Foundation:** Utilize the robust Open Universal Scene Description (OpenUSD) for creating, manipulating, and rendering rich 3D content
- **GPU Acceleration:** Leverage GPU-accelerated capabilities for high-fidelity visualization and simulation
- **Extensibility:** Create specialized extensions with dynamic user interfaces, system integrations, and direct control over OpenUSD data

### Applications and Use Cases

DSX provides a production-ready platform for streaming 3D content and applications. Use cases include:

- Streaming interactive 3D product configurators to customers
- Providing browser-based access to large-scale 3D models and simulations
- Delivering collaborative 3D design review tools
- Creating web-based digital twin viewers
- Building cloud-native 3D visualization portals

### Learning Resources

#### For New Developers
**[Developing an Omniverse Kit-Based Application](https://learn.nvidia.com/courses/course-detail?course_id=course-v1:DLI+S-OV-11+V1)**: NVIDIA DLI course offering an accessible introduction to application development (account and login required)

#### For Advanced Understanding
**[Explore the Kit SDK Companion Tutorial](https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/intro.html)**: Detailed insights into the underlying structure and mechanisms of the Kit SDK

---

## DSX Applications

DSX includes three pre-configured Omniverse Kit applications optimized for USD viewing and streaming:

### dsx.kit (Local Development)

A viewport-focused USD viewer application designed for local development and testing:

- Optimized for real-time 3D visualization
- Direct OpenUSD scene loading and manipulation
- Runs with a window for direct interaction
- Located at: `source/apps/dsx.kit`

### dsx_streaming.kit (Local Streaming)

The local streaming version for direct web browser connection:

- WebRTC streaming via `omni.kit.livestream.app`
- Runs headless (no window) - view in browser
- Direct connection without NVCF
- Ideal for local development with web UI
- Located at: `source/apps/dsx_streaming.kit`

### dsx_nvcf.kit (Cloud Deployment)

The cloud-optimized version configured for deployment on NVIDIA Cloud Functions:

- WebRTC streaming capabilities for browser access
- Optimized for containerized deployment
- Session management and multi-user support
- Located at: `source/apps/dsx_nvcf.kit`

### Custom Extensions

DSX includes custom extensions that enhance the viewer functionality:

- **dsx.setup_extension**: Application initialization and configuration
- **dsx.messaging_extension**: Real-time messaging and stage management for web portal integration
- **omni.ai.aiq.dsx**: AI agent for natural-language datacenter navigation, component visibility control, and rack variant switching. Requires `NVIDIA_API_KEY` environment variable (see [Quick Start](#quick-start)). Exposes an HTTP API on port 8012 (configurable via `DSX_AGENT_PORT` env var) for chat integration.

These extensions are located in `source/extensions/` and provide the foundation for web portal communication and scene management.

---

## Application Streaming

The Omniverse Platform supports streaming Kit-based applications directly to web browsers. You can either manage your own deployment or use an NVIDIA-managed service:

### Self-Managed
- **Omniverse Kit App Streaming**: Reference implementation on GPU-enabled Kubernetes clusters for complete control over infrastructure and scalability

### NVIDIA-Managed
- **NVIDIA Cloud Functions (NVCF)**: Offloads hardware, streaming, and network complexities for secure, large-scale deployments
- **Graphics Delivery Network (GDN)**: Streams high-fidelity 3D content worldwide with just a shared URL

[Configuring and packaging streaming-ready Kit applications](readme-assets/additional-docs/kit_app_streaming_config.md)

---

## Deployment

### Kit Application Deployment

Deploy the `dsx_nvcf.kit` application to NVIDIA Cloud Functions (NVCF) for GPU-accelerated container hosting:

```bash
# Package the application for cloud deployment
./repo.sh package_container

# Push container to registry

./repo.sh ngc push-container jacobs-usd_viewer_nvcf:latest --target-name jacobs-usd_viewer_nvcf

# Deploy to NVCF (requires NVCF configuration)
# See NVCF documentation for deployment steps
```

Alternatively, deploy to your own Kubernetes cluster using the provided Helm charts in the `helm/web-streaming-example/` directory.

The NVCF-specific kit file (`dsx_nvcf.kit`) includes optimizations for:
- Container startup and initialization
- WebRTC streaming configuration
- Resource management for cloud environments
- Session handling and cleanup

### Web Portal Deployment

The web portal can be deployed to any cloud provider supporting Node.js:

```bash
cd web
npm run build
# Deploy the dist/ folder to your static hosting service
```

---

## Tools

The Kit SDK includes a suite of tools to aid in development, testing, and deployment. For detailed information, see the [Kit SDK Tooling Guide](readme-assets/additional-docs/kit_app_template_tooling_guide.md).

### Building from a fresh checkout

A single command builds everything from a clean clone:

```bash
./repo.sh build        # Linux
.\repo.bat build       # Windows
```

The build system automatically initializes submodules, builds kit-cae (USD schemas + extensions), resolves/caches all extension dependencies, and compiles the DSX application. The first build may take several minutes as it downloads the Kit SDK and builds kit-cae.

For incremental builds after the first build, use the same command — it only rebuilds what changed. To force a rebuild of submodule dependencies (e.g. after updating kit-cae or kit-usd-agents), use `./repo.sh build --rebuild-deps`.

### Key Tools Overview

- **Help**: `./repo.sh -h` or `.\repo.bat -h` - List all available tools and descriptions
- **Build**: `./repo.sh build` or `.\repo.bat build` - Compile DSX applications and extensions
- **Launch**: `./repo.sh launch` or `.\repo.bat launch` - Start the Kit application locally
- **Testing**: `./repo.sh test` or `.\repo.bat test` - Execute test suites for extensions
- **Packaging**: `./repo.sh package` or `.\repo.bat package` - Package application for cloud deployment


## Troubleshooting
For detailed troubleshooting issues and solutions, refer to the [Troubleshooting documentation](https://docs.omniverse.nvidia.com/dsx/latest/troubleshooting.html).

Verify GPU and Driver:
```
nvidia-smi
```

Verify Node.js and npm:
```
node --version
npm --version
```

Application hangs during render initialization (IOMMU/zenity dialog)
* Disable IOMMU at the system level.

Unable to display map. WebGL2 support is required
* Enable hardware acceleration in your browser.

---

## Governing Terms

The software and materials are governed by the [NVIDIA Software License Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-software-license-agreement/) and the [Product-Specific Terms for NVIDIA Omniverse](https://www.nvidia.com/en-us/agreements/enterprise-software/product-specific-terms-for-omniverse/).

---

## Data Collection

The Omniverse Kit SDK collects anonymous usage data to help improve software performance and aid in diagnostic purposes. Rest assured, no personal information such as user email, name or any other field is collected.

To learn more about what data is collected, how we use it, and how you can change the data collection setting, see the [details page](readme-assets/additional-docs/data_collection_and_use.md).

---

## Additional Resources

- [Kit SDK Companion Tutorial](https://docs.omniverse.nvidia.com/kit/docs/kit-app-template/latest/docs/intro.html)
- [Usage and Troubleshooting](readme-assets/additional-docs/usage_and_troubleshooting.md)
- [Developer Bundle Extensions](readme-assets/additional-docs/developer_bundle_extensions.md)
- [Omniverse Kit SDK Manual](https://docs.omniverse.nvidia.com/kit/docs/kit-manual/latest/index.html)
- [Kit App Streaming Configuration](readme-assets/additional-docs/kit_app_streaming_config.md)
- [Windows Developer Configuration](readme-assets/additional-docs/windows_developer_configuration.md)
- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed system architecture

---

## Contributing

We provide this source code as-is and are currently not accepting outside contributions.
