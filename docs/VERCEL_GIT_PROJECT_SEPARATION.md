# Separate EduConnect Vercel Git Integration

This procedure separates EduConnect pull request checks from the existing Schoollog Vercel project. It documents dashboard actions only; no Vercel project or Git integration was changed as part of this code change.

## Identify which project owns the pull request check

1. Open the failed Vercel check from the EduConnect pull request and note its Vercel project name and team.
2. In that Vercel project's **Settings → Git**, verify the connected GitHub repository is `Arilsrinivas/school-dashboard`.
3. Confirm whether the project is the Schoollog project before changing any setting. Do not rename it or change its domains, environment variables, or deployments.

## Disconnect Schoollog from future EduConnect pull request checks

Only do this if the project owner wants the existing Schoollog project to stop receiving Git-triggered builds for this repository. In **Schoollog → Settings → Git**, use **Disconnect** for the repository and confirm the action. This stops future Git-triggered Preview and Production deployments and pull request checks for that project. It does not delete existing deployments, but those deployments will no longer update automatically from Git. Keep the Schoollog project, settings, deployments, and domains in place; do not delete the project.

If Schoollog must continue automatic Git deployments, keep its Git integration connected and turn off only the specific pull request/deployment checks offered in that project's Git settings. Check the current Vercel UI and confirm the effect before saving, because those controls can affect Schoollog deployment workflows.

## Connect the separate EduConnect project

1. In the intended Vercel team, create a new project named `educonnect`; verify its project ID is different from Schoollog's.
2. Import the same GitHub repository `Arilsrinivas/school-dashboard` into this new project. Set the root directory to `./`, framework to Vite, Node.js to `24.x`, build command to `npm run vercel-build`, and output directory to `apps/web/dist`.
3. Configure only EduConnect Production environment variables in this new project's encrypted settings. Do not copy variables from Schoollog. Use `docs/EDUCONNECT_VERCEL_PRODUCTION.md` as the variable checklist.
4. Set the intended production branch and confirm the first Git connection will not promote or alias an unreviewed build to the EduConnect production domain. Configure the project before enabling automatic Production deployments.
5. Authorize the final EduConnect hostname in Firebase Authentication and the existing Google OAuth client, then verify project ID, environment scope, and API routing before enabling PR checks.
6. Verify the resulting pull request status is associated with the new `educonnect` project. Any Schoollog check that remains should be identifiable as belonging only to Schoollog.

No configuration in the old Schoollog project should be copied or overwritten during this process. If a setting's effect on Schoollog is unclear, stop before saving and have the project owner review it.
