# Leo DSX Development Guide: Mac VSCode + Brev Ubuntu L40S + Mac Chrome

This fork is intended for the following workflow:

- Edit code on the MacBook in VSCode.
- Connect VSCode Remote SSH to a fresh NVIDIA Brev Ubuntu L40S GPU server.
- Run the Omniverse DSX Kit streaming app and web frontend on the cloud Ubuntu server.
- Open the frontend from Mac Chrome and connect it to the cloud Kit streaming server.
- Treat the cloud server as disposable: every new Brev session starts from a clean disk, so setup must be repeatable.

The recommended runtime path for the cloud server is Docker Compose. It keeps the Kit app and web frontend startup consistent across fresh Brev machines.

## 0. Ports To Open On The Brev Server

For Mac Chrome to connect to the cloud-hosted frontend and Omniverse WebRTC stream, the server must allow these inbound ports. VSCode SSH port forwarding is useful for editing, but it is not enough for the WebRTC media path because the stream uses TCP and UDP media ports.

| Purpose | Protocol | Port(s) |
| --- | --- | --- |
| Web frontend, Docker Compose | TCP | `8080` |
| Web frontend, direct Vite dev server | TCP | `8081` |
| Kit WebRTC signaling | TCP | `49100` |
| Kit control / health | TCP | `8111` |
| DSX AI agent API | TCP | `8012` |
| WebRTC media | TCP + UDP | `47995-48012` |
| Additional WebRTC media | TCP + UDP | `49000-49007` |
| WebRTC UDP helper | UDP | `1024` |

If Brev gives you a public hostname, use that hostname in the browser URL. If it gives you a public IP, use the IP.

```bash
export DSX_HOST="<brev-public-ip-or-hostname>"
```

Chrome URL for the Docker Compose path:

```text
http://<brev-public-ip-or-hostname>:8080?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

Chrome URL for the direct Vite dev-server path:

```text
http://<brev-public-ip-or-hostname>:8081?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

## 1. One-Time Mac Setup

Install VSCode and the Remote - SSH extension on the Mac. Keep this local clone at:

```bash
cd /Users/leonardyoon/workspace/dsx-leo
```

After this fork is pushed, the server clone URL is:

```bash
git clone https://github.com/leonyoon-3dai/dsx-leo.git
```

Optional local remote check:

```bash
git remote -v
```

## 2. Create A Fresh Brev L40S Ubuntu Server

Use an NVIDIA Brev instance with an L40S GPU and Ubuntu 22.04 or 24.04. Save the SSH information Brev provides, for example:

```text
Host brev-dsx
  HostName <brev-hostname-or-ip>
  User ubuntu
  IdentityFile ~/.ssh/<brev-key>
```

Add that block to `~/.ssh/config` on the Mac, then connect from VSCode with `Remote-SSH: Connect to Host...` and choose `brev-dsx`.

From the VSCode remote terminal on the Brev server:

```bash
nvidia-smi
```

You should see the L40S GPU before continuing.

## 3. Clone This Fork On The Brev Server

Because Brev storage is fresh each run, clone the repo every time you create a new server:

```bash
cd ~
git clone https://github.com/leonyoon-3dai/dsx-leo.git
cd dsx-leo
```

If you are testing before this fork has been pushed, clone the upstream repository instead and then add this fork remote after it exists.

## 4. Bootstrap Ubuntu Automatically

Run the included bootstrap script on the Brev server:

```bash
cd ~/dsx-leo
./scripts/brev_bootstrap_ubuntu.sh
```

The script installs or configures:

- `git`, `git-lfs`, build tools, and base packages
- Node.js 20
- Docker Engine and Docker Compose plugin
- NVIDIA Container Toolkit for GPU containers
- Git submodules
- GPU visibility check with `nvidia-smi`

If the script adds your user to the `docker` group, reconnect the VSCode SSH session or run:

```bash
newgrp docker
```

Then verify Docker can see the GPU:

```bash
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi
```

If that image tag is unavailable on a future date, use a current CUDA Ubuntu base image from NVIDIA NGC or Docker Hub.

## 5. DSX Content Pack / USD Scene Data

The DSX scene dataset is not stored in this Git repo. Download the DSX Content Pack from NVIDIA NGC:

```text
https://catalog.ngc.nvidia.com/orgs/nvidia/teams/omniverse/resources/dsx_dataset
```

On every fresh Brev server, place the extracted content at:

```text
/data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda
```

Recommended server commands after downloading or uploading the archive:

```bash
sudo mkdir -p /data/dsx
sudo chown -R "$USER:$USER" /data/dsx
# Extract the content pack so this file exists:
ls /data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda
```

The Docker Compose file mounts `/data/dsx` into the Kit container as `/app/assets` and sets:

```bash
USD_URL=/app/assets/DSX_BP/Assembly/DSX_Main_BP.usda
```

You can override the host asset directory if needed:

```bash
export DSX_ASSETS_DIR=/another/path/to/dsx
```

## 6. Start DSX With Docker Compose

Use Docker Compose for normal Brev runs.

This starts both services together:

- Kit streaming server
- Web frontend on port `8080`

```bash
cd ~/dsx-leo
export DSX_ASSETS_DIR=/data/dsx
export USD_URL=/app/assets/DSX_BP/Assembly/DSX_Main_BP.usda
docker compose up --build
```

Background option:

```bash
cd ~/dsx-leo
docker compose up --build -d
docker compose logs -f
```

Stop the Compose stack:

