# Release process

Panel releases are coordinated with an Xboard-Node release.

1. Merge completed feature branches into `master`.
2. Update `config/app.php` and `CHANGELOG.md` with the immutable tag.
3. Run syntax checks, JavaScript tests and the focused egress PHPUnit suite.
4. Build the panel image natively on SGP.
5. Deploy and verify the public panel, resource cache version, database
   migration and node acknowledgement behavior.
6. Push the release tag and create a GitHub Release from that exact commit.
7. Record the deployed image tag and companion Xboard-Node release in the
   release body.

Do not repoint an existing release tag. If a deployment fix is required, use a
new date-based patch tag.
