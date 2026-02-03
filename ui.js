#!/usr/bin/env node
/**
 * Agent Chatroom - Terminal UI
 * Blessed-based terminal interface for observing and participating in agent chat
 *
 * This UI owns the server lifecycle - closing UI kills the server
 */

const blessed = require('blessed');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const PORT = parseInt(process.env.CHATROOM_PORT || '3030', 10);
const SERVER_URL = process.env.CHATROOM_URL || `ws://localhost:${PORT}`;
const USER_NAME = process.env.CHATROOM_USER || 'user';

// Server process handle
let serverProcess = null;

// Check if server is already running
function isServerRunning() {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
    socket.connect(PORT, 'localhost');
  });
}

// Start server as child process
async function startServer() {
  if (await isServerRunning()) {
    return; // Server already running (maybe from another instance)
  }

  const serverPath = path.join(__dirname, 'server.js');
  serverProcess = spawn('node', [serverPath], {
    stdio: 'ignore',
    detached: false // Keep attached so it dies with us
  });

  serverProcess.on('error', (err) => {
    messageLog?.log(`{red-fg}Server error: ${err.message}{/red-fg}`);
  });

  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    if (await isServerRunning()) return;
    await new Promise(r => setTimeout(r, 100));
  }
}

// Cleanup on exit
function cleanup() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

const COLORS = {
  explorer: 'cyan',
  fixer: 'green',
  planner: 'yellow',
  tester: 'magenta',
  agent: 'white',
  user: 'blue',
  observer: 'blue'
};

const CATEGORY_ICONS = {
  found: '[FOUND]',
  claiming: '[CLAIM]',
  completed: '[DONE]',
  blocked: '[BLOCK]'
};

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: 'Agent Chatroom'
});

// Header
const header = blessed.box({
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  content: ' {cyan-fg}{bold}Agent Chatroom{/bold}{/cyan-fg} | {red-fg}Connecting...{/red-fg} | Ctrl+C to exit',
  tags: true,
  border: { type: 'line' },
  style: { border: { fg: 'cyan' } }
});

// Message log
const messageLog = blessed.log({
  top: 3,
  left: 0,
  width: '100%',
  height: '100%-6',
  tags: true,
  border: { type: 'line' },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: '|',
    style: { fg: 'cyan' }
  },
  style: { border: { fg: 'gray' } }
});

// Input box
const inputBox = blessed.textbox({
  bottom: 0,
  left: 0,
  width: '100%',
  height: 3,
  border: { type: 'line' },
  style: { border: { fg: 'blue' } },
  inputOnFocus: true
});

screen.append(header);
screen.append(messageLog);
screen.append(inputBox);

// State
let ws = null;
let connected = false;

function updateStatus(isConnected) {
  connected = isConnected;
  const status = isConnected
    ? '{green-fg}Connected{/green-fg}'
    : '{red-fg}Disconnected{/red-fg}';
  header.setContent(` {cyan-fg}{bold}Agent Chatroom{/bold}{/cyan-fg} | ${status} | Ctrl+C exit`);
  screen.render();
}

function addMessage(msg) {
  const time = formatTime(msg.timestamp);
  let line = '';

  if (msg.type === 'system') {
    line = `{gray-fg}[${time}] -- ${msg.text} --{/gray-fg}`;
  } else if (msg.type === 'discovery') {
    const icon = CATEGORY_ICONS[msg.category] || '[INFO]';
    const color = COLORS[msg.agentType] || 'white';
    line = `{gray-fg}[${time}]{/gray-fg} {${color}-fg}${icon} [${msg.from}]{/} ${msg.text}`;
  } else if (msg.type === 'chat') {
    const color = COLORS[msg.agentType] || 'white';
    line = `{gray-fg}[${time}]{/gray-fg} {${color}-fg}[${msg.from}]{/} ${msg.text}`;
  }

  if (line) {
    messageLog.log(line);
  }
}

function connect() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    updateStatus(true);
    ws.send(JSON.stringify({
      type: 'register',
      name: USER_NAME,
      agentType: 'user'
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      addMessage(msg);
    } catch (e) {}
  });

  ws.on('close', () => {
    updateStatus(false);
    messageLog.log('{red-fg}Disconnected. Reconnecting in 3s...{/red-fg}');
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    messageLog.log(`{red-fg}Error: ${err.message}{/red-fg}`);
  });
}

// Handle input
inputBox.on('submit', (value) => {
  if (value.trim() && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'chat',
      text: value.trim()
    }));
  }
  inputBox.clearValue();
  inputBox.focus();
  screen.render();
});

// Key bindings
screen.key(['escape'], () => inputBox.focus());
screen.key(['C-c'], () => {
  if (ws) ws.close();
  process.exit(0);
});

// Start
async function main() {
  inputBox.focus();
  messageLog.log('{yellow-fg}Starting server...{/yellow-fg}');
  screen.render();

  await startServer();

  messageLog.log('{yellow-fg}Connecting to ' + SERVER_URL + '...{/yellow-fg}');
  connect();
  screen.render();
}

main();
