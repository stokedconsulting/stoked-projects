# Full Problem Description

We are going to make a desktop version of the VSCode extension for the menu bar, and we will maintain both going forward.

## Source Context
This project is derived from the existing VSCode extension for GitHub Projects management and Multi-Agent Autonomous Project Orchestration System.

## Existing Codebase
The existing VSCode extension lives at `apps/code-ext/` and includes:
- Projects view provider (webview-based)
- GitHub API integration
- Claude session monitoring
- Agent dashboard UI
- Cache management

## Original PRD Summary
The original system includes 5 phases:
1. Foundation - Agent State Management & Configuration
2. Project Execution & Assignment
3. Review Agent & Quality Validation
4. Autonomous Ideation & Project Generation
5. Integration, Monitoring & Polish

## Key Technical Context
- Uses file-based IPC via `.claude-sessions/`
- NestJS State Tracking API for session monitoring
- GitHub OAuth and VS Code authentication
- Supports 1-10 concurrent agents per workspace
- 21 category-specific prompt templates for ideation

---
**Created:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Word Count:** ~11,000 words (includes full PRD context)
