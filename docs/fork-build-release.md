# Fork Build and Release

Xboard Fork keeps its build infrastructure separate from upstream files:

| Purpose | Fork file |
| --- | --- |
| Panel image | `Dockerfile.fork` |
| Verification | `.github/workflows/fork-ci.yml` |
| Tagged release | `.github/workflows/fork-release.yml` |

The upstream `Dockerfile` remains the upstream file. The upstream Docker
workflow is manual-only in this fork so a normal branch push cannot overwrite
Fork images or `latest`.

Local SGP verification:

```bash
docker build \
  --build-arg CACHEBUST="$(git rev-parse HEAD)" \
  -f Dockerfile.fork \
  -t xboard-local:test .
```

`Dockerfile.fork` defaults to `Duan-rax/Xboard`. The release workflow overrides
`REPO_URL` with the current `github.repository`; local builds should always pass
a unique `CACHEBUST` so the image must clone the requested source revision.

Do not tag or publish every maintenance commit. Accumulate a verified batch,
run the Fork CI, build and test on SGP, deploy a canary, and only then push a
release tag.
