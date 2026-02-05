#!/usr/bin/env node
/**
 * Agent Chatroom - WebSocket Server
 * Handles message routing between agents and observers
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.CHATROOM_PORT || 3030;
const HEARTBEAT_INTERVAL = 5000; // 5 seconds (faster detection)
const CLIENT_TIMEOUT = 15000; // 15 seconds (2 missed heartbeats + buffer)
const PARTICIPANT_UPDATE_INTERVAL = 5000; // 5 seconds

function createServer(port = PORT) {
  const wss = new WebSocketServer({ port });
  const clients = new Map(); // ws -> { name, type, alive, joinedAt, status, task }

  console.log(`Agent Chatroom Server running on ws://localhost:${port}`);

  /**
   * Broadcast participant list to all clients
   */
  function broadcastParticipants() {
    const participants = [];
    for (const [, info] of clients.entries()) {
      participants.push({
        name: info.name,
        type: info.type,
        status: info.type === 'user' ? 'observer' : (info.status || 'idle'),
        task: info.task || null,
        joinedAt: info.joinedAt
      });
    }
    broadcast(wss, clients, {
      type: 'participants_update',
      participants,
      timestamp: Date.now()
    });
  }

  // Heartbeat to detect dead connections
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [ws, info] of clients.entries()) {
      if (!info.alive) {
        // Client didn't respond to last ping - terminate
        console.log(`! ${info.name} (no heartbeat response, terminating)`);
        ws.terminate();
      } else {
        // Mark as not alive, will be set true when pong received
        info.alive = false;
        ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL);

  // Periodic participant list broadcast (for status updates)
  const participantInterval = setInterval(() => {
    if (clients.size > 0) {
      broadcastParticipants();
    }
  }, PARTICIPANT_UPDATE_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(participantInterval);
  });

  wss.on('connection', (ws) => {
    const now = Date.now();
    let clientInfo = { name: 'unknown', type: 'unknown', alive: true, joinedAt: now, status: 'idle', task: null };

    // Handle pong responses (heartbeat)
    ws.on('pong', () => {
      if (clients.has(ws)) {
        clients.get(ws).alive = true;
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle registration
        if (msg.type === 'register') {
          const registerTime = Date.now();
          clientInfo = {
            name: msg.name,
            type: msg.agentType || 'agent',
            alive: true,
            joinedAt: registerTime,
            status: 'idle',
            task: null
          };
          clients.set(ws, clientInfo);

          broadcast(wss, clients, {
            type: 'system',
            text: `${clientInfo.name} joined`,
            timestamp: Date.now()
          });

          // Broadcast updated participant list
          broadcastParticipants();

          console.log(`+ ${clientInfo.name} (${clientInfo.type})`);
          return;
        }

        // Handle status update
        if (msg.type === 'status_update') {
          if (clients.has(ws)) {
            const info = clients.get(ws);
            info.status = msg.status || 'idle';
            info.task = msg.task || null;
            // Broadcast updated participant list
            broadcastParticipants();
            console.log(`~ ${info.name} status: ${info.status}${info.task ? ' - ' + info.task : ''}`);
          }
          return;
        }

        // Handle chat messages
        if (msg.type === 'chat') {
          broadcast(wss, clients, {
            type: 'chat',
            from: msg.from || clientInfo.name,  // Use sender's name if provided
            agentType: clientInfo.type,
            text: msg.text,
            timestamp: Date.now()
          });
        }

        // Handle discovery broadcasts
        if (msg.type === 'discovery') {
          // If category is 'leaving', mark client as leaving (for graceful exit detection)
          if (msg.category === 'leaving' && clients.has(ws)) {
            clients.get(ws).leaving = true;
          }

          broadcast(wss, clients, {
            type: 'discovery',
            from: msg.from || clientInfo.name,  // Use sender's name if provided
            agentType: clientInfo.type,
            category: msg.category,
            text: msg.text,
            timestamp: Date.now()
          });
        }

        // Handle "leaving" notification - mark as intentional departure
        if (msg.type === 'leaving') {
          if (clients.has(ws)) {
            clients.get(ws).leaving = true;
          }
        }

        // Handle "who" query - returns list of connected clients
        if (msg.type === 'who') {
          const online = [];
          for (const [, info] of clients.entries()) {
            online.push({ name: info.name, type: info.type, joinedAt: info.joinedAt });
          }
          ws.send(JSON.stringify({
            type: 'who_response',
            clients: online,
            timestamp: Date.now()
          }));
        }

      } catch (err) {
        console.error('Invalid message:', err.message);
      }
    });

    ws.on('close', (code, reason) => {
      if (clients.has(ws)) {
        const info = clients.get(ws);
        const reasonText = reason?.toString() || '';
        const duration = Math.round((Date.now() - info.joinedAt) / 1000);

        // Determine why they left
        let exitReason = 'disconnected';
        if (code === 1000 || info.leaving) exitReason = 'left normally';
        else if (code === 1001) exitReason = 'going away';
        else if (code === 1006) exitReason = 'connection lost';
        else if (!info.alive) exitReason = 'heartbeat timeout';

        // Remove from clients BEFORE broadcasting
        clients.delete(ws);

        broadcast(wss, clients, {
          type: 'system',
          text: `${info.name} ${exitReason} (was here ${duration}s)`,
          timestamp: Date.now()
        });

        // Broadcast updated participant list
        broadcastParticipants();

        console.log(`- ${info.name} [${exitReason}] (code: ${code}, duration: ${duration}s)`);
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
