# DSH Minecraft Agent

[0.3.0-rc.19 is published on GitHub](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.19), with the public exact core **0.5.7-rc.86**. Default installation from the public archive and real main/Worker checks passed on unmodified official DSH 0.2.1-rc.2 and rc.3.

Editable personas, default-off mineral queries, local viewer skins, a shared versioned server notebook and official DSH capability presets are available from Minecraft settings. Offline CPU token-vector/keyword retrieval is not a neural semantic model; configure your own embeddings service when needed. Local skins affect only the own web avatar. Existing game, reasoning/tools, metrics and experiment views remain available. See [configuration](docs/character-notebook.md) and [verification](docs/github-publish-rc19.json).

The separate npm publish authentication expired. Adapter rc.19 is not on npm; latest and the market index remain rc.17. Install the fixed public GitHub archive:

```sh
dsh plugin --profile web add https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.19/jcs130-dsh-minecraft-agent-0.3.0-rc.19.tgz --registry=https://registry.npmjs.org
```

Published archives retain reviewed bytes. Candidate flags inside them are build-time snapshots; Release attachments and main-branch records describe current distribution. Installation starts no game or model.

[简体中文](README.md) | English

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The GitHub release is **0.3.0-rc.19**, consuming core **0.5.7-rc.86** and optional server pack **0.5.0-rc.22**. The npm adapter remains **rc.17** pending independent authentication. Java **1.21.1** is primary, with a separate **1.20.6** compatibility build. Publication, default installation, native Desktop pixels and live gameplay remain separate checks. The metadata-only experiment page does not start inference, replay trials or adopt skills. Installation alone does not connect or call a model.

The default lean tool set now retains `*_script` for on-demand shared routine and method discovery; explicit `tools.exclude` is respected.

Optional [Harness2 practice](docs/harness2.md) reuses DSH's registered model route and the core's isolated execution, baseline/held-out comparison and game-memory contracts. It is disabled by default and never adopts a skill or resumes a live Agent automatically.

Use Node.js 24. The first-run form reuses DSH's selected provider, model and reasoning effort, allocates local ports and keeps a private per-account data directory. An empty first task connects without starting inference. The right pane renders DSH's original reasoning, tools and replies; game-only mode hides the transcript for streaming. Missing reasoning stays unavailable. Stop and configure preserves the session and persists the stopped state. Advanced deployments may still use a private `configFile`; see [examples](examples/harness). Local and cloud models use the same body and public SDK/MCP interface. Microsoft authentication and server-specific activation remain explicit steps.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

The exact dependencies are public: use `npm ci`, `npm run build` and `npm test`. All locked dependencies use registry.npmjs.org with integrity metadata. Tests cover native DSH sessions, loopback model formatting/cancellation, stock official main/Worker loading and legacy repair rollback. `MC_DSH_PROFILE` targets an isolated installed profile for the stock fixture; `DSH_RUNTIME` selects an external host for other API tests. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
