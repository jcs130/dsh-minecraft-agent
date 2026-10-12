import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('lib/plugins', { recursive: true });
for (const name of ['mc-harness', 'harness-bridge']) await copyFile(`src/${name}.mjs`, `lib/plugins/${name}.mjs`);
console.log('Built neutral Minecraft host adapter. No body implementation is bundled.');
