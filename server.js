#!/usr/bin/env node
/**
 * Agent Chatroom - WebSocket Server
 * Handles message routing between agents and observers
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.CHATROOM_PORT || 3030;

function createServer(port = PORT) {
  const wss = new WebSocketServer({ port });
  const clients = new Map(); // ws -> { name, type }

  console.log(`Agent Chatroom Server running on ws://localhost:${port}`);

  wss.on('connection', (ws) => {
    let clientInfo = { name: 'unknown', type: 'unknown' };

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle registration
        if (msg.type === 'register') {
          clientInfo = { name: msg.name, type: msg.agentType || 'agent' };
          clients.set(ws, clientInfo);

          broadcast(wss, clients, {
            type: 'system',
            text: `${clientInfo.name} joined`,
            timestamp: Date.now()
          });

          console.log(`+ ${clientInfo.name} (${clientInfo.type})`);
          return;
        }

        // Handle chat messages
        if (msg.type === 'chat') {
          broadcast(wss, clients, {
            type: 'chat',
            from: clientInfo.name,
            agentType: clientInfo.type,
            text: msg.text,
            timestamp: Date.now()
          });
        }

        // Handle discovery broadcasts
        if (msg.type === 'discovery') {
          broadcast(wss, clients, {
            type: 'discovery',
            from: clientInfo.name,
            agentType: clientInfo.type,
            category: msg.category,
            text: msg.text,
            timestamp: Date.now()
          });
        }

      } catch (err) {
        console.error('Invalid message:', err.message);
      }
    });

    ws.on('close', () => {
      if (clients.has(ws)) {
        const info = clients.get(ws);
        broadcast(wss, clients, {
          type: 'system',
          text: `${info.name} left`,
          timestamp: Date.now()
        });
        console.log(`- ${info.name}`);
        clients.delete(ws);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });
  });

  return wss;
}

function broadcast(wss, clients, message) {
  const payload = JSON.stringify(message);
  for (const client of clients.keys()) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  const server = createServer();

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
  });
}

module.exports = { createServer };
