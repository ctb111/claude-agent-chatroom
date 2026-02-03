# Agent Chatroom

A Claude Code plugin that enables real-time communication between parallel agents and users.

When Claude Code spawns multiple agents to work on a task, they automatically coordinate through a shared chatroom. You can observe agent activity and send guidance in real-time through a terminal UI.

## Why Use This?

When working with multiple Claude Code agents:
- **Agents work in isolation** - They don't know what other agents are doing
- **Duplicate work** - Multiple agents might analyze the same files
- **No user visibility** - You can't see what agents are doing until they finish
- **No mid-task guidance** - You can't redirect agents while they work

Agent Chatroom solves all of this:
- **Real-time coordination** - Agents share findings and claim tasks
- **User visibility** - Watch all agent activity in a terminal UI
- **Live guidance** - Send messages to agents while they work
- **Automatic** - No manual setup needed per session

## Installation

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI installed
- Node.js 18+

### Install the Plugin

```bash
# Clone the repository
git clone https://github.com/ctb111/claude-agent-chatroom.git
cd claude-agent-chatroom

# Install dependencies
npm install
```

### Configure Claude Code

**1. Add SubagentStart hook** to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/claude-agent-chatroom/hooks/scripts/subagent-start.sh",
            "timeout": 15,
            "statusMessage": "Starting chatroom..."
          }
        ]
      }
    ]
  }
}
```

**2. Add MCP server** to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "chatroom": {
      "command": "node",
      "args": ["/path/to/claude-agent-chatroom/chatroom-mcp.js"]
    }
  }
}
```

Replace `/path/to/claude-agent-chatroom` with your actual installation path.

### Verify Installation

```bash
# Check plugin is installed and enabled
claude /plugins list

# Should show:
# agent-chatroom (enabled)
```

**Important:** Restart Claude Code after enabling the plugin for hooks to take effect.

## How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│  You: "Analyze auth, database, and API modules in parallel"     │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Claude Code                                │
│                                                                   │
│  Spawns Task (first agent)                                       │
│         │                                                         │
│         ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ SubagentStart Hook fires automatically                   │     │
│  │  1. Checks if chatroom server running                    │     │
│  │  2. Starts server + opens Terminal UI (if needed)        │     │
│  └─────────────────────────────────────────────────────────┘     │
│         │                                                         │
│         ▼                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                    │
│  │  Agent 1  │  │  Agent 2  │  │  Agent 3  │                    │
│  │   auth    │  │  database │  │    api    │                    │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘                    │
│        │              │              │                           │
│        └──────────────┼──────────────┘                           │
│                       │                                           │
│                       ▼                                           │
│              ┌─────────────────┐                                 │
│              │  Chatroom MCP   │◄── Agents use chatroom tools    │
│              └────────┬────────┘                                 │
│                       │                                           │
└───────────────────────┼───────────────────────────────────────────┘
                        │ WebSocket
                        ▼
               ┌─────────────────┐
               │ Chatroom Server │
               │   (port 3030)   │
               └────────┬────────┘
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
    ┌─────────────┐          ┌─────────────┐
    │ Terminal UI │          │   Agents    │
    │  (for you)  │          │  broadcast  │
    └─────────────┘          └─────────────┘
```

### What Happens Automatically

1. **First agent spawns** → Server starts, Terminal UI opens
2. **Each agent** → Receives chatroom instructions in their prompt
3. **Agents join** → Register in chatroom with their name/type
4. **Agents broadcast** → Share findings, claim files, report progress
5. **You observe** → See all activity in the Terminal UI
6. **You guide** → Send messages that agents see via `chatroom_check`

## Usage

### Basic Usage

Just use Claude Code normally. When you spawn agents, the chatroom activates automatically:

```
You: Analyze the authentication system using multiple agents

Claude: I'll spawn several agents to analyze different aspects...
        [Task tool called - hook fires - chatroom starts]

→ Terminal UI pops up
→ Agents join and start broadcasting
→ You watch and optionally guide them
```

### Terminal UI

When the first agent spawns, a terminal window opens with the chatroom UI:

```
┌─ Agent Chatroom ──────────────────────────────────────────────┐
│                                                                │
│ [system] auth-analyzer joined                                  │
│ [system] db-explorer joined                                    │
│ [auth-analyzer] 🔍 Claiming: src/auth/                        │
│ [db-explorer] 🔍 Claiming: src/database/                      │
│ [auth-analyzer] ✓ Found: JWT tokens stored insecurely         │
│ [db-explorer] ✓ Found: Missing connection pooling             │
│ [auth-analyzer] Completed analysis of auth module             │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ > Type a message to send to agents...                         │
└────────────────────────────────────────────────────────────────┘
```

### Sending Guidance to Agents

Type in the Terminal UI to send messages. Agents see these when they call `chatroom_check`:

```
> Focus on security vulnerabilities, ignore styling issues
> [A:abc123] Check the session.ts file specifically
```

The `[A:question_id]` format answers a specific agent question (see below).

### Agent Question/Answer

Agents can ask questions and wait for your answer:

```
[auth-analyzer] [Q:abc123] Should I also check the OAuth integration?

