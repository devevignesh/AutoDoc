import { NextRequest, NextResponse } from "next/server";
import { getInternalDependencies, getFileContent } from "../git/gitClient";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { filePath } = body;

    if (!filePath) {
      return NextResponse.json(
        { error: "Missing required parameter: filePath" },
        { status: 400 }
      );
    }

    // Get the internal dependencies
    const dependencies = await getInternalDependencies(filePath);

    // Get the content of each dependency
    const dependencyContents = await Promise.all(
      dependencies.map(async (depPath) => {
        try {
          const content = await getFileContent(depPath);
          return {
            path: depPath,
            content: content.substring(0, 100) + "...", // Truncate content for display
            filename: depPath.split("/").pop() || depPath
          };
        } catch (error) {
          return {
            path: depPath,
            content: "",
            filename: depPath.split("/").pop() || depPath,
            error: error instanceof Error ? error.message : "Failed to retrieve content"
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      filePath,
      dependencies,
      dependencyContents
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to get internal dependencies: ${message}` },
      { status: 500 }
    );
  }
} 