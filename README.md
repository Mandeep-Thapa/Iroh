# Iroh

Iroh is a calm, local-first Windows coding assistant built with Tauri, Rust, React, and TypeScript. It can use local models through Ollama, experimental layer-streamed models through AirLLM, or explicitly enabled cloud providers.

The app is local-first. File writes, command execution, web access, and persistent memory are disabled in each chat until you turn on the corresponding toolbar permission.

## Security and cost guarantees

- Cloud API use is off by default. Opening Settings and checking models never sends an OpenAI or Anthropic request.
- Saving an API key does not make a paid model request. A cloud request can occur only after you enable the cloud API switch, select a cloud provider and model, and send a prompt.
- API keys and tokens are handled by the Rust backend and protected with Windows DPAPI. They are never returned to the webview or written to the ordinary settings JSON.
- OpenAI requests use the Responses API with storage disabled. See the official [OpenAI authentication guidance](https://developers.openai.com/api/reference/overview#authentication).
- Commands run through a dedicated non-administrator Windows account and workspace checks. This is defense in depth, not a virtual machine or a complete security boundary. Do not run untrusted models or commands with access to valuable data.
- Workspace resets move recoverable content into the workspace recovery directory; they do not silently erase it.
- Telegram accepts only the configured chat ID, sanitizes filenames, applies size limits, and keeps transfers inside the workspace.

## What works

- Ollama chat with local model detection.
- OpenAI Responses API and Anthropic Messages API through backend-only credentials.
- AirLLM local server controls and OpenAI-compatible local routing.
- Explicit read, write, command, browser, web-search, Telegram, and memory tools.
- Persistent Chromium sessions with public-network URL restrictions.
- Text, image, and PDF reading with bounded file sizes.
- Cited workspace retrieval with a zero-download lexical index or optional local Ollama embeddings.
- Workspace snapshots, rollback, chat history, global rules, and editable skills.
- RAM and NVIDIA VRAM visibility.
- Optional sanitized local telemetry. Raw prompts, paths, commands, and keys are not logged.

## Requirements

Windows 10 or 11 is required for the restricted worker account and DPAPI secret store.

For development:

- Node.js 20 or newer
- Rust stable with the MSVC target
- Visual Studio C++ Build Tools
- Microsoft Edge WebView2
- Administrator permission when initially creating the restricted Windows worker account
- Ollama, recommended for local inference
- Python 3.10-3.12 only if you want to experiment with AirLLM

## Quick start

Install dependencies and run the desktop app:

~~~powershell
npm ci
npm run tauri dev
~~~

In Settings:

1. Choose a workspace directory. Do not choose a drive root, your whole user profile, or the Windows directory.
2. Keep the worker name as AI_Worker or use a name beginning with AI_Worker_.
3. Enter a strong worker password and initialize the workspace. The password is encrypted and the field clears after saving.
4. For a laptop with 4-8 GB total RAM, start with Ollama and a small quantized 1B-3B model.
5. Keep command, write, and web permissions off until a task needs them.

Production build:

~~~powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build
~~~

Installers are written under src-tauri/target/release/bundle.

## Provider setup

### Ollama

Ollama is the recommended default for modest laptops. Install a small quantized model using Ollama, start the Ollama service, then use Detect in Settings. The local endpoint defaults to http://127.0.0.1:11434 and is restricted to loopback addresses.

### OpenAI

The key may come from the OPENAI_API_KEY environment variable, a development-only .env.local file, or the encrypted in-app secret store. The app never displays a stored key.

To prevent accidental charges, Cloud API requests stays disabled until you explicitly enable it. Enter an exact model identifier; the app does not make an automatic model-list request.

### Anthropic

Save the key in Encrypted Secrets, enter the exact model identifier, and explicitly enable cloud requests. Like OpenAI, requests can consume paid credits.

## AirLLM lab

[AirLLM](https://github.com/lyogavin/airllm) loads model layers sequentially to reduce GPU-memory pressure. Its headline low-memory examples refer primarily to VRAM. They do not mean that a very large model will be pleasant or even practical on a laptop with only 4-8 GB of total system RAM.

Expect:

- very large downloads and cache directories;
- model preprocessing or splitting;
- heavy disk I/O;
- long startup and generation times;
- hardware-specific PyTorch installation;
- compatibility differences between models and AirLLM versions.

Install AirLLM only if you want to experiment:

~~~powershell
py -3.11 -m venv .venv-airllm
.venv-airllm\Scripts\Activate.ps1
# Install the PyTorch build appropriate for your CPU or GPU first.
pip install -r requirements-airllm.txt
~~~

Then select AirLLM in Settings, set the virtual environment Python path, choose a Hugging Face model ID, select compression, and use Check locally before Start.

The app never installs packages or downloads a model automatically. Starting a model can trigger a large Hugging Face download. A Hugging Face token is optional for public models and can be stored through Encrypted Secrets.

For most 4-8 GB laptops, a small quantized Ollama model is faster, simpler, and more reliable than streaming a very large AirLLM model.

## Tool permissions

Chat toolbar permissions are authoritative:

- Read-only workspace tools are available after workspace initialization.
- Write enables file changes and persistent memory.
- Terminal enables only validated structured execute_command requests. Code fences are never executed.
- Web enables search and browser actions.
- Thinking controls display/prompt behavior only.

The agent executes at most five tool iterations per user message. Tool output, web content, filenames, documents, workspace trees, global rules, and skill text are treated as untrusted data rather than higher-priority instructions.

## Workspace behavior

All file paths are canonicalized and checked against the configured primary workspace. Dangerous workspace roots are rejected. New files must have an existing in-workspace parent.

The restricted worker account receives modify permission only on the initialized workspace. Existing ACL inheritance is preserved. Iroh does not claim to contain kernel exploits, network access by child processes, or every Windows escape route.

Snapshots store a bounded manifest and copies of existing files. Rollback restores backed-up files but preserves files created later. Reset moves the current workspace contents to:

~~~text
.antigravity/recovery/reset_TIMESTAMP
~~~
The hidden `.antigravity` directory name is retained for compatibility with workspaces created before the Iroh rename.


## Telegram

Create a bot with BotFather, save its token under Encrypted Secrets, enter the one allowed numeric chat ID, and enable Telegram. Messages from every other chat are ignored. File uploads and downloads remain workspace-bound.

Telegram-originated prompts are read-only, but they can run validated workspace read tools such as directory listing, PDF search, and file reading. If a local model merely promises to inspect something without requesting a tool, Iroh corrects it once; an empty Ollama response above 4k context is retried locally at 4k and the safer context is saved.

Do not expose the bot token, and do not authorize a group chat unless every member should be able to control the agent.

## Project layout

~~~text
src/                         React and TypeScript UI
src-tauri/src/               Rust security, provider, and tool backend
scripts/airllm_server.py     Local AirLLM compatibility server
requirements-airllm.txt      Optional AirLLM Python dependencies
.github/workflows/           Release verification and packaging
~~~

Provider calls flow from the React UI through Tauri IPC to the Rust backend. Secrets and outbound cloud authorization stay in Rust. Local-provider endpoints accept loopback addresses only.

## Verification

The repository provides these offline-safe checks:

~~~powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
python -m py_compile scripts/airllm_server.py
~~~

These checks do not send prompts or call a paid AI API. AirLLM environment checks inspect local Python modules only.

## Known limitations

- Windows is the supported platform.
- The worker account is not equivalent to a VM, container, or AppContainer.
- Provider generation is currently non-streaming.
- Stopping the UI prevents further tool iterations but may not cancel a provider HTTP request already in flight.
- Browser automation needs an installed compatible Chromium-based browser.
- AirLLM viability depends heavily on the exact model, disk, Python, PyTorch, CPU, GPU, and driver combination.
- Semantic retrieval requires a separately installed local Ollama embedding model and an index rebuild.

## Model guidance and local benchmarks

Settings includes a curated laptop-sized Ollama catalog and a hardware-aware context recommendation. The catalog currently covers Qwen 3 0.6B/4B, Gemma 3 1B/4B, and Llama 3.2 1B/3B using their published Ollama download sizes and advertised context windows. Installed models are detected locally; Iroh never pulls a model automatically.

The benchmark button sends one small prompt only to the selected local Ollama or AirLLM endpoint. Cloud providers are deliberately blocked from the benchmark path. Context suggestions are conservative because a model's advertised maximum is not a promise that the laptop can run that window comfortably.

## Approval, knowledge, and portability

- Read-only workspace tools may run automatically after initialization.
- Every write, command, web/browser, Telegram delivery, and MCP call requires an in-app approval. File writes show a bounded before/after preview first.
- ?Allow this tool for session? lasts only until the app closes. Telegram-originated sessions are always read-only.
- The bounded local activity ledger records action type and outcome, not prompts, secrets, commands, queries, or file contents.
- Workspace knowledge results cite relative paths and line ranges.
- MCP profiles accept loopback HTTP endpoints only. A server must be inspected, its tools discovered, and the profile enabled before the model can request a tool.
- Task recipes are editable prompt starters.
- Portable JSON export includes settings and chats but excludes encrypted secrets and worker passwords.

## Signed updater setup

Development builds do not contact an update server automatically. The Settings button performs a manual check and reports that updates are unavailable when the build has no signed release configuration.

Before publishing the first tag, generate an encrypted Tauri release key in a secure location outside this repository:

~~~powershell
npm run tauri -- signer generate -p "CHOOSE-A-STRONG-PASSWORD" -w "C:\secure\iroh-release.key"
~~~

Back up the private key and password securely. Never commit them. Add these GitHub repository secrets:

- **TAURI_SIGNING_PRIVATE_KEY**: the complete private key content
- **TAURI_SIGNING_PRIVATE_KEY_PASSWORD**: its password
- **TAURI_UPDATER_PUBLIC_KEY**: the complete generated public key content

A version tag matching **v*** then builds Windows installers, creates signed updater artifacts, and publishes **latest.json** at the verified [Iroh repository](https://github.com/Mandeep-Thapa/Iroh). Installed packages verify signatures before installation.


## Release workflow

Tagged releases run npm ci, the frontend build, Rust tests, and Tauri packaging on Windows. No API key is required for builds or tests.

## License

MIT. See [LICENSE](LICENSE).
