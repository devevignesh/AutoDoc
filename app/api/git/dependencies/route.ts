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

// Helper function to check if a path is an internal dependency (not a third-party package)
function isInternalDependency(importPath: string): boolean {
  // Check for relative paths
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    return true;
  }
  
  // Check for absolute paths from project root
  if (importPath.startsWith('/')) {
    return true;
  }
  
  // Check for imports using the @/ notation (internal aliased imports)
  if (importPath.startsWith('@/')) {
    return true;
  }
  
  // Check for paths that are likely to be from the project structure
  // This helps with cases where the import might not use typical patterns
  const internalPathPatterns = [
    '/components/',
    '/lib/',
    '/app/',
    '/pages/',
    '/utils/',
    '/hooks/',
    '/services/',
    '/api/',
    '/config/',
    '/constants/',
    '/contexts/',
    '/data/',
    '/interfaces/',
    '/layouts/',
    '/models/',
    '/redux/',
    '/store/',
    '/styles/',
    '/types/',
    '/views/'
  ];
  
  return internalPathPatterns.some(pattern => importPath.includes(pattern));
}

// Helper function to extract imports from JavaScript/TypeScript files
function extractJsImports(content: string): { all: string[], internal: string[] } {
  const allImports: string[] = [];
  const internalImports: string[] = [];
  
  // Match ES6 imports
  const es6ImportRegex = /import\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = es6ImportRegex.exec(content)) !== null) {
    if (match[1]) {
      allImports.push(match[1]);
      
      // Check if it's an internal dependency
      if (isInternalDependency(match[1])) {
        internalImports.push(match[1]);
      }
    }
  }
  
  // Match require statements
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  
  while ((match = requireRegex.exec(content)) !== null) {
    if (match[1]) {
      allImports.push(match[1]);
      
      // Check if it's an internal dependency
      if (isInternalDependency(match[1])) {
        internalImports.push(match[1]);
      }
    }
  }
  
  return { 
    all: [...new Set(allImports)], 
    internal: [...new Set(internalImports)]
  };
}

// Helper function to resolve relative paths to absolute paths
function resolveRelativePath(basePath: string, relativePath: string): string {
  // Handle @/ imports (internal alias imports)
  if (relativePath.startsWith('@/')) {
    // Map @/ paths to actual project paths
    const withoutAt = relativePath.replace(/^@\//, '');
    
    // Try both root path and src path (common setups)
    const possiblePaths = [
      path.join(process.cwd(), withoutAt),
      path.join(process.cwd(), 'src', withoutAt),
      path.join(process.cwd(), 'app', withoutAt),
      path.join(process.cwd(), 'components', withoutAt)
    ];
    
    // Check each possible path with different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    
    for (const possiblePath of possiblePaths) {
      // Try the path as is (if it has an extension)
      if (path.extname(possiblePath) && fs.existsSync(possiblePath)) {
        // Convert to relative path from cwd
        return path.relative(process.cwd(), possiblePath);
      }
      
      // Try with extensions
      for (const ext of extensions) {
        const pathWithExt = possiblePath + ext;
        if (fs.existsSync(pathWithExt)) {
          return path.relative(process.cwd(), pathWithExt);
        }
      }
      
      // Try with /index files
      for (const ext of extensions) {
        const indexPath = path.join(possiblePath, `index${ext}`);
        if (fs.existsSync(indexPath)) {
          return path.relative(process.cwd(), indexPath);
        }
      }
    }
    
    // If we couldn't resolve it, return the original path
    return relativePath;
  }
  
  // If it's other third-party module with @ (like @radix-ui), return empty string
  if (relativePath.startsWith('@') && !relativePath.startsWith('@/')) {
    return ''; // Return empty string to indicate it's not a resolvable internal path
  }
  
  // If it's an absolute path, convert to relative to cwd
  if (relativePath.startsWith('/')) {
    const absPath = path.join(process.cwd(), relativePath);
    return path.relative(process.cwd(), absPath);
  }
  
  // Otherwise, resolve relative to the base path
  const baseDir = path.dirname(basePath);
  const resolvedPath = path.join(baseDir, relativePath);
  
  // Handle common file extensions if not specified
  if (!path.extname(resolvedPath)) {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
      const pathWithExt = resolvedPath + ext;
      if (fs.existsSync(path.join(process.cwd(), pathWithExt))) {
        return pathWithExt;
      }
    }
    
    // Try with index files
    for (const ext of extensions) {
      const indexPath = path.join(resolvedPath, `index${ext}`);
      if (fs.existsSync(path.join(process.cwd(), indexPath))) {
        return indexPath;
      }
    }
  }
  
  return resolvedPath;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get('path');
    const internalOnly = searchParams.get('internalOnly') === 'true';
    
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
    let internalDependencies: string[] = [];
    
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || 
        filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const imports = extractJsImports(content);
      dependencies = imports.all;
      
      // Resolve internal dependencies to absolute paths
      const resolvedInternalDeps = imports.internal
        .map(imp => resolveRelativePath(filePath, imp))
        .filter(path => path !== ''); // Filter out empty paths (third-party modules)
      
      internalDependencies = resolvedInternalDeps;
    }
    // Add support for other file types as needed
    
    return NextResponse.json({ 
      success: true,
      path: filePath,
      dependencies,
      internalDependencies: internalOnly ? internalDependencies : undefined
    });
  } catch (error) {
    console.error('Error analyzing file dependencies:', error);
    return NextResponse.json(
      { error: 'Failed to analyze file dependencies', details: (error as Error).message },
      { status: 500 }
    );
  }
} 