import { NextRequest, NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import axios from "axios";
import { z } from "zod";
import { CONFLUENCE_CONFIG, DOC_CONFIG } from "../config";

// Types for our documentation system
interface DocumentationRequest {
  commitId?: string;
  filePath?: string;
  action: "generate" | "update";
  spaceId: string;
  parentPageId?: string;
}

interface FileContext {
  content: string;
  path: string;
  dependencies?: string[];
}

interface DocumentationContext {
  previousDocumentation?: string;
  fileContext: FileContext;
  commitDiff?: string;
}

interface DocumentationResult {
  success: boolean;
  pageId?: string;
  message: string;
  updates?: { filePath: string; pageId: string; status: string }[];
}

interface DocumentationOptions {
  commitId: string;
  filePath: string;
  spaceId: string;
  parentPageId?: string;
}

// Main handler for documentation requests
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    
    // Validate request
    if (!body.spaceId) {
      return NextResponse.json(
        { error: "Missing required parameter: spaceId" },
        { status: 400 }
      );
    }
    
    if (!body.filePath && !body.commitId) {
      return NextResponse.json(
        { error: "Either filePath or commitId must be provided" },
        { status: 400 }
      );
    }

    // Set up the agent with tools
    const { text, toolCalls, steps } = await generateText({
      model: openai('gpt-4o', { structuredOutputs: true }),
      maxSteps: 10, // Allow up to 10 steps for complex documentation tasks
      system: `You are an expert documentation generator that creates comprehensive documentation for code files.
               Your goal is to analyze code, understand its purpose, and create clear, accurate documentation.
               Use the available tools to fetch file content, analyze dependencies, and create or update documentation in Confluence.`,
      prompt: `Generate documentation for ${body.filePath || `files changed in commit ${body.commitId}`}.
              Space ID: ${body.spaceId}
              ${body.parentPageId ? `Parent Page ID: ${body.parentPageId}` : ''}
              Action: ${body.action || 'generate'}`,
      tools: {
        // Tool to get file content
        getFileContent: tool({
          description: "Get the content of a file",
          parameters: z.object({
            filePath: z.string().describe("Path to the file"),
            commitId: z.string().optional().describe("Optional commit ID to get file at specific commit")
          }),
          execute: async ({ filePath, commitId }) => {
            try {
              const url = commitId
                ? `/api/git/file?path=${encodeURIComponent(filePath)}&commitId=${commitId}`
                : `/api/git/file?path=${encodeURIComponent(filePath)}`;
              
              const response = await axios.get(url);
              return response.data.content;
            } catch (error) {
              console.error('Error getting file content:', error);
              return `Error: Could not retrieve file content for ${filePath}`;
            }
          }
        }),
        
        // Tool to get commit diff
        getCommitDiff: tool({
          description: "Get the diff for a specific commit",
          parameters: z.object({
            commitId: z.string().describe("Commit hash")
          }),
          execute: async ({ commitId }) => {
            try {
              const response = await axios.get(`/api/git/diff?commit=${commitId}`);
              return response.data.diff;
            } catch (error) {
              console.error('Error getting commit diff:', error);
              return `Error: Could not retrieve diff for commit ${commitId}`;
            }
          }
        }),
        
        // Tool to get affected files from a commit
        getAffectedFiles: tool({
          description: "Get the list of files affected by a commit",
          parameters: z.object({
            commitId: z.string().describe("Commit hash")
          }),
          execute: async ({ commitId }) => {
            try {
              const response = await axios.get(`/api/git/diff?commit=${commitId}`);
              const diff = response.data.diff;
              
              // Extract file paths from diff
              const fileRegex = /^diff --git a\/(.*?) b\/(.*?)$/gm;
              const files = new Set<string>();
              let match;
              
              while ((match = fileRegex.exec(diff)) !== null) {
                // Use the b/ path as it represents the new file state
                files.add(match[2]);
              }
              
              // Filter files based on supported extensions
              return Array.from(files).filter(file => {
                const extension = file.split('.').pop() || '';
                return DOC_CONFIG.SUPPORTED_EXTENSIONS.includes(`.${extension}`);
              });
            } catch (error) {
              console.error('Error getting affected files:', error);
              return [];
            }
          }
        }),
        
        // Tool to create a Confluence page
        createConfluencePage: tool({
          description: "Create a new page in Confluence",
          parameters: z.object({
            spaceId: z.string().describe("Confluence space ID"),
            title: z.string().describe("Page title"),
            content: z.string().describe("Page content in Confluence storage format"),
            parentId: z.string().optional().describe("Parent page ID (optional)")
          }),
          execute: async ({ spaceId, title, content, parentId }) => {
            try {
              const response = await axios.post("/api/confluence/pages", {
                spaceId,
                title,
                content,
                parentId
              });
              
              return {
                success: true,
                pageId: response.data.page.id,
                title: response.data.page.title
              };
            } catch (error) {
              console.error('Error creating Confluence page:', error);
              return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              };
            }
          }
        }),
        
        // Tool to update a Confluence page
        updateConfluencePage: tool({
          description: "Update an existing page in Confluence",
          parameters: z.object({
            pageId: z.string().describe("Page ID"),
            title: z.string().describe("Page title"),
            content: z.string().describe("Page content in Confluence storage format"),
            version: z.number().describe("Page version number")
          }),
          execute: async ({ pageId, title, content, version }) => {
            try {
              const response = await axios.put("/api/confluence/pages", {
                pageId,
                title,
                content,
                version: version + 1,
                versionMessage: "Updated by documentation agent"
              });
              
              return {
                success: true,
                pageId: response.data.page.id,
                title: response.data.page.title
              };
            } catch (error) {
              console.error('Error updating Confluence page:', error);
              return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              };
            }
          }
        }),
        
        // Tool to get a Confluence page
        getConfluencePage: tool({
          description: "Get a page from Confluence by ID",
          parameters: z.object({
            pageId: z.string().describe("Page ID")
          }),
          execute: async ({ pageId }) => {
            try {
              const response = await axios.get(`/api/confluence/pages?pageId=${pageId}`);
              return response.data.page;
            } catch (error) {
              console.error('Error getting Confluence page:', error);
              return null;
            }
          }
        }),
        
        // Tool to find a documentation page by title
        findDocumentationPage: tool({
          description: "Find a documentation page by title in a specific space",
          parameters: z.object({
            spaceId: z.string().describe("Confluence space ID"),
            title: z.string().describe("Page title to search for")
          }),
          execute: async ({ spaceId, title }) => {
            try {
              const response = await axios.get(
                `/api/confluence/pages?spaceId=${spaceId}&title=${encodeURIComponent(title)}`
              );
              
              const pages = response.data.pages;
              if (pages && pages.length > 0) {
                // Find the page with the exact title
                const page = pages.find((p: { title: string }) => p.title === title);
                return page || null;
              }
              
              return null;
            } catch (error) {
              console.error('Error finding documentation page:', error);
              return null;
            }
          }
        }),
        
        // Tool to convert Markdown to Confluence storage format
        markdownToConfluence: tool({
          description: "Convert Markdown content to Confluence storage format",
          parameters: z.object({
            markdown: z.string().describe("Markdown content")
          }),
          execute: async ({ markdown }) => {
            // In a real implementation, you would use a proper converter
            // For now, we'll just wrap the content in a preformatted block
            return `<ac:structured-macro ac:name="html">
              <ac:plain-text-body><![CDATA[
            ${markdown}
              ]]></ac:plain-text-body>
            </ac:structured-macro>`;
          }
        })
      }
    });

    // Return the results
    return NextResponse.json({
      success: true,
      result: text,
      toolCalls,
      steps: steps.length
    });
  } catch (error: unknown) {
    console.error("Error in documentation agent:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Documentation agent error", details: errorMessage },
      { status: 500 }
    );
  }
}

