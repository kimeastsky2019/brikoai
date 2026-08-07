import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Upload as UploadIcon, FileText, CheckCircle, AlertCircle, Brain, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, Collection } from "@/lib/api";
import { toast } from "sonner";
import Header from "@/components/Header"; // Import Header

const Upload = () => {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [collectionName, setCollectionName] = useState("");
  const [hasImageFiles, setHasImageFiles] = useState(false);
  const [uploadCollectionId, setUploadCollectionId] = useState<number | null>(null);
  const [documentStatuses, setDocumentStatuses] = useState<any[]>([]);
  const [polling, setPolling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Existing collections state (optional enhancement)
  const [existingCollections, setExistingCollections] = useState<Collection[]>([]);

  useEffect(() => {
    // Load existing collections on mount
    api.getCollections().then(setExistingCollections).catch(console.error);
  }, []);

  useEffect(() => {
    if (!uploadCollectionId) return;

    let intervalId: number | null = null;
    const poll = async () => {
      try {
        const docs = await api.getDocuments(uploadCollectionId, true);
        setDocumentStatuses(docs);
        const hasProcessing = docs.some((doc) => doc.status === "processing");
        setPolling(hasProcessing);
        if (!hasProcessing && intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      } catch (e) {
        console.error(e);
      }
    };

    poll();
    intervalId = window.setInterval(poll, 5000);
    return () => {
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [uploadCollectionId]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    setFiles(prev => [...prev, ...selectedFiles]);
    const hasImages = selectedFiles.some((file) =>
      file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name)
    );
    if (hasImages) {
      setHasImageFiles(true);
      toast.info("이미지 파일은 OCR 텍스트만 검색됩니다.");
    }
  };

  const handleUpload = async () => {
    if (files.length === 0 || !collectionName.trim()) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      // 1. Create or Find Collection (simple implementation: create, backend should handle dupes if configured, 
      // but here we might fail if duplicate unique constraint. 
      // Let's try to match existing name first.)

      let targetCollection = existingCollections.find(c => c.name === collectionName);

      if (!targetCollection) {
        try {
          targetCollection = await api.createCollection(collectionName);
        } catch (e: any) {
          // If it failed because of uniqueness, try to refetch
          if (e.message.includes("UNIQUE constraint")) {
            const refreshed = await api.getCollections();
            targetCollection = refreshed.find(c => c.name === collectionName);
            if (!targetCollection) throw e;
          } else {
            throw e;
          }
        }
      }

      const totalFiles = files.length;
      let completed = 0;

      // 2. Upload Files
      for (const file of files) {
        await api.uploadDocument(targetCollection!.id, file);
        completed++;
        setUploadProgress(Math.round((completed / totalFiles) * 100));
      }

      toast.success("업로드가 완료되었습니다!");
      setUploadCollectionId(targetCollection!.id);
      setDocumentStatuses([]);
      setFiles([]);
      setCollectionName("");
      setUploadProgress(100);
      setHasImageFiles(false);

    } catch (e: any) {
      toast.error(`오류 발생: ${e.message}`);
      console.error(e);
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const droppedFiles = Array.from(event.dataTransfer.files || []);
    if (droppedFiles.length === 0) return;
    setFiles(prev => [...prev, ...droppedFiles]);
    const hasImages = droppedFiles.some((file) =>
      file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name)
    );
    if (hasImages) {
      setHasImageFiles(true);
      toast.info("이미지 파일은 OCR 텍스트만 검색됩니다.");
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderStatusBadge = (status: string) => {
    if (status === "processed") {
      return <Badge variant="secondary" className="text-green-700">처리완료</Badge>;
    }
    if (status === "failed") {
      return <Badge variant="destructive">실패</Badge>;
    }
    return <Badge variant="outline" className="text-yellow-700">인덱싱 중</Badge>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold gradient-text mb-2">문서 업로드</h1>
            <p className="text-muted-foreground">새로운 컬렉션 생성 및 문서 추가</p>
          </div>

          {/* Collection Setup */}
          <Card className="mb-8 ai-glow border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Brain className="w-5 h-5 mr-2 text-primary" />
                컬렉션 설정
              </CardTitle>
              <CardDescription>
                문서들을 그룹화할 컬렉션 이름을 설정하세요. 기존 이름을 입력하면 해당 컬렉션에 추가됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="collection-name">컬렉션 이름</Label>
                  <Input
                    id="collection-name"
                    placeholder="예: 회사 정책 문서, 기술 매뉴얼 등"
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    className="mt-1"
                    list="existing-collections"
                  />
                  <datalist id="existing-collections">
                    {existingCollections.map(c => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* File Upload */}
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center">
                <UploadIcon className="w-5 h-5 mr-2 text-primary" />
                파일 업로드
              </CardTitle>
              <CardDescription>
                PDF, TXT, MD, 이미지(JPG/PNG) 파일을 업로드하세요. 여러 파일을 동시에 선택할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="text-sm text-muted-foreground">
                  이미지 데이터도 업로드 가능합니다. (현재는 OCR 텍스트만 검색)
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  ⚠️ 이미지 파일(jpg, png 등)은 텍스트 추출(OCR)만 지원합니다.
                  <br />
                  사진, 차트, 다이어그램 등의 시각적 내용은 현재 검색되지 않을 수 있습니다.
                  <br />
                  (향후 vision 분석 기능으로 업그레이드 예정)
                </div>
                {/* Upload Area */}
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    isDragging ? "border-primary bg-primary/5" : "border-primary/30 hover:border-primary/50"
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <UploadIcon className="w-12 h-12 mx-auto mb-4 text-primary/60" />
                  <div className="space-y-2">
                    <p className="text-lg font-medium">파일을 드래그하거나 클릭하여 선택</p>
                    <p className="text-sm text-muted-foreground">
                      지원 형식: PDF, TXT, MD, JPG, PNG (최대 10MB)
                    </p>
                  </div>
                  <Input
                    type="file"
                    multiple
                    accept=".pdf,.txt,.md,.jpg,.jpeg,.png"
                    onChange={handleFileSelect}
                    className="mt-4 cursor-pointer"
                  />
                </div>

                {/* File List */}
                {files.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-medium">선택된 파일 ({files.length}개)</h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {files.map((file, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <FileText className="w-5 h-5 text-primary" />
                            <div>
                              <p className="font-medium text-sm">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(file.size)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge variant="secondary" className="text-xs">
                              {file.type.includes('pdf') ? 'PDF' :
                                file.type.includes('text') ? 'TXT' :
                                file.type.includes('image') ? 'IMG' : 'MD'}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(index)}
                              className="text-destructive hover:text-destructive"
                            >
                              ×
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upload Progress */}
                {uploading && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">업로드 진행률</span>
                      <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} className="w-full" />
                  </div>
                )}
                {hasImageFiles && !uploading && (
                  <div className="text-xs text-amber-700">
                    이미지 파일은 OCR 텍스트만 검색됩니다. 시각적 내용은 검색되지 않을 수 있습니다.
                  </div>
                )}

                {/* Upload Button */}
                <Button
                  onClick={handleUpload}
                  disabled={files.length === 0 || !collectionName.trim() || uploading}
                  className="w-full bg-gradient-to-r from-primary to-primary-glow hover:from-primary-glow hover:to-primary ai-glow"
                  size="lg"
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      업로드 중...
                    </>
                  ) : (
                    <>
                      <UploadIcon className="w-5 h-5 mr-2" />
                      컬렉션에 업로드
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Upload Tips */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlertCircle className="w-5 h-5 mr-2 text-accent" />
                업로드 가이드
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-2">지원 파일 형식</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• PDF 문서 (텍스트 추출 가능)</li>
                    <li>• 텍스트 파일 (.txt)</li>
                    <li>• 마크다운 파일 (.md)</li>
                    <li>• 이미지 파일 (.jpg, .png) - OCR 텍스트만 검색</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">최적화 팁</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• 파일 크기는 10MB 이하 권장</li>
                    <li>• 명확한 컬렉션 이름 사용</li>
                    <li>• 관련 문서들을 함께 업로드</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {uploadCollectionId && (
            <Card className="mt-8">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CheckCircle className="w-5 h-5 mr-2 text-primary" />
                  인덱싱 상태
                </CardTitle>
                <CardDescription>
                  업로드된 문서의 처리 상태를 실시간으로 확인합니다. 인덱싱 중이면 잠시 후 자동 업데이트됩니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {documentStatuses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">문서 상태를 가져오는 중입니다...</p>
                ) : (
                  <div className="space-y-2">
                    {documentStatuses.map((doc) => (
                      <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
                        <div className="flex items-center space-x-3">
                          <FileText className="w-4 h-4 text-primary" />
                          <div>
                            <p className="text-sm font-medium">{doc.name}</p>
                            <p className="text-xs text-muted-foreground">상태: {doc.status}</p>
                          </div>
                        </div>
                        {renderStatusBadge(doc.status)}
                      </div>
                    ))}
                  </div>
                )}
                {polling && (
                  <div className="mt-4 text-xs text-muted-foreground">
                    인덱싱 중인 문서가 있습니다. 완료될 때까지 자동으로 상태를 갱신합니다.
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default Upload;
