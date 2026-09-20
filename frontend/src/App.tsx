import { useCallback, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { getToken, logout, setToken } from "./api";
import { AuthScreen } from "./AuthScreen";
import { ChatScreen } from "./ChatScreen";
import { CouncilPage } from "./CouncilPage";
import { Dashboard } from "./Dashboard";
import { EventPage } from "./EventPage";

export default function App() {
  const [token, setSessionToken] = useState<string | null>(() => getToken());

  const handleAuthenticated = useCallback((nextToken: string) => {
    setToken(nextToken);
    setSessionToken(nextToken);
  }, []);

  const handleSignOut = useCallback(() => {
    void logout()
      .catch(() => undefined)
      .finally(() => {
        setToken(null);
        setSessionToken(null);
      });
  }, []);

  if (!token) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard onSignOut={handleSignOut} />} />
        <Route path="/new" element={<ChatScreen onSignOut={handleSignOut} />} />
        <Route path="/events/:eventId" element={<EventPage onSignOut={handleSignOut} />} />
        <Route path="/events/:eventId/council" element={<CouncilPage onSignOut={handleSignOut} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
