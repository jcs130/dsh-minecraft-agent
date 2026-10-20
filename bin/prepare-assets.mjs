#!/usr/bin/env node
/** Explicit optional original-audio setup. Never starts a game, Agent or model. */
import {resolve} from 'node:path';
import {MINECRAFT_CLIENT_DEFAULTS,prepareMinecraftViewerAssets} from 'agent-mc-world/client';
if(process.argv.length!==3||process.argv[2].startsWith('--')){
  console.log('Usage: dsh-minecraft-assets <private-cache-directory>\nDownloads and verifies optional original Minecraft audio from Mojang. Set minecraft.viewerAssetsDir to the returned directory.');
}else{
  const controller=new AbortController();
  const abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    const result=await prepareMinecraftViewerAssets({templateDir:MINECRAFT_CLIENT_DEFAULTS.viewerAssetsDir,
      cacheDir:resolve(process.argv[2]),signal:controller.signal});
    console.log(JSON.stringify({viewerAssetsDir:result.directory,downloaded:result.downloaded,total:result.total}));
  }catch{console.error('Optional viewer audio setup did not finish. Verified cached objects remain reusable; retry explicitly.');process.exitCode=1;}
  finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
}
