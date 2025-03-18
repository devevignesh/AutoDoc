import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Helper function to validate file paths to prevent path traversal
function isValidFilePath(filePath: string): boolean {
  // Disallow paths with ".." to prevent directory traversal
  if (filePath.includes('..')) {
    return false;
  }
  
  // Only allow alphanumeric characters, dots, dashes, underscores, and forward slashes
  return /^[0-9a-zA-Z\.\-\_\/]+$/.test(filePath);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const commitId = searchParams.get('commit');
    const filePath = searchParams.get('path');
    
    if (!commitId) {
      return NextResponse.json(
        { error: 'Commit ID is required' },
        { status: 400 }
      );
    }

    // Validate commit ID format
    if (!/^[0-9a-f]{5,40}$/i.test(commitId)) {
      return NextResponse.json(
        { error: 'Invalid commit ID format' },
        { status: 400 }
      );
    }

    // If filePath is provided, validate it
    if (filePath && !isValidFilePath(filePath)) {
      return NextResponse.json(
        { error: 'Invalid file path format' },
        { status: 400 }
      );
    }

    // Execute git commands to get the diff
    try {
      // First, check if the commit exists in the repository
      try {
        const { stdout: revParseOutput } = await execPromise(
          `git rev-parse --verify ${commitId}^{commit}`,
          { 
            cwd: process.cwd(),
            maxBuffer: 1024 * 1024 // 1MB buffer
          }
        );
        
        // If we get here, the commit exists
        console.log(`Commit ${commitId} verified: ${revParseOutput.trim()}`);
      } catch (revParseError) {
        // The commit doesn't exist
        console.error('Commit verification error:', revParseError);
        return NextResponse.json(
          { 
            error: 'Commit not found in repository', 
            details: 'The specified commit ID does not exist in this repository. Please check the commit ID and try again.',
            commitId
          },
          { status: 404 }
        );
      }
      
      // If we get here, the commit exists, so proceed with the diff
      // If path is specified, get diff just for that file
      const gitCommand = filePath 
        ? `git show --patch --unified=3 ${commitId} -- "${filePath}"`
        : `git show --patch --unified=3 --name-status ${commitId}`;
      
      const { stdout } = await execPromise(gitCommand, { 
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large diffs
      });
      
      // For full commit diffs (no file path specified), extract the list of changed files
      let files: string[] = [];
      
      if (!filePath) {
        // Extract the list of files that were changed in this commit
        // This regex looks for lines with a file status and filename
        const fileRegex = /^([AMDRT])\s+(.+)$/gm;
        let match;
        
        while ((match = fileRegex.exec(stdout)) !== null) {
          if (match[2]) {
            files.push(match[2]);
          }
        }
      } else {
        // If specific file requested, just include that in the files list
        files = [filePath];
      }

      return NextResponse.json({ 
        commitId,
        diff: stdout,
        files,
      });
    } catch (gitError) {
      console.error('Git error:', gitError);
      return NextResponse.json(
        { error: 'Failed to get diff', details: (gitError as Error).message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error getting diff:', error);
    return NextResponse.json(
      { error: 'Failed to get diff', details: (error as Error).message },
      { status: 500 }
    );
  }
} 