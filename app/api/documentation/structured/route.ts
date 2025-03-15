import { NextRequest, NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import axios from "axios";
import { z } from "zod";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request
    if (!body.filePath) {
      return NextResponse.json(
        { error: "Missing required parameter: filePath" },
        { status: 400 }
      );
    }

    // Get file content
    const fileResponse = await axios.get(`/api/git/file?path=${encodeURIComponent(body.filePath)}`);
    const fileContent = fileResponse.data.content;
    const fileType = body.filePath.split('.').pop() || 'txt';

    // Set up the agent with tools and structured output
    const { toolCalls } = await generateText({
      model: openai('gpt-4o', { structuredOutputs: true }),
      system: `You are an expert documentation generator that creates comprehensive documentation for code files.
               Your goal is to analyze code, understand its purpose, and create clear, accurate documentation.`,
      prompt: `Generate documentation for the following ${fileType} file:
              
              ${body.filePath}
              
              File content:
              \`\`\`${fileType}
              ${fileContent}
              \`\`\`
              
              Analyze the code and provide comprehensive documentation.`,
      tools: {
        // Structured output tool for documentation
        documentationOutput: tool({
          description: "Provide the final documentation output",
          parameters: z.object({
            overview: z.string().describe("A high-level overview of what the file does"),
            purpose: z.string().describe("The purpose and functionality of the code"),
            dependencies: z.array(z.string()).describe("External dependencies and imports used"),
            functions: z.array(z.object({
              name: z.string(),
              description: z.string(),
              parameters: z.array(z.object({
                name: z.string(),
                type: z.string(),
                description: z.string()
              })).optional(),
              returnValue: z.object({
                type: z.string(),
                description: z.string()
              }).optional()
            })).optional(),
            components: z.array(z.object({
              name: z.string(),
              description: z.string(),
              props: z.array(z.object({
                name: z.string(),
                type: z.string(),
                description: z.string(),
                required: z.boolean().optional()
              })).optional()
            })).optional(),
            examples: z.array(z.string()).optional().describe("Usage examples"),
            notes: z.array(z.string()).optional().describe("Additional notes or considerations")
          })
        })
      },
      toolChoice: "documentationOutput", // Force the model to use the documentation output tool
      maxSteps: 1 // Only one step needed for structured output
    });

    // Return the structured documentation
    return NextResponse.json({
      success: true,
      documentation: toolCalls[0].input
    });
  } catch (error: unknown) {
    console.error("Error generating structured documentation:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Documentation generation error", details: errorMessage },
      { status: 500 }
    );
  }
} 