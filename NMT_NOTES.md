# NMT Pathways - PGLite Fork Notes

This file documents all NMT Pathways-specific modifications to the PGLite fork.

## Fork Information

- **Upstream**: https://github.com/electric-sql/pglite
- **Fork**: https://github.com/GHNetwork/pglite
- **Fork Date**: 2025-12-08
- **Base Version**: 0.3.14

## Purpose

This fork exists to:

1. **Diagnose Chrome/Firefox initialization issues** - Add custom instrumentation for debugging WASM loading and OPFS-AHP initialization
2. **Apply custom fixes** - Implement fixes specific to our use case before they're merged upstream
3. **Enable rapid iteration** - Test changes without waiting for upstream releases

## Custom Modifications

All NMT customizations are marked with `[NMT CUSTOMIZATION]` comments in the code.

---

### 2025-12-10 - Diagnostic Instrumentation and Crash Recovery (Updated)

**Files Changed:**

1. **`packages/pglite/src/pglite.ts`**
   - Added pre-backend datadir validation and pg_control state logging (before `_pgl_backend()` call)
   - Added try/catch wrapper around `_pgl_backend()` with emergency handle cleanup on crash
   - **Fixed**: pg_control state is read at offset 16 (not offset 0) per PostgreSQL's `ControlFileData` struct
   - **Added**: File size check before reading pg_control (must be at least 20 bytes, should be 8192)
   - Purpose: Diagnose `RuntimeError: unreachable` crashes when using `loadDataDir` with prebuilt tarballs

2. **`packages/pglite/src/fs/opfs-ahp.ts`**
   - Added `emergencyCloseAllHandles()` method for crash recovery
   - Added handle creation logging in `#init()` method
   - Purpose: Prevent Access Handle leaks when `_pgl_backend()` crashes, which would cause `NoModificationAllowedError` on subsequent connection attempts

3. **`packages/pglite/src/fs/tarUtils.ts`**
   - Added post-load validation of required datadir paths (PG_VERSION, postgresql.conf, etc.)
   - Added pg_control state logging after tarball extraction
   - **Added**: Detailed extraction logging for pg_control file (tracks `file.data.length` from tinytar)
   - **Fixed**: pg_control state is read at offset 16 (not offset 0) per PostgreSQL's `ControlFileData` struct
   - **Added**: File size check before reading pg_control (detects empty files from tinytar extraction)
   - Purpose: Diagnose why pg_control ends up empty after extraction, fail fast on invalid/corrupt tarballs

**Reason:**
When using `loadDataDir` to load a prebuilt database tarball, `_pgl_backend()` was crashing with `RuntimeError: unreachable` after `wasm.initdb` returned success (0b1110). This provided no context about what went wrong. These changes:
1. Log the pg_control state to identify state mismatches (DB_SHUTDOWNED vs DB_IN_PRODUCTION)
2. Validate critical files exist before backend startup
3. Clean up leaked Access Handles on crash to enable retry logic
4. Provide detailed diagnostic logs for debugging

**Related Documentation:**
- `docs/debugging/pglite-opfs-root-cause-analysis.md` - Comprehensive root cause analysis
- `docs/debugging/chromium-i.md` - Chrome browser console logs
- `docs/debugging/firefox.md` - Firefox browser console logs

**Upstream Status:**
- [ ] Not submitted (changes designed to be upstreamable)
- [ ] PR submitted: #XXX
- [ ] Merged upstream

**Upstreamability Assessment:**
All changes are designed to be upstreamable:
- Pre-backend validation: Pure diagnostics, improves debugging for all `loadDataDir` users
- pg_control logging: Documents internal Postgres state, very useful for debugging
- try/catch around `_pgl_backend()`: Defensive programming, enables cleanup on crash
- `emergencyCloseAllHandles()`: Fixes real bug where handles leak on crash
- Post-load validation: Fail-fast on invalid datadirs, improves error messages

---

## Change Log Template

When making changes, add an entry below:

### [Date] - Brief Description

**Files Changed:**
- `packages/pglite/src/file.ts` - Description of change

**Reason:**
Why this change was needed.

**Upstream Status:**
- [ ] Not submitted
- [ ] PR submitted: #XXX
- [ ] Merged upstream

---

## Syncing with Upstream

```bash
cd packages/pglite
git fetch upstream
git log --oneline upstream/main ^HEAD  # See what's new
git merge upstream/main                 # Merge changes
git push origin main                    # Push to fork
```

## Building

### TypeScript Only (no WASM changes)

```bash
cd packages/pglite/packages/pglite
pnpm build:js
```

### Full Build (requires Docker)

```bash
cd packages/pglite
./postgres-pglite/build-with-docker.sh
```

## Testing Changes

After making changes:

1. Build the package: `pnpm build:js`
2. Run PGLite tests: `pnpm test`
3. Test in Pathways: `cd ../../pathways && pnpm dev`

## Contact

For questions about this fork, contact the NMT Pathways team.

