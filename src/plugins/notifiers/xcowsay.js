'use strict';

const { spawn } = require('child_process');

module.exports = {
  name: 'xcowsay',

  async notify(notification, config) {
    const { body } = notification;
    const time = config.time || 8;
    const monitor = config.monitor || 0;

    const env = { ...process.env };
    if (!env.DISPLAY) env.DISPLAY = ':0';
    if (!env.DBUS_SESSION_BUS_ADDRESS) {
      const uid = process.getuid();
      env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uid}/bus`;
    }

    const child = spawn('xcowsay', [`--time=${time}`, `--monitor=${monitor}`, body], { 
      env, 
      detached: true, 
      stdio: 'ignore' 
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error('xcowsay not found. Install it with: sudo apt install xcowsay');
      } else {
        console.error(`xcowsay error: ${err.message}`);
      }
    });
    
    child.unref();
  }
};
