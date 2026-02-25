#!/usr/bin/env node
'use strict';

/**
 * gcal-xcowsay: Google Calendar notifications via xcowsay.
 * Polls Google Calendar and shows a xcowsay popup 5 minutes before each event.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');

// --- Config ---
const NOTIFY_THRESHOLDS_MINUTES = [5, 1];
const POLL_INTERVAL_SECONDS = 60;
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gcal-xcowsay');
const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');
const LOG_PATH = path.join(CONFIG_DIR, 'gcal_notify.log');

// --- Logging ---
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

function log(level, ...args) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const msg = `${ts} ${level} ${args.join(' ')}`;
  console.log(msg);
  logStream.write(msg + '\n');
}

const logger = {
  info: (...a) => log('INFO', ...a),
  error: (...a) => log('ERROR', ...a),
};

// --- Auth ---
async function loadSavedToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  const content = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  return google.auth.fromJSON(content);
}

function saveToken(client) {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const key = credentials.installed || credentials.web;
  const payload = {
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(payload));
  logger.info(`Saved OAuth token to ${TOKEN_PATH}`);
}

async function getCalendarService() {
  let client = await loadSavedToken();

  if (!client) {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(
        `Missing credentials.json at ${CREDENTIALS_PATH}\n` +
        'Download it from Google Cloud Console > APIs & Services > Credentials.'
      );
    }
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
      saveToken(client);
    }
  }

  return google.calendar({ version: 'v3', auth: client });
}

// --- Notifications ---
function notify(eventSummary, startTime, minutesBefore) {
  const message = `In ${minutesBefore} min: ${eventSummary}\n${startTime}`;
  logger.info(`Notifying: ${message}`);

  const env = { ...process.env };
  if (!env.DISPLAY) env.DISPLAY = ':0';
  if (!env.DBUS_SESSION_BUS_ADDRESS) {
    const uid = process.getuid();
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uid}/bus`;
  }

  const child = spawn('xcowsay', ['--time=8', '--monitor=0', message], { env, detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      logger.error('xcowsay not found. Install it with: sudo apt install xcowsay');
    } else {
      logger.error(`xcowsay error: ${err.message}`);
    }
  });
  child.unref();
}

// --- Calendar ---
async function getUpcomingEvents(calendar, windowMinutes) {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + windowMinutes * 60 * 1000).toISOString();

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return res.data.items || [];
}

function formatStart(event) {
  const start = event.start;
  if (start.dateTime) {
    return new Date(start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return start.date || '';
}

// --- Main loop ---
async function main() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  const testMode = process.argv.includes('--test');

  logger.info(`Starting gcal-xcowsay (notify at ${NOTIFY_THRESHOLDS_MINUTES.join(', ')} min before events)`);

  const calendar = await getCalendarService();
  logger.info('Authenticated with Google Calendar');

  if (testMode) {
    logger.info('TEST MODE: firing a test xcowsay popup...');
    notify('Test Event', '19:99', 5);
    notify('Test Event', '19:99', 1);
    logger.info('TEST MODE: fetching next 60 min of events...');
    const events = await getUpcomingEvents(calendar, 60);
    if (events.length === 0) {
      logger.info('TEST MODE: no events in the next 60 minutes');
    } else {
      for (const e of events) {
        const start = e.start.dateTime || e.start.date;
        const minutesAway = Math.round((new Date(start) - Date.now()) / 60000);
        logger.info(`TEST MODE: event "${e.summary}" starts at ${start} (${minutesAway} min away)`);
      }
    }
    process.exit(0);
  }

  // notified tracks "eventId:minutesBefore" to allow multiple thresholds per event
  const notified = new Set();

  const poll = async () => {
    try {
      const maxThreshold = Math.max(...NOTIFY_THRESHOLDS_MINUTES);
      const events = await getUpcomingEvents(calendar, maxThreshold + 2);

      const nowMs = Date.now();

      for (const event of events) {
        const eventId = event.id;
        const summary = event.summary || '(No title)';
        const start = event.start;

        // Skip all-day events
        if (!start.dateTime) continue;

        const startMs = new Date(start.dateTime).getTime();
        const timeUntilMs = startMs - nowMs;

        for (const threshold of NOTIFY_THRESHOLDS_MINUTES) {
          const key = `${eventId}:${threshold}`;
          const thresholdMs = threshold * 60 * 1000;
          const lowerMs = thresholdMs - 60 * 1000;
          const upperMs = thresholdMs + 60 * 1000;

          if (timeUntilMs >= lowerMs && timeUntilMs <= upperMs && !notified.has(key)) {
            notify(summary, formatStart(event), threshold);
            notified.add(key);
          }
        }
      }

      // Prune when set gets large to avoid unbounded growth
      if (notified.size > 200) notified.clear();

    } catch (err) {
      logger.error(`Poll error: ${err.message}`);
    }
  };

  // Run immediately, then on interval
  await poll();
  setInterval(poll, POLL_INTERVAL_SECONDS * 1000);
}

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
