import { CommitInfo, DiffInfo } from '../types';
import { DOC_CONFIG } from '../config';

/**
 * Get information about a specific commit
 * 
 * @param commitId - Commit ID
 * @returns Promise with commit information
 */
export async function getCommitInfo(commitId: string): Promise<CommitInfo> {
  try {
    const response = await fetch(`/api/git/commits?id=${commitId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get commit info: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`Failed to get commit info: ${data.error || 'Unknown error'}`);
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
    console.error('Error getting commit info:', error);
    throw new Error(`Failed to get commit info: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the diff for a specific commit
 * 
 * @param commitId - Commit ID
 * @returns Promise with diff information
 */
export async function getCommitDiff(commitId: string): Promise<DiffInfo> {
  try {
    const response = await fetch(`/api/git/diff?commit=${commitId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get commit diff: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting commit diff:', error);
    throw new Error(`Failed to get commit diff: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the content of a file at a specific commit
 * 
 * @param filePath - File path
 * @param commitId - Commit ID (optional, defaults to HEAD)
 * @returns Promise with file content
 */
export async function getFileContent(filePath: string, commitId?: string): Promise<string> {
  try {
    const url = commitId
      ? `/api/git/file?path=${encodeURIComponent(filePath)}&commitId=${commitId}`
      : `/api/git/file?path=${encodeURIComponent(filePath)}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to get file content: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`Failed to get file content: ${data.error || 'Unknown error'}`);
    }
    
    return data.content;
  } catch (error) {
    console.error('Error getting file content:', error);
    throw new Error(`Failed to get file content: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const response = await fetch(`/api/git/dependencies?path=${encodeURIComponent(filePath)}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get file dependencies: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`Failed to get file dependencies: ${data.error || 'Unknown error'}`);
    }
    
    return data.dependencies;
  } catch (error) {
    console.error('Error getting file dependencies:', error);
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
  const isInExcludedDir = DOC_CONFIG.EXCLUDED_DIRS.some(dir => 
    filePath.includes(`/${dir}/`) || filePath.startsWith(`${dir}/`)
  );
  
  return hasValidExtension && !isInExcludedDir;
}

/**
 * Extract affected files from a diff that should be documented
 * 
 * @param diff - Diff information
 * @returns Array of file paths that should be documented
 */
export function getAffectedFiles(diff: DiffInfo): string[] {
  return diff.files.filter(shouldDocumentFile);
}

/**
 * Get the file type from a file path
 * 
 * @param filePath - File path
 * @returns File type (e.g., 'typescript', 'javascript', etc.)
 */
export function getFileType(filePath: string): string {
  const extension = filePath.split('.').pop() || '';
  
  const extensionMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'go': 'go',
    'java': 'java',
    'rb': 'ruby',
    'php': 'php',
    'cs': 'csharp',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'swift': 'swift',
    'kt': 'kotlin',
    'rs': 'rust',
    'scala': 'scala',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'fish': 'fish',
    'sql': 'sql',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'md': 'markdown',
    'markdown': 'markdown'
  };
  
  return extensionMap[extension] || extension || 'text';
} 