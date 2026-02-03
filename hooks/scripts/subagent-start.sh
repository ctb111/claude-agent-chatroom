#!/bin/bash
# Agent Chatroom - SubagentStart Hook
# Starts the chatroom server and UI when first subagent spawns

PLUGIN_ROOT="/Users/balanuser/.claude/plugins/my-marketplace/plugins/agent-chatroom"
PORT="${CHATROOM_PORT:-3030}"

# Check if server is running
if ! nc -z localhost "$PORT" 2>/dev/null; then
  # Start WebSocket server in background
  nohup node "$PLUGIN_ROOT/server.js" > /tmp/chatroom-server.log 2>&1 &

  # Spawn terminal with UI
  node "$PLUGIN_ROOT/spawn-terminal.js" "$PLUGIN_ROOT/ui.js" 2>/dev/null &

  # Wait for server to be ready (max 3 seconds)
  for i in {1..30}; do
    if nc -z localhost "$PORT" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
fi

# SubagentStart hooks don't need to return anything special
echo '{"decision": "allow"}'
