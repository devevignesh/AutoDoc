import { AI_CONFIG, DOC_CONFIG } from '../config';
import { DocumentationContext } from '../types';

/**
 * Interface for documentation generation options
 */
interface GenerationOptions {
  context: DocumentationContext;
  fileType: string;
  sections?: string[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Interface for documentation generation result
 */
interface GenerationResult {
  content: string;
  metadata: {
    model: string;
    tokens: number;
    sections: string[];
    generatedAt: string;
  };
}

/**
 * Generate documentation for a file using AI
 * 
 * @param options - Generation options
 * @returns Promise with the generated documentation
 */
export async function generateDocumentation(
  options: GenerationOptions
): Promise<GenerationResult> {
  const {
    context,
    fileType,
    sections = Object.values(DOC_CONFIG.SECTIONS),
    maxTokens = AI_CONFIG.MAX_TOKENS,
    temperature = AI_CONFIG.TEMPERATURE
  } = options;

  try {
    // In a real implementation, this would call an AI service like OpenAI
    // For now, we'll create a placeholder implementation
    
    // Create a prompt for the AI
    const prompt = createDocumentationPrompt(context, fileType, sections);
    
    // Call AI service (placeholder)
    const aiResponse = await callAIService(prompt, maxTokens, temperature);
    
    // Process and format the AI response
    const formattedContent = formatDocumentation(aiResponse, fileType);
    
    return {
      content: formattedContent,
      metadata: {
        model: AI_CONFIG.MODEL || 'gpt-4',
        tokens: estimateTokenCount(formattedContent),
        sections: sections,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Error generating documentation:', error);
    throw new Error(`Failed to generate documentation: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a prompt for the AI to generate documentation
 * 
 * @param context - Documentation context
 * @param fileType - Type of file being documented
 * @param sections - Sections to include in documentation
 * @returns Prompt string for the AI
 */
function createDocumentationPrompt(
  context: DocumentationContext,
  fileType: string,
  sections: string[]
): string {
  const { fileContext, previousDocumentation } = context;
  
  let prompt = `
You are a technical documentation expert. Your task is to create comprehensive documentation for the following ${fileType} code.

FILE PATH: ${fileContext.path}

CODE:
\`\`\`${fileType}
${fileContext.content}
\`\`\`

Please generate documentation with the following sections:
${sections.map(section => `- ${section}`).join('\n')}

The documentation should be detailed, accurate, and follow best practices for technical documentation.
Use Markdown formatting for the documentation.
`;

  if (fileContext.dependencies && fileContext.dependencies.length > 0) {
    prompt += `\n\nDEPENDENCIES:\n${fileContext.dependencies.join('\n')}\n`;
  }

  if (previousDocumentation) {
    prompt += `\n\nPREVIOUS DOCUMENTATION:\n${previousDocumentation}\n\nPlease use the previous documentation as a reference, but update it to reflect the current code.`;
  }

  return prompt;
}

/**
 * Call AI service to generate documentation
 * 
 * @param prompt - Prompt for the AI
 * @param maxTokens - Maximum tokens for the response
 * @param temperature - Temperature for the AI response
 * @returns Promise with the AI response
 */
async function callAIService(
  prompt: string,
  maxTokens: number,
  temperature: number
): Promise<string> {
  // In a real implementation, this would call an AI service like OpenAI
  console.log(`Calling AI service with maxTokens=${maxTokens}, temperature=${temperature}`);
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return `# ${prompt.split('\n')[5].replace('FILE PATH: ', '')} Documentation

## Overview
This file contains functionality related to [feature description].

## Dependencies
- dependency1
- dependency2

## Functions and Methods
### function1
Description of function1 and its parameters.

### function2
Description of function2 and its parameters.

## Usage Examples
\`\`\`${prompt.includes('typescript') ? 'typescript' : 'javascript'}
// Example of how to use the functions in this file
import { function1 } from './path';

function1(param1, param2);
\`\`\`

## Configuration Options
- Option 1: Description of option 1
- Option 2: Description of option 2
`;
}

/**
 * Format the AI-generated documentation
 * 
 * @param aiResponse - Raw AI response
 * @param fileType - Type of file being documented
 * @returns Formatted documentation
 */
function formatDocumentation(aiResponse: string, fileType: string): string {
  // In a real implementation, this would format and clean up the AI response
  console.log(`Formatting documentation for ${fileType} file`);
  
  // Add syntax highlighting for code blocks based on file type
  let formattedContent = aiResponse;
  
  // Replace generic code blocks with language-specific ones
  formattedContent = formattedContent.replace(/```((?!```).)*```/gs, (match) => {
    if (!match.startsWith('```' + fileType) && !match.includes('```typescript') && !match.includes('```javascript')) {
      return match.replace('```', '```' + fileType);
    }
    return match;
  });
  
  return formattedContent;
}

/**
 * Estimate token count for a string
 * 
 * @param text - Text to estimate token count for
 * @returns Estimated token count
 */
function estimateTokenCount(text: string): number {
  // A very rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Update existing documentation based on code changes
 * 
 * @param existingDocumentation - Existing documentation
 * @param context - Documentation context
 * @param fileType - Type of file being documented
 * @returns Promise with the updated documentation
 */
export async function updateDocumentation(
  existingDocumentation: string,
  context: DocumentationContext,
  fileType: string
): Promise<GenerationResult> {
  // Add the existing documentation to the context
  const updatedContext: DocumentationContext = {
    ...context,
    previousDocumentation: existingDocumentation
  };
  
  // Generate new documentation with the updated context
  return generateDocumentation({
    context: updatedContext,
    fileType
  });
} 