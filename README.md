# gcal-xcowsay

Google Calendar → xcowsay desktop notifications. Shows a cow popup 5 minutes before each calendar event.

## Quick Start

### 1. Get Google Calendar API credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project
3. Enable **Google Calendar API** (APIs & Services > Library)
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth 2.0 Client ID**
6. Application type: **Desktop app**
7. Download the JSON file
8. Save it to `~/.config/gcal-xcowsay/credentials.json`

### 2. Run setup

```bash
cd ~/code/gcal-xcowsay
./setup.sh
```

This installs Node.js deps, does the OAuth flow (opens browser), installs the systemd service, and starts it.

### 3. Verify it's running

```bash
systemctl --user status gcal-xcowsay.service
journalctl --user -u gcal-xcowsay.service -f
```

## Manual usage (no systemd)

```bash
npm install
node index.js
```

## Configuration

Edit `index.js` to change:

| Variable | Default | Description |
|---|---|---|
| `NOTIFY_BEFORE_MINUTES` | `5` | How far ahead to notify |
| `POLL_INTERVAL_SECONDS` | `60` | How often to poll Calendar API |

## Files

| Path | Description |
|---|---|
| `~/.config/gcal-xcowsay/credentials.json` | OAuth client secret (you provide) |
| `~/.config/gcal-xcowsay/gcal_notify.log` | Log file |
| `~/.config/systemd/user/gcal-xcowsay.service` | Systemd service |

## Credits

Thanks to [Nick Gasson](https://github.com/nickg) for creating [xcowsay](https://github.com/nickg/xcowsay) — the finest cow-based notification system on the Linux desktop.
