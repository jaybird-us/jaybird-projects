import { useState, useEffect, useCallback } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { AppShell } from "@jybrd/design-system/compounds/app-shell";
import { ThemeSwitcher } from "@jybrd/design-system/compounds/theme-switcher";
import { Button } from "@jybrd/design-system/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@jybrd/design-system/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@jybrd/design-system/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@jybrd/design-system/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { SignOut, Gear, Warning } from "@phosphor-icons/react";
import { cn } from "@jybrd/design-system/lib/utils";

export function AppLayout() {
  const {
    user,
    installations,
    currentInstallation,
    setCurrentInstallation,
    logout,
    isSessionExpired,
  } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    const stored = localStorage.getItem("theme");
    return (stored as "light" | "dark" | "system") || "system";
  });
  const [isDark, setIsDark] = useState(false);
  const navigate = useNavigate();

  // Apply theme to document
  const applyTheme = useCallback((newTheme: "light" | "dark" | "system") => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const shouldBeDark = newTheme === "dark" || (newTheme === "system" && prefersDark);

    if (shouldBeDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    setIsDark(shouldBeDark);
  }, []);

  // Handle theme change from ThemeSwitcher
  const handleThemeChange = useCallback((newTheme: "light" | "dark" | "system") => {
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    applyTheme(newTheme);
  }, [applyTheme]);

  // Apply theme on mount and listen for system preference changes
  useEffect(() => {
    applyTheme(theme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
  }, [theme, applyTheme]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const navItems = [
    { to: "/app", icon: "/icons/dashboard.svg", label: "Dashboard", end: true },
    { to: "/app/projects", icon: "/icons/projects.svg", label: "Projects" },
    { to: "/app/documents", icon: "/icons/documents.svg", label: "Documents" },
    { to: "/app/dependencies", icon: "/icons/dependencies.svg", label: "Dependencies" },
    { to: "/app/milestones", icon: "/icons/milestones.svg", label: "Milestones" },
    { to: "/app/resources", icon: "/icons/resources.svg", label: "Resources" },
    { to: "/app/analytics", icon: "/icons/analytics.svg", label: "Analytics" },
    { to: "/app/configuration", icon: "/icons/configuration.svg", label: "Configuration" },
  ];

  return (
    <AppShell
      fullScreen
      sidebarCollapsed={sidebarCollapsed}
      onSidebarCollapse={setSidebarCollapsed}
    >
      <AppShell.Sidebar className="!bg-sidebar">
        <div className="flex flex-col h-full text-sidebar-foreground">
          {/* Logo */}
          <div className="flex items-center gap-0 px-2 pt-1 pb-3 border-b border-sidebar-border/50">
            <img
              src={isDark ? "/img/logo_dark.png" : "/img/logo_light.png"}
              alt="jayBird"
              className={cn(
                "h-10 transition-all",
                sidebarCollapsed ? "w-8 object-contain object-left" : "w-auto"
              )}
            />
          </div>

          {/* Installation Selector */}
          {installations.length > 0 && !sidebarCollapsed && (
            <div className="px-2 pt-3 pb-1">
              <Select
                value={String(currentInstallation?.id || "")}
                onValueChange={(value) => {
                  const installation = installations.find(
                    (i) => i.id === Number(value)
                  );
                  if (installation) setCurrentInstallation(installation);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select installation" />
                </SelectTrigger>
                <SelectContent>
                  {installations.map((installation) => (
                    <SelectItem
                      key={installation.id}
                      value={String(installation.id)}
                    >
                      <div className="flex items-center gap-2">
                        <img src="/icons/github.svg" alt="" className="h-5 w-5" />
                        <span>{installation.account.login}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 py-4">
            <ul className="space-y-1 px-2">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                      )
                    }
                  >
                    <img src={item.icon} alt="" className="h-5 w-5" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Theme Switcher */}
          <div className={cn("px-2 pb-2", sidebarCollapsed && "flex justify-center")}>
            <ThemeSwitcher
              value={theme}
              onChange={handleThemeChange}
              enableAnimation
            />
          </div>

          {/* User Menu */}
          <div className="p-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start gap-3 py-3 h-auto border border-sidebar-border",
                    sidebarCollapsed && "justify-center px-2"
                  )}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user?.avatar_url} alt={user?.login} />
                    <AvatarFallback>
                      {user?.login?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {!sidebarCollapsed && (
                    <div className="flex flex-col items-start text-left">
                      <span className="text-sm font-medium">
                        {user?.name || user?.login}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        @{user?.login}
                      </span>
                    </div>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/app/settings")}>
                  <Gear className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <SignOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </AppShell.Sidebar>

      <AppShell.Main className="!mr-0 !mb-0">
        {isSessionExpired && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Warning className="h-5 w-5 text-amber-500" weight="fill" />
              <span className="text-sm text-amber-700 dark:text-amber-300">
                Your session has expired. Please sign out and sign back in to continue.
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
            >
              Sign Out
            </Button>
          </div>
        )}
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
