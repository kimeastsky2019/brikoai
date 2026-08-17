import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Search, Upload, BarChart3, Settings, LogIn, LogOut, Database } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";

const Header = () => {
    const navigate = useNavigate();
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    useEffect(() => {
        // Check token on mount and when local storage changes (if we had an event listener, but for now just mount)
        const token = localStorage.getItem("token");
        setIsLoggedIn(!!token);
    }, []);

    const handleAuthAction = (action: () => void) => {
        const token = localStorage.getItem("token");
        if (token) {
            action();
        } else {
            navigate("/login");
        }
    };

    const handleLogout = () => {
        api.logout();
        setIsLoggedIn(false);
        toast.info("로그아웃되었습니다.");
        navigate("/"); // Go home on logout
    };

    return (
        <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
            <div className="container mx-auto px-4 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 cursor-pointer" onClick={() => navigate("/")}>
                        <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center ai-glow border border-primary/10">
                            <img src="/gng-logo.png" alt="GnG" className="w-8 h-8 object-contain" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold gradient-text">RAG Search</h1>
                            <p className="text-sm text-muted-foreground">지능형 문서 검색 시스템</p>
                        </div>
                    </div>
                    <nav className="hidden md:flex items-center space-x-4">
                        <Button
                            variant="ghost"
                            className="text-foreground hover:text-primary"
                            onClick={() => navigate("/")}
                        >
                            <Search className="w-4 h-4 mr-2" />
                            검색
                        </Button>
                        <Button
                            variant="ghost"
                            className="text-foreground hover:text-primary"
                            onClick={() => handleAuthAction(() => navigate("/upload"))}
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            업로드
                        </Button>
                        <Button
                            variant="ghost"
                            className="text-foreground hover:text-primary"
                            onClick={() => handleAuthAction(() => navigate("/knowledge-base"))}
                        >
                            <Database className="w-4 h-4 mr-2" />
                            지식 데이터베이스 구축
                        </Button>
                        <Button
                            variant="ghost"
                            className="text-foreground hover:text-primary"
                            onClick={() => handleAuthAction(() => navigate("/dashboard"))}
                        >
                            <BarChart3 className="w-4 h-4 mr-2" />
                            대시보드
                        </Button>
                        <Button
                            variant="ghost"
                            className="text-foreground hover:text-primary"
                            onClick={() => handleAuthAction(() => navigate("/settings"))}
                        >
                            <Settings className="w-4 h-4 mr-2" />
                            설정
                        </Button>

                        {isLoggedIn ? (
                            <Button variant="outline" className="ml-2" onClick={handleLogout}>
                                <LogOut className="w-4 h-4 mr-2" />
                                로그아웃
                            </Button>
                        ) : (
                            <Button variant="default" className="ml-2" onClick={() => navigate("/login")}>
                                <LogIn className="w-4 h-4 mr-2" />
                                로그인
                            </Button>
                        )}
                    </nav>
                </div>
            </div>
        </header>
    );
};

export default Header;
