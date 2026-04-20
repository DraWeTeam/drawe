import { BrowserRouter, Routes, Route } from "react-router-dom";
import Template from "./template/Template";
import Login from "./pages/login/Login";
import OAuthCallback from "./pages/login/OAuthCallback";
import Home from "./pages/Home";

function App() {
  return (
    <BrowserRouter>
      <Template>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route path="/" element={<Home />} />
        </Routes>
      </Template>
    </BrowserRouter>
  );
}

export default App;
