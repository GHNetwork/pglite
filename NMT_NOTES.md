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

### None Yet

This fork was just created. Document all changes below as they are made.

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

