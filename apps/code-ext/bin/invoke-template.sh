#!/bin/bash

# Generic invoke function template
# Usage: ./invoke-template.sh <model> <prompt>

MODEL=$1
PROMPT=$2

case $MODEL in
  cp-claude)
    echo "Invoking Claude with: $PROMPT"
    # Add Claude CLI execution logic here
    ;;
  cp-codex)
    echo "Invoking Codex with: $PROMPT"
    # Add Codex CLI execution logic here
    ;;
  cp-gemini)
    echo "Invoking Gemini with: $PROMPT"
    # Add Gemini CLI execution logic here
    ;;
  cp-ollama)
    echo "Invoking Ollama with: $PROMPT"
    # Add Ollama CLI execution logic here
    ;;
  cp-openai)
    echo "Invoking OpenAI with: $PROMPT"
    # Add OpenAI API execution logic (via LM Studio) here
    ;;
  *)
    echo "Error: Unknown model $MODEL"
    exit 1
    ;;
esac