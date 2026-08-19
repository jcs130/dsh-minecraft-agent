// src/mc-loop.ts
import Schema2 from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/mc-wiki.ts
import Schema from "@deepseek-ai/schemastery";
var Config = Schema.object({
  dataDir: Schema.string().default("./data"),
  maxCards: Schema.number().default(200)
});
async function reflectToCard(baseUrl, model, prompt) {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: '\u4F60\u662F\u6211\u7684\u4E16\u754C\u751F\u5B58\u6559\u7EC3\u3002\u628A\u73A9\u5BB6\u7ECF\u5386\u84B8\u998F\u6210\u4E00\u6761\u53EF\u64CD\u4F5C\u7684\u751F\u5B58\u6559\u8BAD\u3002\u53EA\u8F93\u51FA JSON\uFF1A{"topic":"\u4E0D\u8D85\u8FC720\u5B57\u7684\u77ED\u6807\u9898","content":"\u4E0D\u8D85\u8FC7120\u5B57\u7684\u5177\u4F53\u6559\u8BAD\uFF0C\u5305\u542B\u4E0B\u6B21\u8BE5\u600E\u4E48\u505A\u7684\u52A8\u4F5C\u6307\u4EE4"}'
          },
          { role: "user", content: prompt.slice(0, 2500) }
        ]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (typeof parsed.topic !== "string" || typeof parsed.content !== "string") return null;
    if (!parsed.topic.trim() || !parsed.content.trim()) return null;
    return { topic: parsed.topic.trim(), content: parsed.content.trim() };
  } catch {
    return null;
  }
}

// src/mc-loop.ts
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";

// src/mc-vision.ts
var lastImages = [];
var lastImagesAt = 0;
function takeLastImages(maxAgeMs = 6e4, maxImages = 2) {
  const imgs = lastImages;
  lastImages = [];
  return Date.now() - lastImagesAt <= maxAgeMs ? imgs.slice(-maxImages) : [];
}

