#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx ]]; then
  npx prettier --write "$FILE_PATH" 2>/dev/null
fi

exit 0
