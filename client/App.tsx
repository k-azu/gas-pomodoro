import { useEffect } from "react";
import { AppProvider } from "./contexts/AppContext";
import { NavigationProvider } from "./contexts/NavigationContext";
import { AppLayout } from "./components/layout/AppLayout";
import { bindDblclick } from "./lib/imageCache";

export default function App() {
  useEffect(() => {
    bindDblclick();
  }, []);

  return (
    <AppProvider>
      <NavigationProvider>
        <AppLayout />
      </NavigationProvider>
    </AppProvider>
  );
}
