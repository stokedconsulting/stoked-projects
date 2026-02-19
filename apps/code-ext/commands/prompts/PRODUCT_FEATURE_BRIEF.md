# Product Feature Brief Generation Prompt

Use this prompt to create a comprehensive Product Feature Brief through interactive discovery.

---

## Prompt Text

```
Create a Product Feature Brief following these steps:

**STEP 1: Setup & Discovery**
1. Read the template: ~/.claude/commands/template/PRODUCT_FEATURE_BRIEF.md
2. Ask for the project name (this will be used for the output path)
3. Ask for the feature name/title

**STEP 2: Interactive Questioning** (--brainstorm mode)
Use the TodoWrite tool to track progress through all 10 sections:
- [ ] Section 1: Feature Overview
- [ ] Section 2: Problem Statement
- [ ] Section 3: Goals & Success Metrics
- [ ] Section 4: User Experience & Scope
- [ ] Section 5: Assumptions & Constraints
- [ ] Section 6: Risks & Mitigations
- [ ] Section 7: Dependencies
- [ ] Section 8: Open Questions
- [ ] Section 9: Non-Goals
- [ ] Section 10: Notes & References

For each section, ask targeted questions to gather information:

**Section 1 - Feature Overview:**
- Who is the owner/lead for this feature?
- What is the current status? (Draft/Proposed/Approved/In Progress/Shipped)
- What is the target release date/timeframe?
- Provide a 2-4 sentence summary of what this feature enables

**Section 2 - Problem Statement:**
- What specific problem are we solving?
- Who is the primary user affected by this problem?
- Are there secondary users? If so, who?
- Why is solving this problem important NOW? (user feedback, metrics, strategic goals, competitive pressure, etc.)

**Section 3 - Goals & Success Metrics:**
- What are the top 2-3 goals for this feature?
- How will we measure success? (Provide baseline → target for each metric)
- What metrics will indicate this feature is working?

**Section 4 - User Experience & Scope:**
- What is explicitly IN SCOPE for this feature?
- What is explicitly OUT OF SCOPE? (This is critical for alignment)

**Section 5 - Assumptions & Constraints:**
- What assumptions are we making? (user behavior, technical capabilities, resources)
- What are the technical constraints?
- Any legal/compliance constraints?
- Timeline constraints?
- Resource constraints?

**Section 6 - Risks & Mitigations:**
- What are the potential risks? (technical, business, user adoption, etc.)
- For each risk: What's the impact? What's the mitigation strategy?

**Section 7 - Dependencies:**
- What other teams do we depend on?
- What external systems, vendors, or APIs are required?
- What data or infrastructure dependencies exist?

**Section 8 - Open Questions:**
- What questions remain unanswered?
- What do we need to research or decide before proceeding?

**Section 9 - Non-Goals:**
- What does success explicitly NOT require?
- What are we intentionally not doing with this feature?

**Section 10 - Notes & References:**
- Links to design docs, user research, discussions, prior art?
- Any other relevant context or documentation?

**STEP 3: Draft Generation**
- Compile all gathered information into the Product Feature Brief format
- Use the template structure exactly as shown in ~/.claude/commands/template/PRODUCT_FEATURE_BRIEF.md
- For any sections where information is unknown, mark as "TBD" or "To be determined"
- Ensure all 10 sections are present and addressed

**STEP 4: Output**
- Create the directory ./projects/[project-name]/ if it doesn't exist
- Write the completed Product Feature Brief to: ./projects/[project-name]/pfb.md
- Confirm the file has been created successfully
- Provide a summary of what was captured

**QUALITY CRITERIA:**
✅ All 10 sections present
✅ Problem statement is clear and specific
✅ Success metrics are measurable with baselines and targets
✅ In-scope vs out-of-scope is explicitly defined
✅ Risks have mitigations
✅ Open questions are captured for future resolution
✅ Output written to correct file path

**FLEXIBILITY:**
- If the user doesn't have information for a section, mark it "TBD" and note it as an open question
- Use AskUserQuestion tool for key decisions (status, priority, etc.)
- Allow iterative refinement - user can update sections later
- Be conversational and collaborative, not interrogative

**WORKFLOW:**
1. Activate --brainstorm mode for discovery
2. Create TodoWrite checklist for all 10 sections
3. Work through sections systematically
4. Mark each section complete as information is gathered
5. Generate comprehensive document
6. Write to ./projects/[project-name]/pfb.md
7. Confirm completion and provide next steps
```

---

## Usage

Simply copy the prompt text above and paste it into your conversation with Claude Code. Claude will:
1. Guide you through interactive discovery
2. Ask clarifying questions for each section
3. Compile everything into a properly formatted Product Feature Brief
4. Save it to the correct location

## Notes

- The prompt uses --brainstorm mode to enable collaborative discovery
- It's designed to be flexible - you don't need all answers upfront
- The resulting PFB can be iteratively refined as more information becomes available
- All files are saved to ./projects/[project-name]/pfb.md for easy organization
