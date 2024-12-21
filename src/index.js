import { verifyKey } from 'discord-interactions';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Discord-Application-Id, cf-discord-token',
    };
}

async function handleOptions(request) {
    return new Response(null, {
        headers: corsHeaders()
    });
}

// Main Worker
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        console.log('Worker received raw request:', {
            method: request.method,
            path: path,
            upgrade: request.headers.get('Upgrade'),
            protocol: request.headers.get('Sec-WebSocket-Protocol')
        });
        console.log(`Headers:`, Object.fromEntries(request.headers.entries()));

        // Add specific handler for WebSocket connections
        if (path.startsWith('/websocket/')) {
            console.log('WebSocket path detected');
            const channelId = path.split('/')[2];
            const upgradeHeader = request.headers.get('Upgrade');
            const protocols = request.headers.get('Sec-WebSocket-Protocol');

            console.log('WebSocket connection details:', {
                channelId,
                upgradeHeader,
                protocols,
                path: path,
                allHeaders: Object.fromEntries(request.headers.entries())
            });

            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                console.log('Missing or invalid upgrade header');
                return new Response('Expected Upgrade: websocket', { status: 426 });
            }

            console.log('Creating DO for channelId:', channelId);
            const id = env.DISCORD_BOTS.idFromName(channelId);
            const bot = env.DISCORD_BOTS.get(id);
            console.log('Forwarding to DO with ID:', id);
            return bot.fetch(request);  // Add this return statement
        }
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }

        // Handle initialization endpoint
        if (path === '/init') {
            if (request.method !== 'POST') {
                return new Response('Method not allowed', {
                    status: 405,
                    headers: corsHeaders()
                });
            }

            const bodyText = await request.text();
            const data = JSON.parse(bodyText);

            if (!data.publicKey || !data.applicationId || !data.token) {
                return new Response('Missing required fields', {
                    status: 400,
                    headers: corsHeaders()
                });
            }

            // Store in Durable Object
            const id = env.DISCORD_BOTS.idFromName(data.applicationId);
            const bot = env.DISCORD_BOTS.get(id);
            const response = await bot.fetch(new Request(request.url, {
                method: 'POST',
                headers: request.headers,
                body: bodyText
            }));

            const newHeaders = new Headers(response.headers);
            Object.entries(corsHeaders()).forEach(([key, value]) => {
                newHeaders.set(key, value);
            });

            return new Response(response.body, {
                status: response.status,
                headers: newHeaders,
            });
        }

        // Handle check endpoint
        if (path === '/check') {
            if (request.method !== 'POST') {
                return new Response('Method not allowed', {
                    status: 405,
                    headers: corsHeaders()
                });
            }

            const bodyText = await request.text();
            const data = JSON.parse(bodyText);

            if (!data.applicationId) {
                return new Response('Missing application ID', {
                    status: 400,
                    headers: corsHeaders()
                });
            }

            // Forward to DO for validation
            const id = env.DISCORD_BOTS.idFromName(data.applicationId);
            const bot = env.DISCORD_BOTS.get(id);
            const response = await bot.fetch(new Request('http://internal/check'));

            const newHeaders = new Headers(response.headers);
            Object.entries(corsHeaders()).forEach(([key, value]) => {
                newHeaders.set(key, value);
            });

            return new Response(response.body, {
                status: response.status,
                headers: newHeaders,
            });
        }

        // Rest of your existing endpoints...
        if (path === '/interactions') {
            console.log('Received interaction request, forwarding to DO');
            const bodyText = await request.text();  // Read the body first
            const body = JSON.parse(bodyText);

            const id = env.DISCORD_BOTS.idFromName(body.application_id || 'default');
            const bot = env.DISCORD_BOTS.get(id);
            return bot.fetch(new Request(request.url, {
                method: request.method,
                headers: request.headers,
                body: bodyText
            }));
        }


        // Handle WebSocket and other requests
        const id = env.DISCORD_BOTS.idFromName(path.slice(1) || 'default');
        const bot = env.DISCORD_BOTS.get(id);
        return bot.fetch(request);
    }
};

