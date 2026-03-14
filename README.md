# OpenClaw Dashboard

A cyberpunk-style real-time monitoring dashboard for [OpenClaw](https://github.com/openclaw/openclaw).

![screenshot](screenshot.png)

## Features

- **Token Usage** — 30-day trend chart with daily cost breakdown
- **Today's Stats** — tokens, cost, output, cache read + hourly activity heatmap
- **Cost Breakdown** — visual bar chart of cache write/read, output, and input costs
- **Sessions** — active sessions with channel badges, token counts, and context window usage bars
- **Task Log** — auto-extracted task summaries from session logs with status indicators
- **Live Activity** — real-time feed of messages, tool calls, and user interactions
- **Channels & Devices** — health status of connected channels and devices in the header

## How It Works

The dashboard server connects directly to the OpenClaw Gateway via its **WebSocket protocol** (device auth v3, ed25519 signing). It fetches health, status, and presence data through Gateway RPC calls, and tails session log files for real-time activity tracking.

Usage cost data is collected via the `openclaw gateway usage-cost` CLI command (no RPC method available yet).

## Setup

### Prerequisites

- Node.js 18+ (with TypeScript build tooling)
- A running [OpenClaw](https://github.com/openclaw/openclaw) gateway

### Install & Run

```bash
git clone https://github.com/xingrz/openclaw-dashboard.git
cd openclaw-dashboard
npm install
npm run build
npm start
```

For development with auto-reload:

```bash
npm run dev
```

The dashboard will be available at `http://localhost:3210`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3210` | Dashboard server port |
| `GW_PORT` | `18789` | Gateway WebSocket port |
| `OPENCLAW_GATEWAY_TOKEN` | *(auto-detected)* | Gateway auth token |

The gateway token is auto-detected from `~/.openclaw/openclaw.json` if not set via environment variable.

### Reverse Proxy (Caddy)

To serve the dashboard under a subpath:

```caddyfile
your.domain {
    handle_path /dashboard/* {
        reverse_proxy localhost:3210
    }
}
```

### systemd Service

```ini
[Unit]
Description=OpenClaw Dashboard
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/openclaw-dashboard
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=PORT=3210
Environment=PATH=/home/your-user/.npm-global/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp openclaw-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-dashboard
```

## License

[MIT](LICENSE)
