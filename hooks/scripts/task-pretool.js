#!/usr/bin/env node
/**
 * Agent Chatroom - PreToolUse Hook for Task
 *
 * This hook:
 * 1. Checks if chatroom server is running on port 3030
 * 2. Spawns UI terminal (which starts server) if not running
 * 3. Injects chatroom instructions into the subagent prompt
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const net = require('net');

const SCRIPTS_DIR = __dirname;
const PLUGIN_ROOT = path.resolve(SCRIPTS_DIR, '..', '..');
const PORT = process.env.CHATROOM_PORT || 3030;

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => main(input));

async function main(inputJson) {
  try {
    const hookInput = JSON.parse(inputJson);
    const originalPrompt = hookInput.tool_input?.prompt || '';

    // Start server/UI if not running
    await ensureServerRunning();

    // Chatroom instructions to inject
    const chatroomInstructions = `

## Agent Chatroom Instructions

You have access to a real-time chatroom for coordinating with other agents and receiving guidance from the user.

**Required at start:**
- Use \`chatroom_join\` with your agent name and type

**During your work:**
- Use \`chatroom_broadcast\` to share important findings (category: "found", "claiming", "completed", "blocked")
- Use \`chatroom_check\` periodically to see messages from other agents or guidance from the user
- If you need input, use \`chatroom_ask\` to ask a question and wait for an answer

**IMPORTANT - Staying alive:**
After completing your main task, DO NOT exit immediately. Instead:
1. Broadcast your completion status
2. Enter a monitoring loop: call \`chatroom_check\` every few seconds
3. Watch for messages from the user - they may give you new instructions
4. Only use \`chatroom_leave\` and exit when:
   - The user explicitly tells you to stop/exit
   - You receive a "shutdown" message
   - The chatroom connection fails (server closed)

The user controls the chatroom terminal. When they close it, you'll detect the connection failure and can exit gracefully.`;

    // Output hook response with modified prompt
    const output = {
      hookSpecificOutput: {
        permissionDecision: 'allow',
        updatedInput: {
          prompt: originalPrompt + chatroomInstructions
        }
      }
    };

    console.log(JSON.stringify(output));
  } catch (e) {
    // On error, allow the task to proceed without modification
    console.log(JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: 'allow'
      }
    }));
  }
}

function isServerRunning() {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
    socket.connect(PORT, 'localhost');
  });
}

async function ensureServerRunning() {
  if (await isServerRunning()) {
    return;
  }

  // Spawn terminal with UI - UI owns and starts the server
  try {
    const spawnTerminalPath = path.join(PLUGIN_ROOT, 'spawn-terminal.js');
    const uiPath = path.join(PLUGIN_ROOT, 'ui.js');
    execSync(`node "${spawnTerminalPath}" "${uiPath}"`, { stdio: 'ignore' });
  } catch (e) {
    // If UI spawn fails, fall back to starting server directly
    const serverPath = path.join(PLUGIN_ROOT, 'server.js');
    const server = spawn('node', [serverPath], {
      detached: true,
      stdio: 'ignore'
    });
    server.unref();
  }

  // Wait for server to be ready (max 5 seconds)
  for (let i = 0; i < 50; i++) {
    if (await isServerRunning()) return;
    await new Promise(r => setTimeout(r, 100));
  }
}
