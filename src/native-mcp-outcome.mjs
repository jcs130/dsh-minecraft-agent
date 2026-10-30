const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function minecraftMcpFailed(value){
  return object(value)&&(value.isError===true||value.failed===true||object(value.structuredContent)&&value.structuredContent.failed===true);
}
const feedback='[Minecraft action FAILED; transport completion is not game success.] Preserve the execution and request receipt: failure alone does not prove that nothing happened. Query the original request for unknown outcomes; never resubmit them automatically. If this receipt reports an unavailable or unlearned ability, do not repeat that cast: read current skills once and select an available action, or change the plan.';

/** A successful native tool envelope may contain an authoritative failed game
 * receipt. Keep that distinction visible without dropping a requested turn
 * conclusion: DSH rc.4's failure result cannot carry concludesTurn. */
export async function nativeMcpOutcomeDecision(exec,result,next,render=()=>result.content??[]){
  if(result.isError||!minecraftMcpFailed(result.value))return next();
  const note={type:'text',text:feedback};
  if(!result.value.structuredContent?.control?.endTurnRequested)
    return{kind:'block',feedback:[note,...render()],
      ...(result.additionalContexts?.length?{additionalContexts:result.additionalContexts}:{})};
  const decision=await next();
  if(decision.kind!=='accept'||Object.hasOwn(decision,'value'))return decision;
  return{...decision,content:[note,...(decision.content??render())]};
}

/** Translate MCP failure semantics at the public Native post-execute boundary. */
export function installNativeMcpOutcome(ctx,{agentId=null,names=null,prefix='mc_'}={}){
  const selected=names?new Set(names):null;
  return ctx.on('tools/post-execute',async(exec,result,next)=>{
    if(agentId!==null&&exec.agent?.id!==agentId
      ||!(selected?selected.has(exec.name):exec.name.startsWith(prefix)))return next();
    // The installed adapter may already project non-concluding MCP errors.
    // Honor its decision and any other host policy instead of overriding it.
    const decision=await next();
    if(decision.kind!=='accept'||Object.hasOwn(decision,'value'))return decision;
    const projected=await nativeMcpOutcomeDecision(exec,result,async()=>decision,
      ()=>decision.content??result.content??[]);
    if(projected.kind==='block'&&decision.additionalContexts?.length)
      projected.additionalContexts=[...(projected.additionalContexts??[]),...decision.additionalContexts];
    return projected;
  });
}

export const name='minecraft-native-mcp-outcome';
export const inject=['tools'];
export function apply(ctx,config={}){ctx.effect(()=>installNativeMcpOutcome(ctx,config));}
