import { NextRequest, NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import axios from "axios";
import { z } from "zod";
import { DOC_CONFIG } from "../config";
import {
  createConfluencePage,
  updateConfluencePage,
  getConfluencePage,
  findDocumentationPage
} from "../confluence/confluenceClient";
import { DocumentationRequest } from "../types";

// Main handler for documentation requests
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as DocumentationRequest;

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
      model: openai("gpt-4o", { structuredOutputs: true }),
      maxSteps: 10, // Allow up to 10 steps for complex documentation tasks
      system: `You are an expert documentation generator that creates comprehensive documentation for code files.
               Your goal is to analyze code, understand its purpose, and create clear, accurate documentation.
               Use the available tools to fetch file content, analyze dependencies, and create or update documentation in Confluence.`,
      prompt: `Generate documentation for ${
        body.filePath || `files changed in commit ${body.commitId}`
      }.
              Space ID: ${body.spaceId}
              ${body.parentPageId ? `Parent Page ID: ${body.parentPageId}` : ""}
              Action: ${body.action || "generate"}`,
      tools: {
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
              const url = commitId
                ? `/api/git/file?path=${encodeURIComponent(
                    filePath
                  )}&commitId=${commitId}`
                : `/api/git/file?path=${encodeURIComponent(filePath)}`;

              const response = await axios.get(url);
              return response.data.content;
            } catch (error) {
              console.error("Error getting file content:", error);
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
              const response = await axios.get(
                `/api/git/diff?commit=${commitId}`
              );
              return response.data.diff;
            } catch (error) {
              console.error("Error getting commit diff:", error);
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
              const response = await axios.get(
                `/api/git/diff?commit=${commitId}`
              );
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
                const extension = file.split(".").pop() || "";
                return DOC_CONFIG.SUPPORTED_EXTENSIONS.includes(
                  `.${extension}`
                );
              });
            } catch (error) {
              console.error("Error getting affected files:", error);
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
            content: z
              .string()
              .describe("Page content in Confluence storage format"),
            parentId: z
              .string()
              .optional()
              .describe("Parent page ID (optional)")
          }),
          execute: async ({ spaceId, title, content, parentId }) => {
            try {
              const pageId = await createConfluencePage(
                spaceId,
                title,
                content,
                parentId
              );

              return {
                success: true,
                pageId,
                title
              };
            } catch (error) {
              console.error("Error creating Confluence page:", error);
              return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error"
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
            content: z
              .string()
              .describe("Page content in Confluence storage format"),
            version: z.number().describe("Page version number")
          }),
          execute: async ({ pageId, title, content, version }) => {
            try {
              const updatedPageId = await updateConfluencePage(
                pageId,
                title,
                content,
                version
              );

              return {
                success: true,
                pageId: updatedPageId,
                title
              };
            } catch (error) {
              console.error("Error updating Confluence page:", error);
              return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error"
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
              const page = await getConfluencePage(pageId);
              return page;
            } catch (error) {
              console.error("Error getting Confluence page:", error);
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
              const pageId = await findDocumentationPage(spaceId, title);
              if (pageId) {
                const page = await getConfluencePage(pageId);
                return page;
              }
              return null;
            } catch (error) {
              console.error("Error finding Confluence page:", error);
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

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Documentation agent error", details: errorMessage },
      { status: 500 }
    );
  }
}
