import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { PublicClientApplication, EventType } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";

const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AAD_CLIENT_ID,                  // e.g. 11111111-2222-3333-4444-555555555555
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AAD_TENANT_ID}`, // e.g. your-tenant-guid
    redirectUri: import.meta.env.VITE_REDIRECT_URI || window.location.origin,            // http://localhost:5173 for dev
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: true,  // helpful on some browsers
  },
};

const pca = new PublicClientApplication(msalConfig);

pca.initialize().then(() => {
  // Optional: set active account after login
  pca.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload?.account) {
      pca.setActiveAccount(event.payload.account);
    }
  });

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <MsalProvider instance={pca}>
        <App />
      </MsalProvider>
    </React.StrictMode>
  );
});
