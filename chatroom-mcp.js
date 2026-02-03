#!/usr/bin/env node
/**
 * Agent Chatroom - MCP Server
 * Provides chatroom tools to Claude Code agents via Model Context Protocol
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const WebSocket = require('ws');
const crypto = require('crypto');

const SERVER_URL = process.env.CHATROOM_URL || 'ws://localhost:3030';

// Chatroom client state
let ws = null;
let agentName = null;
let agentType = null;
let connected = false;
let messages = [];
let lastConnectedClients = []; // Cache of who's online
const pendingQuestions = new Map();
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Connect to chatroom
 */
async function connect(name, type, isReconnect = false) {
  // Always update the current agent's identity
  agentName = name || agentName;
  agentType = type || agentType || 'agent';

  if (connected && ws && ws.readyState === 1) {
    // Re-register with new name
    ws.send(JSON.stringify({
      type: 'register',
      name: agentName,
      agentType: agentType
    }));
    return { success: true, message: `Joined as ${agentName}` };
  }

  // Close any existing dead connection
  if (ws) {
    try { ws.terminate(); } catch (e) {}
    ws = null;
    connected = false;
  }

  return new Promise((resolve) => {
    ws = new WebSocket(SERVER_URL);

    const timeout = setTimeout(() => {
      connected = false;
      resolve({ success: false, error: 'Connection timeout' });
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      connected = true;
      ws.send(JSON.stringify({
        type: 'register',
        name: agentName,
        agentType: agentType
      }));
      const msg = isReconnect ? `Reconnected as ${agentName}` : `Connected as ${agentName}`;
      resolve({ success: true, message: msg });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle "who" response
        if (msg.type === 'who_response') {
          lastConnectedClients = msg.clients || [];
          return;
        }

        messages.push(msg);
        if (messages.length > 100) messages.shift();

        // Check for answers
        if (msg.type === 'chat' && msg.text && msg.from !== agentName) {
          const match = msg.text.match(/\[A:([a-f0-9]+)\]\s*(.*)/);
          if (match) {
            const [, qId, answer] = match;
            const pending = pendingQuestions.get(qId);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingQuestions.delete(qId);
              pending.resolve(answer);
            }
          }
        }
      } catch (e) {}
    });

    ws.on('close', (code) => {
      connected = false;
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      connected = false;
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Try to reconnect if disconnected
 */
async function ensureConnected() {
  if (connected && ws && ws.readyState === 1) {
    return { success: true, wasReconnect: false };
  }

  if (!agentName) {
    return { success: false, error: 'Not initialized - call chatroom_join first' };
  }

  // Try to reconnect
  for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    const result = await connect(agentName, agentType, true);
    if (result.success) {
      return { success: true, wasReconnect: true, attempt };
    }
    // Wait a bit before retry
    await new Promise(r => setTimeout(r, 500 * attempt));
  }

  return { success: false, error: 'Failed to reconnect after ' + MAX_RECONNECT_ATTEMPTS + ' attempts' };
}

/**
 * Disconnect from chatroom
 */
function disconnect() {
  if (ws && ws.readyState === 1) {
    const socket = ws;
    ws = null;
    connected = false;

    // Send leaving message synchronously - this is the key!
    try {
      socket.send(JSON.stringify({ type: 'leaving' }), (err) => {
        // After send completes, close the socket
        if (!err) {
          socket.close(1000, 'leaving');
        }
      });
    } catch (e) {
      try { socket.terminate(); } catch (e2) {}
    }

    return { success: true, message: 'Disconnected' };
  }

  if (ws) {
    try { ws.terminate(); } catch (e) {}
    ws = null;
  }
  connected = false;
  return { success: true, message: 'Already disconnected' };
}

/**
 * Broadcast a message
 */
function broadcast(message, category, senderName) {
  if (!connected) return { success: false, error: 'Not connected' };

  // Use provided sender name, or fall back to agentName
  const from = senderName || agentName;

  const msg = category
    ? { type: 'discovery', category, text: message, from }
    : { type: 'chat', text: message, from };

  ws.send(JSON.stringify(msg));
  return { success: true, message: 'Message sent' };
}

/**
 * Ask a question and wait
 */
async function ask(question, timeoutMs = 30000) {
  if (!connected) return { success: false, error: 'Not connected' };

  const qId = crypto.randomBytes(4).toString('hex');
  const taggedQ = `[Q:${qId}] ${question}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingQuestions.delete(qId);
      resolve({ success: false, error: 'No response (timeout)' });
    }, timeoutMs);

    pendingQuestions.set(qId, {
      resolve: (answer) => resolve({ success: true, answer }),
      timeout
    });

    ws.send(JSON.stringify({ type: 'chat', text: taggedQ }));
  });
}

/**
 * Check messages (with auto-reconnect)
 */
async function check(count = 10, since = 0) {
  // Try to ensure we're connected
  const connResult = await ensureConnected();

  const filtered = since > 0
    ? messages.filter(m => m.timestamp > since)
    : messages.slice(-count);

  return {
    success: true,
    connected,
    reconnected: connResult.wasReconnect || false,
    messages: filtered.map(m => ({
      from: m.from || 'system',
      type: m.type,
      text: m.text,
      category: m.category,
      timestamp: m.timestamp
    }))
  };
}

/**
 * Get list of connected clients
 */
async function who() {
  const connResult = await ensureConnected();
  if (!connected) {
    return { success: false, error: 'Not connected', clients: [] };
  }

  // Request who's online
  ws.send(JSON.stringify({ type: 'who' }));

  // Wait a bit for response
  await new Promise(r => setTimeout(r, 100));

  return {
    success: true,
    clients: lastConnectedClients,
    myName: agentName
  };
}

// Create MCP server
const server = new Server(
  { name: 'agent-chatroom', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'chatroom_join',
      description: 'Join the agent chatroom to communicate with other agents and the user',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Your agent name' },
          type: { type: 'string', description: 'Agent type (explorer, fixer, planner, etc.)' }
        },
        required: ['name']
      }
    },
    {
      name: 'chatroom_leave',
      description: 'Leave the chatroom',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'chatroom_broadcast',
      description: 'Send a message or finding to the chatroom (non-blocking)',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send' },
          name: { type: 'string', description: 'Your agent name (from chatroom_join)' },
          category: {
            type: 'string',
            enum: ['found', 'claiming', 'completed', 'blocked', 'leaving'],
            description: 'Optional category for discoveries (use "leaving" before disconnecting)'
          }
        },
        required: ['message']
      }
    },
    {
      name: 'chatroom_ask',
      description: 'Ask a question and wait for an answer from another agent or user',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question to ask' },
          timeout: { type: 'number', description: 'Timeout in ms (default 30000)' }
        },
        required: ['question']
      }
    },
    {
      name: 'chatroom_check',
      description: 'Check recent messages in the chatroom (non-blocking). Call this periodically to see guidance from user or findings from other agents. Auto-reconnects if connection was lost.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of messages to return (default 10)' },
          since: { type: 'number', description: 'Only messages after this timestamp' }
        }
      }
    },
    {
      name: 'chatroom_who',
      description: 'Get list of currently connected clients in the chatroom',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'chatroom_join':
      return { content: [{ type: 'text', text: JSON.stringify(await connect(args.name, args.type)) }] };

    case 'chatroom_leave':
      return { content: [{ type: 'text', text: JSON.stringify(await disconnect()) }] };

    case 'chatroom_broadcast':
      return { content: [{ type: 'text', text: JSON.stringify(broadcast(args.message, args.category, args.name)) }] };

    case 'chatroom_ask':
      return { content: [{ type: 'text', text: JSON.stringify(await ask(args.question, args.timeout)) }] };

    case 'chatroom_check':
      return { content: [{ type: 'text', text: JSON.stringify(await check(args.count, args.since)) }] };

    case 'chatroom_who':
      return { content: [{ type: 'text', text: JSON.stringify(await who()) }] };

    default:
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown tool' }) }] };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Chatroom MCP server running');
}

main().catch(console.error);
