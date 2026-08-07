import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Brain, Lock, Mail, Loader2, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Login = () => {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);

    // Login State
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    // Register State
    const [regEmail, setRegEmail] = useState("");
    const [regPassword, setRegPassword] = useState("");
    const [regName, setRegName] = useState("");

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await api.login(email, password);
            toast.success("로그인 성공!");
            navigate("/");
        } catch (error: any) {
            if (error?.message?.includes("Failed to fetch")) {
                navigate("/error", {
                    state: {
                        title: "로그인 서버에 연결할 수 없습니다.",
                        message: "네트워크 또는 서버 상태를 확인해 주세요. 잠시 후 다시 시도할 수 있습니다.",
                    },
                });
                return;
            }
            toast.error("로그인 실패: " + (error.message || "이메일 또는 비밀번호를 확인하세요"));
        } finally {
            setIsLoading(false);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await api.register(regEmail, regPassword, regName);
            toast.success("가입 완료! 로그인해주세요.");
            // Switch to login tab ideally, but separate page is complicated in tabs.
            // For now just clear inputs or rely on user to switch tab, or we can auto login?
            // Let's just auto-login or ask to login.
            // Simplest: Auto-login
            await api.login(regEmail, regPassword);
            navigate("/");
        } catch (error: any) {
            toast.error("가입 실패: " + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-primary/20 ai-glow">
                <CardHeader className="space-y-1 text-center">
                    <div className="mx-auto w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center mb-4 ai-glow">
                        <Brain className="w-6 h-6 text-white" />
                    </div>
                    <CardTitle className="text-2xl font-bold gradient-text">RAG Search</CardTitle>
                    <CardDescription>
                        AI 기반 문서 분석 플랫폼에 오신 것을 환영합니다
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="login" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 mb-4">
                            <TabsTrigger value="login">로그인</TabsTrigger>
                            <TabsTrigger value="register">회원가입</TabsTrigger>
                        </TabsList>

                        <TabsContent value="login">
                            <form onSubmit={handleLogin} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">이메일</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="email"
                                            placeholder="name@example.com"
                                            className="pl-10"
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">비밀번호</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type="password"
                                            className="pl-10"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <Button className="w-full bg-primary hover:bg-primary/90" disabled={isLoading}>
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            로그인 중...
                                        </>
                                    ) : (
                                        "로그인"
                                    )}
                                </Button>
                            </form>
                        </TabsContent>

                        <TabsContent value="register">
                            <form onSubmit={handleRegister} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="reg-name">이름</Label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="reg-name"
                                            placeholder="홍길동"
                                            className="pl-10"
                                            required
                                            value={regName}
                                            onChange={(e) => setRegName(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="reg-email">이메일</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="reg-email"
                                            placeholder="name@example.com"
                                            className="pl-10"
                                            type="email"
                                            required
                                            value={regEmail}
                                            onChange={(e) => setRegEmail(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="reg-password">비밀번호</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="reg-password"
                                            type="password"
                                            className="pl-10"
                                            required
                                            value={regPassword}
                                            onChange={(e) => setRegPassword(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <Button className="w-full bg-primary hover:bg-primary/90" disabled={isLoading}>
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            가입 중...
                                        </>
                                    ) : (
                                        "회원가입"
                                    )}
                                </Button>
                            </form>
                        </TabsContent>
                    </Tabs>
                </CardContent>
                <CardFooter className="flex justify-center border-t p-4 text-sm text-muted-foreground">
                    &copy; 2025 RAG Search
                </CardFooter>
            </Card>
        </div>
    );
};

export default Login;
