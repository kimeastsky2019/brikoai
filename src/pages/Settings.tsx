import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  Settings as SettingsIcon, 
  Brain, 
  ArrowLeft, 
  Key,
  Database,
  Zap,
  Shield,
  Bell,
  Palette,
  Save
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const Settings = () => {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState("");
  const [notifications, setNotifications] = useState(true);
  const [autoSave, setAutoSave] = useState(true);
  const [theme, setTheme] = useState("light");
  const [language, setLanguage] = useState("ko");

  const handleSave = () => {
    // 설정 저장 로직 (백엔드 연동 시 구현)
    console.log("Settings saved");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => navigate("/")}
                className="mr-2"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                홈으로
              </Button>
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center ai-glow">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold gradient-text">설정</h1>
                <p className="text-sm text-muted-foreground">시스템 환경 설정</p>
              </div>
            </div>
            <Button onClick={handleSave} className="bg-gradient-to-r from-primary to-primary-glow ai-glow">
              <Save className="w-4 h-4 mr-2" />
              설정 저장
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Tabs defaultValue="api" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="api">API 설정</TabsTrigger>
              <TabsTrigger value="performance">성능</TabsTrigger>
              <TabsTrigger value="security">보안</TabsTrigger>
              <TabsTrigger value="notifications">알림</TabsTrigger>
              <TabsTrigger value="appearance">외관</TabsTrigger>
            </TabsList>

            {/* API Settings */}
            <TabsContent value="api" className="mt-6">
              <Card className="ai-glow border-primary/20">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Key className="w-5 h-5 mr-2 text-primary" />
                    API 키 관리
                  </CardTitle>
                  <CardDescription>
                    Grok API 및 기타 서비스 연동을 위한 API 키를 설정하세요.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="xai-api-key">xAI API 키</Label>
                      <Input
                        id="xai-api-key"
                        type="password"
                        placeholder="xai-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Grok API 사용을 위한 xAI API 키를 입력하세요.
                      </p>
                    </div>
                    
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="collection-name">기본 컬렉션 이름</Label>
                        <Input
                          id="collection-name"
                          placeholder="my_rag_collection"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="model-selection">기본 모델</Label>
                        <Select defaultValue="grok-4-1-fast">
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="grok-4-1-fast">Grok-4.1 Fast</SelectItem>
                            <SelectItem value="grok-4-1">Grok-4.1</SelectItem>
                            <SelectItem value="grok-4">Grok-4</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3">API 상태</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">xAI API 연결</span>
                        <Badge variant="secondary">연결됨</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Collections API</span>
                        <Badge variant="secondary">활성</Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Performance Settings */}
            <TabsContent value="performance" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Zap className="w-5 h-5 mr-2 text-accent" />
                    성능 최적화
                  </CardTitle>
                  <CardDescription>
                    검색 성능 및 응답 시간 최적화 설정
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="top-k">검색 결과 수 (Top-K)</Label>
                        <Select defaultValue="5">
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">3개</SelectItem>
                            <SelectItem value="5">5개</SelectItem>
                            <SelectItem value="10">10개</SelectItem>
                            <SelectItem value="15">15개</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label htmlFor="chunk-size">청크 크기</Label>
                        <Select defaultValue="500">
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="200">200 토큰</SelectItem>
                            <SelectItem value="500">500 토큰</SelectItem>
                            <SelectItem value="1000">1000 토큰</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>캐싱 활성화</Label>
                          <p className="text-xs text-muted-foreground">
                            동일한 쿼리에 대한 응답 캐싱
                          </p>
                        </div>
                        <Switch checked={true} />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>하이브리드 검색</Label>
                          <p className="text-xs text-muted-foreground">
                            벡터 + 키워드 검색 결합
                          </p>
                        </div>
                        <Switch checked={true} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Security Settings */}
            <TabsContent value="security" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Shield className="w-5 h-5 mr-2 text-destructive" />
                    보안 설정
                  </CardTitle>
                  <CardDescription>
                    데이터 보안 및 접근 제어 설정
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>데이터 암호화</Label>
                        <p className="text-xs text-muted-foreground">
                          저장 및 전송 중 데이터 암호화
                        </p>
                      </div>
                      <Switch checked={true} disabled />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>접근 로그 기록</Label>
                        <p className="text-xs text-muted-foreground">
                          모든 API 호출 및 검색 기록
                        </p>
                      </div>
                      <Switch checked={true} />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>자동 로그아웃</Label>
                        <p className="text-xs text-muted-foreground">
                          비활성 시간 후 자동 로그아웃
                        </p>
                      </div>
                      <Switch checked={false} />
                    </div>
                  </div>
                  
                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3">데이터 보존 정책</h4>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="log-retention">로그 보존 기간</Label>
                        <Select defaultValue="30">
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7">7일</SelectItem>
                            <SelectItem value="30">30일</SelectItem>
                            <SelectItem value="90">90일</SelectItem>
                            <SelectItem value="365">1년</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="backup-frequency">백업 주기</Label>
                        <Select defaultValue="daily">
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">매일</SelectItem>
                            <SelectItem value="weekly">매주</SelectItem>
                            <SelectItem value="monthly">매월</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notification Settings */}
            <TabsContent value="notifications" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Bell className="w-5 h-5 mr-2 text-accent" />
                    알림 설정
                  </CardTitle>
                  <CardDescription>
                    시스템 알림 및 이벤트 설정
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>이메일 알림</Label>
                        <p className="text-xs text-muted-foreground">
                          중요 이벤트 이메일 알림
                        </p>
                      </div>
                      <Switch 
                        checked={notifications} 
                        onCheckedChange={setNotifications}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>업로드 완료 알림</Label>
                        <p className="text-xs text-muted-foreground">
                          문서 업로드 및 처리 완료 시
                        </p>
                      </div>
                      <Switch checked={true} />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>오류 알림</Label>
                        <p className="text-xs text-muted-foreground">
                          시스템 오류 및 장애 발생 시
                        </p>
                      </div>
                      <Switch checked={true} />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>사용량 알림</Label>
                        <p className="text-xs text-muted-foreground">
                          API 사용량 한도 도달 시
                        </p>
                      </div>
                      <Switch checked={true} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Appearance Settings */}
            <TabsContent value="appearance" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Palette className="w-5 h-5 mr-2 text-primary" />
                    외관 설정
                  </CardTitle>
                  <CardDescription>
                    테마 및 인터페이스 설정
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="theme">테마</Label>
                        <Select value={theme} onValueChange={setTheme}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="light">라이트</SelectItem>
                            <SelectItem value="dark">다크</SelectItem>
                            <SelectItem value="system">시스템 설정</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label htmlFor="language">언어</Label>
                        <Select value={language} onValueChange={setLanguage}>
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ko">한국어</SelectItem>
                            <SelectItem value="en">English</SelectItem>
                            <SelectItem value="ja">日本語</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>애니메이션 효과</Label>
                          <p className="text-xs text-muted-foreground">
                            UI 전환 애니메이션
                          </p>
                        </div>
                        <Switch checked={true} />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>자동 저장</Label>
                          <p className="text-xs text-muted-foreground">
                            설정 자동 저장
                          </p>
                        </div>
                        <Switch 
                          checked={autoSave} 
                          onCheckedChange={setAutoSave}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Settings;