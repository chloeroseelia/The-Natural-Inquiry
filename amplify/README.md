# Amplify Gen 2 backend foundation

This directory defines the planned Cognito, Amplify Data, and private Storage
resources for The Natural Inquiry admin dashboard. It is not connected to the
React/Vite dashboard or the existing Amplify Hosting app.

## Security boundaries

- Cognito sign-in uses email and requires TOTP MFA.
- Cognito self-service sign-up is disabled. User accounts must be created by an
  administrator through an authorized provisioning process.
- The `Administrators` Cognito group is the only group authorized for the
  Publication, ResearchProject, and ProfileContent models.
- Amplify Data uses the Cognito User Pool authorization mode. No public API key
  or guest authorization rule is configured.
- Storage access is granted only to the `Administrators` group under
  `admin-media/*`. No guest or general authenticated-user rules are configured.
- A `PUBLISHED` record remains private in Amplify Data. Publication to the
  public website must be implemented as a separate reviewed export/deployment
  workflow; setting a status does not make a record or file public.

## Local validation

After installing the root development dependencies, run:

```powershell
npm run typecheck:backend
```

This performs a local TypeScript check only. Do not run `npx ampx sandbox`,
`npx ampx pipeline-deploy`, or other provisioning commands until an isolated
development environment and AWS permissions have been explicitly approved.
No sandbox, production resource, or Hosting integration has been created by
these definitions.

`amplify_outputs*.json` files are ignored because generated backend outputs are
environment-specific. The current dashboard continues to use its existing
browser-local IndexedDB and local Vite publishing behavior.
