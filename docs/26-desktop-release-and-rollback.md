# Desktop release and rollback

The installed shell is deliberately named **Business Assistant**. It does not
show the platform owner's name. After sign-in, the hosted assistant uses the
partner's configured product name and colors.

Production installers embed the public platform origin from the GitHub
`DESKTOP_APP_URL` environment variable, so staff can install and sign in
without entering a server address. The tray's **Workspace server** control is
retained only as a support override. Signed builds fail when the embedded
origin is missing, local, private-network, or non-HTTPS.

## Local release proof

1. Run `npm run desktop:dist:mac`.
2. Run `npm run verify:desktop-bundle`.
3. Launch `release/mac-arm64/Business Assistant.app` with a temporary
   `DESKTOP_USER_DATA_DIR` and `DESKTOP_TEST_MODE=true`, then confirm the
   first-run connection screen. Test mode disables update polling and removes
   the test copy from launch-at-login registration.
4. Run the unpackaged shell against the local web app and confirm sign-in,
   idle assistant, active-call foreground behavior, tray controls, and close to
   tray.

The local artifact is unsigned. It proves packaging and behavior, not Apple or
Microsoft trust. The GitHub release workflow fails unless signing credentials
are configured.

Every production branch also builds unsigned macOS and Windows installers in
GitHub Actions. Both jobs inspect the packaged application archive, runtime
files, updater configuration, release manifest, installer, and blockmap. Tag
releases repeat those checks with valid Developer ID and Authenticode
signatures required.

## Production update acceptance

Before distributing a release, install the previous signed version on clean
macOS and Windows machines. Publish the new release, use **Check for updates**,
and verify download, restart, retained server configuration, retained login,
launch at login, and the new version. Keep the release private until both
platforms pass.

## Rollback

Desktop auto-updaters must not install a lower version. A rollback is therefore
a new signed hotfix release containing the last-known-good source:

1. Mark the broken GitHub release as a draft so new machines stop discovering
   it. Existing installations remain installed; this is containment, not a
   downgrade.
2. Create a repair branch from the last-known-good tag.
3. Bump both `package.json` and `desktop/package.json` to a version higher than
   the broken release. Never reuse a tag or version.
4. Apply only forward-compatible database/API fixes required by the older
   desktop source.
5. Build and verify signed macOS and Windows installers, then test updating one
   machine that already has the broken version.
6. Publish the new tag. Confirm the bad installation updates to the repaired
   version before making the release public to every partner.

Database migrations are forward-only. Rolling back the desktop never reverses
production database migrations or deletes customer data.
