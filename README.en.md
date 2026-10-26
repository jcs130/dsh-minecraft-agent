# DSH Minecraft Agent

**[0.3.0-rc.24](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.24) is published on GitHub and [npm](https://www.npmjs.com/package/@jcs130/dsh-minecraft-agent)** with npm latest, exact core **0.5.7-rc.99** and optional Qiandengji **0.5.0-rc.24**. Explicit read-only queries can overlap navigation; batch message readback, recovery and memory deduplication preserve task and evidence semantics.

Unmodified official DSH **0.2.1-rc.2 / rc.3** passed default public-registry pnpm installation, main/Worker loading, **38 MCP tools** and real local knowledge queries. Each host passed 154 tests with one optional skip. Anonymous archive bytes match the reviewed build. See [npm verification](docs/npm-publish-rc24.json) and [release notes](docs/release-rc24.md). Missing exact materials still use compatible rendering. Publication does not reload live Agents; native Desktop pixels and long-term gameplay remain separate checks. Candidate flags inside the immutable archive are build-time snapshots.

Editable personas, default-off mineral queries, local viewer skins, a shared versioned server notebook and official DSH capability presets are available from the Minecraft settings page. Offline CPU token-vector/keyword retrieval is not a neural semantic model; configure your own embeddings service when needed. Local skins affect the own web avatar only. Existing game, native reasoning/tools, metrics and experiment views remain available. See [configuration and notebook](docs/character-notebook.md), [installation](README-INSTALL.md) and [public verification](docs/npm-publish-rc22.json).

Published archives retain their reviewed bytes. Candidate flags inside the archive are build-time snapshots; Release attachments and main-branch records describe current distribution status. Installation alone starts no game or model.

[简体中文](README.md) | English

## Live spectating

Watch the Agent's existing game connection in first-person, third-person or 3D spectator views. Toggle the HUD and camera locally; the DSH panel can place the game beside native reasoning, replies and tool records.

![Live 3D spectating from the shared core, with the HUD hidden](docs/screenshots/live-spectator-20261026.jpg)

Captured on 2026-10-26 from the shared **Agent MC World** core's existing live spectator page, not an AI-generated image or a DSH Desktop window. This server has custom dungeon content; its skills and character appearance depend on optional server/appearance resources.

![Live spectator HUD with map, abilities and action state](docs/screenshots/live-spectator-hud-20261026.jpg)

![Embedded DSH game view beside native conversation and tools](docs/screenshots/game-and-reasoning.png)

The third image is a recorded DSH Web integration test. The transcript is visibly labelled offline UI test data; it demonstrates the layout, not live model reasoning. See [screenshot provenance](docs/screenshots/README.md), [Desktop installation](docs/desktop.md) and [market listing status](docs/marketplaces.md). The root `screenshots.json` provides the gallery in this order.

A thin DeepSeek Harness adapter for the shared [Agent MC World core](https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world). DSH owns persona, goals, sessions, memory and model choice. The core owns one Minecraft body, navigation, tools, game memory, learning evidence, fast-decision contracts and visualization. The optional `agent-mc-qiandengji` package enables that server's protocols and reference material explicitly.

The rc.24 release consumes core **0.5.7-rc.99** and optional pack **0.5.0-rc.24**. Java 1.21.1 is primary; actual connection protocols and compatible viewer materials remain explicit. Publication, installation, native Desktop pixels and live gameplay are separate acceptance stages.

The default lean tool set now retains `*_script` for on-demand shared routine and method discovery; explicit `tools.exclude` is respected.

Optional [Harness2 practice](docs/harness2.md) reuses DSH's registered model route and the core's isolated execution, baseline/held-out comparison and game-memory contracts. It is disabled by default and never adopts a skill or resumes a live Agent automatically.

Use Node.js 24. The first-run form reuses DSH's selected provider, model and reasoning effort, allocates local ports and keeps a private per-account data directory. An empty first task connects without starting inference. The right pane renders DSH's original reasoning, tools and replies; game-only mode hides the transcript for streaming. Missing reasoning stays unavailable. Stop and configure preserves the session and persists the stopped state. Advanced deployments may still use a private `configFile`; see [examples](examples/harness). Local and cloud models use the same body and public SDK/MCP interface. Microsoft authentication and server-specific activation remain explicit steps.

An existing session resumes with its original identity, goals and history. The adapter preserves structured receipts, task terminal states, cancellation and real DSH turn boundaries. Model actions carry actual session/turn/step attribution. Shadow suggestions are not counted as adopted learned actions. Client stream duration is not engine execution time, and unavailable metrics remain unknown.

The exact dependencies are public: use `npm ci`, `npm run build` and `npm test`. All locked dependencies use registry.npmjs.org with integrity metadata. Tests cover native DSH sessions, loopback model formatting/cancellation, stock official main/Worker loading and legacy repair rollback. `MC_DSH_PROFILE` targets an isolated installed profile for the stock fixture; `DSH_RUNTIME` selects an external host for other API tests. The build copies only the adapter; it does not bundle another body or import a Cortico checkout.

See the [migration guide](docs/harness-migration.md) and [installation guide](README-INSTALL.md). The old 0.1.x implementation is retained as [legacy reference](docs/legacy-0.1.md) and excluded from the default release.

MIT. Demonstration personas reference fictional third-party characters; no third-party YSM model is distributed.
