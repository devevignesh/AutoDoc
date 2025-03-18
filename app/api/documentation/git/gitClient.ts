import { CommitInfo, DiffInfo } from "../types";
import { DOC_CONFIG } from "../config";

/**
 * Helper function to construct absolute URLs when in server environment
 * 
 * @param path - Relative path with query parameters
 * @returns Full URL with base URL when in server environment
 */
function constructApiUrl(path: string): string {
  // Determine if we're in a browser or server environment
  const isServer = typeof window === 'undefined';
  
  // In server environment, use an absolute URL with base URL
  if (isServer) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return `${baseUrl}${path}`;
  }
  
  // In browser environment, relative URL works fine
  return path;
}

/**
 * Get information about a specific commit
 *
 * @param commitId - Commit ID
 * @returns Promise with commit information
 */
export async function getCommitInfo(commitId: string): Promise<CommitInfo> {
  try {
    const url = constructApiUrl(`/api/git/commits?id=${commitId}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get commit info: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        `Failed to get commit info: ${data.error || "Unknown error"}`
      );
    }

    // Extract the commit info from the response
    const commitInfo: CommitInfo = {
      id: data.id,
      message: data.commit.message,
      author: {
        name: data.commit.author,
        email: data.commit.email
      },
      timestamp: data.commit.timestamp,
      files: data.commit.files
    };

    return commitInfo;
  } catch (error) {
    console.error("Error getting commit info:", error);
    throw new Error(
      `Failed to get commit info: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Get the diff for a specific commit
 * @param commitId The commit ID
 * @returns Object containing the diff and files affected
 */
export async function getCommitDiff(commitId: string): Promise<{ diff: string; files: string[] }> {
  try {
    // Use the API route to get the diff
    const url = constructApiUrl(`/api/git/diff?commit=${commitId}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      // Handle different error types
      if (response.status === 404) {
        throw new Error(`Commit not found: ${commitId}. Please verify the commit ID is correct and exists in the repository.`);
      } else {
        const errorData = await response.json();
        throw new Error(`Failed to get diff: ${errorData.error || response.statusText}`);
      }
    }
    
    const data = await response.json();
    
    return {
      diff: data.diff || '',
      files: data.files || []
    };
  } catch (error) {
    console.error('Error fetching commit diff:', error);
    throw error;
  }
}

/**
 * Get the content of a file at a specific commit
 *
 * @param filePath - File path
 * @param commitId - Commit ID (optional, defaults to HEAD)
 * @returns Promise with file content
 */
export async function getFileContent(
  filePath: string,
  commitId?: string
): Promise<string> {
  try {
    const path = commitId
      ? `/api/git/file?path=${encodeURIComponent(filePath)}&commitId=${commitId}`
      : `/api/git/file?path=${encodeURIComponent(filePath)}`;
    
    const url = constructApiUrl(path);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get file content: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        `Failed to get file content: ${data.error || "Unknown error"}`
      );
    }

    return data.content;
  } catch (error) {
    console.error("Error getting file content:", error);
    throw new Error(
      `Failed to get file content: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Get the dependencies of a file
 *
 * @param filePath - File path
 * @returns Promise with dependencies
 */
export async function getFileDependencies(filePath: string): Promise<string[]> {
  try {
    const url = constructApiUrl(`/api/git/dependencies?path=${encodeURIComponent(filePath)}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to get file dependencies: ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        `Failed to get file dependencies: ${data.error || "Unknown error"}`
      );
    }

    return data.dependencies;
  } catch (error) {
    console.error("Error getting file dependencies:", error);
    return [];
  }
}

/**
 * Get all internal dependencies recursively (non third-party)
 *
 * @param filePath - Root file path
 * @param visitedFiles - Set of already processed files to prevent circular dependencies
 * @returns Promise with all internal dependencies
 */
export async function getInternalDependencies(
  filePath: string,
  visitedFiles: Set<string> = new Set()
): Promise<string[]> {
  if (visitedFiles.has(filePath)) {
    return []; // Prevent circular dependencies
  }
  
  visitedFiles.add(filePath);
  
  try {
    // Get the direct dependencies of the file
    const url = constructApiUrl(`/api/git/dependencies?path=${encodeURIComponent(filePath)}&internalOnly=true`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to get internal dependencies: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`Failed to get internal dependencies: ${data.error || "Unknown error"}`);
    }
    
    // The internalDependencies should now have file extensions properly resolved
    // and external dependencies should be filtered out
    const internalDeps = data.internalDependencies || [];
    
    // Filter out any invalid paths (should already be done on the server, but just in case)
    const validInternalDeps = internalDeps.filter(
      (dep: string) => dep && dep.trim() !== '' && !dep.startsWith('@') && dep !== filePath
    );
    
    const allDeps = [...validInternalDeps];
    
    // Recursively get dependencies of each internal dependency
    for (const depPath of validInternalDeps) {
      if (!visitedFiles.has(depPath)) {
        const nestedDeps = await getInternalDependencies(depPath, visitedFiles);
        for (const nestedDep of nestedDeps) {
          if (!allDeps.includes(nestedDep)) {
            allDeps.push(nestedDep);
          }
        }
      }
    }
    
    return allDeps;
  } catch (error) {
    console.error("Error getting internal dependencies:", error);
    return [];
  }
}

/**
 * Check if a file should be documented
 *
 * @param filePath - File path
 * @returns Whether the file should be documented
 */
export function shouldDocumentFile(filePath: string): boolean {
  // Check if file has a supported extension
  const hasValidExtension = DOC_CONFIG.SUPPORTED_EXTENSIONS.some(ext =>
    filePath.endsWith(ext)
  );

  // Check if file is in an excluded directory
  const isInExcludedDir = DOC_CONFIG.EXCLUDED_DIRS.some(
    dir => filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`)
  );

  return hasValidExtension && !isInExcludedDir;
}

/**
 * Filter affected files to only include those that should be documented
 * 
 * @param diffInfo Either a DiffInfo object or an object with diff and files properties
 * @returns Array of file paths that should be documented
 */
export function getAffectedFiles(diffInfo: DiffInfo | { diff: string; files: string[] }): string[] {
  // Filter the files to only include those that should be documented
  return diffInfo.files.filter(file => shouldDocumentFile(file));
}

/**
 * Get the file type from a file path
 *
 * @param filePath - File path
 * @returns File type (e.g., 'typescript', 'javascript', etc.)
 */
export function getFileType(filePath: string): string {
  const extension = filePath.split(".").pop() || "";

  const extensionMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    go: "go",
    java: "java",
    rb: "ruby",
    php: "php",
    cs: "csharp",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    swift: "swift",
    kt: "kotlin",
    rs: "rust",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "fish",
    sql: "sql",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    md: "markdown",
    markdown: "markdown"
  };

  return extensionMap[extension] || extension || "text";
}

/**
 * Get business logic changes across versions for a specific file
 *
 * @param filePath - File path to check
 * @param limit - Maximum number of commits to return (default: 10)
 * @returns Promise with business logic changes information
 */
export async function getBusinessLogicHistory(
  filePath: string,
  limit: number = 10
): Promise<{ 
  commits: Array<{
    id: string;
    message: string;
    date: string;
    authorName: string;
    businessLogicChanged: boolean;
    description: string;
  }>;
}> {
  try {
    // Fetch the file history from the API
    const url = constructApiUrl(`/api/git/history?path=${encodeURIComponent(filePath)}&limit=${limit}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get file history: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        `Failed to get file history: ${data.error || "Unknown error"}`
      );
    }

    // Process each commit to determine if it contains business logic changes
    const processedCommits = [];
    
    for (const commit of data.commits) {
      // Get the diff for this specific commit for this file
      const diffUrl = constructApiUrl(
        `/api/git/diff?commit=${commit.id}&path=${encodeURIComponent(filePath)}`
      );
      const diffResponse = await fetch(diffUrl);
      
      if (!diffResponse.ok) {
        continue; // Skip if we can't get the diff
      }
      
      const diffData = await diffResponse.json();
      const diff = diffData.diff || '';
      
      // Analyze the diff to determine if business logic was changed
      // We'll look for patterns that likely indicate business logic changes
      const businessLogicChanged = isBusinessLogicChange(diff);
      
      processedCommits.push({
        id: commit.id,
        message: commit.message,
        date: commit.date,
        authorName: commit.author,
        businessLogicChanged,
        description: generateChangeDescription(diff, businessLogicChanged)
      });
    }
    
    return { commits: processedCommits };
  } catch (error) {
    console.error("Error getting business logic history:", error);
    return { commits: [] };
  }
}

/**
 * Determine if a diff contains business logic changes
 * This is a heuristic approach that looks for patterns typically associated with business logic
 * 
 * @param diff - The diff content to analyze
 * @returns boolean indicating if business logic likely changed
 */
function isBusinessLogicChange(diff: string): boolean {
  // Look for typical patterns that indicate business logic changes
  const businessLogicPatterns = [
    // Function implementations (not just signature changes)
    /\+\s*function\s+\w+\s*\([^)]*\)\s*{[^}]+}/,
    
    // Method implementations in classes
    /\+\s*\w+\s*\([^)]*\)\s*{[^}]+}/,
    
    // Conditional logic
    /\+\s*(if|else|switch|case|while|for)/,
    
    // Variable assignments that appear to contain logic (not just initialization)
    /\+\s*\w+\s*=\s*([^;]+[+\-*/&|!?:]|function|\([^)]*\)\s*=>)/,
    
    // Exported constants that define business rules
    /\+\s*export\s+const\s+\w+\s*=/,
    
    // Regular expressions (often used for validation logic)
    /\+\s*\/[^/]+\/[gimsuy]*/,
    
    // Database or API queries
    /\+\s*(query|select|insert|update|delete|findOne|findById|save|create)/i,
    
    // State updates in React/front-end
    /\+\s*(setState|dispatch|useReducer|useState)/
  ];
  
  return businessLogicPatterns.some(pattern => pattern.test(diff));
}

/**
 * Generate a description of changes based on diff analysis
 * 
 * @param diff - The diff content
 * @param isBusinessLogic - Whether the change is considered business logic
 * @returns Description of the change
 */
function generateChangeDescription(diff: string, isBusinessLogic: boolean): string {
  if (!isBusinessLogic) {
    return "Minor changes (documentation, formatting, or imports)";
  }
  
  // Look for specific business logic change patterns and generate appropriate descriptions
  if (/\+\s*if\s*\([^)]+\)/.test(diff)) {
    return "Added conditional logic";
  }
  
  if (/\+\s*for\s*\([^)]+\)/.test(diff)) {
    return "Added loop or iteration";
  }
  
  if (/\+\s*function\s+\w+\s*\([^)]*\)/.test(diff)) {
    return "Added or modified function implementation";
  }
  
  if (/\+\s*export\s+const\s+\w+\s*=/.test(diff)) {
    return "Modified business constants or configuration";
  }
  
  if (/\+\s*switch\s*\([^)]+\)/.test(diff)) {
    return "Changed switch statement or case handling";
  }
  
  if (/\+\s*try\s*{/.test(diff)) {
    return "Added error handling logic";
  }
  
  if (/\+\s*\w+\s*=\s*\([^)]*\)\s*=>/.test(diff)) {
    return "Modified function implementation or callback";
  }
  
  // Default description for other business logic changes
  return "Modified business logic implementation";
}
