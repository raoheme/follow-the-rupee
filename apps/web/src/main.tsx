import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { MonsoonApp } from "./MonsoonApp";
import "./features/monsoon/monsoon.css";
import { ApiClientProvider } from "./api/ApiClientContext";
import { I18nProvider } from "./i18n/I18nContext";
import { createQueryClient } from "./features/map-list/queries";
import { PersonaProvider } from "./state/PersonaContext";

const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <PersonaProvider>
        <ApiClientProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <MonsoonApp />
            </BrowserRouter>
          </QueryClientProvider>
        </ApiClientProvider>
      </PersonaProvider>
    </I18nProvider>
  </React.StrictMode>,
);
