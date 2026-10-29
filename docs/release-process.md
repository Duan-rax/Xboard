# Release process

Panel releases are coordinated with an Xboard-Node release.

1. Merge completed feature branches into `master`.
2. Update `config/app.php` and `CHANGELOG.md` with the immutable tag.
3. Run syntax checks, JavaScript tests and the focused egress PHPUnit suite.
4. Push the release tag.
5. GitHub Actions builds and publishes the amd64/arm64 panel image, creates the
   GitHub Release and updates the GHCR `latest` tag.
6. Deploy the new image and verify the public panel, resource cache version,
   database migration and node acknowledgement behavior.
7. Record the deployed image digest and companion Xboard-Node release.

Do not repoint an existing release tag. If a deployment fix is required, use a
new date-based patch tag.
