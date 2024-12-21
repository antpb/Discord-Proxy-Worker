# Discord Bot Proxy Worker

A Cloudflare Worker that serves as a proxy for Discord bot interactions, featuring WebSocket support and Durable Objects for state management. This worker handles Discord's interaction verification, WebSocket connections, and provides a clean API for bot interactions.

If this helped you, please consider sending some coin.
SOL: 5h7YzknKdQKA9QxiZKdt3X5JpjVAyoTEQUroaRGuphAx
ETH: 0x94899E0Cc3115D7761EeCd9bBc04D8eBff9de871

## Features

- Discord Interactions endpoint verification and handling
- WebSocket support for real-time bot communication
- Durable Objects for state persistence
- CORS support for cross-origin requests
- Slash command registration
- Support for all Discord interaction types (commands, components, autocomplete, modals)

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Cloudflare Workers account
- Discord Bot Token and Application ID

## Installation

1. Clone the repository:
```bash
git clone <your-repository>
cd discord-bot-proxy
```

2. Install dependencies:
```bash
npm install
```

3. Make the setup script executable and run it:
```bash
chmod +x setup.sh
./setup.sh
```

## Configuration

### Discord Bot Setup

1. Create a Discord application at the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot for your application and get the bot token
3. Enable the necessary Privileged Gateway Intents for your bot
4. Save your:
   - Application ID
   - Public Key
   - Bot Token

### Worker Configuration

Initialize the worker with your Discord credentials:

```bash
curl -X POST https://your-worker.workers.dev/init \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "YOUR_PUBLIC_KEY",
    "applicationId": "YOUR_APPLICATION_ID",
    "token": "YOUR_BOT_TOKEN"
  }'
```

## Discord Verification Process

The worker implements Discord's security requirements in several ways:

1. **Interaction Verification**
   - Discord sends a unique signature with each interaction
   - The worker verifies this using the `discord-interactions` package
   - Required headers:
     - `x-signature-ed25519`: The request signature
     - `x-signature-timestamp`: Request timestamp
   - Verification process:
     ```javascript
     const isValid = verifyKey(
       bodyText,
       signature,
       timestamp,
       publicKey
     );
     ```

2. **WebSocket Security**
   - Uses secure WebSocket protocol
   - Token verification through protocol header
   - Format: `cf-discord-token.YOUR_BOT_TOKEN`

3. **Slash Command Registration**
   - Automatically registers commands during initialization
   - Verifies bot token with Discord API
   - Creates basic `/ping` command by default

## API Endpoints

### POST /init
Initializes the bot with Discord credentials

### POST /check
Validates Discord configuration

### POST /interactions
Handles Discord interactions

### /websocket/:channelId
WebSocket endpoint for real-time communication

## WebSocket Usage

Connect to the WebSocket endpoint:

```javascript
const ws = new WebSocket(
  'wss://your-worker.workers.dev/websocket/CHANNEL_ID',
  [`cf-discord-token.${YOUR_BOT_TOKEN}`]
);
```

## Development

### Local Development
```bash
wrangler dev
```

### Deployment
```bash
wrangler deploy
```

## Interaction Types Supported

1. PING (Type 1)
2. APPLICATION_COMMAND (Type 2)
3. MESSAGE_COMPONENT (Type 3)
4. APPLICATION_COMMAND_AUTOCOMPLETE (Type 4)
5. MODAL_SUBMIT (Type 5)

## Error Handling

The worker includes comprehensive error handling:
- Invalid signatures return 401
- Missing credentials return 400
- Server errors return 500
- All errors are logged for debugging

## Security Considerations

- Never expose your bot token in client-side code
- Always verify interactions using Discord's signature
- Use HTTPS for all API calls
- Implement rate limiting for production use
- Regularly rotate credentials

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License (or your chosen license)