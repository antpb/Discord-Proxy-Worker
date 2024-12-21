#!/bin/bash

# Check for wrangler installation
# if ! command -v wrangler &> /dev/null; then
#     echo "Installing wrangler..."
#     npm install -g wrangler
# fi

# Login to Cloudflare if not already logged in
# echo "Ensuring you're logged into Cloudflare..."
# wrangler login

# Create wrangler.toml if it doesn't exist
if [ ! -f wrangler.toml ]; then
    echo "Creating wrangler.toml..."
    cat > wrangler.toml << EOF
name = "discord-bot-proxy"
main = "src/index.js"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "DISCORD_BOTS", class_name = "DiscordBot" }
]

[[migrations]]
tag = "v1"
new_classes = ["DiscordBot"]
EOF
fi

# Create the worker
echo "Creating Discord Bot Proxy worker..."
wrangler deploy

# Create and apply the Durable Object migration
echo "Applying Durable Object migrations..."
wrangler migrations apply

echo "Setup complete! Your Discord Bot Proxy worker is ready."
echo "Your worker should be available at: https://discord-bot-proxy.<your-subdomain>.workers.dev"