import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function renderSetup(state, onAction) {
  let entry, cursor = 0, values = [undefined, '', 0, state, false, undefined];
  const jsx = (type, props) => ({ type, props });
  const react = { useEffect() {}, useState(initial) {
    const index = cursor++;
    if (index >= values.length) values[index] = typeof initial === 'function' ? initial() : initial;
    return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
  } };
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    URL, window: { __ModuleLoader__: { load(value) { entry = value.factory(name => name === 'react' ? react : { jsx, jsxs: jsx }); } } },
  });
  const entries = [];
  entry.apply({ sessions: {}, slots: { inject(_name, fn) { fn(); }, register(options, view) { entries.push({ options, view }); }, registerFactory() {} } });
  const dashboard = entries.find(e => e.options.name === 'main').view({});
  const component = dashboard.props.children.type;
  values = []; cursor = 0;
  const render = () => { cursor = 0; return component({ state, onAction }); };
  return { render };
}
const flatten = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(flatten)
  : [tree, ...flatten(tree.props?.children)];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : String(tree ?? '');
const state = { phase: 'configured', fields: { address: 'example.test:25565', username: 'DemoAgent', goal: '自主生存', hasSession: true, dshPreset: '' }, model: { provider: 'fixture', model: 'fixture' } };

test('shipped configuration offers session reset without changing a preset and sends an owner save, never a connect', async () => {
  const calls = [], ui = renderSetup(state, async (kind, config) => { calls.push({ kind, config }); return { fields: { ...state.fields, hasSession: false } }; });
  const reset = flatten(ui.render()).find(node => node.type === 'button' && text(node) === '重置会话并保存配置');
  assert.ok(reset); assert.equal(reset.props.type, 'button'); assert.equal(reset.props.disabled, false);
  await reset.props.onClick();
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'save'); assert.equal(calls[0].config.newSession, true);
  assert.equal(calls[0].config.goal, '自主生存'); assert.equal(calls[0].config.dshPreset, '');
  assert.match(text(ui.render()), /新会话已准备/);
});

test('standalone new-session checkbox reaches normal save and is cleared after success', async () => {
  const calls = [], ui = renderSetup(state, async (kind, config) => { calls.push({ kind, config }); return { fields: state.fields }; });
  const checkbox = flatten(ui.render()).find(node => node.type === 'label' && /新建会话/.test(text(node)));
  assert.ok(checkbox);
  flatten(checkbox).find(node => node.type === 'input').props.onChange({ target: { type: 'checkbox', checked: true } });
  const save = flatten(ui.render()).find(node => node.type === 'button' && text(node) === '仅保存配置'); await save.props.onClick();
  assert.equal(calls[0].config.newSession, true);
  const updated = flatten(ui.render()).find(node => node.type === 'label' && /新建会话/.test(text(node)));
  assert.equal(flatten(updated).find(node => node.type === 'input').props.checked, false);
});

test('a live body must be stopped before resetting its session', () => {
  const ui = renderSetup({ ...state, phase: 'enabled' }, () => assert.fail('Read-only rendering cannot request a reset'));
  const tree = ui.render();
  assert.equal(flatten(tree).find(node => node.type === 'fieldset').props.disabled, true);
  assert.equal(flatten(tree).find(node => node.type === 'button' && text(node) === '重置会话并保存配置').props.disabled, true);
  assert.ok(flatten(tree).find(node => node.type === 'button' && text(node) === '停止并修改配置'));
});

test('shipped plugin settings check the saved external index without a model or connect request',async()=>{
  const calls=[],ui=renderSetup({...state,model:null,fields:{...state.fields,minedojoIndexFile:'D:/datasets/minedojo/wiki.sqlite'}},async(kind,args)=>{
    calls.push({kind,args});return{status:'ready',index:{pages:22,chunks:570}};
  });
  flatten(ui.render()).find(node=>node.type==='button'&&text(node)==='DSH 插件').props.onClick();
  const tree=ui.render();assert.match(text(tree),/CPU 词元向量是词面相似度/);
  const check=flatten(tree).find(node=>node.type==='button'&&text(node)==='检查已保存的索引');assert.equal(check.props.disabled,false);
  await check.props.onClick();assert.equal(calls.length,1);assert.equal(calls[0].kind,'knowledge');assert.equal(calls[0].args.action,'help');
  assert.match(text(ui.render()),/22 页，570 个片段/);
});
