import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface User {
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}

interface Installation {
  id: number;
  account: {
    login: string;
    type: string;
    avatar_url?: string;
  };
  target_type: string;
}

interface AuthContextType {
  user: User | null;
  installations: Installation[];
  currentInstallation: Installation | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSessionExpired: boolean;
  login: () => void;
  logout: () => void;
  setCurrentInstallation: (installation: Installation) => void;
  refreshInstallations: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [currentInstallation, setCurrentInstallation] = useState<Installation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Periodic session check (every 5 minutes)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/auth/status');
        const data = await response.json();
        if (!data.authenticated) {
          setIsSessionExpired(true);
        }
      } catch {
        // Network error - don't mark as expired
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user]);

  // Persist current installation selection
  useEffect(() => {
    if (currentInstallation) {
      localStorage.setItem('currentInstallationId', String(currentInstallation.id));
    }
  }, [currentInstallation]);

  async function checkAuth() {
    try {
      const response = await fetch('/auth/status');
      const data = await response.json();

      if (data.authenticated && data.user) {
        setUser(data.user);
        await fetchInstallations();
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchInstallations() {
    try {
      const response = await fetch('/api/installations');
      if (response.ok) {
        const data = await response.json();
        setInstallations(data);

        // Restore previously selected installation
        const savedId = localStorage.getItem('currentInstallationId');
        if (savedId) {
          const saved = data.find((i: Installation) => i.id === Number(savedId));
          if (saved) {
            setCurrentInstallation(saved);
            return;
          }
        }

        // Default to first installation
        if (data.length > 0) {
          setCurrentInstallation(data[0]);
        }
      }
    } catch (error) {
      console.error('Failed to fetch installations:', error);
    }
  }

  function login() {
    // Redirect to GitHub OAuth
    window.location.href = '/auth/github';
  }

  async function logout() {
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout failed:', error);
    }
    setUser(null);
    setInstallations([]);
    setCurrentInstallation(null);
    setIsSessionExpired(false);
    localStorage.removeItem('currentInstallationId');
  }

  async function refreshInstallations() {
    await fetchInstallations();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        installations,
        currentInstallation,
        isLoading,
        isAuthenticated: !!user,
        isSessionExpired,
        login,
        logout,
        setCurrentInstallation,
        refreshInstallations,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
