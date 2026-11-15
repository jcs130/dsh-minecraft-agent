# Host-owned Minecraft turns

DSH maps its durable turn boundaries to the shared runtime's SDK. The model-facing MCP uses `turnOwnership: 'host'` and the matching environment text from core rc.143. Its protocol catalogue contains reads and cancellation, without begin/end/barrier operations.

The bridge also rejects those lifecycle operations before transport, including a resumed model's obsolete tool calls. The rejected call yields the current DSH decision once and retains the actual host turn until its normal terminal event. It does not cancel body tasks, complete the goal or restart the Agent. The next decision retains the same goal and uses ordinary game tools.

Standalone SDK/MCP clients retain caller-owned turns. The host option changes lifecycle ownership, without adding server-specific gameplay rules.
