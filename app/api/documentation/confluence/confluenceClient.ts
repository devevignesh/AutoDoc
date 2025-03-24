import axios from "axios";
import { CONFLUENCE_CONFIG } from "../config";
import { ConfluenceCredentials, ConfluencePage } from "../types";
import { log } from "@/lib/utils";

/**
 * Get Confluence credentials from environment variables
 *
 * @returns Confluence credentials
 */
export function getConfluenceCredentials(): ConfluenceCredentials {
  const email = process.env.CONFLUENCE_EMAIL;
  const apiToken = process.env.CONFLUENCE_API_TOKEN;
  const baseUrl = process.env.CONFLUENCE_BASE_URL || CONFLUENCE_CONFIG.BASE_URL;

  if (!email || !apiToken) {
    throw new Error(
      "Missing Confluence credentials. Please set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN environment variables."
    );
  }

  return {
    email,
    apiToken,
    baseUrl: baseUrl as string
  };
}

/**
 * Interface for Confluence page creation request
 */
interface ConfluencePageCreationRequest {
  spaceId: string;
  status: string;
  title: string;
  body: {
    representation: string;
    value: string;
  };
  parentId?: string;
}

/**
 * Create a new page in Confluence
 *
 * @param spaceId - Confluence space ID
 * @param title - Page title
 * @param content - Page content in Confluence storage format
 * @param parentId - Parent page ID (optional)
 * @returns Promise with the created page ID
 */
export async function createConfluencePage(
  spaceId: string,
  title: string,
  content: string,
  parentId?: string
): Promise<string> {
  try {
    const credentials = getConfluenceCredentials();
    const apiUrl = `${credentials.baseUrl}/wiki/api/v2/pages`;

    const requestBody: ConfluencePageCreationRequest = {
      spaceId,
      status: "current",
      title,
      body: {
        representation: "storage",
        value: content
      }
    };

    if (parentId) {
      requestBody.parentId = parentId;
    }

    const response = await axios.post(apiUrl, requestBody, {
      auth: {
        username: credentials.email,
        password: credentials.apiToken
      },
      headers: {
        "Content-Type": "application/json"
      }
    });

    return response.data.id;
  } catch (error) {
    console.error("Error creating Confluence page:", error);
    throw new Error(
      `Failed to create Confluence page: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Update an existing page in Confluence
 *
 * @param pageId - Page ID
 * @param title - Page title
 * @param content - Page content in Confluence storage format
 * @param version - Page version
 * @returns Promise with the updated page ID
 */
export async function updateConfluencePage(
  pageId: string,
  title: string,
  content: string,
  version: number
): Promise<string> {
  try {
    const credentials = getConfluenceCredentials();
    const apiUrl = `${credentials.baseUrl}/wiki/api/v2/pages/${pageId}`;

    const response = await axios.put(
      apiUrl,
      {
        id: pageId,
        status: "current",
        title,
        body: {
          representation: "storage",
          value: content
        },
        version: {
          number: version + 1
        }
      },
      {
        auth: {
          username: credentials.email,
          password: credentials.apiToken
        },
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.id;
  } catch (error) {
    console.error("Error updating Confluence page:", error);
    throw new Error(
      `Failed to update Confluence page: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Get a page from Confluence by ID
 *
 * @param pageId - Page ID
 * @returns Promise with the page
 */
export async function getConfluencePage(
  pageId: string
): Promise<ConfluencePage> {
  try {
    const credentials = getConfluenceCredentials();
    const apiUrl = `${credentials.baseUrl}/wiki/api/v2/pages/${pageId}?body-format=storage`;

    const response = await axios.get(apiUrl, {
      auth: {
        username: credentials.email,
        password: credentials.apiToken
      }
    });

    return response.data;
  } catch (error) {
    console.error("Error getting Confluence page:", error);
    throw new Error(
      `Failed to get Confluence page: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Find a page in Confluence by title
 *
 * @param spaceId - Confluence space ID
 * @param title - Page title
 * @returns Promise with the page ID or null if not found
 */
export async function findDocumentationPage(
  spaceId: string,
  title: string
): Promise<string | null> {
  try {
    const credentials = getConfluenceCredentials();
    const apiUrl = `${credentials.baseUrl}/wiki/api/v2/spaces/${spaceId}/pages`;

    const response = await axios.get(apiUrl, {
      params: {
        title,
        status: "current",
        limit: 10
      },
      auth: {
        username: credentials.email,
        password: credentials.apiToken
      }
    });

    const pages = response.data.results;

    if (pages && pages.length > 0) {
      // Find exact match
      const exactMatch = pages.find(
        (page: { title: string; id: string }) => page.title === title
      );
      if (exactMatch) {
        return exactMatch.id;
      }
    }

    return null;
  } catch (error) {
    console.error("Error finding Confluence page:", error);
    return null;
  }
}

/**
 * Get a page title from a file path
 *
 * @param filePath - File path
 * @returns Page title
 */
export function getPageTitle(filePath: string): string {
  // Extract filename without extension
  const filename = filePath.split("/").pop() || "";
  const nameWithoutExtension = filename.split(".")[0];

  // Convert to title case
  const titleCase = nameWithoutExtension
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, str => str.toUpperCase());

  return `${titleCase} Documentation`;
}

/**
 * Convert Markdown to Confluence storage format
 */
export function markdownToConfluence(markdown: string): string {
  try {
    log("info", "Converting markdown to Confluence format", {
      markdownLength: markdown.length
    });

    // Validate markdown input
    if (!markdown || markdown.length === 0) {
      log("error", "Empty markdown provided for conversion");
      throw new Error("Cannot convert empty markdown to Confluence format");
    }

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
