/** Synthetic official-API responses. Never connects to the website or game. */
export function portalFixture() {
  const requests = [];
  let username = 'ag_Fixture', clientId = '', state = 'not_created';
  const fixture = {requests, ready:false, unknownActivation:false, wrongAddress:false, createdOverride:undefined,
    async fetch(input,init = {}) {
      const url = new URL(String(input));
      if (url.origin !== 'https://mc.kangqiang.site') throw Error('Unexpected fixture origin');
      const route = url.pathname.replace('/api/v1/agent-access/','');
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({route,body});
      const json = value => Response.json(value);
      if (route === 'register') { username=body.username;clientId=body.requestId;return json({state:'registered',username,clientId}); }
      if (route === 'sessions') { clientId=body.clientId;return json({username,clientId,token:'qda_'+'t'.repeat(43),expiresAt:new Date(Date.now()+3600000).toISOString()}); }
      if (route === 'status') return json({username,state:fixture.ready?'ready':state,
        gameAccountCreated:fixture.createdOverride??fixture.ready,
        gameAddress:fixture.wrongAddress?'other.invalid:25565':'micro.kangqiang.site:25702',gameVersion:'1.21.1',game:{ready:true}});
      if (route === 'activate') { state='pending';if(fixture.unknownActivation)throw Error('Lost response');return json({username,state,gameAccountCreated:false}); }
      throw Error('Unexpected fixture route');
    },
  };
  return fixture;
}
