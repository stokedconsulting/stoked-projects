---
description: Track Claude responses for extension commands
---

# Track Claude Responses

This hook captures Claude's final response after executing extension commands and updates the task history.

## Hook Logic

Check if the current conversation involved a Stoked Projects command. If so, extract the response and update the task history.

## Implementation

```typescript
// Check for task tracking in conversation history
const fs = require('fs');
const historyFile = `${process.env.HOME}/.claude/task-history.jsonl`;

if (!fs.existsSync(historyFile)) {
    return; // No history file, nothing to track
}

// Read last task from history
const lines = fs.readFileSync(historyFile, 'utf-8').split('\n').filter(Boolean);
if (lines.length === 0) return;

const lastTask = JSON.parse(lines[lines.length - 1]);

// Check if this response is for the last task (within 5 minutes)
const taskTime = new Date(lastTask.timestamp);
const now = new Date();
const diffMinutes = (now - taskTime) / 1000 / 60;

if (diffMinutes < 5 && lastTask.status === 'pending') {
    // Update task with response
    lastTask.response = context.response;
    lastTask.status = 'completed';
    lastTask.completedAt = now.toISOString();

    // Update the last line in the file
    lines[lines.length - 1] = JSON.stringify(lastTask);
    fs.writeFileSync(historyFile, lines.join('\n') + '\n');

    console.log(`[Stoked Projects Hook] Updated task response: ${lastTask.id}`);
}
```