// Generate new documentation for a file
async function generateDocumentation(
  commitId: string,
  options: DocumentationOptions
): Promise<DocumentationResult | null> {
  try {
    // 1. Get file content
    const fileContent = await getFileContent(options.filePath!);
    
    // 2. Analyze file dependencies
    const dependencies = await analyzeDependencies(options.filePath!);
    
    // 3. Build documentation context
    const context: DocumentationContext = {
      fileContext: {
        content: fileContent,
        path: options.filePath!,
        dependencies
      }
    };
    
    // 4. Generate documentation using AI
    const documentation = await generateDocumentationWithAI(context);
    
    // 5. Create Confluence page
    const pageId = await createConfluencePage(
      options.spaceId,
      getPageTitle(options.filePath!),
      documentation,
      options.parentPageId
    );
    
    return {
      success: true,
      pageId,
      message: "Documentation generated successfully"
    };
  } catch (error: unknown) {
    console.error("Error generating documentation:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return null;
  }
}

// Update existing documentation based on code changes
async function updateDocumentation(
  commitId: string,
  options: DocumentationOptions
): Promise<DocumentationResult | null> {
  try {
    // 1. Get commit diff
    const diff = await getCommitDiff(commitId);
    
    // 2. Extract affected files from diff
    const affectedFiles = extractAffectedFiles(diff);
    
    // 3. For each affected file, update its documentation
    const updates = await Promise.all(
      affectedFiles.map(async (filePath) => {
        // Find existing documentation page for this file
        const existingPageId = await findDocumentationPage(options.spaceId, getPageTitle(filePath));
        
        if (!existingPageId) {
          // If no documentation exists, generate new one
          return generateDocumentation(commitId, {
            ...options,
            filePath
          });
        }
        
        // Get existing documentation
        const existingDoc = await getConfluencePage(existingPageId);
        
        // Get current file content
        const fileContent = await getFileContent(filePath);
        
        // Build update context
        const context: DocumentationContext = {
          previousDocumentation: existingDoc,
          fileContext: {
            content: fileContent,
            path: filePath
          },
          commitDiff: getFileDiff(diff, filePath)
        };
        
        // Generate updated documentation
        const updatedDoc = await updateDocumentationWithAI(context);
        
        // Update Confluence page
        await updateConfluencePage(existingPageId, getPageTitle(filePath), updatedDoc);
        
        return {
          filePath,
          pageId: existingPageId,
          status: "updated"
        };
      })
    );
    
    return {
      success: true,
      updates,
      message: "Documentation updated successfully"
    };
  } catch (error: unknown) {
    console.error("Error updating documentation:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return null;
  }
}

// Helper functions

// Get file content from the filesystem
async function getFileContent(filePath: string): Promise<string> {
  try {
    const response: Response = await fetch(`/api/git/file?path=${encodeURIComponent(filePath)}`);
    const content = await response.text();
    return content || "";
  } catch (error) {
    console.error("Error fetching file content:", error);
    return "";
  }
}

// Analyze dependencies of a file
async function analyzeDependencies(filePath: string): Promise<string[]> {
  try {
    const response: Response = await fetch(`/api/git/dependencies?path=${encodeURIComponent(filePath)}`);
    const dependencies = await response.json();
    return dependencies;
  } catch (error) {
    console.error("Error analyzing dependencies:", error);
    return [];
  }
}

// Generate documentation using AI
async function generateDocumentationWithAI(context: DocumentationContext): Promise<string> {
  // This is where we'll integrate with an AI model to generate documentation
  // For now, return a placeholder
  return `<h1>Documentation for ${context.fileContext.path}</h1>
<p>This is automatically generated documentation.</p>`;
}

// Update documentation using AI
async function updateDocumentationWithAI(context: DocumentationContext): Promise<string> {
  // This is where we'll integrate with an AI model to update documentation
  // For now, return a placeholder
  return context.previousDocumentation || "Updated documentation";
}

// Get commit diff from Git API
async function getCommitDiff(commitId: string): Promise<string> {
  try {
    const response = await axios.get(`/api/git/diff?commit=${commitId}`);
    return response.data.diff;
  } catch (error) {
    console.error("Error fetching commit diff:", error);
    throw new Error("Failed to fetch commit diff");
  }
}

// Extract affected files from a diff
function extractAffectedFiles(diff: string): string[] {
  // This is a placeholder - in a real implementation, you would parse the diff to extract file paths
  return ["app/example.ts"];
}

// Get diff for a specific file from the full commit diff
function getFileDiff(fullDiff: string, filePath: string): string {
  // This is a placeholder - in a real implementation, you would extract the specific file's diff
  return fullDiff;
}

// Create a Confluence page
async function createConfluencePage(
  spaceId: string,
  title: string,
  content: string,
  parentId?: string
): Promise<string> {
  try {
    const response = await axios.post("/api/confluence/pages", {
      spaceId,
      title,
      content,
      parentId
    });
    
    return response.data.page.id;
  } catch (error) {
    console.error("Error creating Confluence page:", error);
    throw new Error("Failed to create Confluence page");
  }
}

// Update a Confluence page
async function updateConfluencePage(
  pageId: string,
  title: string,
  content: string
): Promise<void> {
  try {
    // First, get the current page to get its version
    const currentPage = await getConfluencePage(pageId);
    const version = currentPage.version.number;
    
    await axios.put("/api/confluence/pages", {
      pageId,
      title,
      content,
      version: version + 1,
      versionMessage: "Updated by documentation agent"
    });
  } catch (error) {
    console.error("Error updating Confluence page:", error);
    throw new Error("Failed to update Confluence page");
  }
}

// Get a Confluence page
async function getConfluencePage(pageId: string): Promise<any> {
  try {
    const response = await axios.get(`/api/confluence/pages?pageId=${pageId}`);
    return response.data.page;
  } catch (error) {
    console.error("Error fetching Confluence page:", error);
    throw new Error("Failed to fetch Confluence page");
  }
}

// Find a documentation page by title
async function findDocumentationPage(spaceId: string, title: string): Promise<string | null> {
  try {
    const response = await axios.get(`/api/confluence/pages?spaceId=${spaceId}&title=${encodeURIComponent(title)}`);
    
    const pages = response.data.pages;
    if (pages && pages.length > 0) {
      // Find the page with the exact title
      const page = pages.find((p: any) => p.title === title);
      return page ? page.id : null;
    }
    
    return null;
  } catch (error) {
    console.error("Error finding documentation page:", error);
    return null;
  }
}

// Generate a page title from a file path
function getPageTitle(filePath: string): string {
  // Extract the filename without extension
  const filename = filePath.split('/').pop() || filePath;
  const nameWithoutExt = filename.split('.').slice(0, -1).join('.');
  
  // Format it nicely
  return `Documentation: ${nameWithoutExt}`;
} 