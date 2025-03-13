import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const commitHash = searchParams.get('commit');
    
    if (!commitHash) {
      return NextResponse.json(
        { error: 'Commit hash is required' },
        { status: 400 }
      );
    }

    // Validate commit hash format to prevent command injection
    if (!/^[0-9a-f]{7,40}$/.test(commitHash)) {
      return NextResponse.json(
        { error: 'Invalid commit hash format' },
        { status: 400 }
      );
    }

    // Get the diff for the specific commit
    const { stdout } = await execPromise(`git show --pretty=format:"%h - %an, %ar : %s" --patch ${commitHash}`);
    
    return NextResponse.json({ 
      success: true,
      commit: commitHash,
      diff: stdout 
    });
  } catch (error) {
    console.error('Error fetching git diff:', error);
    return NextResponse.json(
      { error: 'Failed to fetch git diff', details: (error as Error).message },
      { status: 500 }
    );
  }
} 