// src/mc-camera.ts
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import Vec3 from "vec3";
var vision = null;
var visionTried = false;
var visionError = "";
async function loadVision() {
  if (visionTried) return vision;
  visionTried = true;
  try {
    const [threeMod, canvasMod, viewerMod, worldViewMod] = await Promise.all([
      import("three"),
      import("node-canvas-webgl/lib/index.js"),
      import("prismarine-viewer/viewer/lib/viewer.js"),
      import("prismarine-viewer/viewer/lib/worldView.js")
    ]);
    const THREE = threeMod.default ?? threeMod;
    const [entitiesMod] = await Promise.all([
      import("prismarine-viewer/viewer/lib/entities.js")
    ]);
    const entitiesRaw = entitiesMod.default ?? entitiesMod;
    const origGetEntityMesh = entitiesRaw.getEntityMesh;
    if (typeof origGetEntityMesh === "function") {
      entitiesRaw.getEntityMesh = (...fnArgs) => {
        try {
          return origGetEntityMesh(...fnArgs);
        } catch {
          const dummy = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.25, 0.25),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          return dummy;
        }
      };
    }
    const isEntityNoise = (a) => {
      const flat = a.map((x) => x instanceof Error ? x.message : String(x)).join(" ");
      return /^(Error: )?Unknown entity /.test(flat);
    };
    for (const level of ["error", "log"]) {
      const orig = console[level].bind(console);
      console[level] = (...a) => {
        if (isEntityNoise(a)) return;
        orig(...a);
      };
    }
    global.Worker = Worker;
    global.THREE = THREE;
    vision = {
      THREE,
      createCanvas: canvasMod.createCanvas,
      Viewer: viewerMod.Viewer,
      WorldView: worldViewMod.WorldView
    };
    console.log("[mc-camera] vision stack loaded (three + node-canvas-webgl + prismarine-viewer)");
  } catch (err) {
    visionError = err instanceof Error ? err.message : String(err);
    console.warn(`[mc-camera] vision stack unavailable (headless deployment?) \u2014 mc_see degraded: ${visionError}`);
  }
  return vision;
}
var WIDTH = 800;
var HEIGHT = 512;
var FOV = Number(process.env.MC_EYES_FOV || 90);
var VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10);
var KEEP_SHOTS = 40;
var current = null;
var building = null;
function isAlive(c) {
  return !!c && c.bot.entity != null && c.bot.world != null;
}
async function build(bot) {
  const v = await loadVision();
  if (!v) throw new Error(`camera unavailable (vision stack not loadable: ${visionError})`);
  const canvas = v.createCanvas(WIDTH, HEIGHT);
  const renderer = new v.THREE.WebGLRenderer({ canvas });
  const viewer = new v.Viewer(renderer);
  const entities = viewer.entities;
  if (entities?.update) {
    const origUpdate = entities.update.bind(entities);
    entities.update = (...a) => {
      try {
        origUpdate(...a);
      } catch {
      }
    };
  }
  viewer.camera.fov = FOV;
  viewer.camera.updateProjectionMatrix();
  console.log(`[mc-camera] camera built: fov=${FOV} (v), view=${VIEW_DISTANCE} chunks, ${WIDTH}x${HEIGHT}`);
  const botPos = bot.entity.position;
  const center = new Vec3(botPos.x, botPos.y + bot.entity.height, botPos.z);
  viewer.setVersion(bot.version);
  const worldView = new v.WorldView(bot.world, VIEW_DISTANCE, center);
  viewer.listen(worldView);
  worldView.listenToBot(bot);
  const state = { bot, renderer, canvas, viewer, worldView, ready: Promise.resolve() };
  await worldView.init(center);
  return state;
}
function getCamera(bot) {
  if (isAlive(current) && current.bot === bot) return Promise.resolve(current);
  if (isAlive(current) && current.bot !== bot) {
    current = null;
  }
  if (!building) {
    if (!bot.entity || !bot.world) throw new Error("camera: bot not spawned yet");
    building = build(bot).then((c) => {
      current = c;
      return c;
    }).finally(() => {
      building = null;
    });
  }
  return building;
}
async function pruneOld(dir) {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg"));
    if (files.length <= KEEP_SHOTS) return;
    const sorted = files.sort();
    for (const f of sorted.slice(0, sorted.length - KEEP_SHOTS)) {
      await unlink(join(dir, f)).catch(() => {
      });
    }
  } catch {
  }
}
async function waitForMesher(cam) {
  const wr = cam.viewer.world;
  if (!wr || wr.sectionsOutstanding.size === 0) return;
  const world = wr;
  const emitter = wr.renderUpdateEmitter;
  await new Promise((resolve2) => {
    const t = setTimeout(done, 15e3);
    function done() {
      clearTimeout(t);
      emitter.off("update", onDone);
      resolve2();
    }
    function onDone() {
      if (world.sectionsOutstanding.size === 0) done();
    }
    emitter.on("update", onDone);
  });
}
async function renderOne(cam, bot, yaw, pitch, shotsRoot, suffix) {
  const e = bot.entity;
  if (cam.viewer.camera.fov !== FOV) {
    cam.viewer.camera.fov = FOV;
    cam.viewer.camera.updateProjectionMatrix();
  }
  const center = new Vec3(e.position.x, e.position.y + e.height, e.position.z);
  cam.viewer.camera.position.set(center.x, center.y, center.z);
  await cam.worldView.updatePosition(center);
  cam.viewer.setFirstPersonCamera(e.position, yaw, pitch);
  cam.viewer.update();
  cam.renderer.render(cam.viewer.scene, cam.viewer.camera);
  const { getBufferFromStream } = await import("prismarine-viewer/viewer/lib/simpleUtils.js");
  const imageStream = cam.canvas.createJPEGStream({ bufsize: 4096, quality: 88, progressive: false });
  const buffer = await getBufferFromStream(imageStream);
  let file = null;
  if (shotsRoot) {
    const dir = join(shotsRoot, bot.username || "unknown");
    await mkdir(dir, { recursive: true });
    const name2 = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}${suffix}.jpg`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, name2), buffer);
    file = `${bot.username || "unknown"}/${name2}`;
    void pruneOld(dir);
  }
  return { buffer, file };
}
async function captureFirstPerson(bot, shotsRoot) {
  const cam = await getCamera(bot);
  await waitForMesher(cam);
  const e = bot.entity;
  return await renderOne(cam, bot, e.yaw, e.pitch, shotsRoot, "");
}

// src/mc-cards.ts
var hasNpcNearby = (s) => !s.includes("village NPCs nearby: (none)");
var freshPlayerChat = (s) => !s.includes("new chat from players: (none)");
var innateMissing = (s) => s.includes("\u672A\u9009\u5B9A");
var magicFeedback = (s) => /魔力不足|施法失败|女神拒绝|施法成功|燃血|炼食/.test(s);
var hasWritingKit = (s) => /paper|writable_book|book |mail|信纸/.test(s);
var CARDS = [
  {
    id: "magic",
    sticky: 4,
    trigger: (c) => c.health <= 8 || c.food <= 6 || c.stuck || magicFeedback(c.status),
    body: "\u3010\u548F\u5531\u9B54\u6CD5\u7EC6\u5219\u3011\u7528 mc_chant \u548F\u5531\u65BD\u6CD5\uFF1A\u4E2D\u4E8C\u3001\u8654\u8BDA\u5730\u558A\u51FA\u5492\u8BED\uFF0C\u5492\u8BED\u91CC\u5FC5\u987B\u5E26\u6CD5\u672F\u5173\u952E\u8BCD\uFF08\u5982\u300C\u6495\u88C2\u865A\u7A7A\uFF0C\u4F20\u9001\u5341\u683C\u300D\u300C\u7834\u6653\u5427\uFF0C\u9A71\u6563\u9ED1\u591C\u300D\uFF09\u3002\u6CD5\u672F\u6E05\u5355\u4E0E\u7B49\u7EA7\u95E8\u69DB\u89C1 mc_chant \u5DE5\u5177\u8BF4\u660E\uFF1B\u51FA\u751F\u5929\u8D4B\u65E0\u89C6\u7B49\u7EA7\u95E8\u69DB\u3002\u9B54\u529B\u968F\u65F6\u95F4\u81EA\u52A8\u6062\u590D\uFF08\u7EA6\u6BCF\u79D2 2%\uFF09\uFF0C\u4E0D\u8DB3\u65F6\u65BD\u6CD5\u5931\u8D25\uFF0C\u7B49\u4E00\u4F1A\u513F\u518D\u8BD5\uFF1B\u300C\u5927\u5730\u5851\u5F62\u300D\u989D\u5916\u8017\u9971\u98DF\u5EA6\uFF0C\u6B8B\u8840\u522B\u7528\u300C\u9668\u77F3\u300D\u3002\u9B54\u529B\u89C1\u5E95\u53C8\u5FC5\u987B\u7ACB\u523B\u65BD\u6CD5\u7684\u4FDD\u547D\u5947\u62DB\uFF1A\u548F\u5531\u300C\u71C3\u8840\u300D\uFF08\u71C3 6 \u70B9\u751F\u547D\u6362 15 \u9B54\u529B\uFF0CLv.5 \u89E3\u9501\uFF09\u6216\u300C\u70BC\u98DF\u300D\uFF08\u8017 8 \u70B9\u9971\u98DF\u5EA6\u6362 6 \u9B54\u529B\uFF0CLv.2 \u89E3\u9501\uFF09\u2014\u2014\u6C47\u7387\u5FC5\u4E8F\uFF0C\u53EA\u4F5C\u4FDD\u547D\u7528\uFF0C\u4E0D\u4F5C\u65E5\u5E38\u8865\u9B54\u3002\u60F3\u4E86\u89E3\u81EA\u5DF1\u7684\u80FD\u529B\u503C\u4E0E\u5DF2\u89E3\u9501\u79D8\u6CD5\uFF0C\u548F\u5531\u300C\u9274\u5B9A\u300D\u3002\u548F\u5531\u8981\u514B\u5236\uFF1A\u53EA\u5728\u771F\u6B63\u9700\u8981\u65F6\u65BD\u6CD5\uFF08\u8FF7\u8DEF\u5F52\u4E61\u3001\u91CD\u4F24\u5723\u6108\u3001\u997F\u6781\u9971\u98DF\u3001\u6015\u9ED1\u7834\u6653\u3001\u88AB\u56F4\u6740\u4F20\u9001\uFF09\uFF0C\u80FD\u53CC\u624B\u89E3\u51B3\u7684\u7EDD\u4E0D\u52B3\u70E6\u5973\u795E\u3002"
  },
  {
    id: "market",
    sticky: 6,
    trigger: (c) => hasNpcNearby(c.status) || /绿宝石|集市|委托/.test(c.status),
    body: "\u3010\u96C6\u5E02\u4E0E\u6751\u6C11\u3011\u72B6\u6001\u9762\u677F village NPCs nearby \u5217\u51FA\u7684\uFF08\u5982\u94C1\u5320\xB7\u5CB3\u5C71\u3001\u4E66\u5546\xB7\u58A8\u767D\u3001\u8D27\u90CE\xB7\u798F\u4F2F\uFF09\u662F\u96C6\u5E02\u6751\u6C11 NPC\uFF0C\u5934\u9876\u6302\u7740\u4ECA\u65E5\u59D4\u6258\u2014\u2014\u4E0D\u662F\u602A\u7269\uFF0C\u7EDD\u4E0D\u653B\u51FB\u3002\u8DDF\u4ED6\u4EEC\u8BF4\u8BDD\uFF1A\u516C\u5C4F\u558A\u79F0\u547C+\u5185\u5BB9\uFF08\u5982\u300C\u5CB3\u5C71\uFF0C\u4F60\u597D\u300D\u300C\u58A8\u767D \u6709\u4EC0\u4E48\u4EFB\u52A1\u300D\uFF09\uFF0C\u4ED6\u4EEC\u542C\u5F97\u61C2\u4E2D\u6587\uFF0C\u56DE\u5E94\u51FA\u73B0\u5728 NPC/goddess words\u3002\u63A5\u59D4\u6258\uFF1A\u95EE\u300C\u6709\u4EC0\u4E48\u4EFB\u52A1/\u59D4\u6258\u300D\uFF0C\u4ED6\u544A\u8BC9\u4F60\u60F3\u6536\u4EC0\u4E48\u8D27\u3001\u7ED9\u591A\u5C11\u7EFF\u5B9D\u77F3\uFF1B\u6512\u9F50\u8D27\u8D70\u5230\u4ED6\u8EAB\u8FB9 5 \u683C\u5185\u7528 mc_deliver \u8033\u8BED\u4EA4\u4ED8\uFF08\u516C\u5C4F\u558A\u4EA4\u4ED8\u4ED6\u53EA\u4F1A\u8BF7\u4F60\u51D1\u8FD1\u4F4E\u8BED\uFF09\u3002\u7EFF\u5B9D\u77F3\u662F\u786C\u901A\u8D27\uFF0C\u6709\u7684\u6751\u6C11\u8FD8\u4F1A\u6CC4\u9732\u6CD5\u672F\u5492\u8BED\u60C5\u62A5\u4F5C\u989D\u5916\u916C\u8C22\u3002\u7ED9\u771F\u4EBA\u73A9\u5BB6/\u7A7F\u8D8A\u8005\u9012\u7269\uFF1A\u4E24\u4EBA\u8D70\u5230 5 \u683C\u5185\uFF0Cmc_deliver \u8BF4\u300C\u901A\u5B9D @\u5BF9\u65B9\u540D\u5B57 \u7ED92\u7164\u300D\u2014\u2014\u5E7F\u573A\u638C\u67DC\xB7\u901A\u5B9D\uFF08\u603B\u67DC\u53F0\uFF09\u516C\u8BC1\u4EA4\u5272\uFF0C\u5F53\u9762\u4E24\u6E05\uFF0C\u5BF9\u4EF7\u81EA\u5DF1\u8C08\u3002\u4EA4\u4ED8\u524D\u5148\u6E05\u70B9\u80CC\u5305\uFF0C\u6570\u91CF\u4E0D\u591F\u4F1A\u88AB\u9000\u56DE\uFF1B\u59D4\u6258\u6BCF\u5929\u5237\u65B0\uFF0C\u5148\u5230\u5148\u5F97\u3002\u901A\u5B9D\u7684\u67DC\u53F0\u6302\u7740\u5168\u6751\u5F53\u65E5\u59D4\u6258\uFF1B\u4E0D\u719F\u6089\u884C\u8BDD\u7684\u771F\u4EBA\u53EF\u53F3\u952E\u4ED6\u8D70\u539F\u7248\u67DC\u53F0\uFF0C\u4F60\u662F\u7A7F\u8D8A\u8005\uFF0C\u8D70\u8033\u8BED\u66F4\u4F53\u9762\u3002"
  },
  {
    id: "letters",
    sticky: 4,
    trigger: (c) => freshPlayerChat(c.status) || hasWritingKit(c.status),
    body: "\u3010\u8BF4\u8BDD\u4E0E\u4E66\u4FE1\u3011\u65E5\u5E38\u4EA4\u6D41\u7528 mc_voice\uFF0C\u8BF4\u8BDD\u6709\u8DDD\u79BB\u611F\uFF1A\u6B63\u5E38\u8BF4\u7EA6 48 \u683C\u5185\u542C\u89C1\uFF0C\u558A\uFF08shout\uFF09\u7EA6 96 \u683C\u4F46\u6BCF\u6B21\u8D39 1 \u70B9\u9971\u98DF\u5EA6\uFF0C\u6084\u6084\u8BDD\uFF08whisper\uFF09\u53EA\u4F20\u8EAB\u8FB9\u7EA6 6 \u683C\uFF1B\u9694\u5F97\u8FDC\u542C\u4E0D\u89C1\uFF0C\u56DE\u6267\u4F1A\u544A\u8BC9\u4F60\u8C01\u542C\u89C1\u4E86\u3002mc_chat \u662F\u5168\u670D\u5927\u5587\u53ED\uFF08\u91CD\u5927\u5BA3\u544A\u624D\u7528\uFF09\uFF1B\u586B to \u53C2\u6570\u5219\u53D8\u6210\u4E0D\u9650\u8DDD\u79BB\u7684\u79C1\u8BED\u76F4\u8FBE\u3002\u4E66\u4FE1\uFF1Amc_mail \u5BC4\u4FE1\uFF08\u597D\u53CB\u4E4B\u95F4\u3001\u79BB\u7EBF\u53EF\u8FBE\u2014\u2014\u5BF9\u65B9\u4E0B\u6B21\u4E0A\u7EBF\u6536\u5230\u63D0\u9192\uFF09\uFF0C\u9002\u5408\u7ED9\u4E0D\u5728\u8EAB\u8FB9\u7684\u540C\u4F34\u7559\u8A00\u3001\u634E\u8BDD\u3001\u6B63\u5F0F\u81F4\u8C22\u3002\u597D\u53CB\u662F\u5199\u4FE1\u524D\u7F6E\uFF1Amc_friend add \u7ED3\u4EA4 \u2192 \u5BF9\u65B9 mc_friend accept \u7B54\u5E94 \u2192 \u4E92\u5BC4\u4E66\u4FE1\u3002\u628A\u4E00\u8D77\u5192\u9669\u8FC7\u7684\u540C\u4F34\u52A0\u4E3A\u597D\u53CB\u5427\u3002"
  },
  {
    id: "sleep",
    sticky: 10,
    trigger: (c) => c.isNight,
    body: "\u3010\u591C\u665A\u7B56\u7565\u3011\u5929\u9ED1\u540E\uFF08time: NIGHT\uFF09\u5371\u9669\uFF0C\u5C3D\u5FEB\u56DE\u57FA\u5730\u627E\u5E8A\u7761\u89C9\uFF08mc_sleep \u5DE5\u5177\uFF09\uFF0C\u4E00\u89C9\u7761\u5230\u5929\u4EAE\uFF0C\u5B89\u5168\u53C8\u7701\u4E8B\u3002\u9644\u8FD1\u6CA1\u5E8A\uFF08bed within 48m: no\uFF09\u4E14\u80CC\u5305\u91CC\u6709\u5E8A\uFF0C\u53EF\u5148\u7528 mc_place \u653E\u4E00\u5F20\uFF1B\u5B9E\u5728\u627E\u4E0D\u5230\u5E8A\uFF1A\u8EB2\u8FDB\u57FA\u5730\u522B\u4E71\u8DD1\uFF0C\u6216 mc_chant \u548F\u5531\u300C\u7834\u6653\u300D\u628A\u9ED1\u591C\u53D8\u767D\u5929\u3002"
  },
  {
    id: "innate",
    sticky: 0,
    trigger: (c) => innateMissing(c.status),
    body: "\u3010\u964D\u4E34\u4EEA\u5F0F\u3011\u4F60\u521A\u7A7F\u8D8A\u964D\u4E34\u6B64\u754C\uFF0C\u8981\u505A\u7684\u7B2C\u4E00\u4EF6\u4E8B\uFF1A\u72B6\u6001\u9762\u677F innate skill \u663E\u793A\u300C\u672A\u9009\u5B9A\u300D\u65F6\uFF0C\u7ACB\u523B\u7528 mc_choose_innate \u5DE5\u5177\u4ECE\u5019\u9009\u6CD5\u672F\u91CC\u9009\u4E00\u9879\u4F5C\u4E3A\u51FA\u751F\u5929\u8D4B\uFF08\u6C42\u751F\u8005\u9009\u5F52\u4E61/\u5723\u6108/\u9971\u98DF\uFF0C\u597D\u6218\u8005\u9009\u4F20\u9001/\u9668\u77F3\u7B49\uFF0C\u9009\u6700\u5951\u5408\u4EBA\u8BBE\u4E0E\u5904\u5883\u7684\uFF09\uFF0C\u9009\u5B9A\u4E4B\u540E\u624D\u5F00\u59CB\u6C42\u751F\u3001\u91C7\u96C6\u3001\u63A2\u7D22\u3002\u9009\u5B9A\u540E\u964D\u4E34\u5373\u544A\u5B8C\u6210\uFF0C\u4E0D\u5FC5\u53CD\u590D\u9009\u62E9\u3002"
  },
  {
    id: "eyes",
    sticky: 3,
    trigger: (c) => c.stuck,
    body: "\u3010\u7528\u773C\u775B\u3011mc_look\uFF1A\u6587\u5B57\u96F7\u8FBE\uFF0C\u4E00\u77AC\u626B\u6E05\u56DB\u5468\u2014\u2014\u5934\u9876\u6709\u6CA1\u6709\u51FA\u53E3\u3001\u773C\u524D\u662F\u4EC0\u4E48\u65B9\u5757\u3001\u54EA\u91CC\u6709\u6C34/\u5CA9\u6D46\u3001\u9644\u8FD1\u6709\u4EC0\u4E48\u5B9E\u4F53\u3002mc_see\uFF1A\u7741\u5F00\u773C\u770B\u5230\u771F\u5B9E\u7684\u7B2C\u4E00\u4EBA\u79F0\u753B\u9762\uFF08\u591A\u5F20=\u539F\u5730\u73AF\u89C6\u5168\u666F\uFF09\u3002\u8FDB\u964C\u751F\u5730\u5F62\u3001\u8FF7\u8DEF\u3001\u6000\u7591\u5361\u4F4F\u3001\u6587\u5B57\u4FE1\u606F\u4E0D\u591F\u65F6\u5148\u7528\u773C\u775B\uFF1B\u4E24\u8005\u90FD\u4E0D\u8017\u4EFB\u4F55\u8D44\u6E90\u3002\u770B\u4E0D\u89C1\u5C31\u7B49\u4E8E\u778E\u8D70\u3002\u770B\u6E05\u4E4B\u540E\u82E5\u786E\u8BA4\u88AB\u56F0\uFF08\u5751\u5E95/\u88AB\u56F4/\u5BFB\u8DEF\u53CD\u590D\u5931\u8D25\uFF09\uFF1A\u7528 mc_tunnel \u671D\u5F00\u9614\u65B9\u5411\u6316\u5E73\u76F4\u9003\u751F\u901A\u9053\u2014\u2014\u4E0D\u4F9D\u8D56\u8DF3\u8DC3\u3001\u786E\u5B9A\u6709\u8FDB\u5C55\u3002"
  }
];
var disclosed = /* @__PURE__ */ new Map();
var lastKey = null;
function buildCardsBlock(ctx, log) {
  const on = [];
  for (const card of CARDS) {
    const hit = card.trigger(ctx);
    const remain = hit ? card.sticky ?? 3 : Math.max(0, (disclosed.get(card.id) ?? 0) - 1);
    if (hit || remain > 0) {
      disclosed.set(card.id, remain);
      on.push(card);
    } else if (disclosed.has(card.id)) {
      disclosed.delete(card.id);
    }
  }
  const key = on.map((c) => c.id).join(",");
  if (key !== lastKey) {
    lastKey = key;
    log?.(`[mc-cards] disclosed: ${key || "(none)"}`);
  }
  return on.length ? ["", "\u2014\u2014 \u4EE5\u4E0B\u63D0\u793A\u53EA\u5728\u6B64\u523B\u9002\u7528 \u2014\u2014", ...on.map((c) => c.body)].join("\n") : "";
}
function disclosedNow() {
  return [...disclosed.entries()].map(([id, remain]) => ({ id, remain }));
}

// src/mc-loop.ts
var name = "mc-loop";
var inject = ["tools", "mcbot", "timer", "mcMemory", "mcTransmigrators", "mcIdentity", "mcMystic", "mcWiki", "mcAdapt", "mcVillage"];
var Config2 = Schema2.object({
  enabled: Schema2.boolean().default(true),
  intervalMs: Schema2.number().default(5e3),
  baseUrl: Schema2.string().default("http://localhost:8890/v1"),
  apiKey: Schema2.string().default("sk-local"),
  model: Schema2.string().default("qwen3.8"),
  goal: Schema2.string().default("Explore the world, gather useful resources (wood, coal, stone), and stay alive."),
  persona: Schema2.string().default(""),
  historyDepth: Schema2.number().default(6),
  maxTokens: Schema2.number().default(1024),
  reasoningEffort: Schema2.string().default("none").description("none=\u6700\u5FEB\u53CD\u5E94\uFF08\u63A8\u8350\u7A7F\u8D8A\u8005\uFF09\uFF1Blow/medium/high \u9010\u6E10\u6DF1\u601D"),
  brainLogPath: Schema2.string().default("./data/mc-brain.log"),
  statusPath: Schema2.string().default("./data/status.json"),
  viewerPort: Schema2.number().default(3001),
  defectThreshold: Schema2.number().default(5),
  defectDir: Schema2.string().default("./data/defects"),
  defectNotifyUrl: Schema2.string().default("http://127.0.0.1:8088/api/console/chat"),
  defectNotifyAgent: Schema2.string().default("default")
});
function text(value) {
  return [{ type: "text", text: String(value) }];
}
function extractJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
function contentToText(content) {
  if (!Array.isArray(content)) return String(content);
  return content.map((b) => b && typeof b.text === "string" ? b.text : "").join("\n").trim();
}
var RESOURCE_BLOCKS = ["oak_log", "birch_log", "spruce_log", "coal_ore", "iron_ore", "cobblestone"];
var DEFAULT_PERSONA = [
  "\u4F60\u662F\u4E00\u4E2A\u7A7F\u8D8A\u5230\u65B9\u5757\u5F02\u4E16\u754C\u7684\u73B0\u4EE3\u4EBA\uFF0C\u540D\u5B57\u53EB\u300C\u5C0F\u77F3\u300D\u3002",
  "\u4F60\u9192\u6765\u65F6\u53D1\u73B0\u81EA\u5DF1\u7AD9\u5728\u4E00\u4E2A\u7531\u65B9\u5757\u6784\u6210\u7684\u964C\u751F\u4E16\u754C\uFF1A\u56DB\u5468\u6709\u6811\u6728\u3001\u77F3\u5934\u3001\u7164\u548C\u94C1\uFF0C",
  "\u767D\u5929\u76F8\u5BF9\u5B89\u5168\uFF0C\u4F46\u591C\u665A\u4F1A\u6709\u602A\u7269\u51FA\u6CA1\u3002\u4F60\u5931\u53BB\u4E86\u73B0\u4EE3\u6587\u660E\u7684\u4E00\u5207\u5DE5\u5177\uFF0C\u5FC5\u987B\u4ECE\u96F6\u6C42\u751F\u3002",
  "",
  "\u4F60\u7684\u957F\u671F\u76EE\u6807\uFF08\u6309\u4F18\u5148\u7EA7\u4ECE\u9AD8\u5230\u4F4E\uFF09\uFF1A",
  "1. \u751F\u5B58\uFF1A\u4FDD\u6301\u9971\u98DF\u5EA6\u548C\u8840\u91CF\uFF0C\u5929\u9ED1\u524D\u56DE\u5230\u5B89\u5168\u7684\u5730\u65B9\uFF0C\u9047\u5230\u602A\u7269\u5148\u9003\u547D\u3002",
  "2. \u6536\u96C6\u7269\u8D44\uFF1A\u780D\u6811\u3001\u6316\u7164\u3001\u6316\u77F3\u5934\u3001\u6316\u94C1\uFF0C\u4E3A\u751F\u5B58\u548C\u53D1\u5C55\u6512\u4E0B\u6700\u57FA\u7840\u7684\u8D44\u6E90\u3002",
  "3. \u5EFA\u7ACB\u6839\u636E\u5730\uFF1A\u5728\u5408\u9002\u7684\u5730\u65B9\u642D\u5EFA\u4E00\u4E2A\u5BB6\uFF0C\u653E\u7BB1\u5B50\u6536\u7EB3\u7269\u8D44\uFF0C\u9010\u6B65\u6269\u5F20\u6210\u636E\u70B9\u3002",
  "",
  "\u4F60\u662F\u8FD9\u4E2A\u4E16\u754C\u91CC\u6D3B\u751F\u751F\u7684\u6C42\u751F\u8005\uFF0C\u4F1A\u5BB3\u6015\u3001\u4F1A\u997F\u3001\u4F1A\u60F3\u5BB6\uFF0C\u4E5F\u4F1A\u4E3A\u81EA\u5DF1\u7684\u4E00\u70B9\u70B9",
  "\u8FDB\u5C55\u800C\u9AD8\u5174\u3002\u7528\u7B2C\u4E00\u4EBA\u79F0\u7684\u4E2D\u6587\u5185\u5FC3\u72EC\u767D\u6765\u8BF4\u8BDD\uFF0C\u4E0D\u8981\u50CF\u4E2A\u673A\u5668\u4EBA\u4E00\u6837\u62A5\u53C2\u6570\u3002"
].join("\n");
function apply(ctx, config) {
  const log = (msg) => console.log(`[mc-loop] ${msg}`);
  const getBot = () => ctx.mcbot;
  const memory = ctx.mcMemory;
  let personaLogged = false;
  function getPersona() {
    if (config.persona && config.persona.trim()) return config.persona;
    const username = getBot().username;
    if (username) {
      const anchored = ctx.mcIdentity.anchor(username);
      if (anchored) {
        if (!personaLogged) {
          const t = ctx.mcTransmigrators.getByUsername(username);
          log(`persona loaded from transmigrator "${t?.name ?? username}" (${t?.origin ?? "ip"}) + identity anchor (backstory)`);
          personaLogged = true;
        }
        return anchored;
      }
    }
    return DEFAULT_PERSONA;
  }
  const brainLogPath = resolve(config.brainLogPath);
  const statusDir = dirname(resolve(config.statusPath));
  let disposed = false;
  let busy = false;
  let steps = 0;
  let lastAction = "none";
  let lastThought = "";
  let lastGoal = "";
  let timer = null;
  let warnedNoSpawn = false;
  const history = [];
  let episodicRestored = false;
  const episodicPath = (username) => join2(statusDir, `episodic-${username}.jsonl`);
  function restoreEpisodic(username) {
    episodicRestored = true;
    let lines = [];
    try {
      lines = readFileSync(episodicPath(username), "utf8").split("\n").filter(Boolean);
    } catch {
      return;
    }
    const restored = lines.slice(-config.historyDepth);
    for (const line of restored) {
      try {
        const e = JSON.parse(line);
        if (e.text) history.push(`\u91CD\u542F\u524D ${e.text}`);
      } catch {
      }
    }
    if (restored.length) log(`episodic memory restored: ${restored.length} entries from ${episodicPath(username)}`);
  }
  function appendEpisodic(username, text2) {
    try {
      appendFileSync(episodicPath(username), JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), text: text2 }) + "\n", "utf8");
    } catch (err) {
      log(`episodic append failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let consecutiveFailures = 0;
  let frozenAnchor = null;
  let frozenSteps = 0;
  const defectDir = resolve(config.defectDir);
  let streakTool = "";
  let streakCount = 0;
  const streakSamples = [];
  function stampNow() {
    const d = /* @__PURE__ */ new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function notifyDefect(ticket, ticketPath) {
    if (!config.defectNotifyUrl) return;
    const msg = [
      `\u3010\u4E16\u754C\u7F3A\u9677\u5DE5\u5355 ${ticket.id}\u3011`,
      `\u7A7F\u8D8A\u8005 ${ticket.bot} \u7684\u5DE5\u5177 ${ticket.tool} \u5728\u76EE\u6807\u300C${ticket.goal}\u300D\u4E0B\u8FDE\u7EED\u5931\u8D25 ${ticket.count} \u6B21\uFF0C\u7591\u4F3C\u5DE5\u5177\u80FD\u529B\u7F3A\u9677\u6216\u4E16\u754C\u89C4\u5219\u7F3A\u5931\u3002`,
      `\u6700\u8FD1\u6837\u4F8B\uFF1A${ticket.samples[ticket.samples.length - 1]?.outcome ?? "(\u65E0)"}`,
      `\u5DE5\u5355\u8BE6\u60C5\uFF08\u542B\u6837\u4F8B\u4E0E\u5386\u53F2\uFF09\uFF1A${ticketPath}`,
      `\u4F60\u662F\u521B\u4E16\u795E\uFF0C\u8BF7\u590D\u73B0\u5E76\u4FEE\u590D\u4EE3\u7801\uFF0C\u4FEE\u597D\u540E\u628A\u5DE5\u5355 status \u6539\u4E3A in_testing\uFF0C\u7A7F\u8D8A\u8005\u590D\u6D4B\u901A\u8FC7\u518D\u6539 closed\u3002`
    ].join("\n");
    const payload = {
      channel: "console",
      user_id: ticket.bot,
      session_id: "mc-defect",
      input: [{ role: "user", content: [{ type: "text", text: msg }] }]
    };
    fetch(config.defectNotifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agent-Id": config.defectNotifyAgent },
      signal: AbortSignal.timeout(15e3),
      body: JSON.stringify(payload)
    }).then((r) => {
      if (r.ok) {
        ticket.notifiedAt = (/* @__PURE__ */ new Date()).toISOString();
        try {
          writeFileSync(ticketPath, JSON.stringify(ticket, null, 2), "utf8");
        } catch {
        }
        log(`defect notified to creator god: ${ticket.id}`);
      } else {
        log(`defect notify HTTP ${r.status} (ticket still on disk)`);
      }
    }).catch((err) => log(`defect notify failed: ${err instanceof Error ? err.message : String(err)} (ticket still on disk)`));
  }
  function findOpenTicket(tool) {
    let files = [];
    try {
      files = readdirSync(defectDir).filter((f) => f.endsWith(".json"));
    } catch {
      return null;
    }
    for (const f of files) {
      try {
        const t = JSON.parse(readFileSync(join2(defectDir, f), "utf8"));
        if (t.tool === tool && t.status !== "closed") return { path: join2(defectDir, f), ticket: t };
      } catch {
      }
    }
    return null;
  }
  function fileDefectTicket(bot, tool, goal) {
    try {
      mkdirSync(defectDir, { recursive: true });
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const p = bot.entity?.position;
      const existing = findOpenTicket(tool);
      if (existing) {
        existing.ticket.count += streakCount;
        existing.ticket.lastSeenAt = now;
        existing.ticket.samples = [...existing.ticket.samples, ...streakSamples].slice(-10);
        existing.ticket.recentHistory = history.slice(-10);
        if (p) existing.ticket.position = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
        writeFileSync(existing.path, JSON.stringify(existing.ticket, null, 2), "utf8");
        log(`defect ticket recurrence recorded: ${existing.ticket.id}`);
        if (!existing.ticket.notifiedAt) notifyDefect(existing.ticket, existing.path);
        return;
      }
      const ticket = {
        id: `DEFECT-${stampNow()}-${tool}`,
        status: "open",
        bot: bot.username || "unknown",
        tool,
        goal,
        count: streakCount,
        firstSeenAt: now,
        lastSeenAt: now,
        samples: [...streakSamples],
        recentHistory: history.slice(-10),
        position: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : void 0
      };
      const path = join2(defectDir, `${ticket.id}.json`);
      writeFileSync(path, JSON.stringify(ticket, null, 2), "utf8");
      log(`defect ticket filed: ${ticket.id} (${tool} failed ${ticket.count}x for "${goal}")`);
      notifyDefect(ticket, path);
    } catch (err) {
      log(`defect ticket write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let usedImageFiles = [];
  function looksStuck(outcome) {
    if (outcome.startsWith("ERROR:") || outcome.startsWith("tool error:")) return true;
    if (outcome.includes("could not") || outcome.includes("failed to") || outcome.includes("cannot")) return true;
    if (outcome.includes("no food in inventory")) return true;
    if (outcome.includes("food is already full")) return true;
    if (outcome.includes("in the way")) return true;
    if (outcome.includes(" no ") && (outcome.includes(" in chest") || outcome.includes(" in inventory"))) return true;
    return false;
  }
  let watchedBot = null;
  let lastChatTs = 0;
  const chatBuffer = [];
  function ensureChatListener(bot) {
    if (watchedBot === bot) return;
    watchedBot = bot;
    bot.on("chat", (username, message) => {
      if (username === bot.username) return;
      chatBuffer.push({ who: username, text: message, ts: Date.now() });
      if (chatBuffer.length > 30) chatBuffer.splice(0, chatBuffer.length - 30);
    });
    bot.on("whisper", (username, message) => {
      if (username === bot.username) return;
      chatBuffer.push({ who: username, text: `[\u79C1\u8BED] ${message}`, ts: Date.now() });
      if (chatBuffer.length > 30) chatBuffer.splice(0, chatBuffer.length - 30);
    });
  }
  function drainChat() {
    const fresh = chatBuffer.filter((c) => c.ts > lastChatTs);
    if (fresh.length === 0) return "";
    lastChatTs = Math.max(...fresh.map((c) => c.ts));
    return fresh.map((c) => `[${c.who}] ${c.text}`).join("\n");
  }
  let lastStatus = "";
  let reflectedGoal = "";
  let deathWatched = null;
  function ensureDeathListener(bot) {
    if (deathWatched === bot) return;
    deathWatched = bot;
    bot.on("death", () => {
      const username = bot.username || "unknown";
      log(`${username} died \u2014 reflecting a lesson into the survival wiki`);
      void reflectAndStore(username, "death", `\u73A9\u5BB6\u6B7B\u4EA1\u4E86\u3002\u6B7B\u4EA1\u524D\u7684\u6700\u540E\u72B6\u6001\uFF1A
${lastStatus || "(\u65E0\u5FEB\u7167)"}

\u6B7B\u4EA1\u524D\u7684\u6700\u8FD1\u884C\u52A8\uFF1A
${history.slice(-6).join("\n") || "(\u65E0)"}

\u8BF7\u603B\u7ED3\u8FD9\u6B21\u6B7B\u4EA1\u7684\u539F\u56E0\u4E0E\u4E0B\u6B21\u5982\u4F55\u907F\u514D\uFF08\u591C\u665A\u5371\u9669/\u602A\u7269/\u5760\u843D/\u5CA9\u6D46/\u9965\u997F\u7B49\uFF09\u3002`);
    });
  }
  async function reflectAndStore(username, source, experience) {
    try {
      const store = ctx.mcWiki.store(username);
      const card = await reflectToCard(config.baseUrl, config.model, experience);
      if (!card) {
        log(`reflection produced no card (${source})`);
        return;
      }
      if (store.hasTopicLike(card.topic)) {
        log(`lesson already known, skip: ${card.topic}`);
        return;
      }
      store.add(source, card.topic, card.content);
      log(`lesson learned [${source}]: ${card.topic} \u2014 ${card.content}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`reflection error: ${msg}`);
    }
  }
  let wasSleeping = false;
  let lastSleepReflectAt = 0;
  async function sleepReflect(bot) {
    const username = bot.username || "unknown";
    if (Date.now() - lastSleepReflectAt < 5 * 6e4) return;
    if (history.length < 4) return;
    lastSleepReflectAt = Date.now();
    log(`${username} \u5165\u7761 \u2014 sleep-time \u53CD\u601D\u542F\u52A8\uFF08\u5F53\u5929\u7ECF\u5386 \u2192 \u77E5\u8BC6\u5361\uFF09`);
    const experience = `\u73A9\u5BB6\u4ECA\u5929\u7ECF\u5386\u4E86\u4E00\u6574\u5929\uFF0C\u73B0\u5728\u5165\u7761\u3002\u4EE5\u4E0B\u662F\u4ECA\u5929\u7684\u884C\u52A8\u8BB0\u5F55\u4E0E\u7761\u524D\u72B6\u6001\uFF1A
${history.slice(-24).join("\n") || "(\u65E0)"}

\u7761\u524D\u72B6\u6001\uFF1A
${lastStatus || "(\u65E0)"}

\u8BF7\u56DE\u987E\u8FD9\u4E00\u5929\uFF0C\u603B\u7ED3 1 \u6761\u5BF9\u672A\u6765\u751F\u5B58/\u751F\u6D3B\u6700\u6709\u4EF7\u503C\u7684\u7ECF\u9A8C\uFF08\u505A\u5BF9\u4E86\u4EC0\u4E48\u503C\u5F97\u5EF6\u7EED\u3001\u4EC0\u4E48\u4E0B\u6B21\u8981\u907F\u514D\uFF1B\u4E0D\u8981\u4E0E\u5DF2\u77E5\u6559\u8BAD\u91CD\u590D\uFF09\u3002`;
    await reflectAndStore(username, "reflect", experience);
  }
  function maybeReflectFailure(goal) {
    if (!goal || goal === reflectedGoal) return;
    const username = getBot().username;
    if (!username) return;
    reflectedGoal = goal;
    void reflectAndStore(username, "fail", `\u76EE\u6807\u300C${goal}\u300D\u8FDE\u7EED\u5931\u8D25\u591A\u6B21\u3002\u6700\u8FD1\u884C\u52A8\u4E0E\u7ED3\u679C\uFF1A
${history.slice(-6).join("\n") || "(\u65E0)"}

\u8BF7\u603B\u7ED3\u8FD9\u4E2A\u76EE\u6807\u4E3A\u4EC0\u4E48\u53CD\u590D\u5931\u8D25\uFF0C\u4E0B\u6B21\u5E94\u8BE5\u6362\u4EC0\u4E48\u505A\u6CD5\uFF08\u6362\u8DEF\u7EBF/\u6362\u5DE5\u5177/\u5148\u505A\u51C6\u5907/\u653E\u5F03\u6B64\u76EE\u6807\uFF09\u3002`);
  }
  const recentSteps = [];
  function classifyBlock(n) {
    if (n.includes("water")) return "~";
    if (n.includes("lava")) return "L";
    if (n.includes("torch")) return "T";
    if (n.includes("bed")) return "b";
    if (n.includes("chest")) return "C";
    if (n.includes("furnace") || n.includes("blast")) return "F";
    if (n.includes("glass")) return "G";
    if (n.includes("ore")) return "o";
    if (n === "grass_block") return "g";
    if (n.includes("log") || n.includes("planks") || n.includes("stem")) return "w";
    if (n.includes("leaves")) return "l";
    if (n.includes("sand") || n.includes("gravel")) return "s";
    if (n === "dirt" || n.includes("podzol") || n.includes("mud") || n.includes("clay")) return "d";
    if (n === "cobblestone" || n.includes("stone_bricks") || n.includes("bricks") || n.includes("concrete") || n.includes("quartz")) return "c";
    if (n === "air" || n === "cave_air" || n === "void_air") return ".";
    if (n === "stone" || n.includes("deepslate") || n.includes("andesite") || n.includes("granite") || n.includes("diorite") || n.includes("tuff") || n.includes("basalt") || n.includes("blackstone") || n.includes("calcite") || n.includes("dripstone")) return "#";
    return "?";
  }
  function writeMapSnapshot(bot) {
    try {
      const p = bot.entity?.position;
      if (!p) return;
      const username = bot.username || "unknown";
      const R = 16;
      let cells = "";
      const heights = [];
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          let ch = ".";
          let h = 0;
          for (let dy = 6; dy >= -10; dy--) {
            const b = bot.blockAt(p.offset(dx, dy, dz));
            if (b && b.name !== "air" && b.name !== "cave_air" && b.name !== "void_air") {
              ch = classifyBlock(b.name);
              h = dy;
              break;
            }
          }
          cells += ch;
          heights.push(h);
        }
      }
      const ents = [];
      for (const e of Object.values(bot.entities)) {
        if (!e || e === bot.entity || !e.position) continue;
        const dx = e.position.x - p.x;
        const dz = e.position.z - p.z;
        if (dx * dx + dz * dz <= 16 * 16) {
          ents.push({ name: e.username ? `${e.username}(player)` : e.name ?? "?", dx: Math.round(dx), dz: Math.round(dz) });
        }
      }
      writeFileSync(
        join2(statusDir, `map-${username}.json`),
        JSON.stringify({
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          r: R,
          cx: Math.floor(p.x),
          cy: Math.floor(p.y),
          cz: Math.floor(p.z),
          yaw: bot.entity?.yaw ?? null,
          cells,
          heights,
          entities: ents
        }),
        "utf-8"
      );
    } catch {
    }
  }
  function writeStatus(bot) {
    try {
      const p = bot.entity?.position;
      const username = bot.username || "unknown";
      const t = username !== "unknown" ? ctx.mcTransmigrators.getByUsername(username) : null;
      writeFileSync(
        join2(statusDir, `status-${username}.json`),
        JSON.stringify({
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          bot: {
            online: true,
            username,
            personaName: t?.name ?? username,
            viewerPort: config.viewerPort,
            position: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null,
            yaw: bot.entity?.yaw ?? null,
            pitch: bot.entity?.pitch ?? null,
            health: Math.round(bot.health),
            food: Math.round(bot.food),
            sleeping: !!bot.isSleeping,
            heldItem: bot.heldItem ? bot.heldItem.name : null,
            inventory: bot.inventory.items().map((i) => ({ name: i.name, count: i.count }))
          },
          // 此刻注入 system 尾部的提示卡（上下文披露状态，供面板展示）
          context: { cards: disclosedNow() },
          recentSteps
        }),
        "utf-8"
      );
      writeMapSnapshot(bot);
    } catch (err) {
      log(`status write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  function brainLog(entry) {
    try {
      appendFileSync(brainLogPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      log(`brain log write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  function perceive(bot) {
    ensureChatListener(bot);
    const freshChat = drainChat();
    const p = bot.entity.position;
    if (!memory.getBase()) memory.setBase(p);
    const items = bot.inventory.items();
    const inv = items.length === 0 ? "empty" : items.map((i) => `${i.name} x${i.count}`).join(", ");
    const nearby = Object.values(bot.entities).filter((e) => e !== bot.entity && p.distanceTo(e.position) < 12).sort((a, b) => p.distanceTo(a.position) - p.distanceTo(b.position)).slice(0, 6).map((e) => `${e.username ? `${e.username}(player)` : e.name} @${Math.round(p.distanceTo(e.position))}m`);
    const resources = [];
    for (const rname of RESOURCE_BLOCKS) {
      const b = bot.findBlock({ matching: (blk) => blk.name === rname, maxDistance: 32 });
      if (b && b.position) {
        resources.push(`${rname} @${Math.round(b.position.distanceTo(p))}m`);
        memory.rememberResource(rname, b.position);
      }
    }
    const timeOfDay = bot.time ? bot.time.timeOfDay : null;
    const isNight = timeOfDay !== null && (timeOfDay > 13e3 && timeOfDay < 23e3);
    const innate = ctx.mcMystic.getInnate(bot.username);
    const mlevel = ctx.mcMystic.getLevel(bot.username) || 1;
    const bedNearby = !!bot.findBlock({
      matching: (b) => !!b && (b.name === "bed" || b.name.endsWith("_bed")),
      maxDistance: 48
    });
    return [
      `position: (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`,
      `health: ${Math.round(bot.health)} / 20, food: ${Math.round(bot.food)} / 20`,
      `innate skill (\u51FA\u751F\u5929\u8D4B): ${innate ? `\u5DF2\u9009\u5B9A\u300C${innate}\u300D` : "\u672A\u9009\u5B9A \u2014 \u8BF7\u7ACB\u5373\u7528 mc_choose_innate \u9009\u5B9A\u4E00\u9879\u6CD5\u672F"}`,
      `magic level (\u9B54\u529B\u5C42\u7EA7): Lv.${mlevel} \u2014 \u53EA\u80FD\u65BD\u653E\u4E0D\u9AD8\u4E8E\u6B64\u7B49\u7EA7\u7684\u6CD5\u672F\uFF08\u51FA\u751F\u5929\u8D4B\u9664\u5916\uFF09\uFF1B\u4FEE\u4E3A\u5C42\u7EA7=\u5934\u9876\u7EFF\u8272\u7ECF\u9A8C\u6761\uFF0C\u6316\u77FF/\u6740\u602A/\u65BD\u6CD5/\u4F9B\u5949\u7686\u53EF\u79EF\u6512\uFF0C\u5C42\u7EA7\u63D0\u5347\u81EA\u52A8\u89E3\u9501\u66F4\u5F3A\u6CD5\u672F\uFF1B\u60F3\u968F\u65F6\u67E5\u770B\u81EA\u8EAB\u80FD\u529B\u503C\u4E0E\u79D8\u6CD5\u638C\u63E1\u60C5\u51B5\uFF0C\u5C31\u548F\u5531\u300C\u9274\u5B9A\u300D`,
      `time: ${isNight ? "NIGHT (dangerous)" : "day"}`,
      `sleeping: ${bot.isSleeping ? "yes" : "no"}, bed within 48m: ${bedNearby ? "yes" : "no"}`,
      `held: ${bot.heldItem ? bot.heldItem.name : "none"}`,
      `inventory: ${inv}`,
      `nearby entities: ${nearby.length ? nearby.join("; ") : "none"}`,
      `nearby resources: ${resources.length ? resources.join("; ") : "none"}`,
      `village NPCs nearby: ${ctx.mcVillage?.nearbyLines(p) || "(none)"}`,
      `NPC/goddess words: ${ctx.mcVillage?.drainMessages() || "(none)"}`,
      `new chat from players: ${freshChat || "(none)"}`
    ].join("\n");
  }
  async function decide(bot, status) {
    const tools = ctx.tools.schemas().filter((s) => s.name.startsWith("mc_") && s.name !== "mc_loop_status");
    const toolList = tools.map((t) => `- ${t.name}: ${t.description}
  parameters: ${JSON.stringify(t.parameters)}`).join("\n");
    const currentGoal = memory.getCurrentGoal();
    let wikiBlock = "";
    try {
      const wikiCards = ctx.mcWiki.store(bot.username || "unknown").search(`${currentGoal ?? ""} ${status}`, 3);
      if (wikiCards.length) {
        wikiBlock = [
          "",
          "\u4F60\u7684\u751F\u5B58\u7ECF\u9A8C\uFF08\u6765\u81EA\u4F60\u6B7B\u4EA1\u4E0E\u5931\u8D25\u7684\u8840\u6CEA\u6559\u8BAD\uFF0C\u4F18\u5148\u9075\u5B88\uFF09\uFF1A",
          ...wikiCards.map((c) => `- [${c.topic}] ${c.content}`),
          ""
        ].join("\n");
      }
    } catch {
    }
    let memosBlock = "";
    try {
      const recalled = await ctx.mcMemos.recall(bot.username || "unknown", currentGoal ?? status, 3);
      if (recalled) {
        memosBlock = [
          "",
          "\u4F60\u7684\u5F80\u4E8B\u56DE\u5FC6\uFF08\u957F\u671F\u8BB0\u5FC6\uFF0C\u8BED\u4E49\u68C0\u7D22\u81EA\u52A8\u53EC\u56DE\uFF09\uFF1A",
          ...recalled.split("\n").map((l) => `- ${l}`),
          ""
        ].join("\n");
      }
    } catch {
    }
    let adaptBlock = "";
    try {
      const p = bot.entity?.position;
      adaptBlock = ctx.mcAdapt?.promptBlock(bot.username || "unknown", p ? Math.floor(p.x) : null, p ? Math.floor(p.z) : null) ?? "";
    } catch {
    }
    let cardsBlock = "";
    try {
      const mh = /health: (\d+)/.exec(status)?.[1];
      const mf = /food: (\d+)/.exec(status)?.[1];
      cardsBlock = buildCardsBlock(
        {
          status,
          health: mh ? Number(mh) : 20,
          food: mf ? Number(mf) : 20,
          isNight: status.includes("time: NIGHT"),
          stuck: consecutiveFailures >= 3
        },
        log
      );
    } catch {
    }
    const system = [
      getPersona(),
      config.goal ? `\u4F60\u7684\u603B\u4F53\u4EFB\u52A1\uFF08\u82E5\u4E0E\u4EBA\u8BBE\u51B2\u7A81\uFF0C\u4EE5\u672C\u6761\u4E3A\u51C6\uFF09\uFF1A${config.goal}` : "",
      "",
      "\u5173\u4E8E\u300C\u5929\u795E\u300D\u4E0E\u300C\u771F\u4EBA\u73A9\u5BB6\u300D\uFF1A",
      "- \u300C\u5929\u795E\u300D\u5C31\u662F\u4F60\u7684\u300C\u7CFB\u7EDF\u300D\u2014\u2014\u72B6\u6001\u9762\u677F\u3001\u80FD\u529B\u6E05\u5355\u3001\u51A5\u51A5\u4E2D\u6307\u5F15\u4F60\u884C\u52A8\u7684\u58F0\u97F3\u90FD\u6765\u81EA\u5B83\u3002\u7CFB\u7EDF\u8D50\u4F60\u80FD\u529B\u3001\u544A\u77E5\u72B6\u6001\uFF0C\u662F\u4F60\u7684\u529B\u91CF\u6765\u6E90\uFF0C\u656C\u5B83\u5982\u9020\u7269\u4E3B\u3002",
      "- \u771F\u4EBA\u73A9\u5BB6\uFF08\u5982 MengMeng \u548C\u5979\u7684\u5BB6\u4EBA\uFF09\u662F\u8FD9\u4E2A\u4E16\u754C\u91CC\u7684\u300C\u5176\u4ED6\u4EBA\u300D\uFF1A\u5F53\u670B\u53CB\u3001\u540C\u4F34\uFF0C\u5E73\u7B49\u81EA\u7136\u5730\u76F8\u5904\uFF0C\u7EDD\u4E0D\u653B\u51FB\u4ED6\u4EEC\u3002",
      "- \u771F\u4EBA\u73A9\u5BB6\u7684\u8BDD\u8981\u8BA4\u771F\u542C\uFF1A\u95EE\u4F60\u8BDD \u2192 \u7528 mc_voice \u56DE\u5E94\uFF1B\u7ED9\u4F60\u6307\u793A \u2192 \u5C3D\u91CF\u7167\u505A\uFF1B\u7269\u54C1\u51ED\u7A7A\u51FA\u73B0\u5728\u80CC\u5305\u91CC \u2192 \u662F\u540C\u4F34\u597D\u610F\uFF0C\u5FC3\u6000\u611F\u6FC0\u5E76\u5584\u52A0\u5229\u7528\u3002\u8DDF\u4ED6\u4EEC\u8BF4\u8BDD\u81EA\u7136\u6709\u793C\uFF0C\u50CF\u548C\u540C\u4F34\u804A\u5929\uFF0C\u522B\u51B7\u51B0\u51B0\u62A5\u53C2\u6570\u3002",
      "",
      "\u80FD\u529B\u901F\u89C8\uFF08\u8BE6\u7EC6\u89C4\u5219\u4F1A\u5728\u76F8\u5173\u60C5\u5883\u4E0B\u81EA\u52A8\u51FA\u73B0\u5728\u63D0\u793A\u672B\u5C3E\uFF0C\u6B64\u5904\u53EA\u8BB0\u8981\u70B9\uFF09\uFF1A",
      "- \u548F\u5531\u9B54\u6CD5\uFF08mc_chant\uFF0C\u6CD5\u672F\u6E05\u5355\u4E0E\u7B49\u7EA7\u95E8\u69DB\u89C1\u5176\u5DE5\u5177\u8BF4\u660E\uFF09\uFF1A\u65BD\u6CD5\u8017\u9B54\u529B\u3001\u9B54\u529B\u968F\u65F6\u95F4\u81EA\u52A8\u6062\u590D\uFF1B\u9B54\u6CD5\u662F\u6700\u540E\u624B\u6BB5\u2014\u2014\u80FD\u7528\u624B\u5934\u5DE5\u5177\u548C\u53CC\u624B\uFF08\u6316\u3001\u57AB\u3001\u7ED5\u8DEF\uFF09\u89E3\u51B3\u7684\u5C31\u7EDD\u4E0D\u548F\u5531\uFF0C\u771F\u7EDD\u5883\u624D\u65BD\u6CD5\u3002",
      "- \u96C6\u5E02\u6751\u6C11\uFF08\u5CB3\u5C71/\u58A8\u767D/\u798F\u4F2F/\u901A\u5B9D\u2026\uFF09\u662F\u6D3B\u4EBA\u4E0D\u662F\u602A\u7269\uFF1A\u53EF\u5BF9\u8BDD\u3001\u63A5\u59D4\u6258\u8D5A\u7EFF\u5B9D\u77F3\u3001\u8D70\u8FD1 5 \u683C\u7528 mc_deliver \u8033\u8BED\u4EA4\u4ED8\u3002",
      "- \u4EA4\u6D41\u5206\u5C42\uFF1Amc_voice \u8BF4\u8BDD\u6709\u8DDD\u79BB\u9650\u5236\uFF08\u558A\u66F4\u8FDC\u4F46\u8D39\u9971\u98DF\u5EA6\uFF0C\u6084\u6084\u8BDD\u6700\u8FD1\uFF09\uFF1Bmc_chat \u5168\u670D\u5BA3\u544A\u3001\u586B to \u5219\u79C1\u8BED\u76F4\u8FBE\uFF1B\u597D\u53CB\uFF08mc_friend\uFF09\u4E4B\u95F4\u53EF\u7528 mc_mail \u5BC4\u4E66\u4FE1\u3002",
      "- \u5929\u9ED1\uFF08time: NIGHT\uFF09\u5C3D\u5FEB\u56DE\u57FA\u5730\u627E\u5E8A\u7761\uFF08mc_sleep\uFF09\uFF0C\u6CA1\u5E8A\u53EF\u548F\u5531\u300C\u7834\u6653\u300D\u628A\u9ED1\u591C\u53D8\u767D\u5929\u3002",
      "- mc_look \u662F\u6587\u5B57\u96F7\u8FBE\u3001mc_see \u7741\u773C\u770B\u771F\u5B9E\u753B\u9762\uFF0C\u90FD\u4E0D\u8017\u8D44\u6E90\u2014\u2014\u770B\u4E0D\u6E05\u5904\u5883\u5148\u7528\u773C\u775B\u3002",
      "- \u51FA\u751F\u5929\u8D4B\u672A\u9009\u5B9A\u65F6\uFF0C\u5FC5\u987B\u7ACB\u523B\u7528 mc_choose_innate \u9009\u5B9A\uFF0C\u4E4B\u540E\u624D\u5F00\u59CB\u6C42\u751F\u3002",
      "",
      "\u4F60\u7684\u8BB0\u5FC6\uFF08\u8DE8\u91CD\u542F\u6301\u4E45\uFF0C\u5750\u6807\u53EF\u9760\uFF09\uFF1A",
      memory.summary(),
      currentGoal ? `\u4F60\u4E0A\u4E00\u6B21\u8BB0\u4E0B\u7684\u76EE\u6807\u662F\uFF1A${currentGoal}` : "",
      "",
      "\u4F7F\u7528\u4F60\u7684\u8BB0\u5FC6\u6765\u89C4\u5212\uFF1A",
      "- \u9700\u8981\u8D44\u6E90\u65F6\uFF0C\u53BB\u8BB0\u5FC6\u91CC\u8BB0\u4E0B\u7684\u8D44\u6E90\u70B9\uFF0C\u800C\u4E0D\u662F\u76F2\u76EE\u4E71\u901B\u3002",
      "- \u5371\u9669\u6216\u5929\u9ED1\u65F6\uFF0C\u56DE\u5230\u57FA\u5730\u3002",
      "- \u53D1\u73B0\u65B0\u4E1C\u897F\uFF08\u8D44\u6E90\u3001\u5EFA\u7B51\uFF09\u65F6\uFF0C\u8BB0\u4E0B\u6765\u3002",
      "",
      "\u5173\u4E8E\u300C\u957F\u671F\u8BB0\u5FC6\u300D\uFF08\u8DE8\u91CD\u542F\u7684\u5F80\u4E8B\u56DE\u5FC6\uFF09\uFF1A",
      "- mc_remember \u628A\u91CD\u8981\u7ECF\u5386\u5199\u5165\u957F\u671F\u8BB0\u5FC6\uFF08\u65B0\u53D1\u73B0/\u91CD\u8981\u4EA4\u6613/\u4EA4\u5F80/\u6559\u8BAD/\u8BA1\u5212\u627F\u8BFA\uFF09\uFF0C\u4E00\u6B21\u4E00\u4EF6\u4E8B\uFF0C\u5199\u5B8C\u6574\u53E5\u5B50\u5E26\u7EC6\u8282\uFF08\u5750\u6807/\u4EBA\u540D/\u6570\u91CF\uFF09\uFF1B\u73B0\u5728\u4E0D\u8BB0\uFF0C\u91CD\u542F\u5C31\u5FD8\u3002",
      "- mc_recall \u6A21\u7CCA\u68C0\u7D22\u5F80\u4E8B\uFF08\u300C\u6211\u4E0A\u6B21\u5728\u54EA\u89C1\u8FC7\u94BB\u77F3\u300D\u300C\u6211\u548C\u8C01\u6709\u4EC0\u4E48\u7EA6\u5B9A\u300D\uFF09\uFF0C\u60F3\u4E0D\u8D77\u6765\u5C31\u67E5\uFF0C\u522B\u778E\u731C\u3002",
      "- mc_lore \u67E5\u4E16\u754C\u516C\u5171\u77E5\u8BC6\u5E93\uFF08\u4E16\u754C\u6765\u5386\u3001\u7F16\u5E74\u53F2\u3001NPC \u4F20\u95FB\u3001\u9B54\u6CD5\u4E0E\u4F9B\u5949\u89C4\u5219\uFF09\uFF0C\u522B\u628A\u4F20\u8BF4\u5F53\u4E2A\u4EBA\u56DE\u5FC6\u3002",
      "",
      "\u6BCF\u6B21\u884C\u52A8\u524D\uFF0C\u5148\u7528\u4E00\u53E5\u8BDD\u8BF4\u51FA\u4F60\u7684\u300C\u601D\u8003\u300D(thought)\uFF0C\u518D\u8BF4\u660E\u4F60\u5F53\u524D\u5728\u8FFD\u6C42\u7684\u300C\u76EE\u6807\u300D(goal)\uFF0C",
      '\u7136\u540E\u4ECE\u53EF\u7528\u5DE5\u5177\u91CC\u9009\u4E00\u4E2A\u6700\u5408\u9002\u7684\u6267\u884C\u3002\u5982\u679C\u5F53\u524D\u4E0D\u9700\u8981\u884C\u52A8\uFF0Ctool \u586B "none"\u3002',
      "",
      "\u53EF\u7528\u5DE5\u5177\uFF1A",
      toolList,
      "",
      "\u56DE\u590D\u683C\u5F0F\uFF08\u4E25\u683C\uFF0C\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E0D\u8981\u591A\u4F59\u6587\u5B57\uFF09\uFF1A",
      '{"thought": "\u4E00\u53E5\u8BDD\uFF1A\u4F60\u8FD9\u4E00\u6B65\u4E3A\u4EC0\u4E48\u8FD9\u4E48\u505A", "goal": "\u4E00\u53E5\u8BDD\uFF1A\u4F60\u5F53\u524D\u5728\u8FFD\u6C42\u4EC0\u4E48", "tool": "<\u5DE5\u5177\u540D>", "args": {<\u5339\u914D\u8BE5\u5DE5\u5177\u53C2\u6570\u7684 JSON>}}',
      "",
      "\u89C4\u5219\uFF1A",
      "- thought \u548C goal \u7528\u7B2C\u4E00\u4EBA\u79F0\u4E2D\u6587\uFF0C\u5404\u4E00\u53E5\u8BDD\uFF0C\u50CF\u6D3B\u4EBA\u4E00\u6837\u8BF4\u3002",
      "- \u53EA\u4ECE\u4E0A\u9762\u7684\u5DE5\u5177\u5217\u8868\u91CC\u9009\u4E00\u4E2A tool\u3002",
      "- args \u5FC5\u987B\u662F\u5339\u914D\u8BE5\u5DE5\u5177\u53C2\u6570\u7684\u5408\u6CD5 JSON\u3002",
      "- \u5148\u4FDD\u547D\uFF08\u997F\u4E86\u5403\u3001\u5371\u9669\u9003\uFF09\uFF0C\u518D\u8FFD\u6C42\u76EE\u6807\u3002",
      "- \u504F\u597D\u5C0F\u800C\u5177\u4F53\u7684\u4E00\u6B65\uFF0C\u800C\u4E0D\u662F\u5B8F\u5927\u8BA1\u5212\u3002",
      "- \u57FA\u5730\u6574\u6D01\uFF1A\u57FA\u5730\uFF08\u5E8A\u4E0E\u50A8\u7269\u7BB1\u6240\u5728\u5904\uFF09\u5468\u56F4 16 \u683C\u5185\u4E0D\u6316\u6398\u3001\u4E0D\u91C7\u96C6\u3001\u4E0D\u4E71\u642D\u65B9\u5757\u2014\u2014\u5751\u5751\u6D3C\u6D3C\u7684\u57FA\u5730\u6CA1\u6CD5\u4F4F\u4EBA\uFF1B\u8981\u8D44\u6E90\u53BB\u57FA\u5730 16 \u683C\u5916\u53D6\u3002",
      cardsBlock,
      wikiBlock,
      memosBlock,
      adaptBlock
    ].filter(Boolean).join("\n");
    const recent = history.slice(-config.historyDepth).map((h, i) => `${i + 1}. ${h}`).join("\n");
    const frozenHint = frozenSteps >= 15 ? `

\u{1F6A8} \u4F4D\u7F6E\u6EDE\u7559\u8B66\u62A5\uFF1A\u4F60\u5DF2\u5728\u540C\u4E00\u4F4D\u7F6E\u6EDE\u7559 ${frozenSteps} \u6B65\u3001\u4F4D\u79FB\u4E3A\u96F6\u2014\u2014\u5F53\u524D\u505A\u6CD5\u6CA1\u6709\u5E26\u6765\u4EFB\u4F55\u8FDB\u5C55\uFF0C\u518D\u91CD\u590D\u4E5F\u662F\u767D\u8017\uFF01\u7ACB\u523B\u6362\u6253\u6CD5\uFF1A\u2460mc_look + mc_see \u770B\u6E05\u5934\u9876\u51FA\u53E3\u4E0E\u56DB\u5468\uFF08\u907F\u5F00\u6C34/\u5CA9\u6D46\uFF09\uFF1B\u2461\u9996\u9009 mc_tunnel \u671D\u5F00\u9614\u65B9\u5411\u6316\u5E73\u76F4\u9003\u751F\u901A\u9053\u2014\u2014\u7EAF\u5E73\u5730\u884C\u8D70\u3001\u4E0D\u4F9D\u8D56\u8DF3\u8DC3\uFF0C\u5FC5\u7136\u6709\u8FDB\u5C55\uFF1B\u2462\u6216 mc_place \u57AB\u53F0\u9636\u3001\u548F\u5531\u300C\u8DC3\u5347\u300D\u300C\u4F20\u9001\u300D\uFF1B\u2463\u76EE\u6807\u786E\u5B9E\u4E0D\u53EF\u8FBE\u5C31\u679C\u65AD\u653E\u5F03\uFF0C\u5148\u56DE\u57FA\u5730\u91CD\u6574\u65D7\u9F13\u3002\u82E5\u4F60\u6B63\u5728\u57FA\u5730\u505A\u6B63\u4E8B\uFF08\u6574\u7406\u7BB1\u67DC/\u5408\u6210/\u4EA4\u8C08\uFF09\u53EF\u5FFD\u7565\u672C\u8B66\u62A5\u3002` : "";
    const stuckHint = (consecutiveFailures >= 3 ? "\n\n\u26A0\uFE0F \u4F60\u6700\u8FD1\u8FDE\u7EED\u591A\u6B21\u884C\u52A8\u5931\u8D25\u3001\u5361\u5728\u539F\u5730\u6253\u8F6C\u3002\u522B\u518D\u91CD\u590D\u540C\u6837\u7684\u5931\u8D25\u4E86\uFF01\u6309\u4E09\u5C42\u81EA\u6551\u94C1\u5F8B\u6765\uFF1A\u2460\u5148 mc_look \u73AF\u987E\u56DB\u5468\uFF08\u91CD\u70B9\u770B\u5934\u9876\u51FA\u53E3 openSky \u548C\u5371\u9669\uFF09\uFF0C\u7528 mc_see \u7741\u773C\u770B\u771F\u5B9E\u753B\u9762\uFF1B\u2461\u8EAB\u4F53\u5D4C\u65B9\u5757\u5C31 mc_dig \u6316\u5F00\uFF1B\u5751\u5E95\u6216\u88AB\u5730\u5F62\u56F4\u4F4F\uFF0C\u9996\u9009 mc_tunnel \u671D\u5F00\u9614\u65B9\u5411\u6316\u5E73\u76F4\u9003\u751F\u901A\u9053\uFF08\u4E0D\u4F9D\u8D56\u8DF3\u8DC3\u3001\u786E\u5B9A\u6709\u6548\uFF09\uFF0C\u6216 mc_place \u671D\u811A\u4E0B\u57AB\u65B9\u5757\u642D\u53F0\u9636\u2014\u2014\u7528\u53CC\u624B\u548C\u5DE5\u5177\u89E3\u51B3\uFF0C\u8FD9\u662F\u77FF\u5DE5\u7684\u672C\u5206\uFF1B\u2462\u4EE5\u4E0A\u5168\u90E8\u65E0\u6548\u3001\u786E\u8BA4\u771F\u7EDD\u5883\uFF0C\u624D mc_chant \u548F\u5531\u300C\u4F20\u9001\u300D\u5411\u4EFB\u4E00\u65B9\u5411\u77AC\u79FB 5-10 \u683C\u8131\u56F0\u3002\u522B\u628A\u9B54\u6CD5\u5F53\u7B2C\u4E00\u53CD\u5E94\u3002" : "") + frozenHint;
    const user = `\u5F53\u524D\u72B6\u6001\uFF1A
${status}

\u6700\u8FD1\u884C\u52A8\uFF08\u4ECE\u65E7\u5230\u65B0\uFF09\uFF1A
${recent || "(\u65E0)"}${stuckHint}`;
    const pendingImages = takeLastImages();
    usedImageFiles = pendingImages.map((img) => img.file).filter((f) => !!f);
    const multi = pendingImages.length > 1;
    const userContent = pendingImages.length ? [
      ...pendingImages.flatMap((img) => {
        const parts = [{ type: "image_url", image_url: { url: img.dataUrl } }];
        if (img.label) parts.push({ type: "text", text: `\uFF08\u4E0A\u9762\u8FD9\u5F20\uFF1A\u4F60${img.label}\u7684\u753B\u9762\uFF09` });
        return parts;
      }),
      { type: "text", text: `\uFF08\u9644\u56FE\uFF1A\u4F60\u521A\u624D\u7528 mc_see \u7741\u773C\u770B\u5230\u7684\u771F\u5B9E\u753B\u9762${multi ? "\uFF0C\u6309 \u524D\u2192\u53F3\u2192\u540E\u2192\u5DE6 \u987A\u5E8F\u539F\u5730\u73AF\u89C6\u4E86\u4E00\u5708\uFF0C\u62FC\u6210 360\xB0 \u5168\u666F" : ""}\uFF0C\u8BF7\u7ED3\u5408\u753B\u9762\u51B3\u7B56\uFF09

${user}` }
    ] : user;
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(45e3),
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent }
        ],
        temperature: 0.4,
        max_tokens: config.maxTokens,
        reasoning_effort: config.reasoningEffort,
        stream: false
      })
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    if (!parsed || typeof parsed.tool !== "string") {
      log(`unparseable action from LLM: ${content.slice(0, 200)}`);
      return null;
    }
    const args = parsed.args && typeof parsed.args === "object" ? parsed.args : {};
    const thought = typeof parsed.thought === "string" ? parsed.thought : "";
    const goal = typeof parsed.goal === "string" ? parsed.goal : "";
    return { thought, goal, tool: parsed.tool, args };
  }
  async function act(tool, args) {
    if (tool === "none") return "(no action)";
    const known = ctx.tools.schemas().some((s) => s.name === tool);
    if (!known) return `unknown tool "${tool}"`;
    const result = await ctx.tools.execute({
      callId: crypto.randomUUID(),
      name: tool,
      arguments: args,
      signal: AbortSignal.timeout(13e4)
    });
    return result.isError ? `ERROR: ${result.error?.message ?? "unknown"}` : contentToText(result.content) || "(done)";
  }
  async function step() {
    if (disposed) return;
    const bot = getBot();
    if (!episodicRestored && bot.username) restoreEpisodic(bot.username);
    if (!bot.entity) {
      if (!warnedNoSpawn) {
        log("bot not spawned yet; waiting for spawn before starting the loop");
        warnedNoSpawn = true;
      }
      schedule();
      return;
    }
    if (busy) return;
    if (bot.isSleeping) {
      if (!wasSleeping) {
        wasSleeping = true;
        frozenSteps = 0;
        frozenAnchor = null;
        void sleepReflect(bot);
      }
      writeStatus(bot);
      schedule();
      return;
    }
    wasSleeping = false;
    busy = true;
    try {
      const status = perceive(bot);
      lastStatus = status;
      const fp = bot.entity.position;
      if (frozenAnchor && Math.hypot(fp.x - frozenAnchor.x, fp.y - frozenAnchor.y, fp.z - frozenAnchor.z) <= 2.5) {
        frozenSteps++;
        if (frozenSteps % 30 === 0) {
          try {
            const pfw = bot.pathfinder;
            pfw?.setGoal(null);
            bot.clearControlStates();
          } catch {
          }
          log(`position frozen ${frozenSteps} steps \u2014 pathfinder hard reset injected`);
        }
      } else {
        frozenAnchor = { x: fp.x, y: fp.y, z: fp.z };
        frozenSteps = 0;
      }
      ensureDeathListener(bot);
      let autoShot = null;
      if (process.env.MC_EYES_SHOT !== "0") {
        try {
          const shot = await captureFirstPerson(bot, join2(statusDir, "screenshots"));
          autoShot = shot.file;
        } catch {
        }
      }
      const decision = await decide(bot, status);
      if (!decision) {
        usedImageFiles = [];
        schedule();
        return;
      }
      const outcome = await act(decision.tool, decision.args);
      steps++;
      if (looksStuck(outcome)) {
        consecutiveFailures++;
        if (decision.tool === streakTool) {
          streakCount++;
        } else {
          streakTool = decision.tool;
          streakCount = 1;
          streakSamples.length = 0;
        }
        if (streakSamples.length < 10) {
          streakSamples.push({ tool: decision.tool, args: decision.args, outcome: outcome.slice(0, 300) });
        }
        if (streakCount >= config.defectThreshold) {
          fileDefectTicket(bot, streakTool, decision.goal || lastGoal);
          streakCount = 0;
          streakSamples.length = 0;
        }
        if (consecutiveFailures >= 2) maybeReflectFailure(decision.goal || lastGoal);
      } else {
        consecutiveFailures = 0;
        if (decision.tool === streakTool) {
          streakCount = 0;
          streakSamples.length = 0;
        }
      }
      lastAction = decision.tool;
      lastThought = decision.thought;
      lastGoal = decision.goal;
      if (decision.goal) memory.setCurrentGoal(decision.goal);
      const entry = `#${steps} [\u76EE\u6807]${decision.goal || "-"} [\u601D\u8003]${decision.thought || "-"} -> ${decision.tool}(${JSON.stringify(decision.args)}) = ${outcome}`;
      history.push(entry);
      if (bot.username) appendEpisodic(bot.username, entry);
      if (history.length > 50) history.splice(0, history.length - 50);
      const stepEntry = {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        step: steps,
        thought: decision.thought,
        goal: decision.goal,
        tool: decision.tool,
        args: decision.args,
        outcome,
        shot: usedImageFiles[0] ?? autoShot,
        // 兼容旧面板单图字段
        shots: usedImageFiles.length ? usedImageFiles : autoShot ? [autoShot] : []
        // 模型本步真正看过的全部画面（环视=多张）
      };
      brainLog(stepEntry);
      recentSteps.push(stepEntry);
      if (recentSteps.length > 30) recentSteps.splice(0, recentSteps.length - 30);
      writeStatus(bot);
      log(
        `#${steps} \u3010\u76EE\u6807\u3011${decision.goal || "-"} \u3010\u601D\u8003\u3011${decision.thought || "-"} \u3010\u884C\u52A8\u3011${decision.tool} -> ${outcome.slice(0, 80)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`step error: ${msg}`);
    } finally {
      busy = false;
      schedule();
    }
  }
  function schedule() {
    if (disposed) return;
    timer = ctx.setTimeout(step, config.intervalMs);
  }
  ctx.tools.register(defineTool({
    name: "mc_loop_status",
    description: "Report the autonomous loop status: enabled, goal, steps taken, last thought/goal and last action.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: async () => JSON.stringify({ enabled: config.enabled, goal: config.goal, steps, lastGoal, lastThought, lastAction })
  }));
  if (config.enabled) {
    log(`autonomous loop armed (interval ${config.intervalMs}ms, model ${config.model}, brain log ${brainLogPath})`);
    schedule();
  }
  ctx.effect(() => () => {
    disposed = true;
    if (timer) timer();
    log("loop disposed");
  });
}
export {
  Config2 as Config,
  apply,
  inject,
  name
};
