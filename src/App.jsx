import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Template from "./template/Template";
import Login from "./pages/login/Login";
import OAuthCallback from "./pages/login/OAuthCallback";
import Home from "./pages/Home";

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem("accessToken");
  return token ? children : <Navigate to="/login" replace />;
};

function App() {
  return (
    <BrowserRouter>
      <Template>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Home />
              </PrivateRoute>
            }
          />
        </Routes>
      </Template>
    </BrowserRouter>
  );
}

export default App;
