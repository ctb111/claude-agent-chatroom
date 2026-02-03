#!/usr/bin/env node
/**
 * Agent Chatroom - Cross-platform Terminal Spawner
 * Opens a new terminal window with the chatroom UI
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');

/**
 * Detect available terminal on Linux
 */
function detectLinuxTerminal() {
  const terminals = [
    'gnome-terminal',
    'konsole',
    'xfce4-terminal',
    'mate-terminal',
    'xterm',
    'terminator',
    'tilix',
    'alacritty',
    'kitty'
  ];

  for (const term of terminals) {
    try {
      require('child_process').execSync(`which ${term}`, { stdio: 'ignore' });
      return term;
    } catch (e) {
      continue;
    }
  }
  return 'xterm'; // fallback
}

/**
 * Open a new terminal window with a command
 */
function openTerminal(command, cwd, options = {}) {
  const platform = process.platform;
  const title = options.title || 'Agent Chatroom';

  return new Promise((resolve, reject) => {
    try {
      if (platform === 'darwin') {
        // macOS
        const script = `
          tell application "Terminal"
            activate
            do script "cd '${cwd}' && ${command}"
          end tell
        `;
        exec(`osascript -e '${script}'`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
      else if (platform === 'win32') {
        // Windows
        const cmd = `start "${title}" cmd /k "cd /d ${cwd} && ${command}"`;
        exec(cmd, { shell: true }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
      else {
        // Linux
        const terminal = detectLinuxTerminal();
        let args;

        switch (terminal) {
          case 'gnome-terminal':
            args = ['--', 'bash', '-c', `cd '${cwd}' && ${command}; exec bash`];
            break;
          case 'konsole':
            args = ['-e', 'bash', '-c', `cd '${cwd}' && ${command}; exec bash`];
            break;
          case 'xfce4-terminal':
          case 'mate-terminal':
            args = ['-e', `bash -c "cd '${cwd}' && ${command}; exec bash"`];
            break;
          case 'alacritty':
            args = ['-e', 'bash', '-c', `cd '${cwd}' && ${command}; exec bash`];
            break;
          case 'kitty':
            args = ['bash', '-c', `cd '${cwd}' && ${command}; exec bash`];
            break;
          default:
            args = ['-e', `cd '${cwd}' && ${command}`];
        }

        const proc = spawn(terminal, args, {
          detached: true,
          stdio: 'ignore'
        });
        proc.unref();
        resolve();
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Open the chatroom UI in a new terminal
 */
async function openChatroomUI(chatroomPath) {
  const uiPath = chatroomPath || __dirname;
  const command = 'node ui.js';

  console.log(`Opening chatroom UI in new terminal...`);
  await openTerminal(command, uiPath, { title: 'Agent Chatroom' });
  console.log('Chatroom UI opened.');
}

// Run if executed directly
if (require.main === module) {
  const scriptPath = process.argv[2];
  if (scriptPath) {
    // If a script path is provided, run it in a new terminal
    const path = require('path');
    const dir = path.dirname(scriptPath);
    const script = path.basename(scriptPath);
    openTerminal(`node ${script}`, dir, { title: 'Agent Chatroom' }).catch(console.error);
  } else {
    openChatroomUI().catch(console.error);
  }
}

module.exports = { openTerminal, openChatroomUI, detectLinuxTerminal };
