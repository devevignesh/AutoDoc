import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

// Helper function to validate file paths to prevent path traversal
function isValidFilePath(filePath: string): boolean {
  // Disallow paths with ".." to prevent directory traversal
  if (filePath.includes('..')) {
    return false;
  }
  
  // Only allow alphanumeric characters, dots, dashes, underscores, and forward slashes
  return /^[0-9a-zA-Z\.\-\_\/]+$/.test(filePath);
}

// Helper function to extract imports from JavaScript/TypeScript files
function extractJsImports(content: string): string[] {
  const imports: string[] = [];
  
  // Match ES6 imports
  const es6ImportRegex = /import\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = es6ImportRegex.exec(content)) !== null) {
    if (match[1] && !match[1].startsWith('.')) {
      imports.push(match[1]);
    }
  }
  
  // Match require statements
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  
  while ((match = requireRegex.exec(content)) !== null) {
    if (match[1] && !match[1].startsWith('.')) {
      imports.push(match[1]);
    }
  }
  
  return [...new Set(imports)]; // Remove duplicates
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get('path');
    
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

    // Get file content
    let content: string;
    try {
      content = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
    } catch (fileError) {
      return NextResponse.json(
        { error: 'File not found or cannot be read', details: (fileError as Error).message },
        { status: 404 }
      );
    }
    
    // Extract dependencies based on file type
    let dependencies: string[] = [];
    
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || 
        filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      dependencies = extractJsImports(content);
    }
    // Add support for other file types as needed
    
    return NextResponse.json({ 
      success: true,
      path: filePath,
      dependencies
    });
  } catch (error) {
    console.error('Error analyzing file dependencies:', error);
    return NextResponse.json(
      { error: 'Failed to analyze file dependencies', details: (error as Error).message },
      { status: 500 }
    );
  }
} 