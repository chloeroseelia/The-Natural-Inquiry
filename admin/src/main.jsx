import React from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify";
import { fetchAuthSession } from "aws-amplify/auth";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import outputs from "../../amplify_outputs.json";
import App from "./App.jsx";
import capabilities, { resolveToolRoute } from "./environment.js";
import "./admin.css";

// Temporary tools are loaded only in development. `import.meta.env.DEV` is replaced at build time,
// so these modules are removed from the production bundle entirely.
const devTools = import.meta.env.DEV
  ? {
      "#cloud-check": React.lazy(() => import("./CloudConnectivityCheck.jsx")),
      "#storage-diagnostic": React.lazy(() => import("./StorageDiagnostic.jsx")),
      "#migration-preview": React.lazy(() => import("./MigrationPreview.jsx"))
    }
  : {};

Amplify.configure(outputs);

function AuthHeader() {
  return (
    <div className="auth-brand">
      <span className="brand-seal">N</span>
      <span>
        <strong>The Natural Inquiry</strong>
        <small>EDITORIAL WORKSPACE</small>
      </span>
    </div>
  );
}

function AdminAccessGate({ user, signOut }) {
  const [access, setAccess] = React.useState({ status: "checking" });
  const [attempt, setAttempt] = React.useState(0);
  const [tool, setTool] = React.useState(window.location.hash);

  React.useEffect(() => {
    const onHashChange = () => setTool(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  React.useEffect(() => {
    let active = true;

    fetchAuthSession()
      .then((session) => {
        if (!active) return;
        const groups = session.tokens?.idToken?.payload["cognito:groups"];
        setAccess({
          status: Array.isArray(groups) && groups.includes("Administrators")
            ? "allowed"
            : "denied"
        });
      })
      .catch((error) => {
        if (active) setAccess({ status: "error", message: error.message });
      });

    return () => {
      active = false;
    };
  }, [user, attempt]);

  if (access.status === "checking") {
    return (
      <main className="auth-page">
        <p className="auth-status" role="status">Checking administrator access…</p>
      </main>
    );
  }

  if (access.status === "denied") {
    return (
      <main className="auth-page">
        <section className="auth-message">
          <span className="brand-seal">N</span>
          <h1>Administrator access required</h1>
          <p>This account is not a member of the Administrators group.</p>
          <button className="button button-primary" onClick={signOut} type="button">Sign out</button>
        </section>
      </main>
    );
  }

  if (access.status === "error") {
    return (
      <main className="auth-page">
        <section className="auth-message">
          <span className="brand-seal">N</span>
          <h1>Unable to verify access</h1>
          <p>{access.message}</p>
          <button
            className="button button-secondary"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            Try again
          </button>
          <button className="button button-primary" onClick={signOut} type="button">Sign out</button>
        </section>
      </main>
    );
  }

  const toolRoute = resolveToolRoute(tool, capabilities);
  const Tool = toolRoute ? devTools[toolRoute] : null;
  if (Tool) {
    return (
      <React.Suspense fallback={<main className="auth-page"><p className="auth-status" role="status">Loading tool…</p></main>}>
        <Tool onClose={() => { window.location.hash = ""; }} />
      </React.Suspense>
    );
  }

  return <App user={user} onSignOut={signOut} />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div className="auth-page">
      <Authenticator
        signUpAttributes={[]}
        formFields={{ signIn: { username: { label: "Email address", placeholder: "Enter your email" } } }}
        hideSignUp
        components={{ Header: AuthHeader }}
      >
        {({ signOut, user }) => <AdminAccessGate signOut={signOut} user={user} />}
      </Authenticator>
    </div>
  </React.StrictMode>
);