// Durable Object Implementation
export class DiscordBot {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.clients = new Map();
        this.publicKey = null;
        this.token = null;
        this.applicationId = null;
        console.log('DO instance created');

    }

    async fetch(request) {
        // At the start of the DO's fetch method
        if (!this.publicKey) {
            this.publicKey = await this.state.storage.get('publicKey');
        }

        console.log('DO fetch handler called with full details:', {
            url: request.url,
            method: request.method,
            upgrade: request.headers.get("Upgrade"),
            protocol: request.headers.get("Sec-WebSocket-Protocol")
        });

        const url = new URL(request.url);
        const path = url.pathname;
        console.log('DO handling URL:', path);

        const createCommand = async (token, applicationId) => {
            const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: 'ping',
                    description: 'Replies with Pong!'
                }),
            });

            if (!response.ok) {
                throw new Error(`Error creating command: ${response.statusText}`);
            }
            return response.json();
        };

        try {
            // Handle WebSocket connections first
            const upgradeHeader = request.headers.get("Upgrade");
            if (upgradeHeader === "websocket") {
                console.log('DO received WebSocket upgrade request');
                return await this.handleWebSocket(request);
            }

            // Handle check endpoint
            if (path === '/check') {
                if (!this.token) {
                    this.token = await this.state.storage.get('token');
                }

                try {
                    const response = await fetch('https://discord.com/api/v10/applications/@me', {
                        headers: {
                            'Authorization': `Bot ${this.token}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        return new Response(JSON.stringify({
                            success: false,
                            message: 'Discord configuration invalid'
                        }), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    return new Response(JSON.stringify({
                        success: true,
                        message: 'Discord configuration valid'
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (err) {
                    return new Response(JSON.stringify({
                        success: false,
                        message: 'Failed to validate Discord configuration'
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
            // Add handler for internal public key requests
            if (path === '/getPublicKey') {
                console.log('Handling getPublicKey request');

                try {
                    if (!this.publicKey) {
                        console.log('Public key not in memory, fetching from storage');
                        this.publicKey = await this.state.storage.get('publicKey');
                        console.log('Retrieved public key:', this.publicKey);
                    }

                    if (!this.publicKey) {
                        console.log('No public key found in storage');
                        return new Response(JSON.stringify({
                            error: 'Public key not configured'
                        }), {
                            status: 404,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    return new Response(JSON.stringify({
                        publicKey: this.publicKey
                    }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (err) {
                    console.error('Error retrieving public key:', err);
                    return new Response(JSON.stringify({
                        error: 'Internal server error'
                    }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
            // Handle initialization
            if (path === '/init') {
                const data = await request.json();
                console.log("the initialization data is", data);

                await Promise.all([
                    this.state.storage.put('publicKey', data.publicKey),
                    this.state.storage.put('token', data.token),
                    this.state.storage.put('applicationId', data.applicationId)
                ]);

                this.publicKey = data.publicKey;
                this.token = data.token;
                this.applicationId = data.applicationId;

                // Add command registration here
                try {
                    await createCommand(data.token, data.applicationId);
                    console.log('Slash command registered successfully');
                } catch (err) {
                    console.error('Failed to register slash command:', err);
                    // Don't throw - we want init to succeed even if command registration fails
                }

                return new Response(JSON.stringify({
                    success: true,
                    message: `Please set your Interactions Endpoint URL to: https://discord-handler.sxp.digital/interactions`
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Handle interactions
            if (path === '/interactions') {
                console.log('Received interaction request');
                const signature = request.headers.get('x-signature-ed25519');
                const timestamp = request.headers.get('x-signature-timestamp');
                const bodyText = await request.text();
        
                if (!signature || !timestamp || !this.publicKey) {
                    console.error('Missing validation headers or public key:', {
                        hasSignature: !!signature,
                        hasTimestamp: !!timestamp,
                        hasPublicKey: !!this.publicKey
                    });
                    return new Response('Invalid request', { status: 401 });
                }
        
                const isValidRequest = verifyKey(
                    bodyText,
                    signature,
                    timestamp,
                    this.publicKey
                );
        
                if (!isValidRequest) {
                    return new Response('Invalid request signature', { status: 401 });
                }
        
                const body = JSON.parse(bodyText);
                console.log('Verified interaction:', body);
        
                // Handle interaction types
                if (body.type === 1) { // PING
                    return new Response(JSON.stringify({ type: 1 }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
        
                console.log(`Handling interaction type: ${body.type}`);

                // APPLICATION_COMMAND (type 2)
                if (body.type === 2) {
                    const commandName = body.data.name;
                    console.log(`Handling command: ${commandName}`);

                    return new Response(JSON.stringify({
                        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
                        data: {
                            content: `Received command: ${commandName}`
                        }
                    }), {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                }

                // MESSAGE_COMPONENT (type 3)
                if (body.type === 3) {
                    const componentId = body.data.custom_id;
                    console.log(`Handling component interaction: ${componentId}`);

                    return new Response(JSON.stringify({
                        type: 4,
                        data: {
                            content: `Component interaction received: ${componentId}`
                        }
                    }), {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                }

                // APPLICATION_COMMAND_AUTOCOMPLETE (type 4)
                if (body.type === 4) {
                    console.log('Handling autocomplete');

                    return new Response(JSON.stringify({
                        type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
                        data: {
                            choices: [] // Add your autocomplete choices here
                        }
                    }), {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                }

                // MODAL_SUBMIT (type 5)
                if (body.type === 5) {
                    const modalId = body.data.custom_id;
                    console.log(`Handling modal submission: ${modalId}`);

                    return new Response(JSON.stringify({
                        type: 4,
                        data: {
                            content: `Modal submission received: ${modalId}`
                        }
                    }), {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                }

                // Default response for unhandled interaction types
                console.log('Unhandled interaction type');
                return new Response(JSON.stringify({
                    type: 4,
                    data: {
                        content: 'Received interaction'
                    }
                }), {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            }

        } catch (err) {
            console.error('DO fetch error:', err);
            return new Response(err.message, { status: 500 });
        }

        return this.handleHttpRequest(request);
    }

    async handleWebSocket(request) {
        console.log('DO handleWebSocket starting');
        try {
            const protocol = request.headers.get('Sec-WebSocket-Protocol');
            console.log('WebSocket protocol:', protocol);

            if (!protocol || !protocol.startsWith('cf-discord-token.')) {
                throw new Error('Invalid WebSocket protocol');
            }

            const token = protocol.split('.')[1];
            console.log('Token extracted, length:', token?.length);

            const pair = new WebSocketPair();
            console.log('WebSocket pair created');

            const [client, server] = Object.values(pair);
            console.log('WebSocket pair split');

            const clientId = crypto.randomUUID();
            const clientInfo = {
                ws: server,
                token: token,
                clientId: clientId,
                pollInterval: null
            };

            // Add message handler BEFORE accepting the socket
            console.log('Setting up message handler');
            server.addEventListener("message", async (msg) => {
                console.log('WebSocket raw message received:', msg);
                try {
                    const data = JSON.parse(msg.data);
                    console.log('Parsed message:', data);

                    if (data.type === "init") {
                        console.log('Processing init message for:', data.channelId);
                        clientInfo.channelId = data.channelId;

                        clientInfo.pollInterval = setInterval(async () => {
                            try {
                                const response = await fetch(
                                    `https://discord.com/api/v10/channels/${data.channelId}/messages`,
                                    {
                                        headers: {
                                            'Authorization': `Bot ${clientInfo.token}`,
                                            'Content-Type': 'application/json'
                                        }
                                    }
                                );
                                if (!response.ok) {
                                    const error = await response.text();
                                    console.error('Discord API error:', error);
                                    return;
                                }

                                const messages = await response.json();
                                const relevantMessages = messages.filter(msg =>
                                    !msg.author.bot && (
                                        msg.mentions?.some(mention => mention.id === this.applicationId) ||
                                        msg.content.includes(`<@${this.applicationId}>`)
                                    )
                                );

                                if (relevantMessages.length > 0) {
                                    console.log('Sending messages to client:', relevantMessages);
                                    server.send(JSON.stringify({
                                        type: "messages",
                                        messages: relevantMessages
                                    }));
                                }
                            } catch (err) {
                                console.error('Polling error:', err);
                            }
                        }, 2000);

                        server.send(JSON.stringify({
                            type: "connected",
                            clientId: clientId
                        }));
                    }
                } catch (err) {
                    console.error('Message processing error:', err);
                }
            });

            // Accept socket AFTER setting up handlers
            await this.state.acceptWebSocket(server);
            console.log('WebSocket accepted, returning upgrade response');

            return new Response(null, {
                status: 101,
                webSocket: client,
                headers: {
                    'Upgrade': 'websocket',
                    'Connection': 'Upgrade',
                    'Sec-WebSocket-Protocol': protocol
                }
            });

        } catch (err) {
            console.error('WebSocket setup error:', err);
            return new Response(err.stack, { status: 500 });
        }
    }



    async sendDiscordMessage(clientInfo, data) {
        const response = await fetch(
            `https://discord.com/api/v10/channels/${clientInfo.channelId}/messages`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bot ${clientInfo.token}`,
                    "Content-Type": "application/json",
                    "X-Discord-Intents": "4096"
                },
                body: JSON.stringify({
                    content: data.content,
                    embeds: data.embed ? [data.embed] : []
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }

        const messageData = await response.json();
        clientInfo.ws.send(JSON.stringify({
            type: "message_sent",
            message: messageData
        }));
    }

    async handleHttpRequest(request) {
        // Proxy regular HTTP requests to Discord API
        const response = await fetch(`https://discord.com/api/v10${new URL(request.url).pathname}`, {
            method: request.method,
            headers: {
                ...request.headers,
                "Content-Type": "application/json"
            },
            body: request.method !== "GET" ? await request.text() : undefined
        });

        return new Response(await response.text(), {
            status: response.status,
            headers: {
                "Content-Type": "application/json",
                ...corsHeaders()
            }
        });
    }
}