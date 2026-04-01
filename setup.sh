#!/bin/bash
set -e

echo "🔧 TeamBlind Scraper — Setup"
echo "=============================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo ""
    echo "❌ Node.js is not installed."
    echo "   Please install Node.js v18 or above from: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -e "process.exit(parseInt(process.versions.node.split('.')[0]))" 2>/dev/null; echo $?)
MAJOR=$(node -e "console.log(parseInt(process.versions.node.split('.')[0]))")
if [ "$MAJOR" -lt 18 ]; then
    echo ""
    echo "❌ Node.js v$MAJOR detected. v18 or above is required."
    echo "   Please upgrade: https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node --version) detected."

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Check credentials
echo ""
if [ ! -f credentials.json ]; then
    echo "⚠️  credentials.json not found."
    echo "   Please edit credentials.json and fill in your TeamBlind login(s) before running."
else
    echo "✅ credentials.json found."
    echo ""
    echo "   Make sure it contains your real TeamBlind account details, e.g.:"
    echo '   {'
    echo '     "1": { "email": "you@example.com", "password": "yourpassword" }'
    echo '   }'
    echo "   The key (\"1\", \"2\", etc.) is the account number you pass via --account 1."
fi

# Install Playwright browsers
echo ""
echo "🌐 Installing Playwright browsers..."
npx playwright install chromium

echo ""
echo "=============================="
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit credentials.json with your TeamBlind account(s)"
echo "  2. Run the pipeline:"
echo ""
echo "     # Collect URLs for mega companies (10k+ posts)"
echo "     npm run pick:10k:collect"
echo ""
echo "     # Scrape post details for mega companies"
echo "     npm run pick:10k -- --account 1"
echo ""
echo "     # Scrape post details for 1k–10k companies"
echo "     npm run pick:1k -- --account 1"
echo ""
echo "     # With proxy (if needed)"
echo "     npm run pick:1k -- --account 1 --proxy socks5://127.0.0.1:18080"
echo ""
