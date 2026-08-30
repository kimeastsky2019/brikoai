import React, { useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";

interface ExpandableNoticeProps {
  summary: string;
  children: React.ReactNode;
  className?: string;
}

export const ExpandableNotice: React.FC<ExpandableNoticeProps> = ({
  summary,
  children,
  className = "",
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900 transition-all duration-300 ${className}`}
    >
      <div
        className="flex cursor-pointer items-center justify-between gap-2 font-medium"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-amber-700" />
          <span className="truncate">{summary}</span>
        </div>
        <button
          type="button"
          className="rounded p-0.5 hover:bg-amber-100/80 transition-colors"
          aria-label={isExpanded ? "상세 정보 접기" : "상세 정보 펼치기"}
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-amber-700" />
          ) : (
            <ChevronDown className="h-4 w-4 text-amber-700" />
          )}
        </button>
      </div>
      {isExpanded && (
        <div className="mt-2.5 border-t border-amber-200/50 pt-2.5 text-xs text-amber-800 leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  );
};

export default ExpandableNotice;
