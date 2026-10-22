# DSH Minecraft Agent

This branch adds the **rc.13 invitation-onboarding candidate**, using the neutral Qiandengji portal contract while preserving DSH models, persona, sessions and memory. API account readiness and authenticated game readiness are separate. Core rc.69 and server pack rc.13 are not yet on npm; the market still points to the published rc.12 below. See [onboarding](docs/qiandengji-invitation.md).

> rc.12 supports the latest official DSH 0.2.1-rc.2 directly, using readable-stream's supported native Node backend during synchronous plugin initialization. No manual host repair is required. Official main/Worker resolution, SDK/MCP and offline engine checks passed. See [compatibility](docs/DSH-COMPAT.md) and the [release record](docs/registry-release.md) for distribution status.

[简体中文](README.md) | English

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The preview release is **0.3.0-rc.12**, consuming core **0.5.7-rc.64** and optional server pack **0.5.0-rc.10**. Java **1.21.1** is primary, with a separate **1.20.6** compatibility build. Stock DSH 0.2.1-rc.2 loads both the ordinary and independent Harness² entries without changing host files or the resolver. Publication, default installation, native Desktop pixels and live gameplay remain separate checks. The metadata-only experiment page does not start inference, replay trials or adopt skills. Installation alone does not connect or call a model.

The default lean tool set now retains `*_script` for on-demand shared routine and method discovery; explicit `tools.exclude` is respected.

Optional [Harness2 practice](docs/harness2.md) reuses DSH's registered model route and the core's isolated execution, baseline/held-out comparison and game-memory contracts. It is disabled by default and never adopts a skill or resumes a live Agent automatically.

Use Node.js 24. Configure a private `configFile` with explicit `enabled`, account, server, data/persona paths, DSH provider/model and input/output budgets. [Examples](examples/harness) show official DeepSeek cloud with explicit thinking-off, along with the supported thinking levels. Keys come from environment variables. Local models and cloud models use the same body and public SDK/MCP interface.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

The exact dependencies are public: use `npm ci`, `npm run build` and `npm test`. All locked dependencies use registry.npmjs.org with integrity metadata. Tests cover native DSH sessions, loopback model formatting/cancellation, stock official main/Worker loading and legacy repair rollback. `MC_DSH_PROFILE` targets an isolated installed profile for the stock fixture; `DSH_RUNTIME` selects an external host for other API tests. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
