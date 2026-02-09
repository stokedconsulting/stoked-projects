# Large Input Handling for /project-create

## Problem Solved

The `/project-create` command was crashing with large problem descriptions because:
1. Orchestration prompt: ~876 lines
2. Template prompts: ~224 lines combined
3. Your problem description: ~850 words
4. **Total context**: 100k+ tokens passed to subagents

This exceeded comfortable processing limits and caused crashes.

## Solution

Added **Stage 0: Problem Description Preprocessing** to the orchestration workflow.

### How It Works

1. **Automatic Detection**
   - Counts words in your problem description
   - If > 500 words: Activates preprocessing
   - If ≤ 500 words: Uses original description (no change)

2. **Summary Generation**
   - Creates concise 200-300 word summary
   - Captures: Core Problem, Key Requirements, Users, Success Criteria
   - Stores full description for reference

3. **File Organization**
   ```
   ./projects/[your-project]/
   ├── problem-description-summary.md    # Used in orchestration (small)
   ├── problem-description-full.md       # Reference (all details preserved)
   ├── pfb.md                             # Generated from summary
   ├── prd.md                             # Can read full description if needed
   └── orchestration-state.json           # Tracks which mode used
   ```

4. **Subagent Access**
   - PFB and PRD generation receive the summary
   - Can read full description file if they need more detail
   - Nothing is lost, just organized better

## Your Multi-Agent Project

Your problem description includes:
- Multi-agent autonomous system concept
- 21 project categories with detailed descriptions
- Pre-canned prompt requirements
- **Estimated**: ~850 words

**Result**: Preprocessing will activate automatically

### What Will Happen

1. `/project-create [your large description]`
2. System detects: "Large input (847 words) - activating preprocessing"
3. Generates summary:
   ```markdown
   # Problem Summary

   ## Core Problem
   Build autonomous multi-agent system for continuous GitHub project
   implementation, peer review, and category-based project generation.

   ## Key Requirements
   - Workspace-configurable agent concurrency
   - One project per agent, sequential execution
   - Automated peer review with acceptance criteria validation
   - 21 predefined project categories
   - Pre-canned prompts for each category

   ## Primary Users
   Development teams wanting autonomous codebase improvement

   ## Success Criteria
   - Agents complete projects with quality validation
   - Review agents catch gaps
   - Category-based generation produces actionable projects
   ```

4. Full description (with all 21 categories detailed) stored in `problem-description-full.md`
5. Orchestration proceeds with summary (much smaller context)
6. No more crashes!

## Usage

**No changes required** - it's automatic:

```bash
# Large input - preprocessing activates automatically
/project-create [your 850-word description with all categories]

# Standard input - works as before
/project-create We need to add user authentication with OAuth2
```

## Benefits

1. **Prevents Crashes**: Keeps context manageable
2. **Preserves Everything**: Full description always available
3. **Faster Processing**: Smaller summaries = faster subagent execution
4. **Better Quality**: Focused summaries help subagents stay on track
5. **Transparent**: State file shows which mode was used

## Files Added

- `apps/code-ext/commands/prompts/PROBLEM_DESCRIPTION_PREPROCESSOR.md` - Documentation
- Updated: `~/.claude/commands/prompts/PROJECT_ORCHESTRATOR.md` - Added Stage 0

## Backward Compatibility

- Existing projects: ✅ No impact
- Small descriptions: ✅ No change in behavior
- Stage 0 is optional: ✅ Only runs when needed
- State file: ✅ New fields are optional

## Testing Your Project

Want to test it? Just run:

```bash
/project-create [paste your full multi-agent system description]
```

It should now:
1. Detect large input
2. Generate summary
3. Complete all 5 stages without crashing
4. Create GitHub project with all issues
5. Store your full description for reference

## Technical Details

### Word Count Thresholds

- **< 350 words**: No preprocessing (standard flow)
- **> 350 words**: Preprocessing activated
- **Summary target**: 200-300 words
- **Summary max**: 350 words

**Note**: Threshold lowered from 500 to 350 words after testing showed that structured descriptions with lists (like 21 categories) can cause context overflow even at 420 words due to high token density.

### Summary Format

Always includes these 4 sections:
1. **Core Problem**: What to build (2-3 sentences)
2. **Key Requirements**: Top 5 requirements (bullets)
3. **Primary Users**: Who it's for (1-2 sentences)
4. **Success Criteria**: Measurable outcomes (2-3 items)

### Storage Locations

```
./projects/[slug]/
├── problem-description-summary.md   # Orchestration input
├── problem-description-full.md      # Complete reference
├── pfb.md                            # Links to both above
├── prd.md                            # Links to both above
└── orchestration-state.json          # Tracks: word_count, using_summary, paths
```

## What This Doesn't Change

- Project creation workflow (still 5 stages after preprocessing)
- PFB template and requirements
- PRD template and requirements
- Issue generation logic
- GitHub project linking
- Command syntax

## Questions?

If preprocessing isn't working or you want to force it off:

```bash
# Skip preprocessing (use original description regardless of size)
# Currently not supported - would need flag added to command
# File an issue if needed
```

## Related Files

- `/Users/stoked/.claude/commands/prompts/PROJECT_ORCHESTRATOR.md` - Main orchestrator (Stage 0 added)
- `apps/code-ext/commands/prompts/PROBLEM_DESCRIPTION_PREPROCESSOR.md` - Detailed preprocessing docs
- `apps/code-ext/commands/project-create.md` - Entry point command
