/** Loopback Java 1.21.1 protocol world. Synthetic password stays in memory. */
import {createRequire} from 'node:module';
import {once} from 'node:events';
export async function authMeWorld(corePackage,{password,mode='login',onCommand=()=>{}}){
  const core=createRequire(corePackage),mf=createRequire(core.resolve('mineflayer'));
  const mc=mf('minecraft-protocol'),nbt=createRequire(mf.resolve('minecraft-protocol'))('prismarine-nbt');
  const data=core('minecraft-data')('1.21.1'),Chunk=mf('prismarine-chunk')('1.21.1'),{Vec3}=mf('vec3'),Item=mf('prismarine-item')('1.21.1');
  const chunk=new Chunk({minY:-64,worldHeight:384});
  for(let x=0;x<16;x++)for(let z=0;z<16;z++)for(let y=60;y<64;y++)chunk.setBlockStateId(new Vec3(x,y,z),data.blocksByName.stone.minStateId);
  const bytes=chunk.dump(),sky=Array.from({length:26},()=>Array(2048).fill(255)),timers=new Set();
  const summary={joins:0,loginCommands:0,registrationCommands:0,validCredential:false,successSent:false,sessionReceiptSent:false};
  const server=mc.createServer({host:'127.0.0.1',port:0,version:'1.21.1','online-mode':false,motd:'AuthMe compatibility fixture',maxPlayers:1});
  const later=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);};
  server.on('playerJoin',client=>{
    summary.joins++;
    const message=text=>client.write('system_chat',{content:nbt.comp({text:nbt.string(text)}),isActionBar:false});
    client.on('error',()=>{});
    client.on('chat_command',packet=>{
      if(/^register(?:\s|$)/.test(packet.command))summary.registrationCommands++;
      if(!/^login(?:\s|$)/.test(packet.command))return;
      summary.loginCommands++;summary.validCredential=packet.command==='login '+password;onCommand();
      later(()=>{summary.successSent=true;message(summary.validCredential?'Successful login!':'Wrong password!');},300);
    });
    client.write('login',{...data.loginPacket,entityId:client.id,isHardcore:false,enforcesSecureChat:false,viewDistance:2,simulationDistance:2,
      worldState:{...data.loginPacket.worldState,isFlat:true}});
    for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)client.write('map_chunk',{x,z,heightmaps:{type:'compound',name:'',value:{}},chunkData:bytes,blockEntities:[],
      skyLightMask:[67108863n],blockLightMask:[],emptySkyLightMask:[],emptyBlockLightMask:[67108863n],skyLight:sky,blockLight:[]});
    client.write('position',{x:0.5,y:64,z:0.5,yaw:0,pitch:0,flags:{},teleportId:1});
    client.write('update_health',{health:20,food:20,foodSaturation:5});
    client.write('window_items',{windowId:0,stateId:1,items:Array.from({length:46},()=>Item.toNotch(null)),carriedItem:Item.toNotch(null)});
    for(const ms of [100,200])later(()=>{
      if(mode==='session'){summary.sessionReceiptSent=true;message('Logged-in due to Session Reconnection.');}
      else message('Please, login with the command: /login <password>');
    },ms);
  });
  await once(server,'listening');
  return{port:server.socketServer.address().port,summary,async close(){for(const timer of timers)clearTimeout(timer);timers.clear();const closed=once(server,'close');server.close();await closed;}};
}
