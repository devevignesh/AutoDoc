import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  // Base URL for local API endpoints
  baseUrl: 'http://localhost:3000',
  
  // Confluence settings
  confluence: {
    spaceId: process.env.CONFLUENCE_DOCUMENTATION_SPACE_ID || '',
    parentPageId: process.env.CONFLUENCE_DOCUMENTATION_PARENT_PAGE_ID || '',
  },
  
  // Paths to document
  paths: [
    'app/api/confluence/pages/route.ts',
    'app/api/git/diff/route.ts',
    'components/calendar-view.tsx',
  ],
  
  // Git settings
  git: {
    // Number of recent commits to check
    recentCommits: 5,
  }
};

/**
 * Main function to run the documentation generator
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  
  switch (command) {
    case 'file':
      await documentFile(args[1]);
      break;
    case 'path':
      await documentPath(args[1]);
      break;
    case 'commit':
      await documentCommit(args[1]);
      break;
    case 'recent':
      await documentRecentCommits();
      break;
    case 'all':
      await documentAllPaths();
      break;
    case 'help':
    default:
      showHelp();
      break;
  }
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Documentation Generator Script

Usage:
  npm run docs [command] [args]

Commands:
  file [filePath]       Generate documentation for a specific file
  path [dirPath]        Generate documentation for all supported files in a directory
  commit [commitId]     Generate documentation for files changed in a specific commit
  recent                Generate documentation for files changed in recent commits
  all                   Generate documentation for all predefined paths
  help                  Show this help information

Examples:
  npm run docs file app/api/confluence/pages/route.ts
  npm run docs path app/api
  npm run docs commit abc1234
  npm run docs recent
  npm run docs all
  `);
}

/**
 * Document a specific file
 */
async function documentFile(filePath?: string) {
  if (!filePath) {
    console.error('Error: File path is required');
    return;
  }
  
  console.log(`Generating documentation for file: ${filePath}`);
  
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      return;
    }
    
    // Call the documentation API
    const response = await axios.post(`${CONFIG.baseUrl}/api/documentation/agent`, {
      filePath,
      action: 'generate',
      spaceId: CONFIG.confluence.spaceId,
      parentPageId: CONFIG.confluence.parentPageId
    });
    
    console.log('Documentation generated successfully:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // Also try the structured documentation API
    console.log('\nGenerating structured documentation...');
    const structuredResponse = await axios.post(`${CONFIG.baseUrl}/api/documentation/structured`, {
      filePath
    });
    
    console.log('Structured documentation generated:');
    console.log(JSON.stringify(structuredResponse.data, null, 2));
  } catch (error) {
    console.error('Error generating documentation:', error);
  }
}

/**
 * Document all supported files in a directory
 */
async function documentPath(dirPath?: string) {
  if (!dirPath) {
    console.error('Error: Directory path is required');
    return;
  }
  
  console.log(`Generating documentation for all supported files in: ${dirPath}`);
  
  try {
    // Check if directory exists
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      console.error(`Error: Directory not found: ${dirPath}`);
      return;
    }
    
    // Get all files in the directory recursively
    const files = getAllFiles(dirPath);
    
    // Filter for supported file types
    const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    const supportedFiles = files.filter(file => 
      supportedExtensions.includes(path.extname(file))
    );
    
    console.log(`Found ${supportedFiles.length} supported files`);
    
    // Document each file
    for (const file of supportedFiles) {
      await documentFile(file);
    }
  } catch (error) {
    console.error('Error documenting directory:', error);
  }
}

/**
 * Document files changed in a specific commit
 */
async function documentCommit(commitId?: string) {
  if (!commitId) {
    console.error('Error: Commit ID is required');
    return;
  }
  
  console.log(`Generating documentation for files changed in commit: ${commitId}`);
  
  try {
    // Call the documentation API
    const response = await axios.post(`${CONFIG.baseUrl}/api/documentation/agent`, {
      commitId,
      action: 'update',
      spaceId: CONFIG.confluence.spaceId,
      parentPageId: CONFIG.confluence.parentPageId
    });
    
    console.log('Documentation generated successfully:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error generating documentation for commit:', error);
  }
}

/**
 * Document files changed in recent commits
 */
async function documentRecentCommits() {
  console.log(`Generating documentation for files changed in recent commits`);
  
  try {
    // Get recent commit IDs
    const commitIds = getRecentCommitIds(CONFIG.git.recentCommits);
    
    console.log(`Found ${commitIds.length} recent commits`);
    
    // Document each commit
    for (const commitId of commitIds) {
      await documentCommit(commitId);
    }
  } catch (error) {
    console.error('Error documenting recent commits:', error);
  }
}

/**
 * Document all predefined paths
 */
async function documentAllPaths() {
  console.log('Generating documentation for all predefined paths');
  
  try {
    for (const filePath of CONFIG.paths) {
      await documentFile(filePath);
    }
  } catch (error) {
    console.error('Error documenting all paths:', error);
  }
}

/**
 * Get all files in a directory recursively
 */
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);
  
  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    
    if (fs.statSync(fullPath).isDirectory()) {
      // Skip node_modules and .git directories
      if (file !== 'node_modules' && file !== '.git' && file !== '.next') {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      arrayOfFiles.push(fullPath);
    }
  });
  
  return arrayOfFiles;
}

/**
 * Get recent commit IDs
 */
function getRecentCommitIds(count: number): string[] {
  try {
    const output = execSync(`git log -n ${count} --pretty=format:"%H"`).toString();
    return output.split('\n');
  } catch (error) {
    console.error('Error getting recent commit IDs:', error);
    return [];
  }
}

// Run the script
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 