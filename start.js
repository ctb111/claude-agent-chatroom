#!/usr/bin/env node
/**
 * Agent Chatroom - Orchestrator
 * Starts server, opens UI, and optionally the MCP server
 */

const { createServer } = require('./server');
const { openChatroomUI } = require('./spawn-terminal');
const net = require('net');
const path = require('path');

const DEFAULT_PORT = 3030;

/**
 * Check if a port is in use
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * Start the chatroom (server + UI)
 */
async function start(options = {}) {
  const port = options.port || DEFAULT_PORT;
  const openUI = options.openUI !== false;
  const chatroomPath = options.path || __dirname;

  console.log('Starting Agent Chatroom...');

  // Check if server already running
  const portInUse = await isPortInUse(port);

  if (portInUse) {
    console.log(`Server already running on port ${port}`);
  } else {
    // Start server
    createServer(port);
    console.log(`Server started on port ${port}`);
  }

  // Open UI in new terminal
  if (openUI) {
    // Small delay to ensure server is ready
    await new Promise(r => setTimeout(r, 500));
    await openChatroomUI(chatroomPath);
  }

  console.log('\nChatroom ready!');
  console.log(`  Server: ws://localhost:${port}`);
  console.log('  Press Ctrl+C to stop server\n');

  return { port };
}

/**
 * Stop the chatroom
 */
function stop() {
  console.log('Stopping chatroom...');
  process.exit(0);
}

// Handle shutdown
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Run if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const noUI = args.includes('--no-ui');

  start({ openUI: !noUI }).catch(console.error);
}

module.exports = { start, stop, isPortInUse };
