import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Enhanced logging with timestamp and metadata
 */
export function log(
  level: "info" | "warn" | "error",
  message: string,
  metadata?: Record<string, unknown>
) {
  const timestamp = new Date().toISOString();
  const metadataStr = metadata ? ` | ${JSON.stringify(metadata)}` : "";

  switch (level) {
    case "error":
      console.error(`[ERROR] ${timestamp} | ${message}${metadataStr}`);
      break;
    case "warn":
      console.warn(`[WARN] ${timestamp} | ${message}${metadataStr}`);
      break;
    default:
      console.log(`[INFO] ${timestamp} | ${message}${metadataStr}`);
  }
}