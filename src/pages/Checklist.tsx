import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardCheck,
  Plus,
  Printer,
  Save,
  CheckCircle,
  FileText,
  Loader2,
  Trash2,
  Calendar,
  AlertTriangle
} from "lucide-react";
import SidebarLayout from "@/components/SidebarLayout";
import ExpandableNotice from "@/components/ExpandableNotice";
import { toast } from "sonner";
import {
  api,
  type KbSector,
  type ChecklistDraft,
  type ChecklistRecord,
  type ChecklistGroup,
  type ChecklistSummary,
} from "@/lib/api";

/* 항목·저장본 타입은 위키(/api/audit/*)가 정한다.
   화면이 따로 정의하면 서버가 스키마를 바꿨을 때 조용히 어긋난다. */

export const Checklist = () => {
  const [sectors, setSectors] = useState<KbSector[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [draft, setDraft] = useState<ChecklistDraft | ChecklistRecord | null>(null);
  const [groups, setGroups] = useState<ChecklistGroup[]>([]);
  const [savedLists, setSavedLists] = useState<ChecklistSummary[]>([]);
  const [checklistTitle, setChecklistTitle] = useState("");
  const [site, setSite] = useState("");
  const [subsector, setSubsector] = useState("");
  const [owner, setOwner] = useState("");
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("generator");

  const reloadSaved = () => {
    api.checklists()
      .then((r) => setSavedLists(r.checklists))
      .catch((e) => toast.error(`저장 목록을 불러오지 못했습니다: ${e.message}`));
  };

  useEffect(() => {
    api.kbGetSectors()
      .then((d) => setSectors(d.sectors))
      .catch(() => setSectors([]));
    reloadSaved();
  }, []);

  /* 설비 목록·문항 수는 화면이 만들지 않는다. 위키에 어떤 개선안이 쌓였는지에
     따라 달라지므로 서버가 준 초안(groups)을 그대로 쓴다. */
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);

  const handleGenerate = async () => {
    if (!selectedSector) {
      toast.warning("업종을 먼저 고르세요.");
      return;
    }
    setIsGenerating(true);
    try {
      // 항목은 위키에 쌓인 개선안(measure) 카드에서 온다 — 진단이 늘면 점검표도 는다.
      const d = await api.checklistDraft(selectedSector);
      setDraft(d);
      setGroups(d.groups);
      setEditingId("");
      if (!checklistTitle) setChecklistTitle(`${d.sector_name} 현장 점검표`);
      if (d.from_wiki) toast.success(`위키에서 ${d.item_count}개 항목을 가져왔습니다.`);
      else toast.warning("이 업종의 개선안 카드가 위키에 없어 설비 골격만 나왔습니다.");
    } catch (e: any) {
      toast.error(`초안을 만들지 못했습니다: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenSaved = async (cid: string) => {
    try {
      const r = await api.checklist(cid);
      setDraft(r);
      setGroups(r.groups);
      setEditingId(r.id);
      setChecklistTitle(r.title);
      setSite(r.site || "");
      setSubsector(r.subsector || "");
      setOwner(r.owner || "");
      setSelectedSector(r.sector || "");
      setActiveTab("generator");
    } catch (e: any) {
      toast.error(`불러오지 못했습니다: ${e.message}`);
    }
  };

  /** 현장에서 적은 값을 항목에 반영한다. */
  const patchItem = (gi: number, ii: number, key: "checked" | "note", value: string) =>
    setGroups((prev) =>
      prev.map((g, i) =>
        i !== gi ? g : { ...g, items: g.items.map((it, j) => (j !== ii ? it : { ...it, [key]: value })) }
      )
    );

  const handleSaveChecklist = async () => {
    if (!checklistTitle.trim()) {
      toast.warning("체크리스트 제목을 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      // 저장은 위키가 한다 — 팀 전체가 같은 목록을 본다.
      const r = await api.saveChecklist({
        id: editingId || undefined,
        title: checklistTitle.trim(),
        sector: selectedSector,
        subsector: subsector.trim(),
        site: site.trim(),
        owner: owner.trim(),
        groups,
      });
      setEditingId(r.id);
      reloadSaved();
      toast.success("현장 체크리스트를 저장했습니다. 모든 팀이 볼 수 있습니다.");
      setActiveTab("saved");
    } catch (e: any) {
      toast.error(`저장 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDeleteSaved = async (id: string) => {
    if (!confirm("이 체크리스트를 지웁니다. 되돌릴 수 없습니다.")) return;
    try {
      await api.deleteChecklist(id);
      if (editingId === id) { setDraft(null); setGroups([]); setEditingId(""); }
      reloadSaved();
      toast.info("저장된 체크리스트를 제거했습니다.");
    } catch (e: any) {
      toast.error(`삭제 실패: ${e.message}`);
    }
  };

  const sectorName = (code: string) =>
    sectors.find((x) => x.code === code)?.name ?? code ?? "—";

  const headerCta = (
    <Button
      onClick={handleGenerate}
      disabled={isGenerating || !selectedSector}
      className="bg-[#5146E5] hover:bg-[#5146E5]/90 text-white font-semibold shadow-lg shadow-[#5146E5]/25 rounded-lg px-5 py-2.5 outline-none"
    >
      {isGenerating ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          문항 빌딩 중...
        </>
      ) : (
        <>
          <Plus className="h-4 w-4 mr-2" />
          체크리스트 만들기
        </>
      )}
    </Button>
  );

  return (
    <SidebarLayout
      title="현장 적용"
      description="에너지 지단 현장 실사에 즉각 적용할 수 있는 맞춤형 체크리스트 문항을 업종별 데이터 규약 및 탑재 지식을 기반으로 추출하여 발행합니다."
      statusLine={
        selectedSector
          ? `선택 업종: ${sectorName(selectedSector)}${totalItems ? ` · 문항 ${totalItems}개` : " · 아직 만들지 않음"}`
          : "업종을 고르면 위키의 개선안 카드로 점검표를 만듭니다"
      }
      cta={headerCta}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Collapsible Notice */}
        <ExpandableNotice summary="ℹ️ 현장 안전 검사 및 법정 안전 진단 항목은 법률 개정에 따라 변동될 수 있습니다.">
          에너지합리화법 제32조 및 산업통상자원부 고시에 의거한 에너지 진단 가이드와 현장 안전 수칙은 
          매분기 regulations/ 채널에 자동 동기화되며, 본 체크리스트 추출 기능은 동기화된 최신 법규 조항을 준수하여 작동합니다.
        </ExpandableNotice>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 rounded-lg bg-slate-200/50 p-1">
            <TabsTrigger value="generator" className="rounded-md font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900">
              체크리스트 생성기
            </TabsTrigger>
            <TabsTrigger value="saved" className="rounded-md font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-slate-900">
              저장된 목록 (결과 탭)
            </TabsTrigger>
          </TabsList>

          {/* Generator Tab */}
          <TabsContent value="generator" className="mt-4 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Option Selector Card */}
              <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden md:col-span-1">
                <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                  <CardTitle className="text-sm font-bold text-slate-800">현장 특성 입력</CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-5">
                  
                  {/* Sector Selection */}
                  <div className="space-y-1.5">
                    <Label htmlFor="sector-select" className="text-xs font-bold text-slate-700">진단 부문</Label>
                    <Select value={selectedSector} onValueChange={setSelectedSector}>
                      <SelectTrigger id="sector-select" className="rounded-lg h-9 bg-white">
                        <SelectValue placeholder="업종 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {sectors.map((sc) => (
                          <SelectItem key={sc.code} value={sc.code}>{sc.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 설비 목록은 화면이 정하지 않는다 — 업종 프로파일에 따라
                      서버가 골격을 짜고, 위키의 개선안 카드를 거기에 붙인다. */}
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-slate-700">점검표 정보</Label>
                    <Input value={checklistTitle} onChange={(e) => setChecklistTitle(e.target.value)}
                           placeholder="제목 (예: 금속가공 현장 점검표)" className="h-9 rounded-lg bg-white text-xs" />
                    <Input value={site} onChange={(e) => setSite(e.target.value)}
                           placeholder="사업장 (예: seojincam)" className="h-9 rounded-lg bg-white text-xs" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={subsector} onChange={(e) => setSubsector(e.target.value)}
                             placeholder="소분류" className="h-9 rounded-lg bg-white text-xs" />
                      <Input value={owner} onChange={(e) => setOwner(e.target.value)}
                             placeholder="작성자" className="h-9 rounded-lg bg-white text-xs" />
                    </div>
                  </div>

                  {/* Info helper */}
                  <div className="rounded-lg bg-indigo-50/40 border border-indigo-100/50 p-3 text-[11px] text-indigo-900 leading-normal">
                    선택하신 설비 조건에 맞추어 사내 RAG DB의 우수 개선안(ECM) 카드 및 설비 지표에서 현장 체크리스트를 자동 조합합니다.
                  </div>
                </CardContent>
              </Card>

              {/* Main Generation & Result Card */}
              <div className="md:col-span-2 space-y-6">
                <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden min-h-[300px] flex flex-col">
                  <CardHeader className="border-b border-slate-100 py-3.5 bg-slate-50/30 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-800">생성 체크리스트 문항</CardTitle>
                      <CardDescription className="text-xs">실시간 지식화된 ECM 조건 매핑 결과입니다.</CardDescription>
                    </div>
                    {groups.length > 0 && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button variant="outline" size="sm" onClick={handlePrint} className="h-8 text-slate-700 rounded-lg border-slate-200">
                          <Printer className="w-3.5 h-3.5 mr-1" /> 인쇄
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleSaveChecklist} className="h-8 text-slate-700 rounded-lg border-slate-200 bg-white">
                          <Save className="w-3.5 h-3.5 mr-1" /> 저장
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-4 flex-1 flex flex-col justify-between">
                    {isGenerating ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-16 space-y-4">
                        <Loader2 className="h-10 w-10 text-[#5146E5] animate-spin" />
                        <div className="text-center space-y-1 max-w-xs">
                          <p className="text-sm font-bold text-slate-800">위키에서 개선안 카드 탐색 중</p>
                          <p className="text-xs text-slate-500">해당 업종의 ECM 카드를 설비별로 배치하고 있습니다…</p>
                        </div>
                      </div>
                    ) : groups.length > 0 ? (
                      <div className="space-y-4 flex-1">
                        {draft?.from_wiki === false && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-[11px] text-amber-900">
                            이 업종의 개선안 카드가 위키에 없어 <strong>설비 골격만</strong> 나왔습니다.
                            해당 업종 진단서를 위키에 넣으면 항목이 채워집니다.
                          </div>
                        )}
                        {/* 설비별로 묶어 낸다 — 현장 투어가 설비 단위로 돌기 때문이다. */}
                        {groups.map((g, gi) => (
                          <div key={g.equipment} className="print:break-inside-avoid">
                            <div className="flex items-baseline gap-2 mb-1.5">
                              <h4 className="text-sm font-bold text-slate-800">{g.equipment}</h4>
                              <span className="text-[11px] text-slate-400">{g.items.length}건</span>
                            </div>
                            <p className="text-[10px] text-slate-400 mb-2">기록할 값: {g.fields.join(" · ")}</p>
                            {g.items.length === 0 ? (
                              <p className="text-[11px] text-slate-400 pl-1 pb-2">
                                붙는 개선안이 아직 없습니다 — 현장에서 직접 기록하세요.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {g.items.map((it, ii) => (
                                  <div key={it.id}
                                       className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 flex items-start gap-3 print:border-slate-300">
                                    <select
                                      value={it.checked}
                                      onChange={(e) => patchItem(gi, ii, "checked", e.target.value)}
                                      className="mt-0.5 text-xs rounded border-slate-300 bg-white h-7 print:hidden"
                                      aria-label="해당 여부"
                                    >
                                      <option value="">—</option>
                                      <option value="yes">해당</option>
                                      <option value="no">비해당</option>
                                      <option value="hold">보류</option>
                                    </select>
                                    <div className="flex-1 space-y-1 text-xs min-w-0">
                                      <p className="font-semibold text-slate-800 leading-normal text-sm">{it.name}</p>
                                      <input
                                        value={it.note}
                                        onChange={(e) => patchItem(gi, ii, "note", e.target.value)}
                                        placeholder={g.fields.join(", ")}
                                        className="w-full text-[11px] border-b border-dotted border-slate-300 py-1 outline-none focus:border-[#5146E5] bg-transparent"
                                      />
                                      <p className="text-[10px] text-slate-400 font-mono print:hidden">근거: {it.source}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center py-16 text-slate-400">
                        <ClipboardCheck className="h-12 w-12 text-slate-300 mb-3" />
                        <p className="text-sm font-semibold">체크리스트가 비어 있습니다.</p>
                        <p className="text-xs mt-1 text-slate-500">업종을 고르고 우측 상단의 [체크리스트 만들기]를 누르세요.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

            </div>
          </TabsContent>

          {/* Saved Lists Tab */}
          <TabsContent value="saved" className="mt-4">
            <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-slate-100 bg-slate-50/50">
                <CardTitle className="text-sm font-bold text-slate-800">이력 및 보관된 체크리스트</CardTitle>
                <CardDescription>과거에 빌드하여 보관된 현장 체크리스트의 이력 목록입니다.</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                {savedLists.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-sm">
                    저장된 체크리스트가 존재하지 않습니다.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {savedLists.map((list) => (
                      <div
                        key={list.id}
                        className="rounded-lg border border-slate-100 p-4 bg-slate-50/50 hover:shadow-md transition-all flex flex-col justify-between h-36"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <Badge className="bg-indigo-600/10 text-[#5146E5] border-none text-[10px] font-bold">
                              {sectorName(list.sector)}
                            </Badge>
                            <span className="text-[10px] text-slate-400 flex items-center font-medium">
                              <Calendar className="w-3 h-3 mr-1" />
                              {(list.updated_at || "").slice(0, 10)}
                            </span>
                          </div>
                          <h4 className="font-bold text-slate-800 mt-2 truncate text-sm">{list.title}</h4>
                          <p className="text-xs text-slate-400 mt-1">
                            문항 {list.item_count}개{list.site ? ` · ${list.site}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs font-bold text-[#5146E5] hover:bg-indigo-50"
                            onClick={() => handleOpenSaved(list.id)}
                          >
                            문항 불러오기
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full"
                            onClick={() => handleDeleteSaved(list.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </SidebarLayout>
  );
};

export default Checklist;
