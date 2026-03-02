#!/usr/bin/env node
'use strict';

const net = require('net');
const path = require('path');
const os = require('os');

const socketPath = path.join(os.homedir(), '.config', 'moo-notify', 'notify.sock');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node notify-send-socket.js "Message Title" "Message Body"');
  process.exit(1);
}

const title = args[0];
const body = args[1] || '';

const client = net.createConnection(socketPath, () => {
  const payload = JSON.stringify({ title, body });
  client.write(payload, () => {
    console.log('Notification sent successfully.');
    client.end();
  });
});

client.on('error', (err) => {
  console.error(`Error connecting to socket: ${err.message}`);
  console.error('Is the broadcast service running?');
  process.exit(1);
});
