import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload as UploadIcon, FileText, CheckCircle, AlertCircle, Play, Loader2 } from "lucide-react";
import { api, Collection } from "@/lib/api";
import { toast } from "sonner";
import SidebarLayout from "@/components/SidebarLayout";
import ExpandableNotice from "@/components/ExpandableNotice";

const Upload = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [collectionName, setCollectionName] = useState("");
  const [hasImageFiles, setHasImageFiles] = useState(false);
  const [uploadCollectionId, setUploadCollectionId] = useState<number | null>(null);
  const [documentStatuses, setDocumentStatuses] = useState<any[]>([]);
  const [polling, setPolling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Redesign additional state for sector & LLM selection inside card
  const [selectedSector, setSelectedSector] = useState("__auto__");
  const [selectedLlm, setSelectedLlm] = useState("exo");

  // Existing collections state
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
      let targetCollection = existingCollections.find(c => c.name === collectionName);

      if (!targetCollection) {
        try {
          targetCollection = await api.createCollection(collectionName);
        } catch (e: any) {
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

      // Refresh collections
      api.getCollections().then(setExistingCollections).catch(console.error);

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
      return <Badge className="bg-[#17B890]/20 text-[#17B890] border-none">처리완료</Badge>;
    }
    if (status === "failed") {
      return <Badge variant="destructive">실패</Badge>;
    }
    return <Badge className="bg-[#F5B51B]/20 text-[#F5B51B] border-none animate-pulse">인덱싱 중</Badge>;
  };

  const isUploadDisabled = files.length === 0 || !collectionName.trim() || uploading;

  const headerCta = (
    <Button
      onClick={handleUpload}
      disabled={isUploadDisabled}
      className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 transition-all outline-none"
    >
      {uploading ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          분석 중...
        </>
      ) : (
        <>
          <Play className="h-4 w-4 mr-2" />
          분석 시작
        </>
      )}
    </Button>
  );

  return (
    <SidebarLayout
      title="자료 준비"
      description="신규 진단 보고서(PDF, TXT) 또는 이미지 파일을 업로드하고, 데이터 분류 체계를 적용하기 위한 컬렉션을 생성합니다."
      statusLine={
        files.length > 0
          ? `분석 대기 중: 파일 ${files.length}개 선택됨`
          : "상태: 분석 준비 완료"
      }
      cta={headerCta}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* OCR Warning collapsible notice */}
        <ExpandableNotice summary="⚠️ 이미지 파일(JPG, PNG)은 OCR 텍스트 추출만 가능하며 시각적 요소 분석은 준비 중입니다.">
          사진, 차트, 다이어그램, 도면 등의 시각적 속성은 원문 텍스트 내 스캔 범위만 인덱싱되며,
          향후 Vision 기반 분석 에이전트 업그레이드 배포 후 정밀 매핑이 지원될 예정입니다.
        </ExpandableNotice>

        {/* Collection & Processing Setup Card */}
        <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50">
            <CardTitle className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#5146E5]" />
              작업 및 분류 설정
            </CardTitle>
            <CardDescription>
              데이터 컨트랙트를 정의하고, 타겟 LLM 추론 환경과 분류 업종을 한 곳에서 설정합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Collection Name */}
              <div className="space-y-2">
                <Label htmlFor="collection-name" className="text-sm font-semibold text-slate-700">컬렉션 이름</Label>
                <Input
                  id="collection-name"
                  placeholder="예: 글로텍 충주공장, 기술 매뉴얼"
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  className="rounded-lg border-slate-200 focus:border-[#5146E5] focus:ring-1 focus:ring-[#5146E5] h-10 outline-none"
                  list="existing-collections"
                />
                <datalist id="existing-collections">
                  {existingCollections.map(c => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>

              {/* Sector Selection */}
              <div className="space-y-2">
                <Label htmlFor="sector-select" className="text-sm font-semibold text-slate-700">분류 업종</Label>
                <Select value={selectedSector} onValueChange={setSelectedSector}>
                  <SelectTrigger id="sector-select" className="rounded-lg border-slate-200 h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">자동 분류 (권장)</SelectItem>
                    <SelectItem value="building">건물 및 공공기관</SelectItem>
                    <SelectItem value="industrial">산업체 및 제조공장</SelectItem>
                    <SelectItem value="renewable">신재생 및 ESS 발전</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* LLM Model Selection */}
              <div className="space-y-2">
                <Label htmlFor="llm-select" className="text-sm font-semibold text-slate-700">추론 경로 (LLM)</Label>
                <Select value={selectedLlm} onValueChange={setSelectedLlm}>
                  <SelectTrigger id="llm-select" className="rounded-lg border-slate-200 h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exo">사내 GPU (Qwen 2.5 72B)</SelectItem>
                    <SelectItem value="grok">외부 API (Grok-2 API)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* File Dropzone & Selection Card */}
        <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
          <CardContent className="p-6">
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${
                isDragging
                  ? "border-[#5146E5] bg-[#5146E5]/5"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50/50"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <UploadIcon className="w-12 h-12 mx-auto mb-4 text-slate-400" />
              <div className="space-y-2 max-w-md mx-auto">
                <p className="text-base font-semibold text-slate-800">분석할 파일을 이곳에 끌어다 놓으세요</p>
                <p className="text-xs text-slate-500 leading-normal">
                  지원 규격: PDF, TXT, MD, JPG, PNG (파일당 최대 10MB)
                </p>
              </div>
              <div className="mt-4 relative max-w-xs mx-auto">
                <Input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button variant="outline" className="w-full rounded-lg border-slate-200 text-slate-700 h-10 hover:bg-slate-100">
                  로컬 파일 탐색
                </Button>
              </div>
            </div>

            {/* Selected File List */}
            {files.length > 0 && (
              <div className="mt-6 space-y-3">
                <h4 className="font-semibold text-sm text-slate-800">업로드 대상 파일 ({files.length}개)</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center space-x-3 truncate">
                        <FileText className="w-5 h-5 text-[#5146E5] shrink-0" />
                        <div className="truncate">
                          <p className="font-medium text-sm text-slate-800 truncate">{file.name}</p>
                          <p className="text-xs text-slate-400">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <Badge variant="outline" className="text-slate-500 border-slate-200 font-normal">
                          {file.type.includes('pdf') ? 'PDF' :
                            file.type.includes('text') ? 'TXT' :
                            file.type.includes('image') ? 'IMG' : 'MD'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full"
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
              <div className="mt-6 space-y-2 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">전송 및 추출 작업 진행 중</span>
                  <span className="font-bold text-[#5146E5]">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-1.5 bg-slate-100" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Indexing Status Results */}
        {uploadCollectionId && (
          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50">
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <CheckCircle className="w-4.5 h-4.5 text-[#17B890]" />
                실시간 인덱싱 현황
              </CardTitle>
              <CardDescription>
                백엔드 파이프라인에서 텍스트 구조를 분해하고 수치를 점검하는 실시간 상태입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              {documentStatuses.length === 0 ? (
                <p className="text-sm text-slate-400">문서 상태 목록을 받아오는 중입니다...</p>
              ) : (
                <div className="space-y-2.5">
                  {documentStatuses.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-slate-50/80 rounded-lg border border-slate-100/60 text-sm">
                      <div className="flex items-center space-x-3 truncate">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="truncate">
                          <p className="font-medium text-slate-700 truncate">{doc.name}</p>
                          <p className="text-xs text-slate-400">크기: {doc.size_bytes ? formatFileSize(doc.size_bytes) : "—"}</p>
                        </div>
                      </div>
                      {renderStatusBadge(doc.status)}
                    </div>
                  ))}
                </div>
              )}
              {polling && (
                <div className="mt-4 text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F5B51B] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#F5B51B]"></span>
                  </span>
                  백그라운드에서 실시간 데이터 가공 중입니다. (5초 간격 갱신)
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </SidebarLayout>
  );
};

export default Upload;
