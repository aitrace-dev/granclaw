Publish a new beta release of the granclaw npm package locally.

The user may pass a version as an argument: $ARGUMENTS
If no version is provided, auto-increment the current beta patch number (e.g. 0.0.1-beta.2 → 0.0.1-beta.3).

## Steps

1. **Resolve the target version**

Read `packages/cli/package.json` to get the current version.

If $ARGUMENTS is non-empty, use it as-is as the target version.

Otherwise, derive the next beta version automatically:
- Strip the `-beta.N` suffix to get the base (e.g. `0.0.1`)
- Find all existing git tags matching `v<base>-beta.*` and take the highest N
- Target version = `<base>-beta.<N+1>` (or `<base>-beta.1` if none exist)

2. **Validate**

- Confirm the target version matches `^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$`
- Confirm no git tag `v<target>` already exists (`git tag -l "v<target>"`)
- If either check fails, stop and tell the user why

3. **Bump `packages/cli/package.json`**

Update the `"version"` field to the target version.

4. **Commit and push**

```bash
git add packages/cli/package.json
git commit -m "chore(release): v<target>"
git push
```

5. **Build**

```bash
npm run build -w granclaw
```

If the build fails, show the error and stop.

> **Manifest check:** The prepublish gate compares the packed file list against
> `packages/cli/packaging/expected-files.txt`. Entries support `*` wildcards
> (e.g. `dist/frontend/assets/index-*.js`) to handle content-hashed filenames
> that change on every build. If the gate reports a manifest mismatch for a
> file that genuinely belongs in the package, update `expected-files.txt` using
> a wildcard and commit before retrying.

6. **Publish to npm**

```bash
npm publish --tag beta --access public -w granclaw
```

This will prompt for OTP if 2FA is enabled on the npm account — that is expected. The user should enter their authenticator code when asked.

7. **Tag and push the tag**

```bash
git tag -a "v<target>" -m "Release v<target>"
git push origin "v<target>"
```

8. **Done**

Print a summary:
- Version published: `<target>`
- npm: `https://www.npmjs.com/package/granclaw/v/<target>`
- Tag: `v<target>`