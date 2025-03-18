import { NextRequest, NextResponse } from "next/server";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateText, tool, ToolSet } from "ai";
import { z } from "zod";
import {
  createConfluencePage,
  updateConfluencePage,
  getConfluencePage,
  findDocumentationPage
} from "../confluence/confluenceClient";
import { DocumentationRequest } from "../types";
import {
  getFileContent,
  getCommitDiff,
  getAffectedFiles,
  getInternalDependencies,
  getBusinessLogicHistory
} from "../git/gitClient";

// Constants
const DEFAULT_TEMPERATURE = 0.1;
const MAX_STEPS = 10;
const REQUIRED_TOOLS_GENERATE = [
  "getFileContent",
  "getInternalDependencies",
  "getBusinessLogicHistory",
  "markdownToConfluence",
  "createConfluencePage"
];
const REQUIRED_TOOLS_UPDATE_WITH_PAGE_ID = [
  "getConfluencePage",
  "getCommitDiff",
  "markdownToConfluence",
  "updateConfluencePage"
];
const REQUIRED_TOOLS_UPDATE_WITH_COMMIT = [
  "getCommitDiff",
  "findDocumentationPage",
  "markdownToConfluence",
  "updateConfluencePage"
];

/**
 * Enhanced logging with timestamp and metadata
 */
function log(
  level: "info" | "warn" | "error",
  message: string,
  metadata?: Record<string, unknown>
) {
  const timestamp = new Date().toISOString();
  const metadataStr = metadata ? ` | ${JSON.stringify(metadata)}` : "";

  switch (level) {
    case "error":
      console.error(`[ERROR] ${timestamp} | ${message}${metadataStr}`);
      break;
    case "warn":
      console.warn(`[WARN] ${timestamp} | ${message}${metadataStr}`);
      break;
    default:
      console.log(`[INFO] ${timestamp} | ${message}${metadataStr}`);
  }
}

/**
 * POST handler for documentation agent
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
      commitId: data.commitId,
      pageId: data.pageId
    });

    // Get the appropriate system and user prompts based on the action
    const systemPrompt = getSystemPrompt(data.action);
    const userPrompt = getPrompt(data);

    // Determine which tools are required for this operation
    let requiredTools: string[] = [];
    if (data.action === "generate") {
      requiredTools = REQUIRED_TOOLS_GENERATE;
    } else if (data.action === "update" && data.pageId) {
      requiredTools = REQUIRED_TOOLS_UPDATE_WITH_PAGE_ID;
    } else if (data.action === "update" && data.commitId) {
      requiredTools = REQUIRED_TOOLS_UPDATE_WITH_COMMIT;
    }

    log("info", "Required tools for this operation", { requiredTools });

    // Execute the agent
    const result = await executeAgent(
      userPrompt,
      systemPrompt,
      getTools(),
      DEFAULT_TEMPERATURE,
      MAX_STEPS
    );

    // Check if all required tools were executed
    const executedTools = new Set<string>();
    let pageId: string | undefined;
    let pageTitle: string | undefined;

    // Process each step to collect tools executed and extract page info
    result.steps.forEach(step => {
      if (step.type === "tool" && step.tool) {
        executedTools.add(step.tool.name);

        // Extract created page information from tool results
        if (step.tool.name === "createConfluencePage") {
          const createResult = step.toolResult as {
            pageId: string;
            title: string;
          };
          pageId = createResult.pageId;
          pageTitle = createResult.title;
        }
        // Also extract updated page info
        else if (step.tool.name === "updateConfluencePage") {
          const updateResult = step.toolResult as {
            pageId: string;
            title: string;
          };
          pageId = updateResult.pageId;
          pageTitle = updateResult.title;
        }
      }
    });

    log("info", "Executed tools", { executedTools: Array.from(executedTools) });

    // Find which required tools were not executed
    const missingTools = requiredTools.filter(tool => !executedTools.has(tool));

    if (missingTools.length > 0) {
      log("warn", "Missing required tools in execution", { missingTools });

      // For update actions, we absolutely require markdownToConfluence and updateConfluencePage
      // These are the most critical tools for a successful update
      const criticalMissingTools =
        data.action === "update"
          ? missingTools.filter(tool =>
              ["markdownToConfluence", "updateConfluencePage"].includes(tool)
            )
          : [];

      if (data.action === "update" && criticalMissingTools.length > 0) {
        // If critical tools are missing for an update, consider it a failure
        return NextResponse.json(
          {
            success: false,
            partialSuccess: missingTools.length !== requiredTools.length,
            missingSteps: missingTools,
            message:
              "Documentation update was incomplete. Critical tools were not executed: " +
              criticalMissingTools.join(", ")
          },
          { status: 200 }
        );
      } else {
        // For other actions or non-critical missing tools, report as partial success
        return NextResponse.json(
          {
            success: false,
            partialSuccess: true,
            missingSteps: missingTools,
            message: `Documentation ${data.action} was incomplete. Some required tools were not executed.`
          },
          { status: 200 }
        );
      }
    }

    // Success response
    return NextResponse.json(
      {
        success: true,
        pageId,
        title: pageTitle,
        message: `Documentation ${data.action} completed successfully.`
      },
      { status: 200 }
    );
  } catch (error) {
    // Log and return error
    log("error", "Error in documentation agent", {
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

const basePrompt = `You are an expert documentation generator specializing in creating comprehensive and technical documentation for code files. Your primary goal is to analyze code, understand its purpose, and produce clear, accurate, and detailed documentation tailored for developers. Utilize the available tools to fetch file content, analyze dependencies, and create or update documentation in Confluence. Ensure that the documentation is technically sound, precise, and provides developers with the necessary insights to understand and work with the code effectively.`;

/**
 * Get the system prompt based on the action
 */
