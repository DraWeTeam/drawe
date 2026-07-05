import { BrowserRouter, Routes, Route } from "react-router-dom";
import Template from "./template/Template";
import Login from "./pages/login/Login";
import Signup from "./pages/login/Signup";
import TermsAgreement from "./pages/login/TermsAgreement";
import SignupCompletePage from "./pages/login/SignupCompletePage";
import OAuthCallback from "./pages/login/OAuthCallback";
import Home from "./pages/Home";
import ReferencePage from "./pages/chat/ReferencePage";
import ProjectList from "./pages/projects/ProjectList";
import ChatPage from "./pages/chat/ChatPage";
import ReferenceBoardPage from "./pages/board/ReferenceBoardPage";
import ArchivePage from "./pages/gallery/ArchivePage";
import ReferenceListPage from "./pages/gallery/ReferenceListPage";
import CompletedGalleryPage from "./pages/gallery/CompletedGalleryPage";
import CompletedDetailPage from "./pages/gallery/CompletedDetailPage";
import SettingsPage from "./pages/settings/SettingsPage";
import PlanPage from "./pages/settings/PlanPage";
import PolicyPage from "./pages/settings/PolicyPage";
// 온보딩 비활성화:
// import OnboardingPage from "./pages/onboarding/OnboardingPage";
// import OnboardingCompletePage from "./pages/onboarding/OnboardingCompletePage";
import { useEffect } from "react";
import { track } from "./analytics";
import { ConsentProvider, ConsentGate } from "./auth/ConsentContext";

function App() {
  useEffect(() => {
    track("test_ping", { hello: "world" });
  }, []);
  return (
    <BrowserRouter>
      <ConsentProvider>
        <Template>
          <ConsentGate>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup/terms" element={<TermsAgreement />} />
              <Route path="/terms" element={<TermsAgreement consentMode />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/oauth/callback" element={<OAuthCallback />} />
              <Route path="/" element={<ProjectList />} />
              <Route
                path="/projects/:projectId/reference/:referenceId"
                element={<ReferencePage />}
              />
              <Route path="/projects" element={<ProjectList />} />
              <Route path="/archive" element={<ArchivePage />} />
              <Route
                path="/archive/references"
                element={<ReferenceListPage />}
              />
              <Route path="/gallery" element={<CompletedGalleryPage />} />
              <Route
                path="/gallery/:projectId"
                element={<CompletedDetailPage />}
              />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/plan" element={<PlanPage />} />
              <Route path="/policy" element={<PolicyPage />} />
              <Route path="/projects/:projectId/chat" element={<ChatPage />} />
              <Route
                path="/projects/:projectId/board"
                element={<ReferenceBoardPage />}
              />
              {/* 온보딩 비활성화:
              <Route path="/onboarding" element={<OnboardingPage />} /> */}
              <Route path="/signup/complete" element={<SignupCompletePage />} />
              {/* 온보딩 비활성화:
              <Route
                path="/onboarding/complete"
                element={<OnboardingCompletePage />}
              /> */}
            </Routes>
          </ConsentGate>
        </Template>
      </ConsentProvider>
    </BrowserRouter>
  );
}

export default App;
