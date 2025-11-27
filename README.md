# 🚀 StreamPad Coin Creator

A complete system for creating Solana tokens via livestream chat commands using pump.fun API.

## Features

- **Real-time Chat Monitoring**: Monitors pump.fun chat for `!launch` commands
- **Token Creation**: Creates Solana tokens via pump.fun API
- **User Tracking**: Each user can only create ONE token
- **Live Dashboard**: Beautiful real-time dashboard for streaming
- **Market Data**: Real-time price and market cap tracking
- **Image Support**: Supports custom images or auto-generates defaults
- **Mock Mode**: Test without spending real SOL

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Basic Usage (Mock Mode)

```bash
# Start the system with a contract address to monitor
node launcher.js DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```

### 3. Live Mode (Real Transactions)

```bash
# With API key for real transactions
node launcher.js --api-key YOUR_PUMPPORTAL_API_KEY DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
```

### 4. Dashboard Only

```bash
# Start just the dashboard and monitoring (no chat)
node launcher.js
```

## Chat Commands

Users can type these commands in the pump.fun chat:

```
!launch COINNAME TICKER
!launch COINNAME TICKER https://example.com/image.png
```

Examples:
- `!launch MoonShot MOON`
- `!launch DiamondHands DIAMOND https://i.imgur.com/image.png`

## Dashboard

Access the live dashboard at: `http://localhost:3000`

The dashboard shows:
- Total coins created
- Unique creators
- Market cap statistics
- Real-time coin data
- Beautiful animations for streaming

## Components

### 1. Chat Monitor (`coin-launcher.js`)
- Extends the existing persistent chat scraper
- Filters messages for `!` commands
- Parses `!launch` commands
- Tracks users to prevent multiple launches
- Creates tokens via pump.fun API

### 2. Dashboard Server (`dashboard-server.js`)
- Serves the live dashboard website
- Provides API endpoints for coin data
- WebSocket for real-time updates
- File watching for automatic updates

### 3. Market Monitor (`market-monitor.js`)
- Connects to PumpPortal WebSocket API
- Tracks real-time price data
- Updates market cap information
- Auto-subscribes to new tokens

### 4. Pump API (`pump-api.js`)
- Handles pump.fun token creation
- IPFS metadata upload
- Image processing and defaults
- Mock mode for testing

## Configuration

### Environment Variables

```bash
export PUMPPORTAL_API_KEY="your_api_key_here"
```

### Command Line Options

```bash
node launcher.js [options] [contract-address]

Options:
  --api-key KEY        PumpPortal API key for real transactions
  --port PORT          Dashboard port (default: 3000)
  --mock              Force mock mode (no real API calls)
  --help              Show help message
```

## File Structure

```
stream-launch/
├── persistent-chat-scraper.js  # Original chat scraper (modified)
├── coin-launcher.js            # Enhanced chat monitor with !launch
├── pump-api.js                 # Pump.fun API integration
├── market-monitor.js           # Real-time market data
├── dashboard-server.js         # Dashboard web server
├── dashboard.html              # Live dashboard interface
├── launcher.js                 # Main system coordinator
├── package.json                # Dependencies
├── README.md                   # This file
├── launched-coins.json         # Created coins data
└── launched-users.json         # User tracking data
```

## API Endpoints

When running, the system provides:

- `GET /api/coins` - Get all created coins data
- `GET /api/stats` - Get system statistics
- `WebSocket /` - Real-time updates

## Requirements

- Node.js 18+
- PumpPortal API key (for live mode)
- SOL balance (for real transactions)
- Internet connection

## Streaming Setup

1. Start the system with your stream's contract address
2. Add the dashboard URL as a browser source in OBS/streaming software:
   ```
   http://localhost:3000
   ```
3. Configure your chat overlay to show pump.fun chat
4. Users type `!launch` commands in chat to create tokens

## Mock vs Live Mode

### Mock Mode (Default)
- ✅ No API key required
- ✅ No SOL spent
- ✅ Simulated transactions
- ✅ Demo market data
- ✅ Perfect for testing

### Live Mode
- 🔴 Requires PumpPortal API key
- 🔴 Spends real SOL
- 🔴 Creates real tokens
- 🔴 Real market data
- ✅ Production ready

## Troubleshooting

### Common Issues

1. **"No contract address provided"**
   - Make sure to provide a valid pump.fun contract address
   - Format: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`

2. **"Failed to connect WebSocket"**
   - Check your PumpPortal API key
   - Verify internet connection
   - System will fall back to mock mode

3. **"Dashboard not loading"**
   - Check if port 3000 is available
   - Try a different port: `--port 8080`

4. **"Coin creation failed"**
   - In mock mode: Check logs for errors
   - In live mode: Verify API key and SOL balance

### Logs

The system provides detailed logging:
- Chat monitoring activity
- Token creation status
- Market data updates
- System status

## Security Notes

- Never commit API keys to version control
- Use environment variables for sensitive data
- Mock mode is safe for testing and demos
- Live mode requires careful API key management

## License

MIT License - See LICENSE file for details

## Support

For issues and questions:
1. Check the logs for error messages
2. Verify your API key and contract address
3. Try mock mode first to test functionality
4. Check PumpPortal API status