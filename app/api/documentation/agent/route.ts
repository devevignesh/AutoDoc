import { NextRequest, NextResponse } from "next/server";
import { google } from "@ai-sdk/google";
import { generateText, tool } from "ai";
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
  getAffectedFiles
} from "../git/gitClient";

// Constants
const DEFAULT_TEMPERATURE = 0.1;
const MAX_STEPS = 10;
const REQUIRED_TOOLS = [
  "getFileContent",
  "markdownToConfluence",
  "createConfluencePage"
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

// Main handler for documentation requests
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    log("info", "Documentation agent request received");

    const body = (await request.json()) as DocumentationRequest;
    log("info", "Request received", { body });

    // Validate request
    if (!body.spaceId) {
      log("error", "Missing required parameter: spaceId");
      return NextResponse.json(
        { error: "Missing required parameter: spaceId" },
        { status: 400 }
      );
    }

    // Validate action-specific parameters
    if (body.action === "generate" && !body.filePath) {
      log("error", "filePath is required for 'generate' action");
      return NextResponse.json(
        { error: "filePath is required for 'generate' action" },
        { status: 400 }
      );
    }

    if (body.action === "update" && !body.commitId) {
      log("error", "commitId is required for 'update' action");
      return NextResponse.json(
        { error: "commitId is required for 'update' action" },
        { status: 400 }
      );
    }

    if (!body.action) {
      // Default to 'generate' if filePath is provided, otherwise 'update'
      body.action = body.filePath ? "generate" : "update";
      log("info", `Action not specified, defaulting to: ${body.action}`);
    }

    log("info", `Starting documentation agent`, {
      action: body.action,
      target: body.action === "generate" ? body.filePath : body.commitId
    });

    // Run the agent based on action type
    return await runDocumentationAgent(body);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log("error", `Documentation agent failed: ${errorMessage}`, {
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json(
      {
        error: "Documentation agent error",
        details: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * Runs the documentation agent based on the request action
 */
async function runDocumentationAgent(
  body: DocumentationRequest
): Promise<NextResponse> {
  try {
    log("info", `Running documentation agent with action: ${body.action}`, {
      actionDetails:
        body.action === "generate"
          ? { filePath: body.filePath }
          : { commitId: body.commitId }
    });

    // Setup the agent with appropriate system prompt and tools
    const { steps } = await generateText({
      model: google("gemini-2.0-flash-001"),
      maxSteps: MAX_STEPS,
      system: getSystemPrompt(body.action),
      prompt: getPrompt(body),
      tools: getTools(),
      temperature: DEFAULT_TEMPERATURE,
      // Force function calling if "generate" action for most reliable results
      toolChoice: body.action === "generate" ? "required" : "auto"
    });

    // Log detailed information about each step
    log("info", `Agent execution completed with ${steps.length} steps`);
    steps.forEach((step, index) => {
      const stepNumber = index + 1;
      const toolNames =
        step.toolCalls?.map(call =>
          "toolName" in call ? call.toolName : "unknown"
        ) || [];

      log("info", `Step ${stepNumber} summary`, {
        toolCalls: toolNames,
        hasToolResults: (step.toolResults?.length || 0) > 0,
        hasText: !!step.text
      });
    });

    // Collect all the function calls that were made
    const executedTools = new Set<string>();
    let pageId: string | undefined;
    let pageTitle: string | undefined;

    steps.forEach(step => {
      if (step.toolCalls) {
        step.toolCalls.forEach(call => {
          if ("toolName" in call) {
            executedTools.add(call.toolName);
          }
        });
      }

      // Extract created page information from tool results
      if (step.toolResults) {
        step.toolResults.forEach(result => {
          if (result.toolName === "createConfluencePage" && result.result) {
            const createResult = result.result as {
              pageId: string;
              title: string;
            };
            pageId = createResult.pageId;
            pageTitle = createResult.title;
          }
        });
      }
    });

    // Check if all required tools were executed
    const missingTools = REQUIRED_TOOLS.filter(
      tool => !executedTools.has(tool)
    );

    if (missingTools.length > 0) {
      log("warn", "Agent did not execute all required tools", {
        missingTools,
        executedTools: Array.from(executedTools)
      });

      return NextResponse.json({
        success: false,
        partialSuccess: true,
        missingSteps: missingTools,
        message:
          "Documentation generation was incomplete. Some required tools were not executed."
      });
    }

    // Return success response
    log("info", "Documentation agent completed successfully", {
      pageId,
      pageTitle
    });
    return NextResponse.json({
      success: true,
      pageId,
      title: pageTitle,
      steps: steps.length,
      message: "Documentation generation completed successfully"
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("error", `Agent execution failed: ${errorMessage}`, {
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error; // Let the main handler handle the error response
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
    
    2. Analyze and Document:
    - Analyze the retrieved code thoroughly.
    - Action Required: Create detailed documentation in Markdown format, ensuring clarity and comprehensiveness.
    
    3. Convert to Confluence Format:
        - Call the markdownToConfluence function to convert the Markdown documentation into Confluence format.
        - Action Required: Wait for the conversion result before proceeding.
    
    4. Create Confluence Page:
        - Call the createConfluencePage function to publish the documentation in Confluence.
        - Action Required: Wait for confirmation that the page has been successfully created.
    
    Important Guidelines:

    - Sequential Execution: Each step must be completed in the specified order. Do not proceed to the next step until the current one is fully completed.
    - Function Calls: Use the exact function names as provided. Ensure each function call returns successfully before moving on.
    - Documentation Format: Always generate the documentation in Markdown format first, then convert it to Confluence format.
    - Error Handling: Implement error handling to manage any issues that arise during function calls or conversions.

    Note: Adherence to these instructions is crucial for the successful generation and publication of documentation.`;
  } else {
    return `${basePrompt} Your primary goal is to analyze changes in a commit, understand what was modified, and produce or update documentation that reflects these changes. Focus on identifying what functionality changed and how it affects the codebase.
    
    IMPORTANT: Your workflow should ALWAYS follow these steps in order:
    1. Use getAffectedFiles function to get the list of files affected by the commit. Wait for the result.
    2. Use getCommitDiff function to analyze the changes. Wait for the result.
    3. For each important file, find if documentation already exists using findDocumentationPage function. Wait for the result.
    4. If documentation exists, update it with updateConfluencePage function. Wait for the result.
    5. If documentation doesn't exist, create new documentation with createConfluencePage function. Wait for the result.
    
    DO NOT SKIP STEPS and always make sure to complete the entire workflow. Wait for each function call to return before proceeding to the next step.`;
  }
}

/**
 * Get the user prompt based on the request
 */
function getPrompt(request: DocumentationRequest): string {
  const { action, filePath, commitId, spaceId, parentPageId } = request;

  if (action === "generate" && filePath) {
    return `<prompt>
    <role>
        You are a technical writer with expertise in software documentation, tasked with creating a comprehensive technical document that explains the business logic and use cases of a file, focusing on the scheduling component of an application. Your document should be understandable by a Product Owner and serve as a learning resource for freshers and interns.
    </role>
    <instructions>
        1. Retrieve the file content using the 'getFileContent' tool:
        <function_call>getFileContent(filePath="${filePath}")</function_call>
        
        2. Analyze the file content to extract business logic and use cases, focusing on the scheduling component:
        - Identify key functions and their roles in the scheduling process.
        - Determine how the scheduling component interacts with other parts of the application.
        - Highlight any dependencies or critical paths within the scheduling logic.
        
        3. Structure the document to be clear and accessible:
        - Use markdown headers to organize the document into sections such as "Introduction", "Business Logic", and "Use Cases".
        - Provide clear explanations and examples to illustrate complex concepts.
        - Ensure the document is suitable for both technical and non-technical audiences.

        4. Convert the document to Confluence format using the 'markdownToConfluence' tool:
        <function_call>markdownToConfluence(markdown="[Your markdown content]")</function_call>
        
        5. Create a Confluence page using the 'createConfluencePage' tool:
        <function_call>createConfluencePage(spaceId="${spaceId}", title="Documentation: ${filePath
      .split("/")
      .pop()}", content="[Confluence formatted content]"${
      parentPageId ? `, parentId="${parentPageId}"` : ""
    })</function_call>
        
        7. Verify the accuracy and completeness of the document before publishing.
        
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
        
        2. Analyze content for business logic and use cases.
        
        3. Structure document with sections: Introduction, Business Logic, and Use Cases.
        
        4. Convert to Confluence format:
        <function_call>markdownToConfluence(markdown="# Introduction\n...")</function_call>
        
        5. Create Confluence page:
        <function_call>createConfluencePage(spaceId="12345", title="Documentation: schedulingComponent.js", content="[Confluence formatted content]", parentId="67890")</function_call>
        </thinking_process>
        
        <final_response>
        # Introduction
        This document provides a comprehensive overview of the scheduling component within our application, detailing its business logic and use cases. It is designed to be accessible to Product Owners and serve as a learning resource for freshers and interns.

        # Business Logic
        The scheduling component is responsible for...

        # Use Cases
        The primary use cases for the scheduling component include...
        </final_response>
    </examples>
  
    <reminder>
        - Ensure the document is comprehensive and accessible to both technical and non-technical audiences.
        - Use markdown headers to organize the document into sections.
        - Verify the accuracy and completeness of the document before publishing.
    </reminder>
  
    <output_format>
        Structure your output as follows:
        <thinking_process>
        [Detail your process of retrieving file content, analyzing business logic, and structuring the document]
        </thinking_process>
        <final_response>
        [Provide your structured document with markdown headers and content]
        </final_response>
    </output_format>
    </prompt>`;
  } else if (action === "update" && commitId) {
    return `<prompt>
    <role>
        You are a technical writer and documentation specialist with expertise in software development and business logic. Your role is to update existing documentation based on code changes, ensuring that it remains clear and accessible to both technical and non-technical stakeholders while maintaining the integrity of the business logic.
    </role>
    
    <instructions>
        1. Identify the code changes:
        - Use the 'commitId' to find the affected files.
        - Call: <function_call>getAffectedFiles(commitId="${commitId}")</function_call>
        - Analyze the specific changes made in the code.
        - Call: <function_call>getCommitDiff(commitId="${commitId}")</function_call>
        
        2. Analyze the impact on business logic:
        - Review the code changes to understand how they affect the existing business logic.
        - Identify any new logic introduced or existing logic modified.
        
        3. Locate the relevant documentation:
        - Use the 'spaceId' to find the documentation pages that need updating.
        - Call: <function_call>findDocumentationPage(spaceId="${spaceId}", title="[Appropriate title based on file name]")</function_call>
        
        4. Update the documentation:
        - Clearly explain the code changes and their impact on business logic.
        - Use simple language and avoid technical jargon to ensure accessibility for non-technical stakeholders.
        - Maintain the integrity of the business logic in the documentation.
        - Structure the documentation with clear headings and bullet points for easy readability.
        
        5. Verify the updated documentation:
        - Cross-check the updated documentation against the code changes to ensure accuracy.
        - Ensure that the documentation is comprehensive and covers all aspects of the code changes.
        
        6. Interact with the user:
        - Present the updated documentation and ask for feedback.
        - Make any necessary adjustments based on user feedback.
        
        Remember to maintain a clear, concise, and accessible style throughout the documentation process.
    </instructions>
    
    <response_style>
        Your responses should be clear, concise, and accessible to both technical and non-technical audiences. Use simple language and avoid technical jargon. Structure the documentation with clear headings and bullet points for easy readability. Maintain the integrity of the business logic in the documentation.
    </response_style>
    
    <examples>
        Example 1:
        <thinking_process>
        1. Identify affected files using commitId.
        2. Analyze code changes to understand impact on business logic.
        3. Locate relevant documentation using spaceId.
        4. Update documentation to reflect code changes.
        5. Verify accuracy of updated documentation.
        </thinking_process>
        
        <final_response>
        ## Updated Documentation

        ### Overview
        - **Commit ID**: ${commitId}
        - **Space ID**: ${spaceId}

        ### Code Changes
        - **Affected Files**: [List of affected files]
        - **Summary of Changes**: [Brief summary of code changes]

        ### Impact on Business Logic
        - **New Logic Introduced**: [Description of new logic]
        - **Modified Logic**: [Description of modified logic]

        ### Updated Documentation
        - **Section 1**: [Updated content]
        - **Section 2**: [Updated content]

        ### Verification
        - **Cross-checked with Code Changes**: [Verification details]

        ### Feedback
        - Please review the updated documentation and provide feedback.
        </final_response>
    </examples>
    
    <reminder>
        - Ensure that the documentation is understandable by non-technical stakeholders.
        - Maintain the integrity of business logic in the documentation.
        - Use the tools effectively to gather necessary information.
        - Verify the accuracy of the updated documentation against the code changes.
    </reminder>
    
    <output_format>
        Structure your output as follows:
        <thinking_process>
        [Detail your process of identifying code changes, analyzing their impact, and updating the documentation]
        </thinking_process>
        <final_response>
        [Provide the updated documentation with markdown headers for subsections]
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

    // Tool to get commit diff
    getCommitDiff: tool({
      description: "Get the diff for a specific commit",
      parameters: z.object({
        commitId: z.string().describe("Commit hash")
      }),
      execute: async ({ commitId }) => {
        try {
          log("info", "Getting commit diff", { commitId });
          const diffInfo = await getCommitDiff(commitId);
          log("info", "Successfully retrieved commit diff", {
            diffLength: diffInfo.diff.length
          });
          return diffInfo.diff;
        } catch (error) {
          log("error", "Error getting commit diff", {
            commitId,
            error: error instanceof Error ? error.message : String(error)
          });
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
          log("info", "Getting affected files for commit", { commitId });
          const diffInfo = await getCommitDiff(commitId);
          const files = getAffectedFiles(diffInfo);
          log("info", "Successfully retrieved affected files", {
            fileCount: files.length
          });
          return files;
        } catch (error) {
          log("error", "Error getting affected files", {
            commitId,
            error: error instanceof Error ? error.message : String(error)
          });
          return [];
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
