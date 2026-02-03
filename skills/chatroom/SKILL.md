---
name: chatroom
description: Start the agent chatroom for real-time coordination between parallel agents. Use when spawning multiple agents that need to communicate or when you want to monitor agent activity.
---

# Agent Chatroom

This skill starts a real-time chatroom for **coordination between parallel agents and the user**. The chatroom is for quick communication, asking questions, and getting help - not for posting work output or results.

## Starting the Chatroom

When this skill is invoked, you MUST:

1. **Start the chatroom server/UI** by running this command:
   ```bash
   node /Users/balanuser/Projects/claude_plugins/agent-chatroom/spawn-terminal.js /Users/balanuser/Projects/claude_plugins/agent-chatroom/ui.js
   ```

2. **Wait for the server** to be ready (check port 3030):
   ```bash
   nc -z localhost 3030 && echo "Ready" || echo "Starting..."
   ```

3. **Confirm to the user** that the chatroom is open.

## Agent Instructions

After starting the chatroom, whenever you spawn agents (using the Task tool), you MUST append these instructions to each agent's prompt:

```
## Chatroom Instructions

You have access to a real-time chatroom for **coordination only** - not for posting your work output.

**At start:**
- Call `chatroom_join` with your agent name (e.g., "backend", "frontend", or a descriptive name)

**What the chatroom IS for:**
- Asking other agents for information you need (e.g., "frontend-agent, what API format do you expect?")
- Asking the user for clarification or decisions (e.g., "Should I use REST or GraphQL?")
- Requesting help when blocked (e.g., "I'm stuck on auth - anyone know where tokens are stored?")
- Brief status updates (e.g., "Starting auth module" / "Done with database setup")
- Coordinating with other agents on shared concerns

**What the chatroom is NOT for:**
- Posting your research findings or results (return those to the orchestrator)
- Dumping code you're writing
- Verbose progress logs
- Detailed explanations of your work

Think of it like a team Slack channel - quick coordination messages, not a build log.

**During work:**
- Call `chatroom_broadcast` with brief coordination messages
  Example: `chatroom_broadcast(message: "Need frontend API spec before I continue", name: "backend")`
- Call `chatroom_check` periodically to see messages from other agents or the user

**IMPORTANT - Stay alive and NEVER leave silently:**
After completing your main task:
1. Broadcast brief completion status (e.g., "Done with my task, standing by")
2. Enter a monitoring loop: call `chatroom_check` every 3-5 seconds
3. Watch for new instructions from the user
4. The chatroom will auto-reconnect if connection drops - don't exit on `connected: false`
5. Only exit when:
   - User explicitly tells you to stop (e.g., "you can go", "exit", "shutdown")
   - You receive a "shutdown" message
   - You've tried 5+ check cycles with connection failures
6. Before exiting, ALWAYS broadcast with category "leaving":
   `chatroom_broadcast(message: "leaving now", category: "leaving", name: "your-name")`
7. Then call `chatroom_leave` to disconnect cleanly
8. NEVER leave without broadcasting with category "leaving" first - the server uses this to track graceful exits
```

## User Interaction

The chatroom UI terminal allows the user to:
- See all agent messages in real-time
- Send messages/instructions to agents
- Close the terminal to shut down the chatroom (agents will detect this and exit)

## Example Workflow

User: `/chatroom` then "spawn backend and frontend agents to build a feature"

You should:
1. Start the chatroom (run the spawn-terminal command)
2. Spawn agents with chatroom instructions appended to their prompts
3. Agents join and work independently, using the chatroom to:
   - Ask each other questions ("What endpoint should I call?")
   - Request user decisions ("REST or GraphQL?")
   - Get help when blocked ("Can't find the auth middleware")
   - Post brief status ("Done with API, standing by")
4. User can direct agents via the chatroom terminal
5. Agents return their actual work output to the orchestrator (not the chatroom)
6. When user closes the terminal, agents exit gracefully

## Example Chatroom Messages

**Good:**
- "frontend: Hey backend, what's the response format for /users?"
- "backend: @frontend - JSON with {id, name, email}"
- "backend: User, should I add rate limiting?"
- "frontend: Blocked - need the API key location"
- "backend: Done with auth module, standing by"

**Bad (don't do this):**
- "Here are my 5 research findings: 1. Dragon fruit exports increased..."
- "Implementing the following code: function handleAuth() { ... }"
- "Full analysis complete: The market trends show..."