function getSystemPrompt(action: string): string {
  if (action === "generate") {
    return `${basePrompt}
    
    System Task: Generate Documentation in Confluence

    Objective: Perform a series of tasks to generate and publish documentation in Confluence. Follow the steps meticulously to ensure accuracy and completeness.

    Instructions:

    1. Retrieve File Content:
      - Call the getFileContent function to obtain the content of the file.
      - Action Required: Wait for the function to return the file content before proceeding.
    
    2. Retrieve all internal module dependencies using the 'getInternalDependencies' tool:
      - Call the getInternalDependencies function to obtain all internal dependencies of the file.
      - Action Required: Wait for the function to return the dependencies before proceeding.
      
    3. Retrieve the business logic version history using the 'getBusinessLogicHistory' tool:
      - Call the getBusinessLogicHistory function to obtain the history of business logic changes.
      - Action Required: Wait for the function to return the history before proceeding.
      
    4. Analyze the file content to extract business logic and use cases, with a focus on three core areas:
    - Module Dependencies: Identify how this file relates to its dependencies and document those relationships
    - Business Logic: Determine the key functions, data flow, and processing steps
    - Version History: Document significant changes to the business logic with commit references
    
    5. Structure the document to be clear and accessible:
    - Use markdown headers to organize the document into sections such as "Module Dependencies", "Business Logic", and "Version History".
    - Provide clear explanations and examples to illustrate complex concepts.
    - Ensure the document is suitable for both technical and non-technical audiences.
    
    6. Convert to Confluence Format:
      - Call the markdownToConfluence function to convert the Markdown documentation into Confluence format.
      - Action Required: Wait for the conversion result before proceeding.
    
    7. Create Confluence Page:
      - Call the createConfluencePage function to publish the documentation in Confluence.
      - Action Required: Wait for confirmation that the page has been successfully created.
    
    Important Guidelines:

      - Sequential Execution: Each step must be completed in the specified order. Do not proceed to the next step until the current one is fully completed.
      - Function Calls: Use the exact function names as provided. Ensure each function call returns successfully before moving on.
      - Documentation Format: Always generate the documentation in Markdown format first, then convert it to Confluence format.
      - Error Handling: Implement error handling to manage any issues that arise during function calls or conversions.

    Note: Adherence to these instructions is crucial for the successful generation and publication of documentation.`;
  } else {
    return `${basePrompt}
    
    System Task: Update Existing Documentation in Confluence

    Objective: Perform a series of tasks to update and publish existing documentation in Confluence. Follow the steps meticulously to ensure accuracy and completeness.

    Instructions:

    1. Retrieve Existing Document:
      - If a specific pageId is provided, use the getConfluencePage function with the pageId to obtain the current content.
      - In all update cases, use getCommitDiff to understand what has changed.
      - If no pageId is provided but a commitId is given, first use getCommitDiff to understand what files were changed, then use findDocumentationPage to locate the relevant document(s).
      - Action Required: Wait for the function to return the document content before proceeding.
    
    2. Analyze and Update:
      - In all cases, analyze the diff from getCommitDiff to understand what has changed.
      - The diff provides both the changes made and the list of affected files.
      - Only use getAffectedFiles if you need to filter for documentable files based on extensions and directories.
      - Analyze the retrieved document thoroughly.
      - Action Required: Update the document content in Markdown format, focusing on three key areas:
        1. Module Dependencies: Document how dependencies have changed
        2. Business Logic: Update the explanation of business logic based on code changes
        3. Version History: Add the new commit to the version history section
    
    3. Convert to Confluence Format:
      - Call the markdownToConfluence function to convert the updated Markdown documentation into Confluence format.
      - This step is CRITICAL and MUST be performed.
      - Action Required: Wait for the conversion result before proceeding.
    
    4. Update Confluence Page:
      - Call the updateConfluencePage function with the pageId, title, content, and version to publish the updated documentation.
      - This step is CRITICAL and MUST be performed.
      - Action Required: Wait for confirmation that the page has been successfully updated.

    Important Guidelines:

      - Required Tools: Every update operation MUST include calls to markdownToConfluence and updateConfluencePage. These are not optional steps.
      - Sequential Execution: Each step must be completed in the specified order. Do not proceed to the next step until the current one is fully completed.
      - Function Calls: Use the exact function names as provided. Ensure each function call returns successfully before moving on.
      - Documentation Structure: Always maintain the three core sections (Module Dependencies, Business Logic, Version History).
      - Error Handling: Implement error handling to manage any issues that arise during function calls or conversions.
      - Direct Update: If a pageId is provided directly, prioritize using that for retrieval and update rather than searching.
      - Diff Analysis: When analyzing code changes, focus on the actual diff content from getCommitDiff rather than just the list of files.

    Completion Verification:
      You must verify that both markdownToConfluence and updateConfluencePage are called successfully before considering the update complete.

    Note: Adherence to these instructions is crucial for the successful updating and publication of documentation.`;
  }
}

/**
 * Get the user prompt based on the request
 */
