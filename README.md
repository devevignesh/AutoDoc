# AutoDoc: Automated Documentation System

AutoDoc is a system that automatically generates and updates documentation in Confluence based on code changes. It monitors your Git repository for changes and uses AI to create comprehensive documentation for your codebase.

## Features

- **Automated Documentation Generation**: Automatically creates documentation for your code files
- **Git Integration**: Monitors your repository for changes and updates documentation accordingly
- **Confluence Integration**: Stores all documentation in your Confluence space
- **AI-Powered**: Uses advanced AI models to generate high-quality documentation
- **Webhook Support**: Integrates with GitHub/GitLab webhooks to trigger documentation updates

## Setup

### Prerequisites

- Confluence account with API access
- Git repository
- Environment variables configured (see below)

### Environment Variables

Create a `.env.local` file with the following variables:

```
# Confluence Configuration
CONFLUENCE_EMAIL=your-email@example.com
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net
CONFLUENCE_DOCUMENTATION_SPACE_ID=SPACEID
CONFLUENCE_DOCUMENTATION_PARENT_PAGE_ID=123456

# Git Configuration
GIT_REPO_URL=https://github.com/yourusername/yourrepo
GIT_MAIN_BRANCH=main
WEBHOOK_SECRET=your-webhook-secret

# AI Configuration
AI_MODEL=gpt-4
```

### Webhook Setup

1. Go to your repository settings in GitHub/GitLab
2. Add a new webhook with the URL: `https://your-app-url.com/api/documentation/webhook`
3. Set the content type to `application/json`
4. Set the secret to match your `WEBHOOK_SECRET` environment variable
5. Select the events you want to trigger documentation updates (typically `push` events)

## API Endpoints

### Generate Documentation

```
POST /api/documentation/agent
```

Request body:
```json
{
  "action": "generate",
  "filePath": "path/to/file.ts",
  "spaceId": "SPACEID",
  "parentPageId": "123456"
}
```

### Update Documentation

```
POST /api/documentation/agent
```

Request body:
```json
{
  "action": "update",
  "pageId": "123456",
  "commitId": "abc123def456",
  "spaceId": "SPACEID"
}
```

The update workflow will:
1. Validate that a valid page ID and commit ID are provided
2. Retrieve the commit details and diff to identify changed files
3. Analyze the page content to determine which file it's documenting
4. If the file was changed in the commit, update the documentation with those changes
5. Add a "Change History" section with commit IDs as citations for proper version tracking
6. Update the Confluence page with the new content

How it works:
- The system identifies which file the documentation page corresponds to (based on page title/content)
- It retrieves the file content at the specific commit and analyzes the changes
- It updates the documentation to reflect those changes, including a history section
- No file path is needed as the system determines this automatically from the page and commit

### Webhook Endpoint

```
POST /api/documentation/webhook
```

This endpoint is called by GitHub/GitLab when changes are pushed to your repository.

## Configuration

You can customize the documentation system by modifying the `config.ts` file:

- **Supported File Extensions**: Add or remove file types to document
- **Excluded Directories**: Specify directories to exclude from documentation
- **Documentation Sections**: Customize the sections included in documentation
- **AI Parameters**: Adjust the AI model parameters for documentation generation

## How It Works

1. When code is pushed to your repository, the webhook is triggered
2. The system analyzes the changes to identify affected files
3. For each affected file, the system:
   - Retrieves the file content
   - Analyzes dependencies and context
   - Generates documentation using AI
   - Creates or updates the corresponding Confluence page
4. All documentation is organized in your Confluence space under the specified parent page

## Troubleshooting

- **Webhook Not Triggering**: Verify your webhook configuration and check the logs
- **Documentation Not Updating**: Ensure your Confluence API token has sufficient permissions
- **Missing Dependencies**: Make sure all required environment variables are set

## License

MIT 