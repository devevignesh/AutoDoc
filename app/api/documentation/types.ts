/**
 * Types for the documentation system
 */

// Request types
export interface DocumentationRequest {
  action: 'generate' | 'update';
  commitId?: string;
  filePath?: string;
  spaceId: string;
  parentPageId?: string;
  pageId?: string;
}

// Result types
export interface DocumentationResult {
  success: boolean;
  pageId?: string;
  message: string;
  updates?: { filePath: string; pageId: string; status: string }[];
}

// Context types
export interface FileContext {
  content: string;
  path: string;
  dependencies: string[];
}

export interface DocumentationContext {
  fileContext: FileContext;
  previousDocumentation?: string;
  commitDiff?: string;
}

// Confluence types
export interface ConfluenceCredentials {
  email: string;
  apiToken: string;
  baseUrl: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  version: {
    number: number;
  };
  body: {
    storage: {
      value: string;
      representation: 'storage';
    };
  };
}

export interface ConfluencePageRequest {
  spaceId: string;
  title: string;
  content: string;
  parentId?: string;
}

export interface ConfluencePageUpdateRequest {
  id: string;
  title: string;
  content: string;
  version: number;
}

// Git types
export interface CommitInfo {
  id: string;
  message: string;
  author: {
    name: string;
    email: string;
  };
  timestamp: string;
  files: string[];
}

export interface DiffInfo {
  commitId: string;
  diff: string;
  files: string[];
}

// Options types
export interface DocumentationOptions {
  commitId: string;
  filePath: string;
  spaceId: string;
  parentPageId?: string;
} 