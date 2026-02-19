---
description: Track Stoked Projects extension command usage
---

# Track Extension Command Usage

This hook tracks when Stoked Projects extension commands are executed and records the task history.

## Hook Logic

Check if the tool being used is a Stoked Projects extension command (review-project, review-phase, review-item, project-start, project-create, project-integrate).

If it is, extract the command details and record them to the task history file.

## Implementation

```typescript
// Check if this is a Stoked Projects command
const claudeProjectsCommands = ['review-project', 'review-phase', 'review-item', 'project-start', 'project-create', 'project-integrate'];
const commandName = context.tool?.name;

if (commandName && claudeProjectsCommands.some(cmd => commandName.includes(cmd))) {
    // Extract command parameters
    const params = context.tool?.parameters || {};

    // Build task record
    const task = {
        id: `task-${Date.now()}`,
        timestamp: new Date().toISOString(),
        command: commandName,
        projectNumber: params.projectNumber || params.project_number,
        phaseNumber: params.phaseNumber || params.phase_number,
        itemNumber: params.itemNumber || params.item_number,
        prompt: context.prompt || '',
        status: 'pending'
    };

    // Write to task history file
    const historyFile = `${process.env.HOME}/.claude/task-history.jsonl`;
    const fs = require('fs');
    fs.appendFileSync(historyFile, JSON.stringify(task) + '\n');

    console.log(`[Stoked Projects Hook] Tracked task: ${task.id}`);
}
```
