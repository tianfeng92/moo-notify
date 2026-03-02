'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
  name: 'unix-socket',

  async start(engine, config) {
    const socketPath = config.socketPath || path.join(os.homedir(), '.config', 'moo-notify', 'notify.sock');

    // Ensure directory exists
    const dir = path.dirname(socketPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Remove existing socket
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    const server = net.createServer((socket) => {
      engine.logger.info(`[unix-socket] Client connected`);
      socket.on('data', (data) => {
        try {
          const rawMessage = data.toString();
          engine.logger.info(`[unix-socket] Received message: ${rawMessage}`);
          const message = JSON.parse(rawMessage);
          engine.broadcast({
            source: 'unix-socket',
            title: message.title || 'Notification',
            body: message.body || message.text || '',
            ...message
          });
        } catch (err) {
          engine.logger.error(`[unix-socket] Error parsing message: ${err.message}`);
        }
      });

      socket.on('error', (err) => {
        engine.logger.error(`[unix-socket] Socket error: ${err.message}`);
      });
    });

    server.on('error', (err) => {
      engine.logger.error(`[unix-socket] Server error: ${err.message}`);
    });

    server.listen(socketPath, () => {
      engine.logger.info(`[unix-socket] Listening on ${socketPath}`);
    });

    // Cleanup on exit
    process.on('exit', () => {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    });
  }
};
