import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Simple test API endpoint that doesn't use AI
 * This is useful for testing the documentation generator without AI dependencies
 */
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

    // Check if file exists
    const filePath = body.filePath;
    let fileContent = "";
    
    try {
      // Try to read the file
      fileContent = fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
    } catch (error) {
      return NextResponse.json(
        { error: "File not found or cannot be read", details: (error as Error).message },
        { status: 404 }
      );
    }

    // Generate a simple documentation object
    const fileExtension = path.extname(filePath).replace(".", "");
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath);
    
    // Count lines of code
    const lines = fileContent.split("\n");
    const lineCount = lines.length;
    
    // Count imports
    const importLines = lines.filter(line => 
      line.trim().startsWith("import ") || 
      line.trim().startsWith("from ") ||
      line.trim().startsWith("require(")
    );
    
    // Count functions
    const functionLines = lines.filter(line => 
      line.includes("function ") || 
      line.includes("=> {") ||
      line.includes("async ")
    );
    
    // Generate mock documentation
    const documentation = {
      overview: `Documentation for ${fileName}`,
      purpose: `This file appears to be a ${fileExtension} file located in ${dirName}.`,
      stats: {
        lines: lineCount,
        imports: importLines.length,
        functions: functionLines.length
      },
      content: {
        firstLine: lines[0] || "",
        lastLine: lines[lines.length - 1] || ""
      },
      generatedAt: new Date().toISOString()
    };

    // Return the documentation
    return NextResponse.json({
      success: true,
      documentation
    });
  } catch (error: unknown) {
    console.error("Error in test documentation endpoint:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Test documentation error", details: errorMessage },
      { status: 500 }
    );
  }
} 