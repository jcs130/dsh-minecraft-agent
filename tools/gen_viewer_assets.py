#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为 prismarine-viewer 生成 1.21.11 的 blocksStates/<v>.json + textures/<v>.png。

数据源：PrismarineJS/minecraft-assets GitHub repo（预处理过的 blockstate/model/贴图）。
烘焙逻辑严格复刻 prismarine-viewer/viewer/lib/{modelsBuilder,atlas}.js：
  - getModel: parent 链递归合并（x/y/z 轴 + textures + elements + ao）
  - prepareModel: '#' 贴图引用解析 -> 图集 UV（含缺省 UV 按 from/to 推导、bu/bv 中心点）
  - atlas: 16px tile 网格，nextPowerOfTwo(ceil(sqrt(N)))，missing_texture 占位第一格
用法：python gen_viewer_assets.py [版本号，默认 1.21.11]
产物写入 node_modules/prismarine-viewer/public/{blocksStates,textures}/<版本>.{json,png}
"""
import base64
import io as _io
import json
import math
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

VERSION = sys.argv[1] if len(sys.argv) > 1 else '1.21.11'
RAW = f'https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/{VERSION}/'
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'assets_cache', VERSION)
PUBLIC = os.path.normpath(os.path.join(HERE, '..', 'node_modules', 'prismarine-viewer', 'public'))
BLOCKS_DIR = os.path.join(CACHE, 'blocks')

# missing_texture.png 从已装的 prismarine-viewer 里拿
MISSING_TEX = os.path.normpath(os.path.join(PUBLIC, '..', 'viewer', 'lib', 'missing_texture.png'))


def next_power_of_two(n: int) -> int:
    if n == 0:
        return 1
    n -= 1
    n |= n >> 1
    n |= n >> 2
    n |= n >> 4
    n |= n >> 8
    n |= n >> 16
    return n + 1


def cleanup_block_name(name: str) -> str:
    # js: name.startsWith('block')||startsWith('minecraft:block') -> split('/')[1]
    if name.startswith('block') or name.startswith('minecraft:block'):
        parts = name.split('/')
        return parts[1] if len(parts) > 1 else name
    return name


def fetch(url: str, retries: int = 3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'asset-baker/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            if i == retries - 1:
                raise
            print(f'  retry {url}: {e}')
            time.sleep(2 * (i + 1))


def download_inputs():
    os.makedirs(BLOCKS_DIR, exist_ok=True)
    for fn in ['blocks_states.json', 'blocks_models.json']:
        dst = os.path.join(CACHE, fn)
        if not os.path.exists(dst):
            print(f'下载 {fn} ...')
            data = fetch(RAW + fn)
            open(dst, 'wb').write(data)
        else:
            print(f'缓存命中 {fn}')

    # 用 git tree API 拿完整清单（contents API 每页 1000 会截断）
    api = (f'https://api.github.com/repos/PrismarineJS/minecraft-assets/git/trees/master'
           f'?recursive=1')
    tree = json.loads(fetch(api)).get('tree', [])
    prefix = f'data/{VERSION}/blocks/'
    pngs = [os.path.basename(x['path']) for x in tree
            if x['path'].startswith(prefix) and x['path'].endswith('.png')]
    print(f'贴图清单 {len(pngs)} 张')

    todo = [n for n in pngs if not os.path.exists(os.path.join(BLOCKS_DIR, n))]
    print(f'待下载 {len(todo)} 张 ...')

    def dl(name):
        data = fetch(RAW + 'blocks/' + name.replace('#', '%23'))
        open(os.path.join(BLOCKS_DIR, name), 'wb').write(data)

    if todo:
        with ThreadPoolExecutor(max_workers=12) as ex:
            list(ex.map(dl, todo))
    print('贴图下载完成')


class Atlas:
    def __init__(self):
        from PIL import Image
        self.Image = Image
        self.files = ['missing_texture.png'] + sorted(
            f for f in os.listdir(BLOCKS_DIR) if f.endswith('.png'))
        count = len(self.files)
        self.tile = 16
        self.dim = next_power_of_two(int(math.ceil(math.sqrt(count))))
        self.size = self.dim * self.tile
        self.canvas = Image.new('RGBA', (self.size, self.size), (0, 0, 0, 0))
        self.index = {}
        missing = Image.open(MISSING_TEX).convert('RGBA')
        self._place(0, missing)
        for i, fname in enumerate(self.files[1:], start=1):
            img = Image.open(os.path.join(BLOCKS_DIR, fname)).convert('RGBA')
            # js drawImage(img,0,0,16,16,x,y,16,16)：取源左上 16x16 缩放到 16x16
            if img.width != 16 or img.height != 16:
                img = img.crop((0, 0, 16, 16)).resize((16, 16), Image.NEAREST)
            self._place(i, img)
        assert len(self.index) == count, '贴图名冲突'

    def _place(self, i, img):
        x = (i % self.dim) * self.tile
        y = (i // self.dim) * self.tile
        self.canvas.paste(img, (x, y))
        name = self.files[i].split('.')[0]
        u = x / self.size
        v = y / self.size
        su = self.tile / self.size
        self.index[name] = {'u': u, 'v': v, 'su': su, 'sv': su}

    def uv(self, tex_name: str):
        return self.index.get(cleanup_block_name(tex_name))

    def save(self, path):
        self.canvas.save(path, 'PNG')
        print(f'图集 {self.size}x{self.size}（{self.dim}x{self.dim} tiles，{len(self.files)} 贴图） -> {path}')


EMPTY_MODEL = {'textures': {}, 'elements': [], 'ao': True}


def get_model(name: str, models: dict):
    """复刻 modelsBuilder.getModel：parent 链递归合并。返回 None 表示模型缺失。"""
    name = cleanup_block_name(name)
    data = models.get(name)
    if data is None:
        return None
    model = {'textures': {}, 'elements': [], 'ao': True}
    for axis in ('x', 'y', 'z'):
        if axis in data:
            model[axis] = data[axis]
    if data.get('parent'):
        parent = get_model(data['parent'], models)
        if parent is None:
            return None
        for axis in ('x', 'y', 'z'):
            if axis in parent:
                model[axis] = parent[axis]
        model['textures'].update(parent['textures'])
        model['elements'] = parent['elements']
        model['ao'] = parent['ao']
    if data.get('textures'):
        model['textures'].update(data['textures'])
    if data.get('elements'):
        model['elements'] = data['elements']
    if data.get('ambient_occlusion') is not None:
        model['ao'] = data['ambient_occlusion']
    return model


DEFAULT_UV = {
    'north': lambda f, t: [t[0], 16 - t[1], f[0], 16 - f[1]],
    'east': lambda f, t: [f[2], 16 - t[1], t[2], 16 - f[1]],
    'south': lambda f, t: [f[0], 16 - t[1], t[0], 16 - f[1]],
    'west': lambda f, t: [f[2], 16 - t[1], t[2], 16 - f[1]],
    'up': lambda f, t: [f[0], f[2], t[0], t[2]],
    'down': lambda f, t: [t[0], f[2], f[0], t[2]],
}


def prepare_model(model: dict, atlas: Atlas):
    """复刻 modelsBuilder.prepareModel：贴图引用 -> 图集 UV。"""
    # 解析 '#' 链
    for tex in model['textures']:
        root = model['textures'][tex]
        depth = 0
        while isinstance(root, str) and root.startswith('#') and depth < 8:
            key = root[1:]
            root = model['textures'].get(key)
            depth += 1
        model['textures'][tex] = root

    resolved = {}
    for tex, name in model['textures'].items():
        uv = atlas.uv(name) if isinstance(name, str) else None
        resolved[tex] = uv  # None = 贴图缺失（渲染 fallback）

    for elem in model['elements']:
        for side, face in (elem.get('faces') or {}).items():
            ft = face.get('texture')
            if isinstance(ft, str) and ft.startswith('#'):
                face['texture'] = resolved.get(ft[1:])
            elif isinstance(ft, str):
                uv = atlas.uv(ft)
                if uv is None and ft in resolved:
                    face['texture'] = resolved[ft]
                else:
                    face['texture'] = uv
            else:
                face['texture'] = ft

            tex_uv = face.get('texture')
            if not tex_uv:
                continue
            tex_uv = dict(tex_uv)  # 别污染图集共享对象
            uv = face.get('uv')
            if not uv:
                f, t = elem.get('from', [0, 0, 0]), elem.get('to', [16, 16, 16])
                uv = DEFAULT_UV[side](f, t)
            su = (uv[2] - uv[0]) * tex_uv['su'] / 16
            sv = (uv[3] - uv[1]) * tex_uv['sv'] / 16
            tex_uv['bu'] = tex_uv['u'] + 0.5 * tex_uv['su']
            tex_uv['bv'] = tex_uv['v'] + 0.5 * tex_uv['sv']
            tex_uv['u'] = tex_uv['u'] + uv[0] * tex_uv['su'] / 16
            tex_uv['v'] = tex_uv['v'] + uv[1] * tex_uv['sv'] / 16
            tex_uv['su'] = su
            tex_uv['sv'] = sv
            face['texture'] = tex_uv
    model['textures'] = resolved


def bake_apply(ref: dict, models: dict, atlas: Atlas):
    """variant / multipart-apply 的单条 {model, x?, y?} -> {model: 烘焙模型, x?, y?}"""
    out = {}
    m = get_model(ref.get('model', ''), models)
    if m is None:
        m = json.loads(json.dumps(EMPTY_MODEL))
    else:
        m = json.loads(json.dumps(m))  # 深拷贝
    prepare_model(m, atlas)
    out['model'] = m
    for k in ('x', 'y'):
        if k in ref:
            out[k] = ref[k]
    return out


def main():
    t0 = time.time()
    download_inputs()
    states = json.load(open(os.path.join(CACHE, 'blocks_states.json'), encoding='utf-8'))
    models = json.load(open(os.path.join(CACHE, 'blocks_models.json'), encoding='utf-8'))
    print(f'states {len(states)} 方块 / models {len(models)} 模型')

    atlas = Atlas()
    out = {}
    missing_models, missing_tex = [], set()
    for bname, spec in states.items():
        entry = {}
        if 'variants' in spec:
            vs = {}
            for key, val in spec['variants'].items():
                refs = val if isinstance(val, list) else [val]
                baked = [bake_apply(r, models, atlas) for r in refs]
                # 与 1.21.4 产物一致：源是单对象则保持对象，列表则保持列表
                vs[key] = baked[0] if not isinstance(val, list) else baked
            entry['variants'] = vs
        if 'multipart' in spec:
            mp = []
            for part in spec['multipart']:
                ap = part.get('apply')
                refs = ap if isinstance(ap, list) else [ap]
                baked = [bake_apply(r, models, atlas) for r in refs]
                np_ = dict(part)
                np_['apply'] = baked[0] if not isinstance(ap, list) else baked
                mp.append(np_)
            entry['multipart'] = mp
        out[bname] = entry

    # 统计缺模型
    for bname, spec in out.items():
        def check(m):
            if m['model']['elements'] == [] and m['model']['textures'] == {}:
                missing_models.append(bname)
        for val in spec.get('variants', {}).values():
            for m in (val if isinstance(val, list) else [val]):
                check(m)

    dst_json = os.path.join(PUBLIC, 'blocksStates', f'{VERSION}.json')
    dst_png = os.path.join(PUBLIC, 'textures', f'{VERSION}.png')
    json.dump(out, open(dst_json, 'w', encoding='utf-8'), separators=(',', ':'))
    atlas.save(dst_png)
    mb = os.path.getsize(dst_json) / 1e6
    print(f'完成：{dst_json}（{mb:.1f} MB，{len(out)} 方块）')
    if missing_models:
        uniq = sorted(set(missing_models))
        print(f'⚠️ {len(uniq)} 个方块模型缺失（渲成空/问号）：{uniq[:15]}{"..." if len(uniq) > 15 else ""}')
    print(f'耗时 {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
