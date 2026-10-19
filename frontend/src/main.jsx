import { StrictMode, Suspense, lazy, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./App.css";

// The 3D intro loads only when needed, so the dashboard stays fast.
const SplashIntro = lazy(() => import("./SplashIntro.jsx"));

const SEEN_KEY = "aquaairx_intro_seen";

function hasSeenIntro() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function Root() {
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());

  const handleIntroDone = useCallback(() => {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowIntro(false);
  }, []);

  if (showIntro) {
    return (
      <Suspense fallback={null}>
        <SplashIntro onComplete={handleIntroDone} />
      </Suspense>
    );
  }

  return <App />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);