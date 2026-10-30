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
docker build -f Dockerfile.fork -t xboard-local:test .
```

Do not tag or publish every maintenance commit. Accumulate a verified batch,
run the Fork CI, build and test on SGP, deploy a canary, and only then push a
release tag.
