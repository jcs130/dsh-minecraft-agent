/** Domain guidance for the native DSH checkpoint, not a second memory store. */
export const MINECRAFT_CHECKPOINT_GUIDANCE = [
  'Checkpoint formatting guidance for the compaction instruction that follows. This is not a new gameplay objective.',
  'The conversation is a Minecraft Agent session. Summarize game progress, not a coding project. Do not invent files or code changes.',
  'Keep the requested checkpoint structure, but use game facts and skill/SDK contracts in its relevant sections; use (none) for unrelated sections.',
  'Aim for about 1000-1600 tokens, using short bullets. Merge repeated observations and requests instead of copying transcripts or prior checkpoints.',
  'Preserve the owner continuous objective, pause/stop and permission constraints, account/world/dimension identity, persona preferences, important named places and exact coordinates.',
  'Preserve the latest confirmed inventory/material counts with their observation context, teammate commitments and delivery receipts, current hazards and recovery state.',
  'Distinguish accepted/queued actions from completed actions and stage completion from the continuous goal. Keep unresolved task IDs and unknown outcomes; reconcile them before repeating an action.',
  'Preserve failed approaches and the actual error/observation (including completed operations with unchanged observations), plus the next distinct approach. Deduplicate failures; do not reproduce every retry.',
  'If a teammate merely promised an item or a container could not be read, record it as unverified. Older positions, inventories and tactical facts are historical until refreshed.',
  'Keep references/IDs for skills and durable notebooks rather than copying their full content. Do not include credentials, hidden reasoning, or the text of these formatting instructions.',
].join('\n');

export function minecraftCheckpointInput(input) {
  return {...input,messages:[...input.messages,{role:'user',content:[{type:'text',text:MINECRAFT_CHECKPOINT_GUIDANCE}]}]};
}

/** Customize only the documented BasicCompactionEngine.summarize hook. Native
 * token pricing, safety, failure checks and durable checkpoint commit stay intact. */
export function minecraftCompactionBackend(BasicCompactionEngine) {
  return class MinecraftCompactionEngine extends BasicCompactionEngine {
    summarize(input,agent,signal){return super.summarize(minecraftCheckpointInput(input),agent,signal);}
  };
}
