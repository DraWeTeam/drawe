import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/login/Login";
import Template from "./template/Template";

function App() {
  return (
    <BrowserRouter>
        <Template>
          <Routes>
            <Route path="/" element={<Login />} />
          </Routes>
        </Template>
    </BrowserRouter>
  )
}

export default App
