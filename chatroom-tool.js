/**
 * Agent Chatroom - Native Tool for Agents
 *
 * Provides chatroom capabilities that agents can use:
 *   - join(name, type) - Connect to chatroom
 *   - leave() - Disconnect
 *   - broadcast(message, category?) - Send message/finding
 *   - ask(question, timeout?) - Ask and wait for answer
 *   - check(count?) - Get recent messages (non-blocking)
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const SERVER_URL = process.env.CHATROOM_URL || 'ws://localhost:3030';

class ChatroomTool {
  constructor() {
    this.ws = null;
    this.name = null;
    this.type = null;
    this.connected = false;
    this.messages = [];
    this.pendingQuestions = new Map();
    this.maxMessages = 100;
  }

  /**
   * Join the chatroom
   */
  async join(name, type = 'agent') {
    if (this.connected) return;

    this.name = name;
    this.type = type;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(SERVER_URL);

      const timeout = setTimeout(() => {
        if (!this.connected) reject(new Error('Connection timeout'));
      }, 5000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        this.ws.send(JSON.stringify({
          type: 'register',
          name: this.name,
          agentType: this.type
        }));
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          this._handleMessage(JSON.parse(data.toString()));
        } catch (e) {}
      });

      this.ws.on('close', () => {
        this.connected = false;
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Leave the chatroom
   */
  leave() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Broadcast a message (non-blocking)
   */
  broadcast(message, category = null) {
    if (!this.connected) throw new Error('Not connected');

    const msg = category
      ? { type: 'discovery', category, text: message }
      : { type: 'chat', text: message };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Ask a question and wait for answer (blocking)
   */
  ask(question, timeoutMs = 30000) {
    if (!this.connected) throw new Error('Not connected');

    const questionId = crypto.randomBytes(4).toString('hex');
    const taggedQuestion = `[Q:${questionId}] ${question}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingQuestions.delete(questionId);
        reject(new Error('No response received'));
      }, timeoutMs);

      this.pendingQuestions.set(questionId, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ type: 'chat', text: taggedQuestion }));
    });
  }

  /**
   * Check recent messages (non-blocking)
   */
  check(count = 10) {
    return this.messages.slice(-count);
  }

  /**
   * Get new messages since last check
   */
  getNew(since = 0) {
    return this.messages.filter(m => m.timestamp > since);
  }

  /**
   * Handle incoming message
   * @private
   */
  _handleMessage(msg) {
    this.messages.push(msg);
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }

    // Check for answer to pending question
    if (msg.type === 'chat' && msg.text && msg.from !== this.name) {
      const match = msg.text.match(/\[A:([a-f0-9]+)\]\s*(.*)/);
      if (match) {
        const [, qId, answer] = match;
        const pending = this.pendingQuestions.get(qId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingQuestions.delete(qId);
          pending.resolve(answer);
        }
      }
    }
  }
}

// Singleton for easy use
const instance = new ChatroomTool();

module.exports = {
  join: (name, type) => instance.join(name, type),
  leave: () => instance.leave(),
  broadcast: (msg, cat) => instance.broadcast(msg, cat),
  ask: (q, t) => instance.ask(q, t),
  check: (c) => instance.check(c),
  getNew: (s) => instance.getNew(s),
  ChatroomTool
};
