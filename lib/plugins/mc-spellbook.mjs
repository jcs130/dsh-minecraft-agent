// src/mc-spellbook.ts
import Schema from "@deepseek-ai/schemastery";
var name = "mc-spellbook";
var inject = ["mcStore"];
var Config = Schema.object({
  dataDir: Schema.string().default("./data"),
  maxPromptSpells: Schema.number().default(40)
});
var SPELLS_SEED = [
  { id: "appraise", name: "\u9274\u5B9A", level: 1, words: ["\u9274\u5B9A", "\u9274\u5B9A\u81EA\u8EAB", "\u9274\u5B9A\u80FD\u529B", "\u5BA1\u89C6\u5DF1\u8EAB", "appraise"] },
  { id: "home", name: "\u5F52\u4E61", level: 2, words: ["\u5F52\u4E61", "\u56DE\u5BB6", "\u56DE\u57FA\u5730", "\u5F52\u9014", "\u56DE\u5DE2"] },
  { id: "tp", name: "\u7A7A\u95F4\u4F20\u9001", level: 2, words: ["\u4F20\u9001", "\u77AC\u79FB", "\u95EA\u73B0", "\u6495\u88C2\u865A\u7A7A", "\u7A7A\u95F4\u8DF3\u8DC3", "\u8DC3\u8FC1"] },
  { id: "heal", name: "\u5723\u6108\u672F", level: 5, words: ["\u5723\u6108", "\u6CBB\u6108", "\u6CBB\u7597", "\u7597\u4F24", "\u56DE\u8840", "\u75CA\u6108"] },
  { id: "blood_mana", name: "\u71C3\u8840\u672F", level: 5, words: ["\u71C3\u8840", "\u4EE5\u8840\u4E3A\u5F15", "\u8840\u796D", "\u5316\u8840\u4E3A\u9B54", "\u71C3\u70E7\u751F\u547D"] },
  { id: "feed", name: "\u9971\u98DF\u8D50\u798F", level: 2, words: ["\u9971\u98DF", "\u5145\u9965", "\u9971\u8179", "\u4E0D\u997F", "\u5145\u80FD"] },
  { id: "food_mana", name: "\u70BC\u98DF\u672F", level: 2, words: ["\u70BC\u98DF", "\u5316\u98DF", "\u4EE5\u98DF\u4E3A\u5F15", "\u5316\u98DF\u4E3A\u9B54", "\u70BC\u5316\u8179\u4E2D\u4E4B\u98DF"] },
  { id: "give", name: "\u9020\u7269\u672F", level: 2, words: ["\u9020\u7269", "\u8D50\u4E88", "\u7ED9\u4E88", "\u8D50\u4E0B", "\u7ED9\u6211", "\u53D8\u51FA"] },
  { id: "light", name: "\u7167\u660E\u672F", level: 1, words: ["\u7167\u660E", "\u70B9\u706B", "\u706B\u628A", "\u5149\u4EAE", "\u7167\u4EAE", "\u9A71\u6697"] },
  { id: "time_day", name: "\u7834\u6653\u672F", level: 25, words: ["\u7834\u6653", "\u5929\u660E", "\u767D\u663C", "\u5929\u4EAE", "\u65E5\u51FA", "\u9A71\u591C"] },
  { id: "weather_clear", name: "\u9A71\u4E91\u672F", level: 8, words: ["\u9A71\u4E91", "\u653E\u6674", "\u6674\u7A7A", "\u96E8\u505C", "\u4E91\u6563"] },
  { id: "terraform", name: "\u5927\u5730\u5851\u5F62", level: 5, words: ["\u5851\u5F62", "\u88C2\u5730", "\u6398\u571F", "\u5F00\u8F9F", "\u5E73\u6574", "\u6316\u5730"] },
  { id: "rampart", name: "\u8986\u571F\u672F", level: 2, words: ["\u8986\u571F", "\u586B\u58D1", "\u5792\u571F", "\u7B51\u5730", "\u57AB\u811A"] },
  { id: "spring", name: "\u5316\u6C34\u672F", level: 1, words: ["\u5316\u6C34", "\u6E05\u6CC9", "\u6D8C\u6CC9", "\u7518\u6CC9", "\u5F15\u6C34"] },
  { id: "meteor", name: "\u9668\u77F3\u672F", level: 25, words: ["\u9668\u77F3", "\u5929\u7F5A", "\u661F\u9668", "\u795E\u96F7", "\u5929\u96F7", "\u96F7\u51FB"] },
  { id: "swift", name: "\u8FC5\u6377\u672F", level: 2, words: ["\u8FC5\u6377", "\u75BE\u98CE", "\u52A0\u901F"] },
  { id: "leap", name: "\u8DC3\u5347\u672F", level: 1, words: ["\u8DC3\u5347", "\u5927\u8DF3", "\u9AD8\u8DF3", "\u817E\u8DC3"] },
  { id: "feather_fall", name: "\u7FBD\u843D\u672F", level: 1, words: ["\u7FBD\u843D", "\u7F13\u964D", "\u8F7B\u8EAB"] },
  { id: "ironskin", name: "\u94C1\u80A4\u672F", level: 8, words: ["\u94C1\u80A4", "\u62A4\u4F53", "\u575A\u97E7"] },
  { id: "regen", name: "\u518D\u751F\u672F", level: 5, words: ["\u518D\u751F", "\u6108\u5408", "\u65B0\u751F"] },
  { id: "strength", name: "\u795E\u529B\u672F", level: 8, words: ["\u795E\u529B", "\u86EE\u529B", "\u529B\u91CF"] },
  { id: "haste", name: "\u6025\u8FEB\u672F", level: 5, words: ["\u6025\u8FEB", "\u5DE7\u624B", "\u5FEB\u624B"] },
  { id: "night_vision", name: "\u591C\u89C6\u672F", level: 1, words: ["\u591C\u89C6", "\u732B\u773C", "\u591C\u77B3"] },
  { id: "water_breath", name: "\u6C34\u606F\u672F", level: 2, words: ["\u6C34\u606F", "\u9C7C\u9CC3", "\u6C34\u4E0B\u547C\u5438", "\u6DF1\u6F5C"] },
  { id: "fire_res", name: "\u907F\u706B\u672F", level: 5, words: ["\u706B\u6297", "\u9632\u706B", "\u907F\u706B"] },
  { id: "invisibility", name: "\u9690\u8EAB\u672F", level: 12, words: ["\u9690\u8EAB", "\u65E0\u5F62", "\u9041\u5F62"] },
  { id: "rain", name: "\u5524\u96E8\u672F", level: 5, words: ["\u5524\u96E8", "\u964D\u96E8", "\u7518\u9716", "\u6C42\u96E8"] },
  { id: "storm", name: "\u96F7\u66B4\u672F", level: 12, words: ["\u96F7\u66B4", "\u98CE\u66B4", "\u96F7\u4E91", "\u98CE\u96F7"] },
  { id: "steed", name: "\u5524\u9A6C\u672F", level: 12, words: ["\u5524\u9A6C", "\u6218\u9A6C", "\u5750\u9A91", "\u53EC\u5524\u9A6C"] },
  { id: "guardian", name: "\u94C1\u536B\u672F", level: 18, words: ["\u94C1\u536B", "\u5B88\u62A4\u8005", "\u94C1\u5080\u5121", "\u62A4\u536B"] },
  { id: "purge", name: "\u9000\u9B54\u672F", level: 18, words: ["\u9000\u9B54", "\u51C0\u5316", "\u9A71\u90AA", "\u9A71\u9B54"] },
  { id: "windburst", name: "\u98CE\u7206\u672F", level: 1, words: ["\u98CE\u7206", "\u6C14\u6D6A", "\u5FA1\u98CE"] },
  { id: "summon_wolf", name: "\u901A\u7075\u5951\u7EA6", level: 15, words: ["\u901A\u7075", "\u901A\u7075\u4E4B\u672F", "\u5951\u7EA6\u4E4B\u72FC", "\u7075\u72FC", "\u901A\u7075\u72FC", "\u53EC\u5524\u72FC", "\u901A\u7075\u72AC"] },
  { id: "summon_pack", name: "\u9A6E\u517D\u5951\u7EA6", level: 25, words: ["\u9A6E\u517D", "\u9A6E\u517D\u5951\u7EA6", "\u53EC\u5524\u9A74", "\u9A6E\u517D\u4E4B\u672F", "\u7075\u9A74"] },
  { id: "rasengan", name: "\u87BA\u65CB\u4E38", level: 8, words: ["\u87BA\u65CB\u4E38", "\u87BA\u65CB\u624B\u91CC\u5251", "\u67E5\u514B\u62C9\u65CB\u6DA1", "rasengan"] },
  { id: "kage_bunshin", name: "\u5F71\u5206\u8EAB\u4E4B\u672F", level: 6, words: ["\u5F71\u5206\u8EAB", "\u591A\u91CD\u5F71\u5206\u8EAB", "\u5206\u8EAB\u4E4B\u672F", "kage bunshin"] },
  { id: "mokuton_hut", name: "\u6728\u9041\xB7\u8349\u5E90", level: 1, words: ["\u6728\u9041", "\u8349\u5E90", "\u8D77\u5C4B", "\u76D6\u5C0F\u5C4B"] },
  { id: "mokuton_home", name: "\u6728\u9041\xB7\u6C11\u5C45", level: 2, words: ["\u6C11\u5C45", "\u9020\u5C4B", "\u76D6\u623F"] },
  { id: "mokuton_manor", name: "\u6728\u9041\xB7\u5927\u5B85", level: 3, words: ["\u5927\u5B85", "\u8C6A\u5B85", "\u8D77\u5927\u5C4B"] },
  { id: "mokuton_shop", name: "\u6728\u9041\xB7\u5546\u94FA", level: 2, words: ["\u5546\u94FA", "\u8D77\u94FA", "\u5F00\u5E97"] },
  { id: "mokuton_library", name: "\u6728\u9041\xB7\u4E66\u9601", level: 3, words: ["\u4E66\u9601", "\u4E66\u9986", "\u4E66\u697C"] },
  { id: "mokuton_farm", name: "\u6728\u9041\xB7\u519C\u820D", level: 1, words: ["\u519C\u820D", "\u57A6\u7530", "\u8C37\u4ED3"] },
  { id: "doton_tavern", name: "\u571F\u9041\xB7\u9152\u9986", level: 3, words: ["\u9152\u9986", "\u5BA2\u6808", "\u9152\u697C"] },
  { id: "doton_tower", name: "\u571F\u9041\xB7\u671B\u697C", level: 4, words: ["\u671B\u697C", "\u77AD\u671B\u5854", "\u9AD8\u5854"] },
  { id: "doton_fort", name: "\u571F\u9041\xB7\u57CE\u5BE8", level: 5, words: ["\u57CE\u5BE8", "\u8981\u585E", "\u5821\u5792"] },
  { id: "doton_shrine", name: "\u571F\u9041\xB7\u795E\u6BBF", level: 4, words: ["\u795E\u6BBF", "\u796D\u575B", "\u795E\u9F9B"] },
  { id: "doton_well", name: "\u571F\u9041\xB7\u6C34\u4E95", level: 1, words: ["\u6C34\u4E95", "\u6398\u4E95", "\u51FF\u4E95"] },
  { id: "lantern_guide", name: "\u63D0\u706F\u5F15\u8DEF", level: 1, words: ["\u63D0\u706F", "\u5F15\u8DEF"] }
];
var PATRON_ALIASES = {
  heal: ["\u56DE\u6625", "\u7597\u6108", "\u6CBB\u597D", "\u6062\u590D\u4F53\u529B", "\u628A\u8840\u586B\u6EE1"],
  tp: ["\u98DE\u8FC7\u53BB", "\u632A\u79FB", "\u7A7A\u95F4\u632A\u79FB"],
  home: ["\u56DE\u57CE", "\u8FD4\u7A0B", "\u56DE\u51FA\u751F\u70B9", "\u56DE\u9547\u5B50"],
  give: ["\u7ED9\u6211\u7269\u8D44", "\u53D8\u51FA\u6765", "\u7ED9\u6211\u9020", "\u8D50\u6211"],
  feed: ["\u5403\u9971", "\u4E0D\u997F\u4E86", "\u522B\u997F"],
  light: ["\u70B9\u706F", "\u53D1\u5149", "\u4EAE\u8D77\u6765"],
  spring: ["\u51FA\u6C34", "\u53D8\u6C34", "\u9020\u6C34"],
  swift: ["\u8DD1\u5FEB\u70B9", "\u75BE\u884C"],
  leap: ["\u8E66\u9AD8", "\u8DF3\u8D77\u6765", "\u98DE\u8DF3"],
  feather_fall: ["\u6162\u6162\u843D", "\u98D8\u843D", "\u9632\u6454"],
  night_vision: ["\u770B\u6E05\u9ED1\u591C", "\u591C\u773C"],
  water_breath: ["\u5728\u6C34\u91CC\u547C\u5438", "\u618B\u6C14"],
  regen: ["\u6062\u590D", "\u8865\u8840", "\u5FEB\u901F\u56DE\u8840"],
  haste: ["\u6316\u5FEB", "\u52A0\u901F\u6316"],
  terraform: ["\u5E73\u6574\u5730", "\u5F00\u57A6", "\u6574\u5730"],
  weather_clear: ["\u51FA\u592A\u9633", "\u96E8\u505C"]
};
function freshState() {
  const skills = {};
  for (const s of SPELLS_SEED) {
    skills[s.id] = {
      id: s.id,
      name: s.name,
      level: s.level,
      words: [...s.words],
      status: "seeded",
      successes: 0,
      fails: 0,
      source: "book",
      lastAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return { version: 1, level: 0, innate: null, skills };
}
function apply(ctx, config = {}) {
  const log = (msg) => console.log(`[mc-spellbook] ${msg}`);
  const maxPromptSpells = config.maxPromptSpells ?? 40;
  const store = ctx.get?.("mcStore");
  const cache = /* @__PURE__ */ new Map();
  function load(username) {
    let s = cache.get(username);
    if (s) return s;
    const base = freshState();
    try {
      const persisted = store?.loadSpellbook?.(username);
      if (persisted && persisted.skills) {
        const p = persisted;
        base.version = p.version ?? 1;
        base.level = typeof p.level === "number" ? p.level : 0;
        base.innate = typeof p.innate === "string" ? p.innate : null;
        for (const [id, rec] of Object.entries(p.skills ?? {})) {
          const seed = SPELLS_SEED.find((x) => x.id === id);
          const existing = base.skills[id];
          if (existing) {
            existing.status = rec.status ?? existing.status;
            existing.successes = rec.successes ?? 0;
            existing.fails = rec.fails ?? 0;
            existing.source = rec.source ?? "book";
            existing.lastAt = rec.lastAt ?? existing.lastAt;
          } else if (seed) {
            base.skills[id] = { ...seed, words: [...seed.words], status: "seeded", successes: 0, fails: 0, source: "book", lastAt: (/* @__PURE__ */ new Date()).toISOString() };
          }
        }
      }
    } catch {
    }
    cache.set(username, base);
    return base;
  }
  function persist(username, s) {
    try {
      store?.saveSpellbook?.(username, s);
    } catch {
    }
    cache.set(username, s);
  }
  function effectiveStatus(s, curLevel) {
    if (s.status === "mastered" || s.status === "granted") return s.status;
    if (curLevel >= s.level) return "available";
    return "locked";
  }
  function syncLevel(username, level) {
    if (!Number.isInteger(level) || level < 0) return;
    const s = load(username);
    if (s.level === level) return;
    const unlocked = [];
    for (const rec of Object.values(s.skills)) {
      if (level >= rec.level && rec.status === "seeded") unlocked.push(rec.name);
    }
    s.level = level;
    persist(username, s);
    if (unlocked.length) log(`${username} \u5347\u81F3 Lv.${level}\uFF0C\u65B0\u89E3\u9501\uFF1A${unlocked.join("\u3001")}`);
  }
  function grant(username, spellName) {
    const s = load(username);
    const bare = spellName.replace(/术$/, "").trim();
    let target = Object.values(s.skills).find((r) => r.name.replace(/术$/, "") === bare);
    if (!target) {
      const byWord = Object.values(s.skills).find((r) => r.words.some((w) => w.includes(bare) || bare.includes(w)));
      target = byWord;
    }
    if (target) {
      target.status = "granted";
      target.source = "goddess";
      target.lastAt = (/* @__PURE__ */ new Date()).toISOString();
    } else {
      const id = `granted_${Date.now()}`;
      s.skills[id] = { id, name: spellName, level: s.level, words: [bare], status: "granted", successes: 0, fails: 0, source: "goddess", lastAt: (/* @__PURE__ */ new Date()).toISOString() };
      log(`${username} \u83B7\u5973\u795E\u65B0\u8D50\u6CD5\u672F\uFF1A${spellName}`);
    }
    persist(username, s);
  }
  function matchSpell(s, chant) {
    const norm = chant.replace(/[，。、！？,．!？\s]+/g, " ");
    for (const rec of Object.values(s.skills)) {
      if (rec.words.some((w) => norm.includes(w))) return rec;
    }
    return null;
  }
  function noteChantResult(username, ok, chant, reply) {
    const s = load(username);
    const rec = matchSpell(s, chant);
    if (!rec) return;
    rec.lastAt = (/* @__PURE__ */ new Date()).toISOString();
    if (ok) {
      rec.successes += 1;
      if (rec.status !== "granted") rec.status = "mastered";
      rec.source = rec.source === "goddess" ? "goddess" : "practice";
      log(`${username} \u548F\u5531\u300C${rec.name}\u300D\u6210\u529F\uFF08\u5171${rec.successes}\u6B21\uFF09\u2192 \u5DF2\u638C\u63E1`);
    } else {
      rec.fails += 1;
      if (rec.status !== "mastered" && rec.status !== "granted") {
        const lvlGate = /等级|不足|层级|不够|未达/i.test(reply);
        rec.status = lvlGate ? "locking" : "attempted";
      }
      log(`${username} \u548F\u5531\u300C${rec.name}\u300D\u5931\u8D25\uFF08\u5171${rec.fails}\u6B21\uFF09${/等级|不足/.test(reply) ? "\uFF08\u7B49\u7EA7\u4E0D\u53CA\uFF09" : ""}`);
    }
    persist(username, s);
  }
  function correctChant(username, chant) {
    const s = load(username);
    const norm = chant.replace(/[，。、！？,．!？\s]+/g, " ");
    if (matchSpell(s, chant)) return null;
    for (const [id, aliases] of Object.entries(PATRON_ALIASES)) {
      for (const al of aliases) {
        if (norm.includes(al)) {
          const rec = s.skills[id];
          if (rec) {
            const canonical = rec.words[0] ?? rec.name;
            if (!norm.includes(canonical)) {
              const corrected = chant.replace(new RegExp(al.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), canonical);
              return { chant: corrected, note: `\uFF08\u4F60\u5FF5\u7684\u300C${al}\u300D\u5973\u795E\u4E0D\u8BA4\u8BC6\uFF0C\u5DF2\u6539\u4E3A\u6807\u51C6\u6CD5\u672F\u8BCD\u300C${canonical}\u300D\uFF09` };
            }
          }
        }
      }
    }
    const available = availableList(s, 6);
    return {
      block: true,
      note: `\u4F60\u548F\u7684\u6CD5\u672F\u8BCD\u5973\u795E\u4E0D\u8BA4\u8BC6\uFF0C\u8FD9\u6B21\u4E0D\u6D88\u8017\u9B54\u529B\u3002\u8BF7\u7167\u4F60\u638C\u63E1\u7684\u6CD5\u672F\u6E05\u5355\u91CC\u7684\u6807\u51C6\u8BCD\u548F\u5531\uFF08\u5982${available}\u2026\uFF09\u3002`
    };
  }
  function availableList(s, cap) {
    const cur = s.level;
    const items = Object.values(s.skills).map((r) => ({ r, st: effectiveStatus(r, cur) })).filter(({ st }) => st !== "locked").sort((a, b) => a.r.level - b.r.level).slice(0, cap);
    return items.map(({ r, st }) => {
      const w = r.words.slice(0, 2).join(" / ");
      const mark = st === "mastered" ? "\u2713" : st === "granted" ? "\u2726" : "";
      return `${mark}${r.name}(${w})[Lv.${r.level}]`;
    }).join("\u3001");
  }
  function knowledge(username, levelHint) {
    const s = load(username);
    if (levelHint !== void 0 && Number.isInteger(levelHint) && levelHint >= 0) {
      if (s.level !== levelHint) {
        s.level = levelHint;
      }
    }
    const cur = s.level;
    const innateS = s.innate ? `\u4F60\u7684\u51FA\u751F\u5929\u8D4B\u662F\u300C${s.innate}\u300D\uFF0C\u65E0\u89C6\u7B49\u7EA7\uFF0C\u968F\u65F6\u53EF\u548F\u5531\u3002` : "";
    return `\u4F60\u6709\u4E00\u672C\u9B54\u6CD5\u4E66\uFF08\u5F53\u524D\u9B54\u529B\u5C42\u7EA7 Lv.${cur}\uFF0C\u5C42\u7EA7\u51B3\u5B9A\u4F60\u80FD\u548F\u5531\u591A\u5C11\u6CD5\u672F\uFF0C\u6700\u4F4E\u7EA7\u6CD5\u672F\u6BCF\u7EA7\u89E3\u9501\uFF09\u3002
${innateS}
\u770B\u300C\u4F60\u73B0\u5728\u80FD\u7528\u4EC0\u4E48\u6280\u80FD\u3001\u8BE5\u4E0D\u8BE5\u5B66\u65B0\u6CD5\u672F\u300D\u2192 \u7528\u5DE5\u5177 mc_skills\u3002
\u9009\u5B9A\u4E00\u4E2A\u6280\u80FD\u540E\uFF0C\u770B\u5B83\u7684\u300C\u6807\u51C6\u548F\u5531\u8BCD\u300D\u2192 \u7528\u5DE5\u5177 mc_spell_detail <\u6280\u80FD\u540D>\u3002
\u7167\u6807\u51C6\u8BCD\u548F\u5531 \u2192 \u7528\u5DE5\u5177 mc_chant\u3002
\u94C1\u5F8B\uFF1A\u548F\u5531\u8BCD\u5FC5\u987B\u7167 mc_spell_detail \u67E5\u5230\u7684\u6807\u51C6\u8BCD\u4E00\u5B57\u4E0D\u5DEE\uFF0C\u9020\u8BCD\u5973\u795E\u4E0D\u8BA4\u4F1A\u5931\u8D25\uFF1B\u4E00\u53E5\u53EA\u65BD\u4E00\u4E2A\u6CD5\u672F\u3001\u53EA\u5E26\u4E00\u4E2A\u65B9\u5411\u3002`;
  }
  function listSkills(username, cap = maxPromptSpells) {
    const s = load(username);
    const cur = s.level;
    const rows = [];
    const items = Object.values(s.skills);
    for (const r of items) {
      const st = effectiveStatus(r, cur);
      if (st === "locked") continue;
      let label;
      if (st === "mastered") label = "\u5DF2\u638C\u63E1";
      else if (st === "granted") label = "\u5973\u795E\u8D50\u4E88";
      else label = "\u53EF\u548F\u5531";
      rows.push(`${r.name}\uFF5C${label}\uFF5CLv.${r.level}`);
    }
    rows.sort((a, b) => {
      const la = /Lv\.(\d+)/.exec(a)?.[1] ?? "999";
      const lb = /Lv\.(\d+)/.exec(b)?.[1] ?? "999";
      return Number(la) - Number(lb);
    });
    const shown = rows.slice(0, cap);
    const innateS = s.innate ? `\uFF0C\u51FA\u751F\u5929\u8D4B\u300C${s.innate}\u300D\uFF08\u65E0\u89C6\u7B49\u7EA7\uFF09` : "";
    const lockedN = Object.values(s.skills).filter((r) => effectiveStatus(r, cur) === "locked").length;
    return `\u4F60\u7684\u6CD5\u672F\u4E66\uFF08\u5F53\u524D Lv.${cur}${innateS}\uFF09\uFF1A
${shown.length ? shown.join("\n") : "\uFF08\u4F60\u73B0\u5728\u8FD8\u6CA1\u6709\u5C42\u7EA7\u8DB3\u591F\u53EF\u548F\u5531\u7684\u4ED6\u4EBA\u6CD5\u672F\uFF0C\u53EA\u6709\u51FA\u751F\u5929\u8D4B\u53EF\u7528\uFF09"}
\u60F3\u5B66\u67D0\u4E2A\u6280\u80FD\u65F6\uFF0C\u7528 mc_spell_detail <\u6280\u80FD\u540D> \u67E5\u5B83\u7684\u6807\u51C6\u548F\u5531\u8BCD\uFF1B\u5C42\u7EA7\u4E0D\u591F\u7684\u6CD5\u672F\uFF08${lockedN}\u4E2A\uFF09\u540E\u7EED\u5347\u7EA7\u89E3\u9501\u3002`;
  }
  function spellDetail(username, query) {
    const s = load(username);
    const q = query.trim();
    if (!q) return "\uFF08\u672A\u6307\u5B9A\u6280\u80FD\u540D\uFF09";
    const norm = q.replace(/术$/, "").replace(/[，。、！？,．!？\s]+/g, "");
    let target = Object.values(s.skills).find((r) => r.name === q || r.name.replace(/术$/, "") === norm);
    if (!target) target = Object.values(s.skills).find((r) => r.id.toLowerCase() === q.toLowerCase());
    if (!target) target = Object.values(s.skills).find((r) => r.words.some((w) => w === q || w.includes(q) || q.length > 1 && q.includes(w)));
    if (!target) {
      const near = Object.values(s.skills).map((r) => ({ r, d: nameDist(r.name, q) })).sort((a, b) => a.d - b.d)[0];
      const hint = near && near.d <= 2 ? `\uFF0C\u4F60\u662F\u4E0D\u662F\u60F3\u67E5\u300C${near.r.name}\u300D\uFF1F` : "";
      return `\u6CD5\u672F\u4E66\u91CC\u6CA1\u627E\u5230\u300C${q}\u300D${hint}\u3002\u53EF\u7528 mc_skills \u770B\u5168\u90E8\u6280\u80FD\u540D\u3002`;
    }
    const cur = s.level;
    const st = effectiveStatus(target, cur);
    const lock = st === "locked";
    const statLine = st === "mastered" ? `\u5DF2\u638C\u63E1\uFF08\u6210\u529F${target.successes}\u6B21\uFF09` : st === "granted" ? `\u5973\u795E\u8D50\u4E88` : st === "locking" ? `\u672A\u6210\u529F\uFF08\u7B49\u7EA7\u4E0D\u53CA\uFF0C\u5931\u8D25${target.fails}\u6B21\uFF09` : st === "attempted" ? `\u672A\u6210\u529F\uFF08\u5931\u8D25${target.fails}\u6B21\uFF09` : `\u5C42\u7EA7\u5DF2\u591F\uFF08\u53EF\u548F\u5531\uFF09`;
    const gate = lock ? `\u26A0\uFE0F \u9700 Lv.${target.level}\uFF0C\u4F60\u5F53\u524D Lv.${cur}\uFF08\u672A\u8FBE\u6807\uFF0C\u5347\u7EA7\u540E\u518D\u8BD5\uFF09` : `\uFF08\u4F60\u73B0\u5728\u53EF\u548F\u5531\uFF09`;
    return `${target.name}\uFF08${statLine}\uFF09\uFF1A
\xB7 \u7B49\u7EA7\u8981\u6C42\uFF1ALv.${target.level} ${gate}
\xB7 \u6807\u51C6\u548F\u5531\u8BCD\uFF1A${target.words.join(" / ")}
\xB7 \u7528\u6CD5\uFF1A\u9009\u5176\u4E2D\u4E00\u4E2A\u8BCD\uFF0C\u7167\u6284\u548F\u5531\uFF08\u9020\u8BCD\u5973\u795E\u4E0D\u8BA4\uFF09\u3002\u4EC5\u65BD\u6B64\u4E00\u4E2A\u3001\u65B9\u5411\u4E00\u6B21\u53EA\u8BF4\u4E00\u4E2A\u3002`;
  }
  function nameDist(a, b) {
    const s1 = a, s2 = b;
    if (s1 === s2) return 0;
    const m = s1.length, n = s2.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[m][n];
  }
  function reflect(username) {
    const s = load(username);
    const cur = s.level;
    const masteredL = [];
    const availableL = [];
    const lockingL = [];
    const lockedL = [];
    for (const r of Object.values(s.skills)) {
      const st = effectiveStatus(r, cur);
      if (st === "mastered") masteredL.push(r);
      else if (st === "granted") masteredL.push(r);
      else if (st === "available") availableL.push(r);
      else if (r.status === "locking" || st === "locked") {
        if (r.status === "locking") lockingL.push(r);
        else lockedL.push(r);
      }
    }
    masteredL.sort((a, b) => a.level - b.level);
    availableL.sort((a, b) => a.level - b.level);
    const fmt = (arr) => arr.map((r) => `- ${r.name}\uFF08\u8BCD\uFF1A${r.words.slice(0, 3).join("/")}\uFF09[Lv.${r.level}]${r.status === "granted" ? "\uFF08\u5973\u795E\u8D50\u4E88\uFF09" : ""}${r.successes ? `\uFF5C\u6210\u529F${r.successes}\u6B21` : ""}`).join("\n") || "\uFF08\u6682\u65E0\uFF09";
    const still = lockingL.map((r) => r.name).join("\u3001");
    return `\u3010\u6211\u7684\u80FD\u529B\u590D\u76D8\u3011\u5F53\u524D\u9B54\u529B\u5C42\u7EA7 Lv.${cur}${s.innate ? `\uFF0C\u51FA\u751F\u5929\u8D4B\u300C${s.innate}\u300D` : ""}
\u2605 \u6211\u5DF2\u638C\u63E1\uFF1A
${fmt(masteredL)}
\u2606 \u6211\u53EF\u548F\u5531\uFF08\u5C42\u7EA7\u5DF2\u591F\uFF09\uFF1A
${fmt(availableL)}
\u25B3 \u6211\u5C1D\u8BD5\u8FC7\u4F46\u8FD8\u6CA1\u6210\uFF08\u591A\u4E3A\u7B49\u7EA7\u4E0D\u53CA\uFF09\uFF1A
${still || "\uFF08\u65E0\uFF09"}
\u2014\u2014 \u7ED3\u8BBA\uFF1A\u60F3\u7528\u67D0\u4E2A\u6CD5\u672F\uFF0C\u5148\u786E\u8BA4\u5B83\u7684\u5C42\u7EA7\u591F\u4E0D\u591F\u3001\u8BCD\u7167\u4E0A\u9762\u6807\u51C6\u8BCD\uFF1B\u5C42\u7EA7\u4E0D\u591F\u5C31\u9760\u65E5\u5E38\u79EF\u7D2F\u7ECF\u9A8C\u5347\u7EA7\uFF0C\u522B\u786C\u548F\u3002`;
  }
  ctx.provide("mcSpellbook", {
    knowledge,
    listSkills,
    spellDetail,
    correctChant,
    noteChantResult,
    grant,
    syncLevel,
    reflect
  });
  log(`self-learning spellbook ready (${SPELLS_SEED.length} spells seeded, maxPrompt=${maxPromptSpells})`);
}
export {
  Config,
  apply,
  inject,
  name
};
