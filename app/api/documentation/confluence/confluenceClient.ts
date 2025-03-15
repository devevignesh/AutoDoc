import axios from 'axios';
import { CONFLUENCE_CONFIG } from '../config';
import { 
  ConfluenceCredentials, 
  ConfluencePage, 
  ConfluencePageRequest, 
  ConfluencePageUpdateRequest 
} from '../types';

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
    throw new Error('Missing Confluence credentials. Please set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN environment variables.');
  }
  
  return {
    email,
    apiToken,
    baseUrl
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
      status: 'current',
      title,
      body: {
        representation: 'storage',
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
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.id;
  } catch (error) {
    console.error('Error creating Confluence page:', error);
    throw new Error(`Failed to create Confluence page: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    
    const response = await axios.put(apiUrl, {
      id: pageId,
      status: 'current',
      title,
      body: {
        representation: 'storage',
        value: content
      },
      version: {
        number: version + 1
      }
    }, {
      auth: {
        username: credentials.email,
        password: credentials.apiToken
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.id;
  } catch (error) {
    console.error('Error updating Confluence page:', error);
    throw new Error(`Failed to update Confluence page: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get a page from Confluence by ID
 * 
 * @param pageId - Page ID
 * @returns Promise with the page
 */
export async function getConfluencePage(pageId: string): Promise<ConfluencePage> {
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
    console.error('Error getting Confluence page:', error);
    throw new Error(`Failed to get Confluence page: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Find a page in Confluence by title
 * 
 * @param spaceId - Confluence space ID
 * @param title - Page title
 * @returns Promise with the page ID or null if not found
 */
export async function findDocumentationPage(spaceId: string, title: string): Promise<string | null> {
  try {
    const credentials = getConfluenceCredentials();
    const apiUrl = `${credentials.baseUrl}/wiki/api/v2/spaces/${spaceId}/pages`;
    
    const response = await axios.get(apiUrl, {
      params: {
        title,
        status: 'current',
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
      const exactMatch = pages.find((page: { title: string; id: string }) => page.title === title);
      if (exactMatch) {
        return exactMatch.id;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding Confluence page:', error);
    return null;
  }
}

/**
 * Convert Markdown to Confluence storage format
 * 
 * @param markdown - Markdown content
 * @returns Confluence storage format
 */
export function markdownToConfluence(markdown: string): string {
  // In a real implementation, this would convert Markdown to Confluence storage format
  // For now, we'll just wrap the content in a preformatted block
  return `<ac:structured-macro ac:name="html">
  <ac:plain-text-body><![CDATA[
${markdown}
  ]]></ac:plain-text-body>
</ac:structured-macro>`;
}

/**
 * Get a page title from a file path
 * 
 * @param filePath - File path
 * @returns Page title
 */
export function getPageTitle(filePath: string): string {
  // Extract filename without extension
  const filename = filePath.split('/').pop() || '';
  const nameWithoutExtension = filename.split('.')[0];
  
  // Convert to title case
  const titleCase = nameWithoutExtension
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase());
  
  return `${titleCase} Documentation`;
} 