function getPrompt(request: DocumentationRequest): string {
  const { action, filePath, commitId, spaceId, parentPageId, pageId } = request;

  if (action === "generate" && filePath) {
    return `<prompt>
    <role>
        You are a technical writer with expertise in software documentation, tasked with creating a comprehensive technical document that explains the business logic, module dependencies, and version history of code files. Your document should be understandable by a Product Owner and serve as a learning resource for developers of all levels.
    </role>
    <instructions>
        1. Retrieve the file content using the 'getFileContent' tool:
        <function_call>getFileContent(filePath="${filePath}")</function_call>
        
        2. Retrieve all internal module dependencies using the 'getInternalDependencies' tool:
        <function_call>getInternalDependencies(filePath="${filePath}")</function_call>
        
        3. Retrieve the business logic version history using the 'getBusinessLogicHistory' tool:
        <function_call>getBusinessLogicHistory(filePath="${filePath}", limit=15)</function_call>
        
        4. Analyze the file content to extract business logic and use cases, with a focus on three core areas:
        - Module Dependencies: Identify how this file relates to its dependencies and document those relationships
        - Business Logic: Determine the key functions, data flow, and processing steps
        - Version History: Document significant changes to the business logic with commit references
        
        5. Structure the document to be clear and accessible:
        - Use markdown headers to organize the document into sections such as "Module Dependencies", "Business Logic", and "Version History".
        - Provide clear explanations and examples to illustrate complex concepts.
        - Ensure the document is suitable for both technical and non-technical audiences.
        
        6. Convert the document to Confluence format using the 'markdownToConfluence' tool:
        <function_call>markdownToConfluence(markdown="[Your markdown content]")</function_call>
        
        7. Create a Confluence page using the 'createConfluencePage' tool:
        <function_call>createConfluencePage(spaceId="${spaceId}", title="Documentation: ${filePath
      .split("/")
      .pop()}", content="[Confluence formatted content]"${
      parentPageId ? `, parentId="${parentPageId}"` : ""
    })</function_call>
        
        8. Verify the accuracy and completeness of the document before publishing.
        
        Remember to maintain clarity and accessibility throughout the document, ensuring it serves as a valuable resource for both Product Owners and freshers/interns.
    </instructions>
    
    <response_style>
        Your response should be clear, instructional, and educational. Use straightforward language to explain complex concepts, ensuring the document is accessible to both technical and non-technical audiences. Organize the document logically with markdown headers to guide the reader through the content.
    </response_style>
    
    <examples>
        Example of using tools and structuring the document:
        <thinking_process>
        1. Retrieve file content using 'getFileContent':
        <function_call>getFileContent(filePath="/path/to/schedulingComponent.js")</function_call>
        
        2. Retrieve internal dependencies.
        
        3. Retrieve business logic history.
        
        4. Analyze content for business logic and use cases.
        
        5. Structure document with sections: Module Dependencies, Business Logic, and Version History.
        
        6. Convert to Confluence format:
        <function_call>markdownToConfluence(markdown="# Module Dependencies\n...")</function_call>
        
        7. Create Confluence page:
        <function_call>createConfluencePage(spaceId="12345", title="Documentation: schedulingComponent.js", content="[Confluence formatted content]", parentId="67890")</function_call>
        </thinking_process>
        
        <final_response>
        # Module Dependencies
        This document provides a comprehensive overview of the dependencies for the scheduling component within our application.

        # Business Logic
        The scheduling component is responsible for...

        # Version History
        The following commits have significant changes to the business logic:
        - [Commit message 1]
        - [Commit message 2]
        </final_response>
    </examples>
  
    <reminder>
        - Document ALL internal dependencies, not just third-party ones
        - Analyze the complete business logic across ALL files, not just the main file
        - Include version history with commit IDs for significant business logic changes
        - Ensure the document is comprehensive and accessible to both technical and non-technical audiences
    </reminder>
  
    <output_format>
        Structure your output as follows:
        <thinking_process>
        [Detail your process of retrieving file content, analyzing dependencies, and structuring the document]
        </thinking_process>
        <final_response>
        [Provide your structured document with markdown headers and content]
        </final_response>
    </output_format>
    </prompt>`;
  } else if (action === "update") {
    return `<prompt>
    <role>
        You are a technical writer and documentation specialist with expertise in software development and business logic. Your role is to update existing documentation based on code changes, ensuring that it remains clear and accessible to both technical and non-technical stakeholders while maintaining the integrity of the business logic.
    </role>
    
    <instructions>
        ${
          pageId
            ? `
        1. Retrieve Existing Document:
        - Use the pageId to get the current content of the document to be updated.
        - Call: <function_call>getConfluencePage(pageId="${pageId}")</function_call>
        
        2. Get the code changes:
        - To understand what needs to be updated in the document, retrieve the code changes.
        - Call: <function_call>getCommitDiff(commitId="${
          commitId || ""
        }")</function_call>
        - Note: If no commitId is provided, you will need to ask for it or rely solely on the existing document.
        `
            : `
        1. Identify the code changes:
        - Use the 'commitId' to get the detailed diff of changes.
        - Call: <function_call>getCommitDiff(commitId="${commitId}")</function_call>
        - This will provide both the diff content and the list of affected files.
        - If you need to filter for documentable files only, call: <function_call>getAffectedFiles(commitId="${commitId}")</function_call>
        
        2. Analyze the impact on business logic:
        - Carefully review the diff to understand what code was changed.
        - Identify which files were modified and how they were changed.
        - Determine how these changes affect existing module dependencies
        - Document how these changes modify the overall business logic
        - Update the version history to include this commit
        
        3. For each affected file:
        - Use the findDocumentationPage function to locate the existing documentation page:
        - Call: <function_call>findDocumentationPage(spaceId="${spaceId}", title="[Title based on file name]")</function_call>
        - Note: If no documentation page exists, you may need to create a new one instead of updating.
        `
        }
        
        ${
          pageId
            ? `
        3. Analyze and Update all focus areas:
        - MODULE DEPENDENCIES: Update the documentation to reflect any changes in dependencies
        - BUSINESS LOGIC: Update the comprehensive explanation of the business logic
        - VERSION HISTORY: Add this new commit to the version history section
        - Maintain the integrity of all three focus areas in the documentation
        
        4. Convert to Confluence Format:
        - This step is REQUIRED. You MUST call markdownToConfluence with your updated markdown content:
        - Call: <function_call>markdownToConfluence(markdown="[Your updated markdown content]")</function_call>
        
        5. Update the Confluence page:
        - This step is REQUIRED. You MUST call updateConfluencePage with the pageId, title, content, and version:
        - Call: <function_call>updateConfluencePage(pageId="${pageId}", title="[Retrieved title]", content="[Confluence formatted content]", version=[Retrieved version])</function_call>
        `
            : `
        4. Update the documentation:
        - Ensure MODULE DEPENDENCIES section reflects any added, modified, or removed dependencies
        - Update BUSINESS LOGIC section to explain the modified functionality  
        - Add the new commit to the VERSION HISTORY section with details about what changed
        - Make all changes accessible to both technical and non-technical stakeholders
        
        5. Convert your updated markdown content to Confluence format:
        - This step is REQUIRED. You MUST call markdownToConfluence with your updated markdown content:
        - Call: <function_call>markdownToConfluence(markdown="[Your updated markdown content]")</function_call>
        
        6. Update the documentation page:
        - This step is REQUIRED. You MUST call updateConfluencePage with the correct parameters:
        - Call: <function_call>updateConfluencePage(pageId="[Retrieved pageId]", title="[Retrieved title]", content="[Confluence formatted content]", version=[Retrieved version])</function_call>
        `
        }
        
        Important: You MUST complete ALL steps in order. Do not skip any steps, especially the final conversion and update steps which are critical to the process.
    </instructions>
    
    <response_style>
        Your responses should be well-structured with clear sections for each focus area. Use tables, lists, and code examples where appropriate. Balance technical accuracy with accessibility for non-technical stakeholders.
    </response_style>
    
    <examples>
        <thinking_process>
        ${
          pageId
            ? `
        1. I will follow all steps in order:
        
        Step 1: First, I need to retrieve the existing document
        <function_call>getConfluencePage(pageId="${pageId}")</function_call>
        
        Step 2: Now I'll get the commit diff to understand what code has changed
        <function_call>getCommitDiff(commitId="${
          commitId || ""
        }")</function_call>
        
        Step 3: Next, I'll analyze both the document content and code changes to determine what needs updating
        
        Step 4: I'll convert the updated markdown to Confluence format
        <function_call>markdownToConfluence(markdown="# Updated Documentation\n\n## Module Dependencies\n...")</function_call>
        
        Step 5: Finally, I'll update the Confluence page
        <function_call>updateConfluencePage(pageId="${pageId}", title="Documentation: Example", content="<h1>Updated Documentation</h1>...", version=2)</function_call>
        `
            : `
        1. I will follow all steps in order:
        
        Step 1: First, I need to get the commit diff to analyze what changed
        <function_call>getCommitDiff(commitId="${commitId}")</function_call>
        
        Step 2: I'll also get the list of documentable files
        <function_call>getAffectedFiles(commitId="${commitId}")</function_call>
        
        Step 3: For each affected file, I'll find the existing documentation page
        <function_call>findDocumentationPage(spaceId="${spaceId}", title="Documentation: Example")</function_call>
        
        Step 4: I'll analyze the changes and update the documentation accordingly
        
        Step 5: I'll convert the updated markdown to Confluence format
        <function_call>markdownToConfluence(markdown="# Updated Documentation\n\n## Module Dependencies\n...")</function_call>
        
        Step 6: Finally, I'll update the Confluence page
        <function_call>updateConfluencePage(pageId="retrieved-page-id", title="Documentation: Example", content="<h1>Updated Documentation</h1>...", version=2)</function_call>
        `
        }
        </thinking_process>
        
        <final_response>
        ## Updated Documentation

        ### Module Dependencies
        - **Added Dependencies**: [List of new dependencies]
        - **Removed Dependencies**: [List of removed dependencies]
        - **Modified Dependency Relationships**: [Description of changed relationships]

        ### Business Logic Changes
        - **Modified Components**: [List of components with changed logic]
        - **Impact on Data Flow**: [Description of how data flow has changed]
        - **New Business Rules**: [Description of any new business rules]
        - **Updated Logic Flow**: [Explanation of how the logic flow has changed]

        ### Version History Update
        | Date | Commit ID | Change Description |
        |------|-----------|-------------------|
        | 2023-06-15 | ${
          commitId || "actual-commit-id"
        } | [Description of changes in this commit] |
        | 2023-05-10 | a1b2c3d | Added validation for input fields |
        | 2023-04-22 | e5f6g7h | Fixed calculation logic in processing pipeline |
        </final_response>
    </examples>
    
    <reminder>
        - Focus on ALL THREE areas: module dependencies, business logic, and version history
        - Ensure the documentation remains comprehensive and covers the entire system
        - Document ALL internal dependencies, not just third-party ones
        - Include the new commit in the version history section with accurate descriptions
        - You MUST execute ALL required tools in the correct sequence - especially markdownToConfluence and updateConfluencePage at the end
    </reminder>
    
    <output_format>
        Structure your output as follows:
        <thinking_process>
        [Detail your process of analyzing changes and updating all three focus areas]
        [Show each tool call you make, including markdownToConfluence and updateConfluencePage]
        </thinking_process>
        <final_response>
        [Provide your structured document with appropriate markdown formatting]
        </final_response>
    </output_format>
    </prompt>`;
  } else {
    return "Invalid request: missing required parameters.";
  }
}

