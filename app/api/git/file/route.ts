import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execPromise = promisify(exec);

// Helper function to validate file paths to prevent path traversal
function isValidFilePath(filePath: string): boolean {
  // Disallow paths with ".." to prevent directory traversal
  if (filePath.includes("..")) {
    return false;
  }

  // Only allow alphanumeric characters, dots, dashes, underscores, and forward slashes
  return /^[0-9a-zA-Z\.\-\_\/]+$/.test(filePath);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get("path");
    const commitId = searchParams.get("commitId");

    if (!filePath) {
      return NextResponse.json(
        { error: "File path is required" },
        { status: 400 }
      );
    }

    // Validate file path to prevent path traversal
    if (!isValidFilePath(filePath)) {
      return NextResponse.json(
        { error: "Invalid file path format" },
        { status: 400 }
      );
    }

    let content: string;

    if (commitId) {
      // Validate commit hash format to prevent command injection
      if (!/^[0-9a-f]{7,40}$/.test(commitId)) {
        return NextResponse.json(
          { error: "Invalid commit hash format" },
          { status: 400 }
        );
      }

      // Get file content at specific commit
      const { stdout } = await execPromise(`git show ${commitId}:${filePath}`);
      content = stdout;
    } else {
      // Get current file content
      try {
        content = fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
      } catch (fileError) {
        return NextResponse.json(
          {
            error: "File not found or cannot be read",
            details: (fileError as Error).message
          },
          { status: 404 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      path: filePath,
      commitId: commitId || "current",
      content
    });
  } catch (error) {
    console.error("Error fetching file content:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch file content",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}