import { BrowserRouter, Routes, Route } from "react-router-dom";
import Template from "./template/Template";
import Login from "./pages/login/Login";
import Signup from "./pages/login/Signup";
import OAuthCallback from "./pages/login/OAuthCallback";
import Home from "./pages/Home";
import ReferencePage from "./pages/chat/ReferencePage";
import ProjectList from "./pages/projects/ProjectList";
import ChatPage from "./pages/chat/ChatPage";
import OnboardingPage from "./pages/onboarding/OnboardingPage";

function App() {
  return (
    <BrowserRouter>
      <Template>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/" element={<Home />} />
          <Route path="/projects/:projectId/reference/:referenceId" element={<ReferencePage />} />
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/projects/:projectId/chat" element={<ChatPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Routes>
      </Template>
    </BrowserRouter>
  );
}

export default App;
