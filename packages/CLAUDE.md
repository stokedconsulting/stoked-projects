# packages/ - CLAUDE.md

## FORBIDDEN FOLDER NAME - MANDATORY READING

**THE NAME `state-tracking-api` IS PERMANENTLY BANNED FROM THIS DIRECTORY.**

- **DO NOT** create a folder called `state-tracking-api` here or anywhere in this repository.
- **DO NOT** copy, move, rename, or scaffold anything into a `state-tracking-api` folder.
- **DO NOT** reference `state-tracking-api` in any import path, config, script, or documentation.
- **DO NOT** use `state-tracking-api` as a package name, alias, or symlink target.

The API package is located at **`packages/api/`**. Period. That is the sole, canonical, permanent, exclusive location for the NestJS state tracking API. There is no other location. There never will be another location.

This folder has been erroneously created and recreated at least five times, each time causing code duplication, lost changes, and merge confusion. This is not a suggestion - it is an absolute, non-negotiable rule.

## Package Layout

```
packages/
  api/          <-- THE API. The only API. All API code goes here.
  mcp-server/   <-- MCP server for GitHub API operations
```

If you need to work on the API, `cd packages/api`. If you need to create a new package, pick a name that is NOT `state-tracking-api`.