```bash
cd ~/dsx-leo
docker compose down
```

Mac Chrome URL:

```text
http://<brev-public-ip-or-hostname>:8080?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

Do not use `server=localhost` from the Mac browser unless the Kit app is also running on the Mac. From Mac Chrome, `localhost` means the MacBook, not the Brev server.

## 7. Optional Direct Development Mode Without Docker

Use direct development mode only when changing code and you want separate terminals.

This mode does not use Docker Compose:

- Terminal 1 runs Kit streaming directly.
- Terminal 2 runs the Vite web frontend directly.
- The web frontend uses port `8081`.

Terminal 1 on Brev:

```bash
cd ~/dsx-leo
export USD_URL=/data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda
./run_streaming.sh
```

Terminal 2 on Brev:

```bash
cd ~/dsx-leo
./run_web.sh
```

Mac Chrome URL:

```text
http://<brev-public-ip-or-hostname>:8081?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

## 8. Optional AI Agent API

The 3D viewer and configurator can run without an NVIDIA API key. The AI chat agent needs `NVIDIA_API_KEY`.

On the Brev server:

```bash
export NVIDIA_API_KEY="nvapi-..."
export DSX_AGENT_PORT=8012
```

For Docker Compose, add the key to the shell before `docker compose up` or extend `compose.yml` with the environment variable under the `kit` service.

## 9. Troubleshooting Checklist

Check GPU:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi
```

Check listening ports on the Brev server:

```bash
ss -lntup | grep -E ':(8080|8081|49100|8111|8012)\b'
```

Check Docker logs:

```bash
docker compose logs -f kit
docker compose logs -f web
```

Check the USD path:

```bash
ls -lh /data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda
```

If the web page loads but streaming does not connect, re-check the Brev firewall/security settings for TCP and UDP ranges `47995-48012` and `49000-49007`, plus TCP `49100`.

If the page is opened through VSCode forwarded port `8080`, still set the `server` query parameter to the Brev public host unless all streaming ports are also reachable through a supported tunnel:

```text
http://localhost:8080?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

## 10. Fresh Brev Server Runbook

Use this on a fresh Brev server when you want to start with one copy/paste command. It installs the NGC CLI, downloads the DSX Content Pack, prepares `/data/dsx`, and starts Docker Compose.

The DSX Content Pack is large, about 33GB compressed. Make sure the Brev disk has enough free space before running.

If NGC asks for authentication, create an NGC API key and run `export NGC_CLI_API_KEY="..."` before this block, then run the block again.

Copy and run this whole block on the Brev server:

```bash
set -euo pipefail

REPO_URL="https://github.com/leonyoon-3dai/dsx-leo.git"
REPO_DIR="$HOME/dsx-leo"
NGC_RESOURCE="nvidia/omniverse/dsx_dataset:2.1"
DSX_DOWNLOAD_DIR="$HOME/ngc-dsx-download"
DSX_ASSETS_DIR_HOST="/data/dsx"
DSX_USD_HOST="/data/dsx/DSX_BP/Assembly/DSX_Main_BP.usda"
BREV_HOST="${BREV_HOST:-$(curl -fsS https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')}"

echo "1/9 Checking GPU"
nvidia-smi

echo "2/9 Preparing /data/dsx"
sudo mkdir -p "$DSX_ASSETS_DIR_HOST"
sudo chown -R "$USER:$USER" "$DSX_ASSETS_DIR_HOST"

echo "3/9 Cloning or updating repo"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
else
  git -C "$REPO_DIR" pull --ff-only
fi

cd "$REPO_DIR"

echo "4/9 Bootstrapping Ubuntu, Docker, NVIDIA Container Toolkit, Node.js, and submodules"
./scripts/brev_bootstrap_ubuntu.sh

echo "5/9 Installing NGC CLI if needed"
sudo apt-get update
sudo apt-get install -y curl unzip rsync
if ! command -v ngc >/dev/null 2>&1; then
  rm -rf /tmp/ngccli /tmp/ngccli_linux.zip
  curl -L -o /tmp/ngccli_linux.zip https://ngc.nvidia.com/downloads/ngccli_linux.zip
  unzip -q /tmp/ngccli_linux.zip -d /tmp/ngccli
  sudo install /tmp/ngccli/ngc-cli/ngc /usr/local/bin/ngc
fi
ngc --version

echo "6/9 Downloading DSX Content Pack from NGC"
if [ ! -f "$DSX_USD_HOST" ]; then
  mkdir -p "$DSX_DOWNLOAD_DIR"
  ngc registry resource download-version "$NGC_RESOURCE" --dest "$DSX_DOWNLOAD_DIR"
fi

echo "7/9 Preparing downloaded files in /data/dsx"
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

echo "8/9 Chrome URL from MacBook"
echo "http://${BREV_HOST}:8080?server=${BREV_HOST}&signalingPort=49100"

echo "9/9 Starting DSX with Docker Compose"
export DSX_ASSETS_DIR=/data/dsx
export USD_URL=/app/assets/DSX_BP/Assembly/DSX_Main_BP.usda

if docker ps >/dev/null 2>&1; then
  docker compose up --build
else
  sudo --preserve-env=DSX_ASSETS_DIR,USD_URL docker compose up --build
fi
```

When the web service is running, open the printed URL from Mac Chrome. It will look like this:

```text
http://<brev-public-ip-or-hostname>:8080?server=<brev-public-ip-or-hostname>&signalingPort=49100
```

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
