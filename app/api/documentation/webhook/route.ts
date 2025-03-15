import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { createHmac } from "crypto";

// Configuration
const CONFLUENCE_SPACE_ID = process.env.CONFLUENCE_DOCUMENTATION_SPACE_ID || "";
const DOCUMENTATION_PARENT_PAGE_ID = process.env.CONFLUENCE_DOCUMENTATION_PARENT_PAGE_ID || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

// Type for the webhook payload
interface WebhookPayload {
  ref: string;
  commits: {
    id: string;
    message: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  }[];
  repository: {
    id: number;
    name: string;
    full_name: string;
  };
}

// Webhook handler for git push events
export async function POST(request: NextRequest) {
  try {
    // Verify webhook signature
    const signature = request.headers.get('x-hub-signature-256');
    const body = await request.text();
    
    // Only proceed if signature is valid
    if (!verifyWebhookSignature(signature, body)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
    
    const payload: WebhookPayload = JSON.parse(body);
    
    // Only process pushes to the main branch
    if (!payload.ref.includes("main") && !payload.ref.includes("master")) {
      return NextResponse.json({
        success: true,
        message: "Skipped: Not a push to the main branch"
      });
    }
    
    // Process each commit
    const results = await Promise.all(
      payload.commits.map(async (commit) => {
        try {
          // Call the documentation agent to update docs for this commit
          const response = await axios.post("/api/documentation/agent", {
            commitId: commit.id,
            action: "update",
            spaceId: CONFLUENCE_SPACE_ID,
            parentPageId: DOCUMENTATION_PARENT_PAGE_ID
          });
          
          return {
            commitId: commit.id,
            status: "processed",
            result: response.data
          };
        } catch (error) {
          console.error(`Error processing commit ${commit.id}:`, error);
          return {
            commitId: commit.id,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error"
          };
        }
      })
    );
    
    return NextResponse.json({
      success: true,
      message: "Webhook processed",
      results
    });
  } catch (error: unknown) {
    console.error("Error processing webhook:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Webhook processing error", details: errorMessage },
      { status: 500 }
    );
  }
}

// Function to verify webhook signature
function verifyWebhookSignature(signature: string | null, payload: string): boolean {
  if (!signature || !WEBHOOK_SECRET) {
    console.warn("Webhook signature verification skipped: missing signature or secret");
    return true; // Skip verification if no signature or secret is provided
  }
  
  try {
    // Implement proper HMAC verification
    const hmac = createHmac('sha256', WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    
    // Use constant-time comparison to prevent timing attacks
    return signature === digest;
  } catch (error) {
    console.error("Webhook signature verification failed:", error);
    return false;
  }
} 