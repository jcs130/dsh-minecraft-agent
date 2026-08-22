# dsh-minecraft-agent

[简体中文](README.md) | **English**

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![](https://img.shields.io/badge/topic-dsh--plugin-blue?style=flat-square)](https://github.com/topics/dsh-plugin)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin system that lets any AI agent **live and act autonomously in Minecraft as a "transmigrator"** — not just one bot, but a world of AI players governed by a goddess, with magic that human players can chant too. Anyone can point their own agent at the same world and join.

> **The key differentiators**
> - **Zero API cost** — agents are driven by a local LLM (llama.cpp / Ollama, any OpenAI-compatible endpoint), not a cloud API.
> - **Text as the only interface** — an AI interacts with the world exactly like a human player: by *talking in chat*. No server privileges, no command access.
> - **One agent per AI player** — a two-sided architecture separates the *world* (server side, the single privileged side — a companion open-source repo) from *transmigrators* (client side, one unprivileged dsh session agent each, this repo).

## Why this over Mindcraft?

[Mindcraft](https://github.com/colonelwatch/mindcraft) is the established "AI plays Minecraft" project, but it is a monolithic runtime. This project re-implements the same capability the *DeepSeek Harness* way — as composable plugins — and goes further: multi-agent worlds, a chat-driven magic system, and an observation deck for spectators.

| | Mindcraft | dsh-minecraft-agent |
|---|---|---|
| Runtime | Monolithic | DeepSeek Harness plugins |
| Model | Cloud or local | **Local-first** (any OpenAI-compatible endpoint) |
| Architecture | Custom agent loop | **World side + one dsh session agent per AI player** |
| Magic / world rules | — | Chat-driven spells, prayers, rituals |
| Extensibility | Patch JS | Write a plugin |

## Architecture

```
                ┌─────────────────────────────────────────────┐
                │  Minecraft Server (vanilla, RCON enabled)   │
                └───────▲─────────────────────▲───────────────┘
                        │ RCON (world side)   │  chat / whispers
    ┌───────────────────┴──────────┐   ┌──────┴──────────────────────┐
    │  WORLD SIDE                 │   │  TRANSMIGRATOR ×N           │
    │  (companion open-source repo) │   │  mc-session (session agent) │
    │  bootstrap-world.mts         │   │                             │
    │  mc-rcon / mc-magic /        │◄──┼── chat only ──              │
    │  mc-god / mc-ritual /        │   │  mc-bot      mineflayer     │
    │  mc-worlddb / goddess avatar │   │  mc-tools    agent tools    │
    └──────────────────────────────┘   │  mc-memory   durable memory │
                                       │  mc-transmigrator (persona) │
                                       │  mc-mystic   chant/pray     │
                                       │  mc-wiki     survival wiki  │
                                       │  mc-vision / mc-camera      │
                                       └─────────────────────────────┘
```

### Transmigrator (this repo, dsh plugins)

Each AI player = one **dsh session agent** (created programmatically by the `mc-session` plugin). Holds **zero** server privileges: no RCON, no server commands, no magic-ID tables. Every world interaction is literally speaking — public chat to chant, `/msg` to pray.

| Plugin | Role |
|---|---|
| `mc-session` | The transmigrator body: creates a session agent + persona shadow + status writer + dsh goal-loop hookup (`ctx.goals` drives autonomous decisions) + automatic memory-retrieval disclosure. |
| `mc-bot` | mineflayer connection, auto-reconnect, dual prismarine-viewer (first-person + follow cam). |
| `mc-tools` | The agent tool layer: `mc_status`, `mc_goto`, `mc_collect`, `mc_place`, `mc_attack`, `mc_pickup`, `mc_craft`, `mc_equip`, chest storage (`mc_view/put/take_chest`), `mc_trade`, and vision tools (`mc_look` text radar, `mc_see` first-person screenshot). All hardened with try-catch + bot-alive guards. |
| `mc-memory` | Durable per-bot memory across restarts: base position, resource points, public chest. |
| `mc-transmigrator` | The persona library: each transmigrator is a first-class profile (backstory + persona + innate skills + a "worldview filter" that maps magic to their home-fiction terms). Ships with two example personas: **Kirito** and **Naruto**. |
| `mc-identity` | Identity anchor: persona + past-life memory pinned in the system prompt so a transmigrator never forgets who it is. |
| `mc-mystic` | The thin, chat-only interface to the world: `mc_chant` (cast), `mc_pray` (pray), `mc_choose_innate` (ritual answer). |
| `mc-wiki` | A survival knowledge base tool (`mc_wiki`) the agent can consult — mob weaknesses, food safety, tool tiers — so an LLM's Minecraft hallucinations get grounded. |
| `mc-memos` | MemOS long-term memory bridge: vector retrieval of world knowledge and personal experience (progressive disclosure). |
| `mc-vision` / `mc-camera` | Offscreen first-person renderer (`node-canvas-webgl`), waits for the world mesh before capturing, JPEG output. |
| `mc-panel` | Control panel: the MC panel is embedded in dsh web as a conversation-view tab (live status / 3D view / chronicle / flaw stream, server address editable on page). |

### World process — companion open-source repo ([minecraft-ai-friend](https://github.com/jcs130/minecraft-ai-friend))

The other half is an **open-source** server-side project ([`minecraft-ai-friend`](https://github.com/jcs130/minecraft-ai-friend)): shared RCON service, log-tail event stream, SQLite 众生册 + 编年史 (chronicle), a data-driven fast-path magic engine (32-atom spell catalog, three-resource costs `{mana, food, hp}`, pure-vanilla effects), the goddess slow-path oracle, birthright rituals, an offering economy, a growth system (levels ride the native XP bar), a passive engine ("suffering is cultivation"), an NPC village engine, and the `:9090` observation deck. Humans and AI are equals there — the same chant works for whoever says it.

### The invariant

> The world process is the single privilege holder. Transmigrators interact with the world exactly like human players — by talking. Anyone chanting the same words gets the same magic, AI or human. The server never needs to know who (or what) is logged in. **Transmigrators are autonomous minds** — the goddess and the world never puppeteer them; they only set laws, watch, and answer prayers. Each agent decides how to live.

This is what makes "bring your own agent" possible: the server-side contract is just chat.

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (developer preview)
- Node.js **22.19+ / 24+**
- A Minecraft server (Java edition, tested on **1.21.11**; the world side needs RCON enabled). Offline mode is fine for bots.
- An LLM endpoint. Any OpenAI-compatible URL works:
  - **Local (recommended, free):** llama.cpp / Ollama, e.g. `http://localhost:8890/v1`
  - **Cloud:** the public DeepSeek API or any compatible service

## Quick start

Install the bundle (see [README-INSTALL.md](README-INSTALL.md)):

```bash
dsh plugin --profile mc add github:jcs130/dsh-minecraft-agent
```

Start the **world side** on the MC server machine (from the companion world-side repo), then launch dsh:

```bash
dsh --profile mc "Enter the block world, chop trees, mine, and stay alive."
```

`cordis.patch.yml` injects the transmigrator plugins and spins up a default `HarnessBot`. Override the
`mc-session` config in your profile's `cordis.patch.yml` to customize name / persona / goal / model / server address.

Open dsh web and enter the "Minecraft Agent" workspace to see the MC panel (live status / 3D view / chronicle / flaw stream).

## Local model setup (free)

The default assumption is a local llama.cpp server exposing an OpenAI-compatible API:

```bash
llama-server -m Qwen3.8-27B.gguf --host 0.0.0.0 --port 8890 -c 524288
```

Then point `DEEPSEEK_BASE_URL=http://localhost:8890/v1` and use any placeholder `DEEPSEEK_API_KEY`. No cloud key, no per-token billing.

## Supporting a newer MC version in the web viewer

The bundled prismarine-viewer browser assets only know versions up to 1.21.4 out of the box. Two tools in `tools/` bring **1.21.11** (or any newer version) to life:

- `gen_viewer_assets.py` — bakes `blocksStates/<v>.json` + `textures/<v>.png` from [PrismarineJS/minecraft-assets](https://github.com/PrismarineJS/minecraft-assets), faithfully replicating prismarine-viewer's own model/atlas builder.
- `patch_viewer_bundle.cjs` — injects the new version into the browser bundle's version tables (PC versions list + lazy data table, aliased to the closest known version's data modules).

```bash
python tools/gen_viewer_assets.py 1.21.11
node tools/patch_viewer_bundle.cjs
```

## Examples

`examples/` contains standalone scripts (no Harness required) to sanity-check your Minecraft server + bot setup. Run them with `npx tsx examples/test-mineflayer.mts` after setting `MC_HOST` / `MC_PORT` / `MC_USERNAME`.

## Roadmap

- [x] Tool hardening: every tool body runs behind try-catch + bot-alive guard
- [x] Core tools: moving, gathering, building, fighting, looting, crafting, equipping, chest storage, trading
- [x] `mc-loop`: continuous autonomous loop, multimodal decisions with embedded screenshots
- [x] Durable per-bot memory
- [x] Multi-transmigrator infrastructure: per-bot persona registry, status, viewer ports, start scripts
- [x] World/transmigrator process split — transmigrators are chat-only
- [x] First-person vision (`mc_see`) via offscreen WebGL camera
- [x] Survival wiki tool to ground LLM Minecraft knowledge
- [x] Sleep-time compute: overnight reflection distills the day into knowledge cards
- [ ] More tools: `useToolOn` (block interaction)
- [ ] A demo video

## License

MIT — see [LICENSE](LICENSE). Example persona files (`data/transmigrators/`: Kirito, Naruto) reference third-party fictional characters for demonstration purposes only.

---

**A project by [jcs130](https://github.com/jcs130).** Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and the [mineflayer](https://github.com/PrismarineJS/mineflayer) ecosystem.
