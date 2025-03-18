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
    const filePath = searchParams.get('path');
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    
    if (!filePath) {
      return NextResponse.json(
        { error: 'File path is required' },
        { status: 400 }
      );
    }

    // Validate file path to prevent path traversal
    if (!isValidFilePath(filePath)) {
      return NextResponse.json(
        { error: 'Invalid file path format' },
        { status: 400 }
      );
    }

    // Get file history using git log
    try {
      const { stdout } = await execPromise(
        `git log -n ${limit} --pretty=format:"%H|%an|%ad|%s" --date=iso -- "${filePath}"`,
        { cwd: process.cwd() }
      );

      if (!stdout) {
        return NextResponse.json(
          { success: true, commits: [] },
          { status: 200 }
        );
      }

      // Parse the commit history
      const commits = stdout.split('\n').map(line => {
        const [id, author, date, ...messageParts] = line.split('|');
        const message = messageParts.join('|'); // In case message contains our delimiter
        
        return {
          id,
          author,
          date,
          message
        };
      });

      return NextResponse.json({ 
        success: true,
        path: filePath,
        commits
      });
    } catch (gitError) {
      console.error('Git error:', gitError);
      return NextResponse.json(
        { error: 'Failed to retrieve file history', details: (gitError as Error).message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error retrieving file history:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve file history', details: (error as Error).message },
      { status: 500 }
    );
  }
} 