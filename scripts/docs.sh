#!/bin/bash

# Documentation Generator Script Wrapper
# This script makes it easier to run the documentation generator

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

# Run the TypeScript script with ts-node
npx ts-node scripts/generate-docs.ts "$@" 