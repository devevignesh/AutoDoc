# Confluence API Integration

This directory contains API routes for interacting with Atlassian Confluence.

## Setup

1. Create a `.env.local` file in the root of your project with the following variables:

```
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_EMAIL=your-atlassian-email
```

2. To generate an API token, visit: https://id.atlassian.com/manage-profile/security/api-tokens

## API Endpoints

### Create a Confluence Page

**Endpoint:** `POST /api/confluence/pages`

**Request Body:**

```json
{
  "spaceId": "SPACE123",
  "title": "My Page Title",
  "content": "<p>This is the page content in storage format</p>",
  "parentId": "123456" // Optional
}
```

**Response:**

```json
{
  "success": true,
  "page": {
    // Confluence page object
  }
}
```

### Update a Confluence Page

**Endpoint:** `PUT /api/confluence/pages`

**Request Body:**

```json
{
  "pageId": "123456",
  "title": "Updated Page Title",
  "content": "<p>Updated page content</p>",
  "version": 2,
  "versionMessage": "Updated via API" // Optional
}
```

**Response:**

```json
{
  "success": true,
  "page": {
    // Updated Confluence page object
  }
}
```

### Get a Confluence Page by ID

**Endpoint:** `GET /api/confluence/pages?pageId=123456`

**Response:**

```json
{
  "success": true,
  "page": {
    // Confluence page object
  }
}
```

### Get All Pages in a Space

**Endpoint:** `GET /api/confluence/pages?spaceId=SPACE123`

**Query Parameters:**

- `limit` (optional): Number of results to return (default: 25)
- `cursor` (optional): Cursor for pagination
- `title` (optional): Filter pages by title
- `status` (optional): Filter pages by status (default: "current")

**Response:**

```json
{
  "success": true,
  "pages": [
    // Array of Confluence page objects
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "cursor-token"
  }
}
```

## Error Handling

All endpoints return appropriate HTTP status codes and error messages:

```json
{
  "error": "Error message",
  "details": "Detailed error information"
}
```

## Important Notes

1. The Confluence API URL structure requires `/wiki/api/v2/` in the path. Make sure your `CONFLUENCE_BASE_URL` environment variable is set to the base domain (e.g., `https://your-domain.atlassian.net`) without the `/wiki` part.

2. Authentication is done using Basic Auth with your Atlassian email and API token. Ensure that the email address is correct and matches the one associated with your Atlassian account.

3. The API token must have the appropriate permissions to access and modify Confluence pages.

## References

- [Atlassian Confluence REST API v2 Documentation](https://developer.atlassian.com/cloud/confluence/rest/v2/intro/) 