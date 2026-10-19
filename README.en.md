# DSH Minecraft Agent

[简体中文](README.md) | English

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The current candidate is **0.3.0-rc.6**, using DSH **0.2.1-rc.2**, core **0.5.7-rc.47** and optional server pack **0.5.0-rc.3**, with regression coverage for DSH **0.2.0-rc.2**. Minecraft Java **1.21.1** is the primary target. Both the core and the server pack are published on npm. Installation alone does not connect a game account or call a model.

Use Node.js 24. Configure a private `configFile` with explicit `enabled`, account, server, data/persona paths, DSH provider/model and input/output budgets. [Examples](examples/harness) show official DeepSeek cloud with explicit thinking-off, along with the supported thinking levels. Keys come from environment variables. Local models and cloud models use the same body and public SDK/MCP interface.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

For development, run `npm ci`, `npm test` and `npm run build` on a fresh clone; the lockfile resolves against registry.npmjs.org. To test unpublished local candidate archives, see the optional section of the [installation guide](README-INSTALL.md). Tests cover native DSH sessions and actual SDK request formatting against loopback endpoints. `DSH_RUNTIME` can point to an external DSH installation. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
