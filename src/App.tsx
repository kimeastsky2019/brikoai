import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Upload from "./pages/Upload";
import Dashboard from "./pages/Dashboard";
import KnowledgeBase from "./pages/KnowledgeBase";
import Settings from "./pages/Settings";
import Checklist from "./pages/Checklist";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import ErrorPage from "./pages/Error";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Index />} />
          <Route path="/source-analysis" element={<Upload />} />
          <Route path="/upload" element={<Navigate to="/source-analysis" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/checklist" element={<Checklist />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/error" element={<ErrorPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
