'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.config', 'moo-notify');

module.exports = {
  name: 'google-calendar',

  async start(engine, config) {
    const configDir = config.configDir || DEFAULT_CONFIG_DIR;
    const tokenPath = path.join(configDir, 'token.json');
    const credentialsPath = path.join(configDir, 'credentials.json');
    const thresholds = config.thresholds || [5, 1];
    const pollInterval = config.pollInterval || 60;

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    async function loadSavedToken() {
      if (!fs.existsSync(tokenPath)) return null;
      const content = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      return google.auth.fromJSON(content);
    }

    function saveToken(client) {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      const key = credentials.installed || credentials.web;
      const payload = {
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
      };
      fs.writeFileSync(tokenPath, JSON.stringify(payload));
      engine.logger.info(`[google-calendar] Saved OAuth token to ${tokenPath}`);
    }

    async function getCalendarService() {
      let client = await loadSavedToken();

      if (!client) {
        if (!fs.existsSync(credentialsPath)) {
          throw new Error(
            `Missing credentials.json at ${credentialsPath}
` +
            'Download it from Google Cloud Console > APIs & Services > Credentials.'
          );
        }
        client = await authenticate({
          scopes: SCOPES,
          keyfilePath: credentialsPath,
        });
        if (client.credentials) {
          saveToken(client);
        }
      }

      return google.calendar({ version: 'v3', auth: client });
    }

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

    const calendar = await getCalendarService();
    engine.logger.info('[google-calendar] Authenticated');

    const notified = new Set();

    const poll = async () => {
      try {
        const maxThreshold = Math.max(...thresholds);
        const events = await getUpcomingEvents(calendar, maxThreshold + 2);

        const nowMs = Date.now();

        for (const event of events) {
          const eventId = event.id;
          const summary = event.summary || '(No title)';
          const start = event.start;

          if (!start.dateTime) continue;

          const startMs = new Date(start.dateTime).getTime();
          const timeUntilMs = startMs - nowMs;

          for (const threshold of thresholds) {
            const key = `${eventId}:${threshold}`;
            const thresholdMs = threshold * 60 * 1000;
            const lowerMs = thresholdMs - 60 * 1000;
            const upperMs = thresholdMs + 60 * 1000;

            if (timeUntilMs >= lowerMs && timeUntilMs <= upperMs && !notified.has(key)) {
              engine.broadcast({
                source: 'google-calendar',
                title: summary,
                body: `In ${threshold} min: ${summary}
${formatStart(event)}`,
                startTime: formatStart(event),
                minutesBefore: threshold
              });
              notified.add(key);
            }
          }
        }

        if (notified.size > 200) notified.clear();
      } catch (err) {
        engine.logger.error(`[google-calendar] Poll error: ${err.message}`);
      }
    };

    await poll();
    setInterval(poll, pollInterval * 1000);
  }
};
