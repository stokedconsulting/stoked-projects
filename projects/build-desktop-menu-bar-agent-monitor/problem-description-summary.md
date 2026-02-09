# Problem Summary

## Core Problem
Create a desktop menu bar application that mirrors the functionality of the existing VSCode extension (`apps/code-ext/`), enabling users to manage GitHub Projects, monitor Claude AI agent sessions, and orchestrate multi-agent autonomous workflows from their system menu bar. Both the VSCode extension and menu bar app will be maintained as parallel products sharing a common core.

## Key Requirements
- Native menu bar application for macOS (and potentially Windows/Linux)
- Feature parity with VSCode extension: projects view, agent dashboard, session monitoring
- Shared core logic extracted into reusable packages
- Real-time agent status updates and controls (start/pause/stop)
- Cost tracking and budget enforcement display
- Emergency controls accessible from menu bar

## Primary Users
Developers and teams who use Claude AI for autonomous project execution but don't always have VSCode open, need quick access to agent status and controls from their system menu bar.

## Success Criteria
- Menu bar app launches within 2 seconds
- Real-time agent status updates within 5 seconds
- All agent control operations work identically to VSCode extension
- Shared codebase reduces duplication by >70%
- Users can monitor and control agents without opening VSCode
