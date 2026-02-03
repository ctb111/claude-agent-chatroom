#!/usr/bin/env node
/**
 * Agent Chatroom - MCP Installer
 * Adds chatroom MCP server to Claude Code settings
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CHATROOM_MCP_PATH = path.join(__dirname, 'chatroom-mcp.js');

function getSettingsPath() {
  const home = os.homedir();
  return path.join(home, '.claude', 'settings.json');
}

function readSettings(settingsPath) {
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('Warning: Could not parse existing settings:', e.message);
  }
  return {};
}

function writeSettings(settingsPath, settings) {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function install() {
  console.log('Agent Chatroom - MCP Installer\n');

  const settingsPath = getSettingsPath();
  console.log(`Settings file: ${settingsPath}`);

  // Read existing settings
  const settings = readSettings(settingsPath);

  // Initialize mcpServers if needed
  if (!settings.mcpServers) {
    settings.mcpServers = {};
  }

  // Check if already installed
  if (settings.mcpServers.chatroom) {
    console.log('\nChatroom MCP already configured.');
    console.log(`Current path: ${settings.mcpServers.chatroom.args?.[0]}`);

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Update to current path? (y/N): ', (answer) => {
      rl.close();
      if (answer.toLowerCase() === 'y') {
        addConfig(settings, settingsPath);
      } else {
        console.log('No changes made.');
        process.exit(0);
      }
    });
    return;
  }

  addConfig(settings, settingsPath);
}

function addConfig(settings, settingsPath) {
  // Add chatroom config
  settings.mcpServers.chatroom = {
    command: 'node',
    args: [CHATROOM_MCP_PATH]
  };

  // Write settings
  writeSettings(settingsPath, settings);

  console.log('\n✓ Chatroom MCP server configured!');
  console.log(`  Path: ${CHATROOM_MCP_PATH}`);
  console.log('\nNext steps:');
  console.log('  1. Restart Claude Code');
  console.log('  2. Start the chatroom: npm start');
  console.log('  3. Agents will have access to chatroom_* tools');
}

function uninstall() {
  console.log('Agent Chatroom - MCP Uninstaller\n');

  const settingsPath = getSettingsPath();
  const settings = readSettings(settingsPath);

  if (!settings.mcpServers?.chatroom) {
    console.log('Chatroom MCP not configured. Nothing to remove.');
    return;
  }

  delete settings.mcpServers.chatroom;

  // Clean up empty mcpServers
  if (Object.keys(settings.mcpServers).length === 0) {
    delete settings.mcpServers;
  }

  writeSettings(settingsPath, settings);

  console.log('✓ Chatroom MCP server removed.');
  console.log('  Restart Claude Code for changes to take effect.');
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--uninstall') || args.includes('-u')) {
  uninstall();
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Agent Chatroom - MCP Installer

Usage:
  node install.js           Install MCP server config
  node install.js --uninstall   Remove MCP server config
  node install.js --help        Show this help

This adds the chatroom MCP server to Claude Code's settings,
making chatroom tools available to all agents.
`);
} else {
  install();
}
