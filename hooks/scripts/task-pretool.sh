#!/bin/bash
# Agent Chatroom - PreToolUse Hook for Task
#
# This hook:
# 1. Checks if chatroom server is running on port 3030
# 2. Starts server + UI if not running
# 3. Injects chatroom instructions into the subagent prompt

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-/Users/balanuser/.claude/plugins/my-marketplace/plugins/agent-chatroom}"
PORT="${CHATROOM_PORT:-3030}"

# Read hook input from stdin
INPUT=$(cat)

# Extract original prompt using Node.js (guaranteed available)
ORIGINAL_PROMPT=$(node -e "console.log(JSON.parse(process.argv[1]).tool_input?.prompt || '')" "$INPUT" 2>/dev/null || echo "")

# Check if server is running on port
is_server_running() {
  nc -z localhost "$PORT" 2>/dev/null
  return $?
}

# Start the server and UI
start_server() {
  # Start WebSocket server in background
  nohup node "$PLUGIN_ROOT/server.js" > /dev/null 2>&1 &

  # Spawn terminal with UI
  node "$PLUGIN_ROOT/spawn-terminal.js" "$PLUGIN_ROOT/ui.js" 2>/dev/null || true

  # Wait for server to be ready (max 5 seconds)
  for i in {1..50}; do
    if is_server_running; then
      return 0
    fi
    sleep 0.1
  done

  return 1
}

# Start server if not running
if ! is_server_running; then
  start_server
fi

# Chatroom instructions to inject
read -r -d '' CHATROOM_INSTRUCTIONS << 'INSTRUCTIONS' || true

## Agent Chatroom Instructions

You have access to a real-time chatroom for coordinating with other agents and receiving guidance from the user.

**Required:** Join the chatroom at the start of your task:
- Use `chatroom_join` with your agent name and type

**During your work:**
- Use `chatroom_broadcast` to share important findings (category: "found", "claiming", "completed", "blocked")
- Use `chatroom_check` periodically (every few major steps) to see messages from other agents or guidance from the user
- If you need input, use `chatroom_ask` to ask a question and wait for an answer

**Before finishing:**
- Broadcast your final findings/status with `chatroom_broadcast`
- Use `chatroom_leave` when done

The user can see all agent messages and may send guidance. Check the chatroom between major steps to stay coordinated.
INSTRUCTIONS

# Combine original prompt with chatroom instructions (add newlines for separation)
MODIFIED_PROMPT="${ORIGINAL_PROMPT}

${CHATROOM_INSTRUCTIONS}"

# Output hook response with modified prompt using Node.js for proper JSON escaping
node -e "
const prompt = process.argv[1];
const output = {
  hookSpecificOutput: {
    permissionDecision: 'allow',
    updatedInput: {
      prompt: prompt
    }
  }
};
console.log(JSON.stringify(output));
" "$MODIFIED_PROMPT"
