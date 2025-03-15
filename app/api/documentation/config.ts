/**
 * Configuration for the AutoDoc documentation system
 */

// Confluence configuration
export const CONFLUENCE_CONFIG = {
  // The Confluence space ID where documentation will be stored
  SPACE_ID: process.env.CONFLUENCE_DOCUMENTATION_SPACE_ID || "",
  
  // The parent page ID under which all documentation pages will be created
  PARENT_PAGE_ID: process.env.CONFLUENCE_DOCUMENTATION_PARENT_PAGE_ID || "",
  
  // Base URL for the Confluence instance
  BASE_URL: process.env.CONFLUENCE_BASE_URL || "https://your-domain.atlassian.net",
  
  // API version to use
  API_VERSION: "v2"
};

// Git configuration
export const GIT_CONFIG = {
  // The repository URL
  REPO_URL: process.env.GIT_REPO_URL || "",
  
  // The branch to monitor for changes
  MAIN_BRANCH: process.env.GIT_MAIN_BRANCH || "main",
  
  // Webhook secret for verifying incoming webhook requests
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || ""
};

// Documentation configuration
export const DOC_CONFIG = {
  // File extensions to document
  SUPPORTED_EXTENSIONS: [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb"],
  
  // Directories to exclude from documentation
  EXCLUDED_DIRS: ["node_modules", ".git", "dist", "build", ".next", "__pycache__"],
  
  // Maximum file size to process (in bytes)
  MAX_FILE_SIZE: 500000, // 500KB
  
  // Documentation template sections
  SECTIONS: {
    OVERVIEW: "Overview",
    DEPENDENCIES: "Dependencies",
    FUNCTIONS: "Functions and Methods",
    CLASSES: "Classes and Interfaces",
    USAGE: "Usage Examples",
    CONFIGURATION: "Configuration Options"
  }
};

// AI configuration
export const AI_CONFIG = {
  // Model to use for documentation generation
  MODEL: process.env.AI_MODEL || "gpt-4",
  
  // Maximum tokens for AI requests
  MAX_TOKENS: 4000,
  
  // Temperature for AI requests
  TEMPERATURE: 0.2
};

// Export all configurations
export default {
  CONFLUENCE: CONFLUENCE_CONFIG,
  GIT: GIT_CONFIG,
  DOC: DOC_CONFIG,
  AI: AI_CONFIG
}; 