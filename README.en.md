# DSH Minecraft Agent

> Source candidate rc.10 follows the shared work/mobility core and repairs method-terminal continuation. Per user request this run is source and verification only: neither core rc.61 nor this adapter is published. Use the verified local core archive for development. The official DSH process/ resolver blocker remains. See the [update record](docs/core-update-20261021.md).

[简体中文](README.md) | English

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The release candidate is **0.3.0-rc.10**, consuming core **0.5.7-rc.61** and optional server pack **0.5.0-rc.3**. Java **1.21.1** is primary, with a separate **1.20.6** compatibility build. Both current candidates remain unpublished. Fixed Git/tag and archive distribution remain planned until framework compatibility passes. See the [release record](docs/registry-release.md) and [Desktop and experiments](docs/desktop.md). The metadata-only experiment page does not start inference, replay trials or adopt skills. Installation alone does not connect or call a model.

The default lean tool set now retains `*_script` for on-demand shared routine and method discovery; explicit `tools.exclude` is respected.

Optional [Harness2 practice](docs/harness2.md) reuses DSH's registered model route and the core's isolated execution, baseline/held-out comparison and game-memory contracts. It is disabled by default and never adopts a skill or resumes a live Agent automatically.

Use Node.js 24. Configure a private `configFile` with explicit `enabled`, account, server, data/persona paths, DSH provider/model and input/output budgets. [Examples](examples/harness) show official DeepSeek cloud with explicit thinking-off, along with the supported thinking levels. Keys come from environment variables. Local models and cloud models use the same body and public SDK/MCP interface.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

For development, first install the verified local core candidate as described in the [update record](docs/core-update-20261021.md), then run `npm test` and `npm run build`; plain online npm ci cannot fetch the unpublished core yet. All locked dependencies use registry.npmjs.org with integrity metadata, including the exact core version. See the [installation guide](README-INSTALL.md). Tests cover native DSH sessions and actual SDK request formatting against loopback endpoints. `DSH_RUNTIME` can point to an external DSH installation. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
