# Claude Code Guidelines for Todocko MCP Server

## Security - CRITICAL

### Mnemonic Handling

The `TODOCKO_MNEMONIC` environment variable contains a BIP39 mnemonic phrase that:
- Is the **private key** to all user's Todocko data
- Allows decryption of all tasks, projects, and other data
- Should be treated with the same care as a password or private key

**NEVER:**
- Print or log the mnemonic value
- Include the mnemonic in command line arguments (visible in `ps`, shell history)
- Write the mnemonic to files (except secure config files)
- Send the mnemonic over network or to external services
- Include the mnemonic in error messages or debug output

**ALWAYS:**
- Use environment variables to pass the mnemonic
- If testing, use `export TODOCKO_MNEMONIC=... && command` (single line, not in history if using space prefix)
- Refer to the mnemonic as "the configured mnemonic" without showing its value

### Safe Testing Example

```bash
# Set in current session only (not in command args)
export TODOCKO_MNEMONIC="..."
node dist/index.js

# Or read from secure file
export TODOCKO_MNEMONIC=$(cat ~/.todocko-mnemonic)
node dist/index.js
```

## Project Structure

- `src/evolu.ts` - Evolu database integration with sync
- `src/tools/` - MCP tool implementations
- `src/index.ts` - MCP server entry point

## Development

```bash
pnpm install
pnpm run build
pnpm run dev  # watch mode
```

## Testing

The MCP server connects to Todocko relay servers and syncs data encrypted with the mnemonic-derived keys. Ensure you have a valid mnemonic configured before testing.
