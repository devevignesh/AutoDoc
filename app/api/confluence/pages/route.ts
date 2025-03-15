import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

// Environment variables should be set in your .env.local file:
// CONFLUENCE_BASE_URL - Your Confluence instance URL (e.g., https://your-domain.atlassian.net)
// CONFLUENCE_API_TOKEN - Your Atlassian API token
// CONFLUENCE_EMAIL - Your Atlassian account email

// Types for Confluence API
interface ConfluencePagePayload {
  spaceId: string;
  status: "current" | "draft";
  title: string;
  parentId?: string;
  body: {
    representation: "storage" | "atlas_doc_format" | "wiki";
    value: string;
  };
}

interface ConfluencePageUpdatePayload {
  id: string;
  status: "current" | "draft";
  title: string;
  body: {
    representation: "storage" | "atlas_doc_format" | "wiki";
    value: string;
  };
  version: {
    number: number;
    message: string;
  };
}

// Helper function to get Confluence API credentials
function getConfluenceCredentials() {
  const email = process.env.CONFLUENCE_EMAIL;
  const apiToken = process.env.CONFLUENCE_API_TOKEN;
  const baseUrl = process.env.CONFLUENCE_BASE_URL;

  if (!email || !apiToken || !baseUrl) {
    throw new Error(
      "Missing Confluence API credentials in environment variables"
    );
  }

  // Create the Basic Auth header
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString(
    "base64"
  )}`;

  return {
    authHeader,
    baseUrl
  };
}

// Create a new Confluence page
export async function POST(request: NextRequest) {
  try {
    const { authHeader, baseUrl } = getConfluenceCredentials();
    const body = await request.json();

    // Required parameters
    const { spaceId, title, content, parentId } = body;

    if (!spaceId || !title || !content) {
      return NextResponse.json(
        {
          error:
            "Missing required parameters: spaceId, title, and content are required"
        },
        { status: 400 }
      );
    }

    // Prepare request payload
    const payload: ConfluencePagePayload = {
      spaceId,
      status: "current",
      title,
      body: {
        representation: "storage",
        value: content
      }
    };

    // Add optional parent ID if provided
    if (parentId) {
      payload.parentId = parentId;
    }

    // Make API request to create page
    const response = await axios.post(`${baseUrl}/wiki/api/v2/pages`, payload, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    });

    return NextResponse.json({
      success: true,
      page: response.data
    });
  } catch (error: unknown) {
    console.error("Error creating Confluence page:", error);

    // Handle Atlassian API errors
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        {
          error: "Failed to create Confluence page",
          details: error.response?.data || error.message
        },
        { status: error.response?.status || 500 }
      );
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create Confluence page", details: errorMessage },
      { status: 500 }
    );
  }
}

// Update an existing Confluence page
export async function PUT(request: NextRequest) {
  try {
    const { authHeader, baseUrl } = getConfluenceCredentials();
    const body = await request.json();

    // Required parameters
    const { pageId, title, content, version } = body;

    if (!pageId || !title || !content || !version) {
      return NextResponse.json(
        {
          error:
            "Missing required parameters: pageId, title, content, and version are required"
        },
        { status: 400 }
      );
    }

    // Prepare request payload
    const payload: ConfluencePageUpdatePayload = {
      id: pageId,
      status: "current",
      title,
      body: {
        representation: "storage",
        value: content
      },
      version: {
        number: version,
        message: body.versionMessage || "Updated via API"
      }
    };

    // Make API request to update page
    const response = await axios.put(
      `${baseUrl}/wiki/api/v2/pages/${pageId}`,
      payload,
      {
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    return NextResponse.json({
      success: true,
      page: response.data
    });
  } catch (error: unknown) {
    console.error("Error updating Confluence page:", error);

    // Handle Atlassian API errors
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        {
          error: "Failed to update Confluence page",
          details: error.response?.data || error.message
        },
        { status: error.response?.status || 500 }
      );
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update Confluence page", details: errorMessage },
      { status: 500 }
    );
  }
}

// Get a Confluence page by ID
export async function GET(request: NextRequest) {
  try {
    const { authHeader, baseUrl } = getConfluenceCredentials();
    const searchParams = request.nextUrl.searchParams;
    const pageId = searchParams.get("pageId");
    const spaceId = searchParams.get("spaceId");
    
    // If spaceId is provided, get all pages in the space
    if (spaceId) {
      return getSpacePages(spaceId, searchParams, authHeader, baseUrl);
    }
    
    // Otherwise, get a specific page by ID
    if (!pageId) {
      return NextResponse.json(
        { error: "Missing required parameter: pageId or spaceId" },
        { status: 400 }
      );
    }

    // Make API request to get page
    const response = await axios.get(`${baseUrl}/wiki/api/v2/pages/${pageId}`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json"
      },
      params: {
        "body-format": "storage"
      }
    });

    return NextResponse.json({
      success: true,
      page: response.data
    });
  } catch (error: unknown) {
    console.error("Error fetching Confluence page:", error);

    // Handle Atlassian API errors
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        {
          error: "Failed to fetch Confluence page",
          details: error.response?.data || error.message
        },
        { status: error.response?.status || 500 }
      );
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch Confluence page", details: errorMessage },
      { status: 500 }
    );
  }
}

// Helper function to get all pages in a space with pagination support
async function getSpacePages(
  spaceId: string,
  searchParams: URLSearchParams,
  authHeader: string,
  baseUrl: string
) {
  try {
    // Extract pagination and filter parameters
    const limit = searchParams.get("limit") || "25";
    const cursor = searchParams.get("cursor") || undefined;
    const title = searchParams.get("title") || undefined;
    const status = searchParams.get("status") || "current";
    
    // Prepare request parameters
    const params: Record<string, string | undefined> = {
      limit,
      cursor,
      title,
      status
    };
    
    // Remove undefined parameters
    Object.keys(params).forEach(key => {
      if (params[key] === undefined) {
        delete params[key];
      }
    });
    
    // Make API request to get pages in space
    const response = await axios.get(`${baseUrl}/wiki/api/v2/spaces/${spaceId}/pages`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json"
      },
      params
    });
    
    // Extract pagination information from headers
    const linkHeader = response.headers.link;
    const nextLink = linkHeader ? extractNextLink(linkHeader) : null;
    
    return NextResponse.json({
      success: true,
      pages: response.data.results,
      pagination: {
        hasMore: !!nextLink,
        nextCursor: nextLink ? extractCursorFromLink(nextLink) : null
      }
    });
  } catch (error: unknown) {
    console.error("Error fetching pages in space:", error);
    
    // Handle Atlassian API errors
    if (axios.isAxiosError(error)) {
      return NextResponse.json(
        {
          error: "Failed to fetch pages in space",
          details: error.response?.data || error.message
        },
        { status: error.response?.status || 500 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch pages in space", details: errorMessage },
      { status: 500 }
    );
  }
}

// Helper function to extract the next link from the Link header
function extractNextLink(linkHeader: string): string | null {
  const links = linkHeader.split(',');
  for (const link of links) {
    const [url, rel] = link.split(';');
    if (rel.trim() === 'rel="next"') {
      // Remove < and > from the URL
      return url.trim().slice(1, -1);
    }
  }
  return null;
}

// Helper function to extract the cursor parameter from a URL
function extractCursorFromLink(url: string): string | null {
  const match = url.match(/cursor=([^&]*)/);
  return match ? match[1] : null;
}
