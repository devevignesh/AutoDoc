import { NextRequest, NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createConfluencePage, markdownToConfluence, getConfluencePage, updateConfluencePage, findDocumentationPage, getPageTitle } from "../confluence/confluenceClient";
import { DocumentationRequest } from "../types";
import { getFileContent, getInternalDependencies, getBusinessLogicHistory, getCommitInfo, getCommitDiff } from "../git/gitClient";
import { log } from "@/lib/utils";
import { DEFAULT_TEMPERATURE, DEFAULT_MODEL } from "@/lib/constants";

/**
 * POST handler for documentation
 */
export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const data: DocumentationRequest = await request.json();

    // Validate the request
    if (!data || !data.action) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields in request"
        },
        { status: 400 }
      );
    }

    // Log the request
    log("info", "Documentation request received", {
      action: data.action,
      filePath: data.filePath,
      spaceId: data.spaceId,
    });

    // Handle the request based on the action
    if (data.action === "generate") {
      return await handleGenerateDocument(data);
    } else if (data.action === "update") {
      return await handleUpdateDocument(data);
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid action specified"
        },
        { status: 400 }
      );
    }
  } catch (error) {
    // Log and return error
    log("error", "Error in documentation handler", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json(
      {
        success: false,
        error: "Error processing documentation request",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

/**
 * Handle document generation
 */
async function handleGenerateDocument(data: DocumentationRequest) {
  const { filePath, spaceId, parentPageId } = data;

  if (!filePath || !spaceId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Missing required fields for document generation: filePath and spaceId"
      },
      { status: 400 }
    );
  }

  try {
    // Step 1: Get file content and dependencies
    log("info", "Getting file content and dependencies", { filePath });
    const [fileContent, dependencies] = await Promise.all([
      getFileContent(filePath),
      getInternalDependencies(filePath)
    ]);

    // Step 2: Process dependencies to get their content
    const dependencyContents = await Promise.all(
      dependencies.map(async depPath => {
        try {
          // Skip if the path is a third-party dependency
          if (depPath.startsWith("@") && !depPath.startsWith("@/")) {
            log("info", `Skipping third-party dependency: ${depPath}`);
            return null;
          }

          const content = await getFileContent(depPath);
          return {
            path: depPath,
            content,
            filename: depPath.split("/").pop() || depPath,
            originalImport: depPath.includes("components/")
              ? `@/components/${depPath.split("components/")[1]}`
              : depPath.includes("lib/")
              ? `@/lib/${depPath.split("lib/")[1]}`
              : depPath
          };
        } catch (error) {
          log("warn", `Could not retrieve content for dependency ${depPath}`, {
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            path: depPath,
            content: "",
            filename: depPath.split("/").pop() || depPath,
            error:
              error instanceof Error
                ? error.message
                : "Failed to retrieve content"
          };
        }
      })
    );

    // Filter out null results (third-party dependencies that were skipped)
    const filteredDependencyContents = dependencyContents.filter(Boolean);

    // Step 3: Generate documentation using LLM
    log("info", "Generating documentation with LLM");
    const documentationMarkdown = await generateDocumentation(
      filePath,
      fileContent,
      filteredDependencyContents.filter(dep => dep !== null).map(dep => ({
        path: dep.path,
        content: dep.content,
        filename: dep.filename,
        originalImport: dep.originalImport || ""
      }))
    );

    // Step 4: Convert markdown to Confluence format
    log("info", "Converting markdown to Confluence format");
    const confluenceContent = markdownToConfluence(documentationMarkdown);

    // Step 5: Create Confluence page
    log("info", "Creating Confluence page", {
      spaceId,
      contentLength: confluenceContent.length
    });

    // Generate a suitable title for the page based on the file path
    const fileName = filePath.split("/").pop() || filePath;
    const pageTitle = `${fileName} Documentation`;

    const pageId = await createConfluencePage(
      spaceId,
      pageTitle,
      confluenceContent,
      parentPageId
    );

    log("info", "Successfully created Confluence page", { pageId });

    // Return success response
    return NextResponse.json(
      {
        success: true,
        pageId,
        title: pageTitle,
        message: "Documentation generated and published successfully."
      },
      { status: 200 }
    );
  } catch (error) {
    log("error", "Error generating documentation", {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate documentation",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

/**
 * Handle document update
 */
async function handleUpdateDocument(data: DocumentationRequest) {
  const { pageId, commitId, spaceId } = data;

  // Validate the essential parameters for update
  if (!pageId) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing required field for document update: pageId"
      },
      { status: 400 }
    );
  }

  // Space ID is needed for Confluence operations
  if (!spaceId) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing required field: spaceId"
      },
      { status: 400 }
    );
  }

  if (!commitId) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing required field: commitId - needed to identify changes to update"
      },
      { status: 400 }
    );
  }

  try {
    // Step 1: Get commit details and diff to identify changed files
    log("info", "Getting commit details", { commitId });
    let commitDetails;
    let commitDiff;
    
    try {
      [commitDetails, commitDiff] = await Promise.all([
        getCommitInfo(commitId),
        getCommitDiff(commitId)
      ]);
    } catch (error) {
      log("error", "Failed to retrieve commit information", { 
        commitId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return NextResponse.json(
        {
          success: false,
          error: "Failed to retrieve commit information. Please verify the commit ID is valid."
        },
        { status: 400 }
      );
    }
    
    if (!commitDiff || !commitDiff.files || commitDiff.files.length === 0) {
      log("warn", "No file changes found in the commit", { commitId });
      return NextResponse.json(
        {
          success: false,
          error: "No file changes found in the specified commit"
        },
        { status: 400 }
      );
    }

    // Step 2: Get existing page content
    log("info", "Getting existing page content", { pageId });
    const existingPage = await getConfluencePage(pageId);
    
    if (!existingPage) {
      log("error", "Could not find the specified page", { pageId });
      return NextResponse.json(
        {
          success: false,
          error: "The specified page could not be found in Confluence"
        },
        { status: 404 }
      );
    }

    // Step 3: Identify the file being documented on this page
    // This could be determined from page title, content, or metadata
    // For this implementation, we'll assume the page title or content contains the file path
    // A more robust implementation would maintain a mapping in a database
    
    // Extract potentially documented files from the commit diff
    const changedFiles = commitDiff.files;
    log("info", "Files changed in commit:", { files: changedFiles });
    
    // Try to identify the main file this page is documenting
    // This is a simplified approach - in a real system, you might store this mapping
    const possibleFilePath = identifyDocumentedFile(existingPage, changedFiles);
    
    if (!possibleFilePath) {
      log("warn", "Could not identify which file this page documents", { pageId });
      return NextResponse.json(
        {
          success: false,
          error: "Could not determine which file this documentation page corresponds to"
        },
        { status: 400 }
      );
    }
    
    log("info", "Identified documented file", { filePath: possibleFilePath });

    // Step 4: Get file content and dependencies
    const fileContent = await getFileContent(possibleFilePath, commitId);
    log("info", "Retrieved file content at commit", { filePath: possibleFilePath, commitId });
    
    // Step 5: Get dependencies
    const dependencies = await getInternalDependencies(possibleFilePath);
    log("info", "Retrieved dependencies", { dependencyCount: dependencies.length });

    // Step 6: Process dependencies to get their content
    const dependencyContents = await Promise.all(
      dependencies.map(async depPath => {
        try {
          if (depPath.startsWith("@") && !depPath.startsWith("@/")) {
            return null; // Skip third-party dependencies
          }

          const content = await getFileContent(depPath, commitId);
          return {
            path: depPath,
            content,
            filename: depPath.split("/").pop() || depPath,
            originalImport: depPath.includes("components/")
              ? `@/components/${depPath.split("components/")[1]}`
              : depPath.includes("lib/")
              ? `@/lib/${depPath.split("lib/")[1]}`
              : depPath
          };
        } catch (error) {
          log("warn", `Could not retrieve content for dependency ${depPath}`, {
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        }
      })
    );

    // Filter out null results
    const filteredDependencyContents = dependencyContents.filter(Boolean);

    // Step 7: Get business logic history for the file
    const businessLogicHistory = await getBusinessLogicHistory(possibleFilePath, 10);
    log("info", "Retrieved business logic history", { 
      filePath: possibleFilePath,
      commitCount: businessLogicHistory.commits.length 
    });

    // Step 8: Generate updated documentation
    log("info", "Generating updated documentation with LLM");
    const documentationMarkdown = await generateUpdatedDocumentation(
      possibleFilePath,
      fileContent,
      filteredDependencyContents.map(dep => ({
        path: dep?.path || "",
        content: dep?.content || "",
        filename: dep?.filename || "",
        originalImport: dep?.originalImport || ""
      })),
      existingPage,
      businessLogicHistory,
      commitDetails,
      commitDiff
    );

    // Step 9: Convert markdown to Confluence format
    log("info", "Converting markdown to Confluence format");
    const confluenceContent = markdownToConfluence(documentationMarkdown);

    // Step 10: Update Confluence page
    log("info", "Updating Confluence page", { pageId });
    const updatedPageId = await updateConfluencePage(
      pageId,
      existingPage.title,
      confluenceContent,
      existingPage.version.number
    );

    log("info", "Successfully updated Confluence page", { pageId: updatedPageId });

    // Return success response
    return NextResponse.json(
      {
        success: true,
        pageId: updatedPageId,
        title: existingPage.title,
        message: "Documentation updated successfully based on commit changes",
        commitId: commitId,
        updatedFile: possibleFilePath
      },
      { status: 200 }
    );
  } catch (error) {
    log("error", "Error updating documentation", {
      pageId,
      commitId,
      error: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      {
        success: false,
        error: "Failed to update documentation",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

/**
 * Attempt to identify which file a documentation page is documenting
 * based on page content and a list of changed files
 */
function identifyDocumentedFile(
  page: { title: string; body: { storage: { value: string } } },
  changedFiles: string[]
): string | null {
  // First check: page title often includes file name
  const titleMatch = changedFiles.find(file => {
    const fileName = file.split("/").pop();
    return fileName && page.title.toLowerCase().includes(fileName.toLowerCase());
  });
  
  if (titleMatch) {
    return titleMatch;
  }
  
  // Second check: look for file paths in the content
  const content = page.body.storage.value;
  
  // Sort files by length (descending) to match the longest path first
  // This helps avoid matching partial paths
  const sortedFiles = [...changedFiles].sort((a, b) => b.length - a.length);
  
  for (const file of sortedFiles) {
    // Look for exact file path mentions
    if (content.includes(file)) {
      return file;
    }
    
    // Try just the filename
    const fileName = file.split("/").pop();
    if (fileName && content.includes(fileName) && fileName.length > 3) {
      // Only match filenames that are reasonably long (to avoid matching common words)
      return file;
    }
  }
  
  // If we can't find a clear match, return the first changed file as a fallback
  // In a real system, you'd want a more robust mapping solution
  return changedFiles.length > 0 ? changedFiles[0] : null;
}

/**
 * Generate updated documentation using LLM, taking into account existing content
 */
async function generateUpdatedDocumentation(
  filePath: string,
  fileContent: string,
  dependencies: {
    path: string;
    content: string;
    filename: string;
    originalImport: string;
  }[],
  existingPage: {
    body: {
      storage: {
        value: string;
      };
    };
  },
  businessLogicHistory: {
    commits: Array<{
      id: string;
      message: string;
      date: string;
      authorName: string;
      businessLogicChanged: boolean;
      description: string;
    }>;
  },
  commitDetails?: {
    id: string;
    author: {
      name: string;
      email: string;
    };
    timestamp: string;
    message: string;
  },
  commitDiff?: {
    diff: string;
  }
): Promise<string> {
  const model = openai(DEFAULT_MODEL);

  // Extract existing content
  const existingContent = existingPage.body.storage.value;

  // Format business logic history for the prompt
  const formattedHistory = businessLogicHistory.commits.map(commit => {
    return `- [${commit.id.substring(0, 7)}] ${commit.date} by ${commit.authorName}: ${commit.message}${commit.businessLogicChanged ? ` (${commit.description})` : ''}`;
  }).join('\n');

  // Format commit details if provided
  let formattedCommitDetails = '';
  if (commitDetails) {
    formattedCommitDetails = `
Current Commit Details:
- ID: ${commitDetails.id}
- Author: ${commitDetails.author.name} <${commitDetails.author.email}>
- Date: ${commitDetails.timestamp}
- Message: ${commitDetails.message}
`;
    
    if (commitDiff && commitDiff.diff) {
      // Truncate diff if it's very long
      const truncatedDiff = commitDiff.diff.length > 2000 
        ? commitDiff.diff.substring(0, 2000) + '...[truncated for brevity]' 
        : commitDiff.diff;
      
      formattedCommitDetails += `
- Changes:
\`\`\`diff
${truncatedDiff}
\`\`\`
`;
    }
  }

  // Build dependencies string
  const dependenciesString = dependencies
    .map(
      dep =>
        `- ${dep.originalImport || dep.path} (${dep.filename})
    Content: ${
      dep.content.length > 500
        ? dep.content.substring(0, 500) + "..."
        : dep.content
    }`
    )
    .join("\n\n");

  // Get the short commit ID for citations
  const shortCommitId = commitDetails ? commitDetails.id.substring(0, 7) : "";

  // Build prompt with all the relevant information
  const prompt = `
You are a technical documentation expert. Your task is to update documentation for a code file.

FILE PATH: ${filePath}

CURRENT FILE CONTENT:
\`\`\`
${fileContent}
\`\`\`

DEPENDENCIES (${dependencies.length}):
${dependenciesString}

EXISTING DOCUMENTATION:
The existing documentation is in Confluence HTML format, but I'll convert your markdown output to this format afterward.
Current structure and content:
\`\`\`
${existingContent}
\`\`\`

FILE HISTORY (Recent changes, most recent first):
${formattedHistory}

${formattedCommitDetails}

INSTRUCTIONS:
1. Create updated documentation in clean, proper markdown format.
2. DO NOT include HTML tags (<h1>, <p>, <code>, etc.) in your response.
3. Use standard markdown syntax for all formatting (# for headings, \`\`\` for code blocks, etc.)
4. Preserve the overall structure and sections of the existing documentation.
5. Update any outdated information based on the current file content.
6. Add documentation for new features/functions.
7. Remove documentation for removed features/functions.
8. IMPORTANT: For each significant business logic change you document, add the commit ID in square brackets at the end of the sentence or paragraph describing the change. 
   Example: "Note that the date comparison has been updated to use UTC, which may affect local timezone comparisons [${shortCommitId}]"

YOUR RESPONSE SHOULD BE PURE MARKDOWN WITH NO HTML TAGS.
`;

  const { text } = await generateText({
    model,
    prompt,
    temperature: DEFAULT_TEMPERATURE
  });

  return text;
}

/**
 * Generate documentation using LLM
 */
async function generateDocumentation(
  filePath: string,
  fileContent: string,
  dependencies: {
    path: string;
    content: string;
    filename: string;
    originalImport: string;
  }[]
): Promise<string> {
  const model = openai(DEFAULT_MODEL);

  // Build dependencies string
  const dependenciesString = dependencies
    .map(
      dep =>
        `- ${dep.originalImport || dep.path} (${dep.filename})
    Content: ${
      dep.content.length > 500
        ? dep.content.substring(0, 500) + "..."
        : dep.content
    }`
    )
    .join("\n\n");

  // Build prompt with all the relevant information
  const prompt = `
Generate comprehensive documentation for the following file:

FILE PATH: ${filePath}

FILE CONTENT:
\`\`\`
${fileContent}
\`\`\`

DEPENDENCIES (${dependencies.length}):
${dependenciesString}

Please structure the documentation with the following sections:
1. Overview - A brief summary of the file's purpose and functionality
2. Module Dependencies - List and explain the dependencies used by this module
3. Business Logic - Detailed explanation of the core functionality

Format the documentation in markdown. DO NOT include HTML tags in your response.
`;

  const { text } = await generateText({
    model,
    prompt,
    temperature: DEFAULT_TEMPERATURE
  });

  return text;
}
