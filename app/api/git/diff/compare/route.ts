import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Helper function to validate git references (commit hashes, branch names, tags)
function isValidGitRef(ref: string): boolean {
  // Allow alphanumeric characters, dots, dashes, underscores, and slashes (for branch names)
  return /^[0-9a-zA-Z\.\-\_\/]+$/.test(ref);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const base = searchParams.get('base');
    const head = searchParams.get('head');
    
    if (!base || !head) {
      return NextResponse.json(
        { error: 'Both base and head references are required' },
        { status: 400 }
      );
    }

    // Validate git references to prevent command injection
    if (!isValidGitRef(base) || !isValidGitRef(head)) {
      return NextResponse.json(
        { error: 'Invalid git reference format' },
        { status: 400 }
      );
    }

    // Get the diff between the two references
    const { stdout } = await execPromise(`git diff ${base}..${head}`);
    
    return NextResponse.json({ 
      success: true,
      base,
      head,
      diff: stdout 
    });
  } catch (error) {
    console.error('Error fetching git diff comparison:', error);
    return NextResponse.json(
      { error: 'Failed to fetch git diff comparison', details: (error as Error).message },
      { status: 500 }
    );
  }
} 