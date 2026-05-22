import { BrowserRouter, Routes, Route } from "react-router-dom";
import Template from "./template/Template";
import Login from "./pages/login/Login";
import Signup from "./pages/login/Signup";
import SignupCompletePage from "./pages/login/SignupCompletePage";
import OAuthCallback from "./pages/login/OAuthCallback";
import Home from "./pages/Home";
import ReferencePage from "./pages/chat/ReferencePage";
import ProjectList from "./pages/projects/ProjectList";
import ChatPage from "./pages/chat/ChatPage";
import OnboardingPage from "./pages/onboarding/OnboardingPage";
import OnboardingCompletePage from "./pages/onboarding/OnboardingCompletePage";
import { useEffect } from "react";
import { track } from "./analytics";

function App() {
  useEffect(() => {
    track("test_ping", { hello: "world" });
  }, []);
  return (
    <BrowserRouter>
      <Template>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/" element={<ProjectList />} />
          <Route
            path="/projects/:projectId/reference/:referenceId"
            element={<ReferencePage />}
          />
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/:projectId/chat" element={<ChatPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/signup/complete" element={<SignupCompletePage />} />
          <Route
            path="/onboarding/complete"
            element={<OnboardingCompletePage />}
          />
        </Routes>
      </Template>
    </BrowserRouter>
  );
}

export default App;