/**
 * Get the tools for the agent - organized by category for better maintainability
 */
function getTools() {
  // Git-related tools
  const gitTools = {
    // Tool to get file content
    getFileContent: tool({
      description: "Get the content of a file",
      parameters: z.object({
        filePath: z.string().describe("Path to the file"),
        commitId: z
          .string()
          .optional()
          .describe("Optional commit ID to get file at specific commit")
      }),
      execute: async ({ filePath, commitId }) => {
        try {
          log("info", "Getting file content", { filePath, commitId });
          const content = await getFileContent(filePath, commitId);
          log("info", "Successfully retrieved file content", {
            length: content.length
          });
          return content;
        } catch (error) {
          log("error", "Error getting file content", {
            filePath,
            commitId,
            error: error instanceof Error ? error.message : String(error)
          });
          throw new Error(
            `Failed to retrieve content for ${filePath}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    }),

    // Tool to get internal dependencies (recursive)
    getInternalDependencies: tool({
      description:
        "Get all internal dependencies (non third-party imports) for a file recursively",
      parameters: z.object({
        filePath: z.string().describe("Path to the file")
      }),
      execute: async ({ filePath }) => {
        try {
          log("info", "Getting internal dependencies", { filePath });
          const dependencies = await getInternalDependencies(filePath);
          log("info", "Successfully retrieved internal dependencies", {
            count: dependencies.length,
            dependencies
          });

          // Return list of dependencies and their content
          const dependencyContents = await Promise.all(
            dependencies.map(async depPath => {
              try {
                // Skip if the path is a third-party dependency (shouldn't happen with our updated logic)
                if (depPath.startsWith("@") && !depPath.startsWith("@/")) {
                  log("info", `Skipping third-party dependency: ${depPath}`);
                  return null;
                }

                // Make sure we're using the resolved path with proper extension
                const content = await getFileContent(depPath);
                return {
                  path: depPath,
                  content,
                  // Include the filename without the path for easier reference
                  filename: depPath.split("/").pop() || depPath,
                  // Determine the original import pattern if possible
                  originalImport: depPath.includes("components/")
                    ? `@/components/${depPath.split("components/")[1]}`
                    : depPath.includes("lib/")
                    ? `@/lib/${depPath.split("lib/")[1]}`
                    : depPath
                };
              } catch (error) {
                log(
                  "warn",
                  `Could not retrieve content for dependency ${depPath}`,
                  {
                    error:
                      error instanceof Error ? error.message : String(error)
                  }
                );
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

          return filteredDependencyContents;
        } catch (error) {
          log("error", "Error getting internal dependencies", {
            filePath,
            error: error instanceof Error ? error.message : String(error)
          });
          return [];
        }
      }
    }),

    // Tool to get business logic version history
    getBusinessLogicHistory: tool({
      description: "Get the history of business logic changes for a file",
      parameters: z.object({
        filePath: z.string().describe("Path to the file"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of commits to analyze (default: 10)")
      }),
      execute: async ({ filePath, limit = 10 }) => {
        try {
          log("info", "Getting business logic history", { filePath, limit });
          const history = await getBusinessLogicHistory(filePath, limit);

          // Filter to only show commits with business logic changes
          const businessLogicCommits = history.commits.filter(
            commit => commit.businessLogicChanged
          );

          log("info", "Successfully retrieved business logic history", {
            totalCommits: history.commits.length,
            businessLogicChanges: businessLogicCommits.length
          });

          return {
            path: filePath,
            totalCommits: history.commits.length,
            businessLogicChanges: businessLogicCommits.length,
            commits: history.commits,
            businessLogicCommits
          };
        } catch (error) {
          log("error", "Error getting business logic history", {
            filePath,
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            path: filePath,
            totalCommits: 0,
            businessLogicChanges: 0,
            commits: [],
            businessLogicCommits: []
          };
        }
      }
    }),

    // Tool to get commit diff
    getCommitDiff: tool({
      description:
        "Get the complete diff for a specific commit, showing both the changes made to code and the list of affected files",
      parameters: z.object({
        commitId: z.string().describe("Commit hash")
      }),
      execute: async ({ commitId }) => {
        try {
          // First, validate that we have a real commit ID, not a placeholder
          if (!commitId || 
              commitId === "" || 
              commitId === "[commit_id]" || 
              commitId === "test_commit_id" || 
              commitId === "actual-commit_id" ||
              commitId === "[example_commit_id]") {
            log("error", "Invalid or placeholder commit ID provided", { commitId });
            throw new Error("A valid commit ID is required. Please provide an actual Git commit hash.");
          }
          
          // Validate commit ID format (basic check for SHA-1 hash format)
          if (!/^[0-9a-f]{5,40}$/i.test(commitId)) {
            log("error", "Invalid commit ID format", { commitId });
            throw new Error(`Invalid commit ID format: "${commitId}". Please provide a valid Git commit hash.`);
          }
          
          log("info", "Getting commit diff and affected files", { commitId });
          const diffInfo = await getCommitDiff(commitId);
          log("info", "Successfully retrieved commit diff", {
            diffLength: diffInfo.diff.length,
            affectedFiles: diffInfo.files.length
          });
          return {
            diff: diffInfo.diff,
            files: diffInfo.files,
            summary: `Changes to ${diffInfo.files.length} files in commit ${commitId}`
          };
        } catch (error) {
          log("error", "Error getting commit diff", {
            commitId,
            error: error instanceof Error ? error.message : String(error)
          });
          return {
            error: `Could not retrieve diff for commit ${commitId}`,
            diff: "",
            files: []
          };
        }
      }
    }),

    // Tool to get affected files from a commit
    getAffectedFiles: tool({
      description:
        "Filter the list of files affected by a commit to only include those that should be documented based on file extensions and directories",
      parameters: z.object({
        commitId: z.string().describe("Commit hash")
      }),
      execute: async ({ commitId }) => {
        try {
          // First, validate the commit ID to check if it's a placeholder
          if (!commitId || 
              commitId === "" || 
              commitId === "[commit_id]" || 
              commitId === "test_commit_id" || 
              commitId === "actual-commit_id" ||
              commitId === "[example_commit_id]") {
            log("error", "Invalid or placeholder commit ID provided in getAffectedFiles", { commitId });
            throw new Error("A valid commit ID is required. Please provide an actual Git commit hash.");
          }
          
          // Validate commit ID format (basic check for SHA-1 hash format)
          if (!/^[0-9a-f]{5,40}$/i.test(commitId)) {
            log("error", "Invalid commit ID format in getAffectedFiles", { commitId });
            throw new Error(`Invalid commit ID format: "${commitId}". Please provide a valid Git commit hash.`);
          }
          
          log("info", "Filtering documentable files for commit", { commitId });
          const diffInfo = await getCommitDiff(commitId);
          const files = getAffectedFiles(diffInfo);
          log("info", "Successfully filtered documentable files", {
            totalFiles: diffInfo.files.length,
            documentableFiles: files.length
          });
          return files;
        } catch (error) {
          // Check for commit-specific errors
          if (error instanceof Error && 
              (error.message.includes("Commit not found") || 
               error.message.includes("bad object"))) {
            log("error", "Invalid commit ID in getAffectedFiles", {
              commitId,
              error: error.message
            });
            throw new Error(
              `Invalid commit ID: ${commitId}. Please verify this commit exists in the repository.`
            );
          } else {
            log("error", "Error filtering documentable files", {
              commitId,
              error: error instanceof Error ? error.message : String(error)
            });
            return [];
          }
        }
      }
    })
  };

  // Confluence-related tools
  const confluenceTools = {
    // Tool to create a Confluence page
    createConfluencePage: tool({
      description: "Create a new page in Confluence",
      parameters: z.object({
        spaceId: z.string().describe("Confluence space ID"),
        title: z.string().describe("Page title"),
        content: z
          .string()
          .describe("Page content in Confluence storage format"),
        parentId: z.string().optional().describe("Parent page ID (optional)")
      }),
      execute: async ({ spaceId, title, content, parentId }) => {
        try {
          log("info", "Creating Confluence page", {
            title,
            spaceId,
            contentLength: content.length,
            hasParentId: !!parentId
          });

          const pageId = await createConfluencePage(
            spaceId,
            title,
            content,
            parentId
          );
          log("info", "Successfully created Confluence page", { pageId });

          return { pageId, title };
        } catch (error) {
          log("error", "Error creating Confluence page", {
            title,
            spaceId,
            error: error instanceof Error ? error.message : String(error)
          });
          throw new Error(
            `Failed to create Confluence page: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    }),

    // Tool to update a Confluence page
    updateConfluencePage: tool({
      description: "Update an existing page in Confluence",
      parameters: z.object({
        pageId: z.string().describe("Page ID"),
        title: z.string().describe("Page title"),
        content: z
          .string()
          .describe("Page content in Confluence storage format"),
        version: z.number().describe("Page version number")
      }),
      execute: async ({ pageId, title, content, version }) => {
        try {
          log("info", "Updating Confluence page", { pageId, title, version });
          const updatedPageId = await updateConfluencePage(
            pageId,
            title,
            content,
            version
          );
          log("info", "Successfully updated Confluence page", {
            pageId: updatedPageId
          });
          return { pageId: updatedPageId, title };
        } catch (error) {
          log("error", "Error updating Confluence page", {
            pageId,
            title,
            error: error instanceof Error ? error.message : String(error)
          });
          throw new Error(
            `Failed to update Confluence page: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
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
          log("info", "Getting Confluence page", { pageId });
          const page = await getConfluencePage(pageId);
          log("info", "Successfully retrieved Confluence page", {
            pageId,
            found: !!page
          });
          return page;
        } catch (error) {
          log("error", "Error getting Confluence page", {
            pageId,
            error: error instanceof Error ? error.message : String(error)
          });
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
          log("info", "Finding documentation page", { spaceId, title });
          const pageId = await findDocumentationPage(spaceId, title);

          if (pageId) {
            log("info", "Documentation page found, retrieving details", {
              pageId
            });
            const page = await getConfluencePage(pageId);
            log("info", "Successfully retrieved page details", {
              pageId,
              found: !!page
            });
            return page;
          }

          log("info", "Documentation page not found", { spaceId, title });
          return null;
        } catch (error) {
          log("error", "Error finding documentation page", {
            spaceId,
            title,
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        }
      }
    })
  };

  // Content transformation tools
  const transformationTools = {
    // Tool to convert Markdown to Confluence storage format
    markdownToConfluence: tool({
      description: "Convert Markdown content to Confluence storage format",
      parameters: z.object({
        markdown: z.string().describe("Markdown content")
      }),
      execute: async ({ markdown }) => {
        try {
          log("info", "Converting markdown to Confluence format", {
            markdownLength: markdown.length
          });

          // Proper conversion to Confluence storage format
          let confluenceContent = markdown
            // Headers conversion
            .replace(/^# (.*$)/gm, "<h1>$1</h1>")
            .replace(/^## (.*$)/gm, "<h2>$1</h2>")
            .replace(/^### (.*$)/gm, "<h3>$1</h3>")
            .replace(/^#### (.*$)/gm, "<h4>$1</h4>")
            .replace(/^##### (.*$)/gm, "<h5>$1</h5>")
            .replace(/^###### (.*$)/gm, "<h6>$1</h6>")

            // Bold and italic
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/_(.+?)_/g, "<em>$1</em>")

            // Lists - proper Confluence list format
            .replace(/^\s*\* (.*$)/gm, "<ul><li>$1</li></ul>")
            .replace(/^\s*- (.*$)/gm, "<ul><li>$1</li></ul>")
            .replace(/^\s*\d+\. (.*$)/gm, "<ol><li>$1</li></ol>")

            // Code blocks - use Confluence code macro
            .replace(/```(\w*)\n([\s\S]*?)```/g, (match, language, code) => {
              const lang = language || "";
              return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${lang}</ac:parameter><ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`;
            })

            // Inline code
            .replace(/`([^`]+)`/g, "<code>$1</code>")

            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

            // Fix consecutive list items (Confluence needs proper nesting)
            .replace(/<\/ul>\s*<ul>/g, "")
            .replace(/<\/ol>\s*<ol>/g, "");

          // Handle tables (basic support)
          confluenceContent = handleMarkdownTables(confluenceContent, markdown);

          // Paragraphs - wrap text blocks in <p> tags
          confluenceContent = confluenceContent.replace(
            /^([^<\s][^\n]*[^>])$/gm,
            "<p>$1</p>"
          );

          log("info", "Conversion to Confluence format completed", {
            confluenceLength: confluenceContent.length
          });
          return confluenceContent;
        } catch (error) {
          log("error", "Error converting Markdown to Confluence format", {
            markdownLength: markdown.length,
            error: error instanceof Error ? error.message : String(error)
          });
          throw new Error("Failed to convert Markdown to Confluence format");
        }
      }
    })
  };

  // Combine all tools into a single object
  return {
    ...gitTools,
    ...confluenceTools,
    ...transformationTools
  };
}

/**
 * Helper function to handle Markdown table conversion to Confluence format
 */
function handleMarkdownTables(
  confluenceContent: string,
  markdown: string
): string {
  // Handle tables (basic support)
  let result = confluenceContent.replace(/^\|(.+)\|$/gm, (match, content) => {
    const cells = content.split("|").map((cell: string) => cell.trim());
    let isHeader = false;

    // Check next line for table separator
    const nextLine = markdown
      .split("\n")
      .find(line => line.includes("---") && line.includes("|"));

    if (nextLine) {
      isHeader = true;
    }

    if (isHeader) {
      return `<table><thead><tr>${cells
        .map((cell: string) => `<th>${cell}</th>`)
        .join("")}</tr></thead><tbody>`;
    } else {
      return `<tr>${cells
        .map((cell: string) => `<td>${cell}</td>`)
        .join("")}</tr>`;
    }
  });

  // Remove separator lines and fix multiple tbody tags
  result = result.replace(/^\|[-|]+\|$/gm, "").replace(/<\/tbody><tbody>/g, "");

  // Add closing table tags where needed
  if (result.includes("<table>") && !result.includes("</table>")) {
    result += "</tbody></table>";
  }

  return result;
}

/**
 * Execute the agent with the given prompts and tools
 */
async function executeAgent(
  userPrompt: string,
  systemPrompt: string,
  tools: ToolSet,
  temperature: number,
  maxSteps: number
) {
  // Define step types for better type checking
  interface ToolCall {
    toolName: string;
    args: Record<string, unknown>;
  }

  interface ToolResult {
    toolName: string;
    result: unknown;
  }

  interface StepInfo {
    type: "tool" | "text";
    tool?: {
      name: string;
      args: Record<string, unknown>;
    };
    text?: string;
    toolResult?: unknown;
  }

  // Sequential Chain Implementation
  const model = openai("gpt-4o-mini");
  
  // Calculate step budgets based on total maxSteps
  // Allocate more steps to initial data retrieval and final creation/update
  const initialStepsBudget = Math.floor(maxSteps * 0.4); // 40% of steps
  const analysisStepsBudget = Math.floor(maxSteps * 0.2); // 20% of steps
  const finalStepsBudget = Math.floor(maxSteps * 0.4); // 40% of steps
  
  // Initialize result storage to track steps
  const allSteps: StepInfo[] = [];
  let finalResponse = "";

  try {
    // STEP 1: Initial data retrieval step (common for both generate and update)
    log("info", "Starting sequential chain: Initial data retrieval step");
    
    // Determine if this is a generate or update action from the system prompt
    const isGenerateAction = systemPrompt.includes("Generate Documentation in Confluence");
    
    // Set appropriate tools to check based on action
    const initialRequiredTools = isGenerateAction 
      ? ["getFileContent", "getInternalDependencies", "getBusinessLogicHistory"]
      : ["getCommitDiff"];
      
    const initialDataResult = await generateText({
      model: model,
      maxSteps: initialStepsBudget,
      system: systemPrompt,
      prompt: userPrompt,
      tools: tools,
      temperature: temperature,
      toolChoice: "required"
    });

    // Record steps from the initial phase
    initialDataResult.steps.forEach(step => {
      const stepInfo: StepInfo = { type: step.toolCalls ? "tool" : "text" };
      
      if (step.toolCalls && step.toolCalls.length > 0) {
        const toolCall = step.toolCalls[0];
        if ("toolName" in toolCall) {
          const typedToolCall = toolCall as ToolCall;
          stepInfo.tool = {
            name: typedToolCall.toolName,
            args: typedToolCall.args
          };
        }
      }
      
      if (step.text) {
        stepInfo.text = step.text;
      }
      
      if (step.toolResults && step.toolResults.length > 0) {
        const toolResult = step.toolResults[0] as ToolResult;
        stepInfo.toolResult = toolResult.result;
      }
      
      allSteps.push(stepInfo);
    });

    // Check if all required tools were executed in the initial phase
    const executedInitialTools = new Set<string>();
    initialDataResult.steps.forEach(step => {
      if (step.toolCalls && step.toolCalls.length > 0) {
        const toolCall = step.toolCalls[0];
        if ("toolName" in toolCall) {
          executedInitialTools.add((toolCall as ToolCall).toolName);
        }
      }
    });
    
    const missingInitialTools = initialRequiredTools.filter(
      tool => !executedInitialTools.has(tool)
    );
    
    if (missingInitialTools.length > 0) {
      log("warn", "Missing required tools in initial data retrieval phase", { 
        missingTools: missingInitialTools 
      });
      
      // If important tools are missing, try to recover by explicitly asking for them
      const recoveryPrompt = initialDataResult.text + 
        "\n\nYou missed some important tools in the initial phase. Please call the following tools: " + 
        missingInitialTools.join(", ");
      
      const recoveryResult = await generateText({
        model: model,
        maxSteps: Math.floor(initialStepsBudget * 0.5),
        system: systemPrompt,
        prompt: recoveryPrompt,
        tools: tools,
        temperature: temperature,
        toolChoice: "required"
      });
      
      // Add recovery steps to all steps
      recoveryResult.steps.forEach(step => {
        const stepInfo: StepInfo = { type: step.toolCalls ? "tool" : "text" };
        
        if (step.toolCalls && step.toolCalls.length > 0) {
          const toolCall = step.toolCalls[0];
          if ("toolName" in toolCall) {
            const typedToolCall = toolCall as ToolCall;
            stepInfo.tool = {
              name: typedToolCall.toolName,
              args: typedToolCall.args
            };
            executedInitialTools.add(typedToolCall.toolName);
          }
        }
        
        if (step.text) {
          stepInfo.text = step.text;
        }
        
        if (step.toolResults && step.toolResults.length > 0) {
          const toolResult = step.toolResults[0] as ToolResult;
          stepInfo.toolResult = toolResult.result;
        }
        
        allSteps.push(stepInfo);
      });
    }

    // STEP 2: Analysis and documentation creation/update step
    log("info", "Continuing sequential chain: Analysis and documentation step");
    const analysisPrompt = initialDataResult.text + 
      (missingInitialTools.length > 0 ? "\n\nIncorporate the additional data from recovery steps." : "") +
      "\n\nNow analyze the retrieved data and prepare the documentation in markdown format.";
    
    const analysisResult = await generateText({
      model: model,
      maxSteps: analysisStepsBudget,
      system: systemPrompt,
      prompt: analysisPrompt,
      tools: tools,
      temperature: temperature
    });

    // Record steps from the analysis phase
    analysisResult.steps.forEach(step => {
      const stepInfo: StepInfo = { type: step.toolCalls ? "tool" : "text" };
      
      if (step.toolCalls && step.toolCalls.length > 0) {
        const toolCall = step.toolCalls[0];
        if ("toolName" in toolCall) {
          const typedToolCall = toolCall as ToolCall;
          stepInfo.tool = {
            name: typedToolCall.toolName,
            args: typedToolCall.args
          };
        }
      }
      
      if (step.text) {
        stepInfo.text = step.text;
      }
      
      if (step.toolResults && step.toolResults.length > 0) {
        const toolResult = step.toolResults[0] as ToolResult;
        stepInfo.toolResult = toolResult.result;
      }
      
      allSteps.push(stepInfo);
    });

    // STEP 3: Final step - Confluence conversion and page creation/update
    // Define the critical tools required for this phase
    const finalRequiredTools = isGenerateAction 
      ? ["markdownToConfluence", "createConfluencePage"]
      : ["markdownToConfluence", "updateConfluencePage"];
    
    // Track the pageId for update operations
    let retrievedPageId: string | null = null;
    let retrievedPageTitle: string | null = null;
    let retrievedPageVersion: number = 0;
    
    // Find if we already have a page ID and version from previous steps
    initialDataResult.steps.forEach(step => {
      if (step.toolCalls && step.toolCalls.length > 0) {
        const toolCall = step.toolCalls[0];
        if ("toolName" in toolCall && toolCall.toolName === "getConfluencePage" && step.toolResults && step.toolResults.length > 0) {
          const result = step.toolResults[0] as ToolResult;
          if (result && result.result) {
            const pageResult = result.result as { id: string; title: string; version: { number: number } };
            retrievedPageId = pageResult.id;
            retrievedPageTitle = pageResult.title;
            retrievedPageVersion = pageResult.version.number;
            log("info", "Found existing page details", { pageId: retrievedPageId, title: retrievedPageTitle, version: retrievedPageVersion });
          }
        } else if ("toolName" in toolCall && toolCall.toolName === "findDocumentationPage" && step.toolResults && step.toolResults.length > 0) {
          const result = step.toolResults[0] as ToolResult;
          if (result && result.result) {
            const pageResult = result.result as { id?: string; title?: string; version?: { number: number } };
            if (pageResult.id) {
              retrievedPageId = pageResult.id;
              retrievedPageTitle = pageResult.title || "Documentation";
              retrievedPageVersion = pageResult.version?.number || 1;
              log("info", "Found documentation page via search", { pageId: retrievedPageId, title: retrievedPageTitle, version: retrievedPageVersion });
            }
          }
        }
      }
    });
    
    log("info", "Final sequential chain step: Confluence conversion and page creation/update");
    let finalPrompt = analysisResult.text + 
      "\n\nNow convert the markdown to Confluence format and " + 
      (isGenerateAction ? "create a new page" : "update the existing page") + 
      ".\n\nIMPORTANT: You MUST call these required tools in order: " + 
      finalRequiredTools.join(", ");
    
    // For update operations, include the specific pageId if available
    if (!isGenerateAction && retrievedPageId) {
      finalPrompt += `\n\nFor the updateConfluencePage call, use these EXACT values:\n- pageId: "${retrievedPageId}"\n- title: "${retrievedPageTitle}"\n- version: ${retrievedPageVersion}`;
    }
    
    const finalResult = await generateText({
      model: model,
      maxSteps: finalStepsBudget,
      system: systemPrompt,
      prompt: finalPrompt,
      tools: tools,
      temperature: temperature,
      toolChoice: "required"
    });

    // Record steps from the final phase
    finalResult.steps.forEach(step => {
      const stepInfo: StepInfo = { type: step.toolCalls ? "tool" : "text" };
      
      if (step.toolCalls && step.toolCalls.length > 0) {
        const toolCall = step.toolCalls[0];
        if ("toolName" in toolCall) {
          const typedToolCall = toolCall as ToolCall;
          
          // If this is an updateConfluencePage call with a placeholder pageId, fix it
          if (typedToolCall.toolName === "updateConfluencePage" && retrievedPageId) {
            const args = typedToolCall.args as { pageId: string; title: string; content: string; version: number };
            if (args.pageId && (args.pageId === "123" || args.pageId === "[Retrieved pageId]")) {
              log("warn", "Fixing placeholder pageId in updateConfluencePage call", {
                original: args.pageId,
                corrected: retrievedPageId
              });
              args.pageId = retrievedPageId;
              
              // Also ensure title and version are correct
              if (args.title === "[Retrieved title]" || !args.title) {
                args.title = retrievedPageTitle || "Documentation";
              }
              if (args.version === 1 || args.version === 0 || args.version === "[Retrieved version]" as unknown as number) {
                args.version = retrievedPageVersion;
              }
            }
          }
          
          stepInfo.tool = {
            name: typedToolCall.toolName,
            args: typedToolCall.args
          };
        }
      }
      
      if (step.text) {
        stepInfo.text = step.text;
      }
      
      if (step.toolResults && step.toolResults.length > 0) {
        const toolResult = step.toolResults[0] as ToolResult;
        stepInfo.toolResult = toolResult.result;
      }
      
      allSteps.push(stepInfo);
    });

    // Check if all final required tools were executed
    const executedFinalTools = new Set<string>();
    finalResult.steps.forEach(step => {
      if (step.toolCalls && step.toolCalls.length > 0) {
        const toolCall = step.toolCalls[0];
        if ("toolName" in toolCall) {
          executedFinalTools.add((toolCall as ToolCall).toolName);
        }
      }
    });
    
    const missingFinalTools = finalRequiredTools.filter(
      tool => !executedFinalTools.has(tool)
    );
    
    if (missingFinalTools.length > 0) {
      log("warn", "Missing required tools in final phase", { 
        missingTools: missingFinalTools 
      });
      
      // For critical tools, try one more recovery attempt
      const recoveryPrompt = finalResult.text + 
        "\n\nYou missed some CRITICAL tools in the final phase. You MUST call these tools for the documentation to be saved: " + 
        missingFinalTools.join(", ") + "\n\nPlease call these tools now with the appropriate parameters.";
      
      const recoveryResult = await generateText({
        model: model,
        maxSteps: Math.floor(finalStepsBudget * 0.5),
        system: systemPrompt,
        prompt: recoveryPrompt,
        tools: tools,
        temperature: temperature,
        toolChoice: "required"
      });
      
      // Add recovery steps to all steps
      recoveryResult.steps.forEach(step => {
        const stepInfo: StepInfo = { type: step.toolCalls ? "tool" : "text" };
        
        if (step.toolCalls && step.toolCalls.length > 0) {
          const toolCall = step.toolCalls[0];
          if ("toolName" in toolCall) {
            const typedToolCall = toolCall as ToolCall;
            stepInfo.tool = {
              name: typedToolCall.toolName,
              args: typedToolCall.args
            };
          }
        }
        
        if (step.text) {
          stepInfo.text = step.text;
        }
        
        if (step.toolResults && step.toolResults.length > 0) {
          const toolResult = step.toolResults[0] as ToolResult;
          stepInfo.toolResult = toolResult.result;
        }
        
        allSteps.push(stepInfo);
      });
      
      // Update final response with recovery result
      finalResponse = recoveryResult.text;
    } else {
      // Combine responses from each step if all required tools were called
      finalResponse = finalResult.text;
    }
  } catch (error) {
    // Specific handling for common errors
    let errorMessage = "Error in documentation process: ";
    
    if (error instanceof Error) {
      // Handle commit not found errors with more user-friendly messages
      if (error.message.includes("Commit not found") || error.message.includes("bad object")) {
        log("error", "Invalid commit ID error", {
          error: error.message,
          stack: error.stack
        });
        errorMessage += "The specified commit ID could not be found in the repository. Please verify the commit ID is correct.";
      } 
      // Handle missing or placeholder commit ID errors
      else if (error.message.includes("placeholder commit ID") || 
               error.message.includes("A valid commit ID is required") ||
               error.message.includes("Invalid commit ID format")) {
        log("error", "Missing or invalid commit ID error", {
          error: error.message,
          stack: error.stack
        });
        errorMessage += "A valid commit ID is required for this operation. Please provide a valid Git commit hash.";
      }
      // Handle Confluence-specific errors
      else if (error.message.includes("Failed to update Confluence page") || error.message.includes("Failed to create Confluence page")) {
        log("error", "Confluence API error", {
          error: error.message,
          stack: error.stack
        });
        errorMessage += "There was a problem with the Confluence API. " + error.message;
      }
      // Generic error handling
      else {
        log("error", "Error in sequential chain execution", {
          error: error.message,
          stack: error.stack
        });
        errorMessage += error.message;
      }
    } else {
      log("error", "Unknown error in sequential chain execution", {
        error: String(error)
      });
      errorMessage += "Unknown error";
    }
    
    finalResponse = errorMessage;
  }

  // Return combined results
  return {
    response: finalResponse,
    steps: allSteps
  };
}
