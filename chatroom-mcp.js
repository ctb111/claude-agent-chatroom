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
const pendingQuestions = new Map();

/**
 * Connect to chatroom
 */
async function connect(name, type) {
  if (connected) return { success: true, message: 'Already connected' };

  agentName = name;
  agentType = type || 'agent';

  return new Promise((resolve) => {
    ws = new WebSocket(SERVER_URL);

    const timeout = setTimeout(() => {
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
      resolve({ success: true, message: `Connected as ${agentName}` });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
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

    ws.on('close', () => {
      connected = false;
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Disconnect from chatroom
 */
function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
    connected = false;
  }
  return { success: true, message: 'Disconnected' };
}

/**
 * Broadcast a message
 */
function broadcast(message, category) {
  if (!connected) return { success: false, error: 'Not connected' };

  const msg = category
    ? { type: 'discovery', category, text: message }
    : { type: 'chat', text: message };

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
 * Check messages
 */
function check(count = 10, since = 0) {
  const filtered = since > 0
    ? messages.filter(m => m.timestamp > since)
    : messages.slice(-count);

  return {
    success: true,
    connected,
    messages: filtered.map(m => ({
      from: m.from || 'system',
      type: m.type,
      text: m.text,
      category: m.category,
      timestamp: m.timestamp
    }))
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
          category: {
            type: 'string',
            enum: ['found', 'claiming', 'completed', 'blocked'],
            description: 'Optional category for discoveries'
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
      description: 'Check recent messages in the chatroom (non-blocking). Call this periodically to see guidance from user or findings from other agents.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of messages to return (default 10)' },
          since: { type: 'number', description: 'Only messages after this timestamp' }
        }
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
      return { content: [{ type: 'text', text: JSON.stringify(disconnect()) }] };

    case 'chatroom_broadcast':
      return { content: [{ type: 'text', text: JSON.stringify(broadcast(args.message, args.category)) }] };

    case 'chatroom_ask':
      return { content: [{ type: 'text', text: JSON.stringify(await ask(args.question, args.timeout)) }] };

    case 'chatroom_check':
      return { content: [{ type: 'text', text: JSON.stringify(check(args.count, args.since)) }] };

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
