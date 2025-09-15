import { Switch, Route } from "wouter";
import { lazy, Suspense } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import SidebarLayout from "@/components/SidebarLayout";

// Enhanced loading component with skeleton
const LoadingFallback = ({ page }: { page?: string }) => (
  <div className="p-6 animate-pulse">
    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
    <div className="space-y-3">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
    </div>
  </div>
);
const Home = lazy(() => import("@/pages/home"));
const Scheduling = lazy(() => import("@/pages/scheduling"));
const Inventory = lazy(() => import("@/pages/inventory"));
const Staff = lazy(() => import("@/pages/staff"));
const Analytics = lazy(() => import("@/pages/analytics"));
const NotFound = lazy(() => import("@/pages/not-found"));
// New custom tool pages
const POS = lazy(() => import("@/pages/pos"));
const Marketing = lazy(() => import("@/pages/marketing"));
const Loyalty = lazy(() => import("@/pages/loyalty"));
import DemoInit from "@/components/DemoInit";

function Router() {
  return (
    <Switch>
      {/* Business Tool Pages with Sidebar */}
      <Route path="/">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="home" />}>
            <Home />
          </Suspense>
        </SidebarLayout>
      </Route>
      <Route path="/pos">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="pos" />}>
            <POS />
          </Suspense>
        </SidebarLayout>
      </Route>
      <Route path="/marketing">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="marketing" />}>
            <Marketing />
          </Suspense>
        </SidebarLayout>
      </Route>
      <Route path="/loyalty">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="loyalty" />}>
            <Loyalty />
          </Suspense>
        </SidebarLayout>
      </Route>
      <Route path="/scheduling">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="scheduling" />}>
            <Scheduling />
          </Suspense>
        </SidebarLayout>
      </Route>
      <Route path="/inventory">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="inventory" />}>
            <Inventory />
          </Suspense>
        </SidebarLayout>
      </Route>
      <Route path="/staff">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="staff" />}>
            <Staff />
          </Suspense>
        </SidebarLayout>
      </Route>
      <Route path="/analytics">
        <SidebarLayout>
          <Suspense fallback={<LoadingFallback page="analytics" />}>
            <Analytics />
          </Suspense>
        </SidebarLayout>
      </Route>
      {/* Fallback to 404 without sidebar */}
      <Route>
        <Suspense fallback={<LoadingFallback page="404" />}>
          <NotFound />
        </Suspense>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DemoInit />
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
