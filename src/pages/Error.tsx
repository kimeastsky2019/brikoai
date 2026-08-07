import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

const ErrorPage = () => {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { title?: string; message?: string } };
  const title = location.state?.title || "요청 처리 중 오류가 발생했습니다.";
  const message = location.state?.message || "네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요.";

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center p-4">
      <Card className="w-full max-w-xl border-primary/20 ai-glow">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-lg bg-gradient-to-br from-destructive to-orange-400 flex items-center justify-center mb-4 ai-glow">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Button onClick={() => navigate("/")} className="w-full max-w-xs">
            홈으로 돌아가기
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()} className="w-full max-w-xs">
            새로고침
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ErrorPage;
