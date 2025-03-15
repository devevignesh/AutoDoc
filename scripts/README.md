# Documentation Generator

This tool automatically generates documentation for your codebase using AI and updates Confluence pages accordingly.

## Prerequisites

- Node.js and npm installed
- TypeScript and ts-node installed (`npm install -g typescript ts-node`)
- A running local Next.js server (`npm run dev`)
- Confluence API credentials set in your environment variables

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```
# Confluence Configuration
CONFLUENCE_EMAIL=your-email@example.com
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net
CONFLUENCE_DOCUMENTATION_SPACE_ID=SPACEID
CONFLUENCE_DOCUMENTATION_PARENT_PAGE_ID=123456
```

## Usage

You can run the documentation generator in several ways:

### Using npm script

```bash
# Show help
npm run docs help

# Document a specific file
npm run docs file app/api/confluence/pages/route.ts

# Document all supported files in a directory
npm run docs path app/api

# Document files changed in a specific commit
npm run docs commit abc1234

# Document files changed in recent commits
npm run docs recent

# Document all predefined paths
npm run docs all
```

### Using the shell script

```bash
# Make sure the script is executable
chmod +x scripts/docs.sh

# Show help
./scripts/docs.sh help

# Document a specific file
./scripts/docs.sh file app/api/confluence/pages/route.ts

# Document all supported files in a directory
./scripts/docs.sh path app/api

# Document files changed in a specific commit
./scripts/docs.sh commit abc1234

# Document files changed in recent commits
./scripts/docs.sh recent

# Document all predefined paths
./scripts/docs.sh all
```

## How It Works

1. The script calls the documentation API endpoints in your local Next.js server
2. The API uses AI to analyze your code and generate documentation
3. The documentation is then created or updated in Confluence

## Customization

You can customize the script by editing the `CONFIG` object in `scripts/generate-docs.ts`:

- `baseUrl`: The base URL of your local API endpoints
- `confluence`: Confluence settings
- `paths`: Predefined paths to document
- `git`: Git settings

## Troubleshooting

- Make sure your local Next.js server is running (`npm run dev`)
- Check that your Confluence API credentials are correctly set in `.env.local`
- Ensure you have the necessary permissions to access the Confluence space 