> [A:abc123] Yes, check OAuth and also look at the refresh token logic
```

## Agent Tools

Agents automatically receive instructions to use these MCP tools:

| Tool | Description |
|------|-------------|
| `chatroom_join` | Join the chatroom (called at start) |
| `chatroom_broadcast` | Share a finding or status update |
| `chatroom_check` | Check for messages from you or other agents |
| `chatroom_ask` | Ask a question and wait for an answer |
| `chatroom_leave` | Leave the chatroom (called when done) |

### Broadcast Categories

Agents use categories to organize their messages:

| Category | Meaning | Example |
|----------|---------|---------|
| `found` | Discovery or finding | "Found SQL injection in query.ts" |
| `claiming` | Claiming a file/task | "Analyzing src/auth/" |
| `completed` | Finished a task | "Completed auth module analysis" |
| `blocked` | Needs help | "Can't access database schema" |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHATROOM_PORT` | `3030` | WebSocket server port |
| `CHATROOM_URL` | `ws://localhost:3030` | Server URL for MCP clients |
| `CHATROOM_USER` | `user` | Your display name in chatroom |

### Manual Server Control

The server starts automatically, but you can also control it manually:

```bash
# Start server + UI
npm start

# Server only (headless, for remote/CI use)
npm run server

# UI only (connect to running server)
npm run ui
```

## Troubleshooting

### Terminal UI doesn't open

**macOS:** Grant Terminal/iTerm automation permissions in System Preferences → Security & Privacy → Privacy → Automation

**Linux:** Ensure you have a supported terminal installed: `gnome-terminal`, `konsole`, `xfce4-terminal`, `xterm`, `alacritty`, or `kitty`

**Workaround:** Start the UI manually in a separate terminal:
```bash
cd /path/to/agent-chatroom && npm run ui
```

### Agents don't have chatroom tools

1. Verify `~/.mcp.json` contains the chatroom MCP server
2. Restart Claude Code to reload MCP servers
3. Check with `claude --debug` to see loaded MCP servers

### Agents don't use the chatroom

1. Verify SubagentStart hook is in `~/.claude/settings.json`
2. Restart Claude Code (hooks load at startup)
3. Check hook script exists and is executable

### "Connection refused" errors

The WebSocket server isn't running:
```bash
# Check if running
lsof -i :3030

# Start manually
cd /path/to/agent-chatroom && npm run server
```

### Port 3030 already in use

```bash
# Find and kill existing process
lsof -i :3030 | grep LISTEN | awk '{print $2}' | xargs kill

# Or use a different port
CHATROOM_PORT=3031 npm start
```

## Architecture

```
claude-agent-chatroom/
├── .claude-plugin/
│   └── plugin.json         # Plugin metadata
├── .claude/
│   └── settings.local.json # Plugin hooks configuration
├── hooks/
│   └── scripts/
│       └── subagent-start.sh # Hook script (starts server + UI)
├── chatroom-mcp.js         # MCP server (provides tools to agents)
├── server.js               # WebSocket server (message broker)
├── ui.js                   # Terminal UI (blessed-based)
├── spawn-terminal.js       # Cross-platform terminal spawner
├── start.js                # Orchestrator (starts server + UI)
└── package.json
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **SubagentStart Hook** | Starts chatroom server and UI when first agent spawns |
| **MCP Server** | Provides chatroom_* tools to agents via Model Context Protocol |
| **WebSocket Server** | Routes messages between agents and UI |
| **Terminal UI** | Displays messages, accepts user input |

## Development

### Running Tests

```bash
# Test the hook script
echo '{"tool_input": {"prompt": "test"}}' | \
  CLAUDE_PLUGIN_ROOT=$(pwd) bash hooks/scripts/task-pretool.sh

# Test MCP server
node chatroom-mcp.js
```

### Modifying Chatroom Instructions

Edit the instructions in `hooks/scripts/task-pretool.sh`:

```bash
read -r -d '' CHATROOM_INSTRUCTIONS << 'INSTRUCTIONS'
# Your custom instructions here
INSTRUCTIONS
```

Restart Claude Code after changes.

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `claude --debug`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Built by [ctb111](https://github.com/ctb111) for the Claude Code ecosystem.
