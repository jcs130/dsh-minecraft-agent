#!/usr/bin/env node
import {runJoin} from '../lib/plugins/qiandengji-access.mjs';
try { await runJoin(process.argv.slice(2)); }
catch (error) {
  // No raw file/JSON/HTTP error can echo a pasted invitation or credential.
  console.error(JSON.stringify({error:/^[A-Z0-9_]{3,100}$/.test(error.message) ? error.message : 'QIANDENGJI_ACCESS_NOT_COMPLETED',
    message:'接入未完成。保留原身份与请求号，先查询状态；没有连接游戏或重启宿主。'}));
  process.exitCode = 1;
}
