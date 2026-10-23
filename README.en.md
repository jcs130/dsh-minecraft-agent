# DSH Minecraft Agent

[rc.15 is publicly available on GitHub](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.15). It adds in-page setup and the native DSH conversation beside the game. Choose your default model in DSH, open Minecraft, enter the server and account, then click Save and connect. No additional model key or handwritten JSON is required. [npm rc.15](https://www.npmjs.com/package/@jcs130/dsh-minecraft-agent) is also public and selected by latest; install the exact version through DSH. See [installation](README-INSTALL.md), [quick start](docs/quick-start.md) and the [release record](docs/registry-release.md).

> rc.15 retains stock official DSH compatibility, using readable-stream's supported native Node backend during synchronous plugin initialization. No manual host repair is required. Anonymous npm/GitHub archives match exactly. Default registry installs and stock main/Worker checks have passed on both verified DSH releases; see [compatibility](docs/DSH-COMPAT.md) and the [release record](docs/registry-release.md).

[简体中文](README.md) | English

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The public npm and GitHub release is **0.3.0-rc.15**, consuming core **0.5.7-rc.69** and optional server pack **0.5.0-rc.13**. Java **1.21.1** is primary, with a separate **1.20.6** compatibility build. Publication, default installation, native Desktop pixels and live gameplay remain separate checks. The metadata-only experiment page does not start inference, replay trials or adopt skills. Installation alone does not connect or call a model.

The default lean tool set now retains `*_script` for on-demand shared routine and method discovery; explicit `tools.exclude` is respected.

Optional [Harness2 practice](docs/harness2.md) reuses DSH's registered model route and the core's isolated execution, baseline/held-out comparison and game-memory contracts. It is disabled by default and never adopts a skill or resumes a live Agent automatically.

Use Node.js 24. The first-run form reuses DSH's selected provider, model and reasoning effort, allocates local ports and keeps a private per-account data directory. An empty first task connects without starting inference. The right pane renders DSH's original reasoning, tools and replies; game-only mode hides the transcript for streaming. Missing reasoning stays unavailable. Stop and configure preserves the session and persists the stopped state. Advanced deployments may still use a private `configFile`; see [examples](examples/harness). Local and cloud models use the same body and public SDK/MCP interface. Microsoft authentication and server-specific activation remain explicit steps.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

The exact dependencies are public: use `npm ci`, `npm run build` and `npm test`. All locked dependencies use registry.npmjs.org with integrity metadata. Tests cover native DSH sessions, loopback model formatting/cancellation, stock official main/Worker loading and legacy repair rollback. `MC_DSH_PROFILE` targets an isolated installed profile for the stock fixture; `DSH_RUNTIME` selects an external host for other API tests. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
