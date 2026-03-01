import { AppProvider } from "./contexts/AppContext";
import { NavigationProvider } from "./contexts/NavigationContext";
import { AppLayout } from "./components/layout/AppLayout";

export default function App() {
  return (
    <AppProvider>
      <NavigationProvider>
        <AppLayout />
      </NavigationProvider>
    </AppProvider>
  );
}
