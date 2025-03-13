# Git API Endpoints

This directory contains API endpoints for interacting with Git repositories.

## Available Endpoints

### Get Diff for a Specific Commit

```
GET /api/git/diff?commit={commitHash}
```

Returns the diff for a specific commit.

**Parameters:**
- `commit` (required): The commit hash to get the diff for (7-40 hexadecimal characters)

**Example Response:**
```json
{
  "success": true,
  "commit": "abc1234",
  "diff": "... git diff output ..."
}
```

### Compare Diffs Between Two References

```
GET /api/git/diff/compare?base={baseRef}&head={headRef}
```

Returns the diff between two Git references (commits, branches, or tags).

**Parameters:**
- `base` (required): The base reference
- `head` (required): The head reference to compare against the base

**Example Response:**
```json
{
  "success": true,
  "base": "main",
  "head": "feature-branch",
  "diff": "... git diff output ..."
}
```

### List Recent Commits

```
GET /api/git/commits?limit={limit}&branch={branch}
```

Returns a list of recent commits.

**Parameters:**
- `limit` (optional): The number of commits to return (default: 10)
- `branch` (optional): The branch to get commits from (default: HEAD)

**Example Response:**
```json
{
  "success": true,
  "branch": "main",
  "limit": 10,
  "commits": [
    {
      "hash": "abc1234",
      "fullHash": "abc1234def5678...",
      "author": "John Doe",
      "date": "Mon Apr 1 12:34:56 2023 +0000",
      "message": "Fix bug in login form"
    },
    ...
  ]
}
``` 