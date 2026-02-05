#!/usr/bin/env node
/**
 * Agent Chatroom - MCP Server
 * Provides chatroom tools to Claude Code agents via Model Context Protocol
 *
 * ARCHITECTURE: Multiple agents share this MCP process, so we use a Map
 * to track separate websocket connections per agent name.
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
const MAX_RECONNECT_ATTEMPTS = 3;

// Shared message buffer - all agents see the same messages
let messages = [];

// Per-agent connection state: name -> { ws, type, connected, registered, pendingQuestions }
const connections = new Map();

/**
 * Get or create connection state for an agent
 */
function getConnection(name) {
  if (!connections.has(name)) {
    connections.set(name, {
      ws: null,
      type: 'agent',
      connected: false,
      registered: false,
      pendingQuestions: new Map()
    });
  }
  return connections.get(name);
}

/**
 * Connect to chatroom for a specific agent
 */
async function connect(name, type, isReconnect = false) {
  if (!name) {
    return { success: false, error: 'Name is required' };
  }

  const conn = getConnection(name);
  if (type) conn.type = type;

  // Already connected with this name
  if (conn.connected && conn.ws && conn.ws.readyState === 1) {
    if (!conn.registered) {
      conn.ws.send(JSON.stringify({
        type: 'register',
        name: name,
        agentType: conn.type
      }));
      conn.registered = true;
    }
    return { success: true, message: `Joined as ${name}` };
  }

  // Close any existing dead connection for this agent
  if (conn.ws) {
    try { conn.ws.terminate(); } catch (e) {}
    conn.ws = null;
    conn.connected = false;
    conn.registered = false;
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(SERVER_URL);
    conn.ws = ws;

    const timeout = setTimeout(() => {
      conn.connected = false;
      conn.registered = false;
      resolve({ success: false, error: 'Connection timeout' });
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      conn.connected = true;
      ws.send(JSON.stringify({
        type: 'register',
        name: name,
        agentType: conn.type
      }));
      conn.registered = true;
      const msg = isReconnect ? `Reconnected as ${name}` : `Connected as ${name}`;
      resolve({ success: true, message: msg });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle "who" response - don't add to messages
        if (msg.type === 'who_response') {
          conn.lastWhoResponse = msg.clients || [];
          return;
        }

        // Add to shared message buffer (dedupe by timestamp+from+text)
        const isDupe = messages.some(m =>
          m.timestamp === msg.timestamp &&
          m.from === msg.from &&
          m.text === msg.text
        );
        if (!isDupe) {
          messages.push(msg);
          if (messages.length > 100) messages.shift();
        }

        // Check for answers to pending questions
        if (msg.type === 'chat' && msg.text && msg.from !== name) {
          const match = msg.text.match(/\[A:([a-f0-9]+)\]\s*(.*)/);
          if (match) {
            const [, qId, answer] = match;
            const pending = conn.pendingQuestions.get(qId);
            if (pending) {
              clearTimeout(pending.timeout);
              conn.pendingQuestions.delete(qId);
              pending.resolve(answer);
            }
          }
        }
      } catch (e) {}
    });

    ws.on('close', (code) => {
      conn.connected = false;
      conn.registered = false;
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      conn.connected = false;
      conn.registered = false;
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Try to reconnect a specific agent if disconnected
 */
async function ensureConnected(name) {
  if (!name) {
    return { success: false, error: 'Name is required' };
  }

  const conn = connections.get(name);
  if (!conn) {
    return { success: false, error: `Agent ${name} not initialized - call chatroom_join first` };
  }

  if (conn.connected && conn.ws && conn.ws.readyState === 1) {
    return { success: true, wasReconnect: false };
  }

  // Try to reconnect
  for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    const result = await connect(name, conn.type, true);
    if (result.success) {
      return { success: true, wasReconnect: true, attempt };
    }
    await new Promise(r => setTimeout(r, 500 * attempt));
  }

  return { success: false, error: 'Failed to reconnect after ' + MAX_RECONNECT_ATTEMPTS + ' attempts' };
}

/**
 * Disconnect a specific agent from chatroom
 */
function disconnect(name) {
  if (!name) {
    return { success: false, error: 'Name is required' };
  }

  const conn = connections.get(name);
  if (!conn) {
    return { success: true, message: `${name} was not connected` };
  }

  if (conn.ws && conn.ws.readyState === 1) {
    const socket = conn.ws;
    conn.ws = null;
    conn.connected = false;
    conn.registered = false;

    try {
      socket.send(JSON.stringify({ type: 'leaving' }), (err) => {
        if (!err) {
          socket.close(1000, 'leaving');
        }
      });
    } catch (e) {
      try { socket.terminate(); } catch (e2) {}
    }
  } else if (conn.ws) {
    try { conn.ws.terminate(); } catch (e) {}
    conn.ws = null;
    conn.connected = false;
    conn.registered = false;
  }

  // Remove from connections map
  connections.delete(name);
  return { success: true, message: `Disconnected ${name}` };
}

/**
 * Broadcast a message from a specific agent
 */
function broadcast(message, category, senderName) {
  if (!senderName) {
    return { success: false, error: 'Name is required to send messages' };
  }

  const conn = connections.get(senderName);
  if (!conn || !conn.connected || !conn.ws || conn.ws.readyState !== 1) {
    return { success: false, error: `${senderName} is not connected` };
  }

  const msg = category
    ? { type: 'discovery', category, text: message, from: senderName }
    : { type: 'chat', text: message, from: senderName };

  conn.ws.send(JSON.stringify(msg));
  return { success: true, message: 'Message sent' };
}

/**
 * Ask a question and wait for answer (from a specific agent)
 */
async function ask(name, question, timeoutMs = 30000) {
  if (!name) {
    return { success: false, error: 'Name is required' };
  }

  const conn = connections.get(name);
  if (!conn || !conn.connected) {
    return { success: false, error: `${name} is not connected` };
  }

  const qId = crypto.randomBytes(4).toString('hex');
  const taggedQ = `[Q:${qId}] ${question}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      conn.pendingQuestions.delete(qId);
      resolve({ success: false, error: 'No response (timeout)' });
    }, timeoutMs);

    conn.pendingQuestions.set(qId, {
      resolve: (answer) => resolve({ success: true, answer }),
      timeout
    });

    conn.ws.send(JSON.stringify({ type: 'chat', text: taggedQ, from: name }));
  });
}

/**
 * Check messages (with auto-reconnect for specific agent)
 */
async function check(name, count = 10, since = 0) {
  if (!name) {
    return { success: false, error: 'Name is required', messages: [] };
  }

  // Try to ensure this agent is connected
  const connResult = await ensureConnected(name);
  const conn = connections.get(name);
  const isConnected = conn ? conn.connected : false;

  const filtered = since > 0
    ? messages.filter(m => m.timestamp > since)
    : messages.slice(-count);

  return {
    success: true,
    connected: isConnected,
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
 * Get list of connected clients (from perspective of specific agent)
 */
async function who(name) {
  if (!name) {
    return { success: false, error: 'Name is required', clients: [] };
  }

  const connResult = await ensureConnected(name);
  const conn = connections.get(name);

  if (!conn || !conn.connected) {
    return { success: false, error: `${name} is not connected`, clients: [] };
  }

  // Request who's online
  conn.ws.send(JSON.stringify({ type: 'who' }));

  // Wait a bit for response
  await new Promise(r => setTimeout(r, 100));

  return {
    success: true,
    clients: conn.lastWhoResponse || [],
    myName: name
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
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Your agent name (from chatroom_join)' }
        },
        required: ['name']
      }
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
        required: ['message', 'name']
      }
    },
    {
      name: 'chatroom_ask',
      description: 'Ask a question and wait for an answer from another agent or user',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Your agent name (from chatroom_join)' },
          question: { type: 'string', description: 'Question to ask' },
          timeout: { type: 'number', description: 'Timeout in ms (default 30000)' }
        },
        required: ['name', 'question']
      }
    },
    {
      name: 'chatroom_check',
      description: 'Check recent messages in the chatroom (non-blocking). Call this periodically to see guidance from user or findings from other agents. Auto-reconnects if connection was lost.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Your agent name (from chatroom_join)' },
          count: { type: 'number', description: 'Number of messages to return (default 10)' },
          since: { type: 'number', description: 'Only messages after this timestamp' }
        },
        required: ['name']
      }
    },
    {
      name: 'chatroom_who',
      description: 'Get list of currently connected clients in the chatroom',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Your agent name (from chatroom_join)' }
        },
        required: ['name']
      }
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
      return { content: [{ type: 'text', text: JSON.stringify(disconnect(args.name)) }] };

    case 'chatroom_broadcast':
      return { content: [{ type: 'text', text: JSON.stringify(broadcast(args.message, args.category, args.name)) }] };

    case 'chatroom_ask':
      return { content: [{ type: 'text', text: JSON.stringify(await ask(args.name, args.question, args.timeout)) }] };

    case 'chatroom_check':
      return { content: [{ type: 'text', text: JSON.stringify(await check(args.name, args.count, args.since)) }] };

    case 'chatroom_who':
      return { content: [{ type: 'text', text: JSON.stringify(await who(args.name)) }] };

    default:
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown tool' }) }] };
  }
});

// Graceful shutdown - notify chatroom before exit for all connections
function gracefulShutdown(signal) {
  for (const [name, conn] of connections.entries()) {
    if (conn.ws && conn.ws.readyState === 1) {
      try {
        conn.ws.send(JSON.stringify({
          type: 'discovery',
          category: 'leaving',
          text: `${name} is exiting (${signal})`,
          from: name
        }));
        conn.ws.send(JSON.stringify({ type: 'leaving' }));
        conn.ws.close(1000, 'process exiting');
      } catch (e) {}
    }
  }
}

// Register exit handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('beforeExit', () => gracefulShutdown('beforeExit'));
process.on('exit', () => {
  for (const [, conn] of connections.entries()) {
    if (conn.ws) {
      try { conn.ws.terminate(); } catch (e) {}
    }
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Chatroom MCP server running');
}

main().catch(console.error);
