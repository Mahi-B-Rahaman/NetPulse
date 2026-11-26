# NetPulse

<p align="center">
  <strong>Precision browser-based network diagnostics for Wi-Fi, BDIX peering, and global CDN performance.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#diagnostics">Diagnostics</a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=061E33">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwindcss&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-000000?logo=express&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-not%20specified-lightgrey">
</p>

> NetPulse combines throughput, latency, bufferbloat, BDIX peering, and CDN edge measurements into one focused diagnostics dashboard—running directly in your browser.

## Why NetPulse?

A speed test can tell you a number, but not always **why** your connection feels slow. NetPulse separates network performance into three practical layers:

| Test | Measures | Useful for |
|---|---|---|
| **Overall Wi-Fi** | Download, upload, ping, jitter, packet loss, bufferbloat | Home and office connection quality |
| **BDIX** | Domestic bandwidth, node reachability, peering RTT | ISP routing and local Bangladesh network performance |
| **CDN Edge** | Real payload speed and RTT across edge networks | Global content delivery and route quality |

## Features

### 1. Overall Wi-Fi speed

- Multi-stream HTTP download testing
- Concurrent `XMLHttpRequest` upload testing
- Cloudflare Edge or built-in Express server benchmarks
- Automatic fallback between available test engines
- Live throughput gauge and waveform visualization
- Idle latency percentiles: `Min`, `Median`, `Avg`, `p95`, and `p99`
- RFC 3550 jitter and packet-loss estimation
- Loaded-latency and bufferbloat analysis with grades from `A+` to `F`

### 2. BDIX speed and peering

- Domestic multi-stream throughput measurements
- Reachability checks for BDIX and Bangladesh ISP nodes
- RTT, jitter, and peering verdicts
- Built-in support for Link3 and other commonly used local targets
- Add and remove custom BDIX mirrors
- Automated peering and routing diagnostics

### 3. CDN edge matrix

- Real payload delivery tests instead of empty pings
- Throughput and median RTT comparisons
- Coverage for Cloudflare, jsDelivr, cdnjs, unpkg, Google Edge, and the App Cloud Edge
- Edge POP hints where available

### 4. Results that stay useful

- Automatic bottleneck identification
- Readiness checks for 4K streaming, gaming, video calls, cloud sync, and BDIX workloads
- Persistent local run history
- One-click historical run inspection
- Full CSV and JSON exports
- Light and dark themes

## How It Works

1. NetPulse detects your ISP, approximate client route context, browser link hint, and IP information.
2. It resolves an available benchmark engine.
3. It runs the selected test scope:
   - Overall Wi-Fi
   - BDIX
   - CDN
   - Or all three sequentially
4. It combines throughput, RTT, jitter, and bufferbloat measurements into a diagnostic analysis.
5. Results are stored locally in your browser for later review.

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Motion, Lucide React
- **Backend:** Node.js, Express, Vite
- **Tooling:** TSX, TSC, Vite

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm

### Installation

```bash
npm install
npm run dev
```

The development server will start on the address printed in your terminal, typically `http://localhost:3000`.

### Production build

```bash
npm run build
npm start
```

### Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite and Express development server |
| `npm run build` | Create the production frontend bundle |
| `npm start` | Start the Node.js server |
| `npm run preview` | Preview the built Vite application |
| `npm run lint` | Run TypeScript checks without emitting files |

## Configuration

Copy the example environment file and update it if you need to enable optional integrations:

```bash
cp .env.example .env
```

Never commit API keys or private configuration values. Keep secrets in `.env` or your deployment provider's environment settings.

## Diagnostics

NetPulse reports metrics in context rather than as isolated numbers:

- **Download / upload:** sustained and peak throughput in Mbps
- **Latency:** median idle latency and percentile distribution
- **Jitter:** variation between latency samples
- **Bufferbloat:** how much latency rises under load
- **BDIX RTT:** response time for local exchange and ISP peering targets
- **CDN speed:** actual edge-network throughput and RTT

> Network measurements vary with Wi-Fi congestion, device CPU, browser behavior, routing changes, server load, VPNs, and network throttling.

## Privacy

Test history is saved locally using browser `localStorage`. Exported CSV and JSON files are generated in the browser and remain under your control.

## Contributing

Contributions, bug reports, and feature suggestions are welcome.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint` and `npm run build`
5. Open a pull request

## License

No license is currently specified. If you plan to reuse or distribute this project, please add an appropriate license first.
