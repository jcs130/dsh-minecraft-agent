import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: '192.168.3.225',
  port: 25565,
  username: 'Xiaozhi_Greeter',
  auth: 'offline',
});

const done = (code) => {
  try { bot.quit(); } catch {}
  setTimeout(() => process.exit(code), 300);
};

bot.once('spawn', () => {
  console.log('[greeter] spawned at', bot.entity.position);
  // 公屏喊话，Edward 的 ensureChatListener 会捕获
  bot.chat('Edward，先别急着来回看状态。用 mc_see 睁眼看看你此刻四周真实的画面，判断挡路的是树还是路，然后往前走探索新地形。');
  setTimeout(() => {
    console.log('[greeter] message sent, quitting');
    done(0);
  }, 4000);
});

bot.on('chat', (username, message) => {
  console.log(`[chat] ${username}: ${message}`);
});

bot.on('kicked', (reason) => {
  console.log('[greeter] kicked:', reason);
  done(2);
});

bot.on('error', (e) => {
  console.error('[greeter] error:', e.message);
  done(1);
});

setTimeout(() => { console.log('[greeter] timeout 20s'); done(3); }, 20000);
