# DSH Minecraft Agent

> rc.11 repair preview removes the production engine's tsx loader dependency while retaining visualization and the training simulator. DSH 0.2.1-rc.2 has an [explicit check/apply/rollback tool](docs/DSH-COMPAT.md) for its `process/` resolver defect; installing the plugin never patches the framework automatically. Source and isolated runtime checks passed. See the [release record](docs/registry-release.md) for public distribution status.

[简体中文](README.md) | English

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The preview release is **0.3.0-rc.11**, consuming core **0.5.7-rc.64** and optional server pack **0.5.0-rc.10**. Java **1.21.1** is primary, with a separate **1.20.6** compatibility build. The old DSH release requires a one-time explicit repair after fully exiting the selected installation; both its main and Worker resolvers are covered. Upstream acceptance/release, native Desktop pixels and live gameplay remain separate checks. The market entry stays held. The metadata-only experiment page does not start inference, replay trials or adopt skills. Installation alone does not connect or call a model.

The default lean tool set now retains `*_script` for on-demand shared routine and method discovery; explicit `tools.exclude` is respected.

Optional [Harness2 practice](docs/harness2.md) reuses DSH's registered model route and the core's isolated execution, baseline/held-out comparison and game-memory contracts. It is disabled by default and never adopts a skill or resumes a live Agent automatically.

Use Node.js 24. Configure a private `configFile` with explicit `enabled`, account, server, data/persona paths, DSH provider/model and input/output budgets. [Examples](examples/harness) show official DeepSeek cloud with explicit thinking-off, along with the supported thinking levels. Keys come from environment variables. Local models and cloud models use the same body and public SDK/MCP interface.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

Before a core candidate is public, install its verified local archive as described in the [update record](docs/core-update-20261021.md), then run `npm test` and `npm run build`. All locked dependencies use registry.npmjs.org with integrity metadata, including the exact core version. Tests cover native DSH sessions, SDK request formatting against loopback endpoints and exact-byte repair/rollback. `DSH_RUNTIME` can point to an external DSH installation. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
