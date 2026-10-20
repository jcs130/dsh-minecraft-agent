# DSH Minecraft Agent

> rc.9 replaces the URL core subdependency with an exact npm registry version. Publication, default DSH installation and native Desktop visual checks are recorded separately in the [release record](docs/registry-release.md).

[简体中文](README.md) | English

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The registry release candidate is **0.3.0-rc.9**, using DSH **0.2.1-rc.2**, core **0.5.7-rc.57** and optional server pack **0.5.0-rc.3**. Java **1.21.1** is primary, with a separate **1.20.6** compatibility build. After publication the exact install target is `@jcs130/dsh-minecraft-agent@0.3.0-rc.9`; see the [release record](docs/registry-release.md) for publication and installation status and [Desktop and experiments](docs/desktop.md) for usage. The metadata-only experiment page does not start inference, replay trials or adopt skills. Installation alone does not connect or call a model.

Optional [Harness2 practice](docs/harness2.md) reuses DSH's registered model route and the core's isolated execution, baseline/held-out comparison and game-memory contracts. It is disabled by default and never adopts a skill or resumes a live Agent automatically.

Use Node.js 24. Configure a private `configFile` with explicit `enabled`, account, server, data/persona paths, DSH provider/model and input/output budgets. [Examples](examples/harness) show official DeepSeek cloud with explicit thinking-off, along with the supported thinking levels. Keys come from environment variables. Local models and cloud models use the same body and public SDK/MCP interface.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

For development, run `npm ci`, `npm test` and `npm run build`. All locked dependencies use registry.npmjs.org with integrity metadata, including the exact core version. See the [installation guide](README-INSTALL.md). Tests cover native DSH sessions and actual SDK request formatting against loopback endpoints. `DSH_RUNTIME` can point to an external DSH installation. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
