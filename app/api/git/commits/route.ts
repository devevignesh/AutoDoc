import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    // Validate commit hash format to prevent command injection
    if (!id || !/^[0-9a-f]{7,40}$/.test(id)) {
      return NextResponse.json(
        { error: "Invalid commit hash format" },
        { status: 400 }
      );
    }

    // Get the specific commit
    const { stdout } = await execPromise(
      `git show --pretty=format:'{"hash":"%h","fullHash":"%H","author":"%an","email":"%ae","date":"%ad","timestamp":"%at","message":"%s"}' --name-only ${id}`
    );

    const lines = stdout.split("\n").filter(line => line.trim() !== "");

    if (lines.length === 0) {
      return NextResponse.json({ error: "Commit not found" }, { status: 404 });
    }

    try {
      // First line contains the commit info
      const cleanLine = lines[0].replace(/^'|'$/g, "").replace(/\\'/g, "'");
      const commitInfo = JSON.parse(cleanLine);

      // Remaining lines are file paths
      const files = lines.slice(1);

      return NextResponse.json({
        success: true,
        id,
        commit: {
          ...commitInfo,
          files
        }
      });
    } catch (e) {
      console.error("Error parsing commit info:", e);
      return NextResponse.json(
        { error: "Failed to parse commit info" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error fetching git commits:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch git commits",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}
