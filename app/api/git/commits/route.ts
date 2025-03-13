import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get('limit') || '10';
    const branch = searchParams.get('branch') || 'HEAD';
    
    // Validate limit is a number
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum <= 0) {
      return NextResponse.json(
        { error: 'Limit must be a positive number' },
        { status: 400 }
      );
    }

    // Validate branch name to prevent command injection
    if (!/^[0-9a-zA-Z\.\-\_\/]+$/.test(branch)) {
      return NextResponse.json(
        { error: 'Invalid branch name format' },
        { status: 400 }
      );
    }

    // Get the recent commits
    const { stdout } = await execPromise(
      `git log ${branch} --pretty=format:'{"hash":"%h","fullHash":"%H","author":"%an","date":"%ad","message":"%s"}' -n ${limitNum}`
    );
    
    // Parse the JSON objects from each line
    const commits = stdout
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        try {
          // Replace any escaped single quotes that might cause JSON parsing issues
          const cleanLine = line.replace(/^'|'$/g, '').replace(/\\'/g, "'");
          return JSON.parse(cleanLine);
        } catch (e) {
          console.error('Error parsing commit line:', line, e);
          return null;
        }
      })
      .filter(commit => commit !== null);
    
    return NextResponse.json({ 
      success: true,
      branch,
      limit: limitNum,
      commits 
    });
  } catch (error) {
    console.error('Error fetching git commits:', error);
    return NextResponse.json(
      { error: 'Failed to fetch git commits', details: (error as Error).message },
      { status: 500 }
    );
  }
} 