import React, { useState } from 'react';
import { DailyReportData, LineSummaryItem, HourlyLogItem, ProductMasterItem } from '../types';
import { CodeDropdownInput } from './CodeDropdownInput';
import { Layers, Plus, Minus, Trash2 } from 'lucide-react';

interface ExcelReportViewProps {
  reportData: DailyReportData;
  onUpdateReport?: (updated: DailyReportData) => void;
  isEditable?: boolean;
  tableRef?: React.RefObject<HTMLDivElement | null>;
  catalog?: ProductMasterItem[];
}

export const ExcelReportView: React.FC<ExcelReportViewProps> = ({
  reportData,
  onUpdateReport,
  isEditable = true,
  tableRef,
  catalog = [],
}) => {
  const [autoFilledCellId, setAutoFilledCellId] = useState<string | null>(null);
  const [isLineModalOpen, setIsLineModalOpen] = useState(false);
  const [activeLineGroupIndex, setActiveLineGroupIndex] = useState<number>(0);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [activeModelGroupIndex, setActiveModelGroupIndex] = useState<number>(0);
  const [activeModelSuggestIndex, setActiveModelSuggestIndex] = useState<number | null>(null);

  const [activeModalSuggestIndex, setActiveModalSuggestIndex] = useState<number | null>(null);

  // State for delete confirmation modal
  const [deleteConfirmInfo, setDeleteConfirmInfo] = useState<{
    type: 'line' | 'model';
    index: number;
    name: string;
  } | null>(null);

  // Extract distinct line names from the catalog (file root's 2nd Model/Line column)
  const availableLines = Array.from(
    new Set(
      catalog
        .map((item) => item.defaultLine?.trim())
        .filter((line): line is string => Boolean(line && line.length > 0))
    )
  );

  // Extract distinct model codes from Bảng 1 and catalog for quick selection in Bảng 2
  const availableModelCodes = Array.from(
    new Set(
      [
        ...(reportData.lineItems || []).map((li) => li.code?.trim()),
        ...catalog.map((c) => c.code?.trim()),
      ].filter((code): code is string => Boolean(code && code.length > 0))
    )
  );

  // Helper to extract line groups from lineItems
  const getLineGroups = () => {
    const groups: { lineName: string; items: LineSummaryItem[] }[] = [];
    (reportData.lineItems || []).forEach((item) => {
      const currentGroup = groups[groups.length - 1];
      if (currentGroup && currentGroup.lineName === item.line) {
        currentGroup.items.push(item);
      } else {
        groups.push({ lineName: item.line || (availableLines[0] || 'AT 1'), items: [item] });
      }
    });
    return groups;
  };

  // Helper to extract model groups from hourlyLogs (Bảng 2)
  const getModelGroups = () => {
    const groups: { modelName: string; items: HourlyLogItem[] }[] = [];
    (reportData.hourlyLogs || []).forEach((item) => {
      const currentGroup = groups[groups.length - 1];
      if (currentGroup && currentGroup.modelName === item.modelCode) {
        currentGroup.items.push(item);
      } else {
        groups.push({ modelName: item.modelCode || (availableModelCodes[0] || 'MODEL 1'), items: [item] });
      }
    });
    return groups;
  };

  // Helper to set number of rows for a specific Line group
  const handleSetLineRowCount = (lineIndex: number, newRowCount: number) => {
    if (!onUpdateReport || newRowCount < 1) return;
    const groups = getLineGroups();
    if (!groups[lineIndex]) return;

    const group = groups[lineIndex];
    const currentCount = group.items.length;

    if (newRowCount > currentCount) {
      const diff = newRowCount - currentCount;
      for (let i = 0; i < diff; i++) {
        group.items.push({
          id: `line-${Date.now()}-${lineIndex}-${i}`,
          line: group.lineName,
          code: '',
          modelName: '',
          plan: 0,
          actual: 0,
          speedPerHour: 70,
          gap: 0,
        });
      }
    } else if (newRowCount < currentCount) {
      group.items = group.items.slice(0, newRowCount);
    }

    const newItems = groups.flatMap((g) => g.items);
    onUpdateReport({ ...reportData, lineItems: newItems });
  };

  // Helper to get speed for model in Bảng 2
  const getSpeedForModel = (modelCode: string): number => {
    if (!modelCode) return 70;
    const matchedCat = catalog.find((c) => c.code.trim().toLowerCase() === modelCode.trim().toLowerCase());
    if (matchedCat && matchedCat.speedPerHour) return matchedCat.speedPerHour;

    const matchedLine = reportData.lineItems.find((li) => li.code.trim().toLowerCase() === modelCode.trim().toLowerCase());
    if (matchedLine && matchedLine.speedPerHour) return matchedLine.speedPerHour;

    return 70;
  };

  // Helper to parse time string like "7h25", "7h", "7", "7:25", "07:30" into total minutes from midnight
  const parseTimeToMinutes = (timeStr: string | number): number => {
    if (timeStr === undefined || timeStr === null || timeStr === '') return 0;
    const str = String(timeStr).trim().toLowerCase();
    if (!str) return 0;

    // Pattern 1: contains ':' e.g. "7:25", "07:30"
    if (str.includes(':')) {
      const parts = str.split(':');
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      return h * 60 + m;
    }

    // Pattern 2: contains 'h' e.g. "7h25", "7h", "7h 25"
    if (str.includes('h')) {
      const match = str.match(/^(\d+)\s*h\s*(\d+)?/);
      if (match) {
        const h = parseInt(match[1], 10) || 0;
        const m = match[2] ? parseInt(match[2], 10) || 0 : 0;
        return h * 60 + m;
      }
    }

    // Pattern 3: pure number e.g. "7", "7.5", "7.25"
    const num = parseFloat(str);
    if (!isNaN(num)) {
      return Math.round(num * 60);
    }

    return 0;
  };

  // Helper to calculate duration in minutes between timeStart and timeEnd
  const calculateDurationMinutes = (timeStart: string, timeEnd: string): number => {
    if (!timeStart && !timeEnd) return 0;
    const start = parseTimeToMinutes(timeStart);
    const end = parseTimeToMinutes(timeEnd);
    if (start === 0 && end === 0) return 60;
    let diff = end - start;
    if (diff < 0) {
      // Cross-midnight shift handling (e.g. 23:00 to 01:00)
      diff += 24 * 60;
    }
    return diff > 0 ? diff : 60;
  };

  // Helper to calculate target based on speed and time duration: target = (speed * minutes) / 60
  const calculateTargetFromSpeedAndTime = (modelCode: string, timeStart: string, timeEnd: string): number => {
    if (!timeStart && !timeEnd) return '' as any;
    const speed = getSpeedForModel(modelCode);
    const mins = calculateDurationMinutes(timeStart, timeEnd);
    return Math.round((speed * mins) / 60);
  };

  // Helper to confirm and blur input / finish editing on Enter
  const handleEnterKeyConfirm = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  // Helper to set number of rows for a specific Model group in Bảng 2
  const handleSetModelRowCount = (modelIndex: number, newRowCount: number) => {
    if (!onUpdateReport || newRowCount < 1) return;
    const groups = getModelGroups();
    if (!groups[modelIndex]) return;

    const group = groups[modelIndex];
    const currentCount = group.items.length;

    if (newRowCount > currentCount) {
      const diff = newRowCount - currentCount;
      for (let i = 0; i < diff; i++) {
        group.items.push({
          id: `hourly-log-${Date.now()}-${modelIndex}-${i}`,
          puWeight: '',
          tc: '',
          manpower: '',
          modelCode: group.modelName,
          timeStart: '',
          timeEnd: '',
          sttStart: '',
          sttEnd: '',
          pcsPerHour: '' as any,
          target: '' as any,
          variance: '' as any,
          statusNote: '',
          pig: '',
        });
      }
    } else if (newRowCount < currentCount) {
      group.items = group.items.slice(0, newRowCount);
    }

    const newLogs = groups.flatMap((g) => g.items);
    onUpdateReport({ ...reportData, hourlyLogs: newLogs });
  };

  // Helper to update line name for a group
  const handleUpdateLineName = (lineIndex: number, newName: string) => {
    if (!onUpdateReport) return;
    const groups = getLineGroups();
    if (!groups[lineIndex]) return;

    groups[lineIndex].items.forEach((item) => {
      item.line = newName;
    });

    const newItems = groups.flatMap((g) => g.items);
    onUpdateReport({ ...reportData, lineItems: newItems });
  };

  // Helper to update model code name for a group in Bảng 2
  const handleUpdateModelName = (modelIndex: number, newName: string) => {
    if (!onUpdateReport) return;
    const groups = getModelGroups();
    if (!groups[modelIndex]) return;

    groups[modelIndex].items.forEach((item) => {
      item.modelCode = newName;
      item.target = calculateTargetFromSpeedAndTime(newName, item.timeStart, item.timeEnd);
      const pcs = Number(item.pcsPerHour) || 0;
      const target = Number(item.target) || 0;
      if (item.pcsPerHour !== undefined && (item.pcsPerHour as any) !== '') {
        item.variance = pcs - target;
      }
    });

    const newLogs = groups.flatMap((g) => g.items);
    onUpdateReport({ ...reportData, hourlyLogs: newLogs });
  };

  // Helper to change model code of all contiguous rows in a group in Bảng 2
  const handleGroupModelCodeChange = (startIndex: number, count: number, newCode: string) => {
    if (!onUpdateReport) return;
    const updatedLogs = [...reportData.hourlyLogs];
    
    // Update all logs in the contiguous group
    for (let i = startIndex; i < startIndex + count; i++) {
      if (updatedLogs[i]) {
        const target = calculateTargetFromSpeedAndTime(newCode, updatedLogs[i].timeStart, updatedLogs[i].timeEnd);
        const pcs = Number(updatedLogs[i].pcsPerHour) || 0;
        const targetNum = Number(target) || 0;
        const variance = (updatedLogs[i].pcsPerHour !== undefined && (updatedLogs[i].pcsPerHour as any) !== '')
          ? pcs - targetNum
          : '' as any;

        updatedLogs[i] = {
          ...updatedLogs[i],
          modelCode: newCode,
          target,
          variance,
        };
      }
    }
    
    onUpdateReport({ ...reportData, hourlyLogs: updatedLogs });
  };

  // Helper to get suggestions list for a query (deduplicated)
  const getModelSuggestions = (query: string) => {
    const cleanQuery = (query || '').trim().toLowerCase();
    
    // List of unique suggestions { code, modelName }
    const allCandidates: { code: string; modelName?: string }[] = [];
    const seenCodes = new Set<string>();
    
    // Add catalog items
    catalog.forEach(item => {
      if (item.code) {
        const cleanCode = item.code.trim();
        const lower = cleanCode.toLowerCase();
        if (!seenCodes.has(lower)) {
          seenCodes.add(lower);
          allCandidates.push({
            code: cleanCode,
            modelName: item.modelName?.trim()
          });
        }
      }
    });
    
    // Add any codes from report line items that are not in catalog
    (reportData.lineItems || []).forEach(item => {
      if (item.code) {
        const cleanCode = item.code.trim();
        const lower = cleanCode.toLowerCase();
        if (!seenCodes.has(lower)) {
          seenCodes.add(lower);
          allCandidates.push({
            code: cleanCode,
            modelName: item.modelName?.trim()
          });
        }
      }
    });

    if (!cleanQuery) {
      return allCandidates.slice(0, 10);
    }

    // Filter based on query matching code or model name
    const filtered = allCandidates.filter(c => 
      c.code.toLowerCase().includes(cleanQuery) || 
      (c.modelName && c.modelName.toLowerCase().includes(cleanQuery))
    );

    return filtered.slice(0, 10);
  };

  // Helper to add a brand new Line group
  const handleAddLineGroup = () => {
    if (!onUpdateReport) return;
    const groups = getLineGroups();
    const currentUsedLines = groups.map((g) => g.lineName);
    const nextUnusedLine = availableLines.find((l) => !currentUsedLines.includes(l));
    const newLineName = nextUnusedLine || (availableLines[0] ? availableLines[0] : `Line ${groups.length + 1}`);

    const newGroupItems: LineSummaryItem[] = [
      {
        id: `line-group-${Date.now()}-1`,
        line: newLineName,
        code: '',
        modelName: '',
        plan: 0,
        actual: 0,
        speedPerHour: 70,
        gap: 0,
      },
      {
        id: `line-group-${Date.now()}-2`,
        line: newLineName,
        code: '',
        modelName: '',
        plan: 0,
        actual: 0,
        speedPerHour: 70,
        gap: 0,
      },
    ];

    onUpdateReport({
      ...reportData,
      lineItems: [...(reportData.lineItems || []), ...newGroupItems],
    });
  };

  // Helper to add a new Model group in Bảng 2
  const handleAddModelGroup = () => {
    if (!onUpdateReport) return;
    const groups = getModelGroups();
    const existingCodes = groups.map((g) => g.modelName);
    const nextCode = availableModelCodes.find((c) => !existingCodes.includes(c)) || (availableModelCodes[0] || `MODEL ${groups.length + 1}`);

    const newGroupItems: HourlyLogItem[] = [
      {
        id: `model-group-${Date.now()}-1`,
        puWeight: '',
        tc: '',
        manpower: '',
        modelCode: nextCode,
        timeStart: '',
        timeEnd: '',
        sttStart: '',
        sttEnd: '',
        pcsPerHour: '' as any,
        target: '' as any,
        variance: '' as any,
        statusNote: '',
        pig: '',
      },
      {
        id: `model-group-${Date.now()}-2`,
        puWeight: '',
        tc: '',
        manpower: '',
        modelCode: nextCode,
        timeStart: '',
        timeEnd: '',
        sttStart: '',
        sttEnd: '',
        pcsPerHour: '' as any,
        target: '' as any,
        variance: '' as any,
        statusNote: '',
        pig: '',
      },
    ];

    onUpdateReport({
      ...reportData,
      hourlyLogs: [...(reportData.hourlyLogs || []), ...newGroupItems],
    });
  };

  // Helper to remove an entire Line group
  const handleRemoveLineGroup = (lineIndex: number) => {
    if (!onUpdateReport) return;
    const groups = getLineGroups();
    groups.splice(lineIndex, 1);
    const newItems = groups.flatMap((g) => g.items);
    onUpdateReport({ ...reportData, lineItems: newItems });
  };

  // Helper to remove a Model group in Bảng 2
  const handleRemoveModelGroup = (modelIndex: number) => {
    if (!onUpdateReport) return;
    const groups = getModelGroups();
    groups.splice(modelIndex, 1);
    const newLogs = groups.flatMap((g) => g.items);
    onUpdateReport({ ...reportData, hourlyLogs: newLogs });
  };

  // Helper to normalize codes for fuzzy matching (chỉ dùng cho bảng trên)
  const findProductInCatalog = (codeStr: string): ProductMasterItem | undefined => {
    if (!codeStr) return undefined;
    const clean = codeStr.trim().toLowerCase();
    
    // 1. Exact match
    let found = catalog.find((c) => c.code.trim().toLowerCase() === clean);
    if (found) return found;

    // 2. Match without dashes or spaces
    const cleanNoSpecial = clean.replace(/[-_\s]/g, '');
    found = catalog.find((c) => c.code.trim().toLowerCase().replace(/[-_\s]/g, '') === cleanNoSpecial);
    if (found) return found;

    // 3. Prefix match
    found = catalog.find((c) => c.code.trim().toLowerCase().startsWith(clean) || clean.startsWith(c.code.trim().toLowerCase()));
    return found;
  };

  // Helper to handle header field updates
  const handleFieldChange = (field: keyof DailyReportData, value: any) => {
    if (!onUpdateReport) return;
    const updated = { ...reportData, [field]: value };
    
    if (['manpower', 'picking', 'absent', 'borrowed', 'transferredSupport'].includes(field)) {
      const mp = field === 'manpower' ? Number(value) || 0 : Number(reportData.manpower) || 0;
      const pick = field === 'picking' ? Number(value) || 0 : Number(reportData.picking) || 0;
      const trans = field === 'transferredSupport' ? Number(value) || 0 : Number(reportData.transferredSupport) || 0;
      const bor = field === 'borrowed' ? Number(value) || 0 : Number(reportData.borrowed) || 0;
      const abs = field === 'absent' ? Number(value) || 0 : Number(reportData.absent) || 0;
      updated.totalManpower = mp + pick + trans + bor - abs;
    }
    
    onUpdateReport(updated);
  };

  // BẢNG TRÊN: Triggered when a product is chosen via Enter or Click (KÍCH HOẠT LỌC TỰ ĐỘNG)
  const handleSelectProductForLine = (index: number, product: ProductMasterItem) => {
    if (!onUpdateReport) return;
    const updatedItems = [...reportData.lineItems];
    const current = { ...updatedItems[index] };

    current.code = product.code;
    current.modelName = product.modelName;
    current.speedPerHour = product.speedPerHour;

    // Giữ nguyên cột Line (bộ lọc 1 chiều: chọn Line -> gợi ý Mã, chọn Mã -> KHÔNG đổi Line)
    if (product.defaultPlan && (!current.plan || current.plan === 0)) {
      current.plan = product.defaultPlan;
      current.gap = (Number(current.actual) || 0) - product.defaultPlan;
    }

    updatedItems[index] = current;
    onUpdateReport({ ...reportData, lineItems: updatedItems });

    // Flash green confirmation
    setAutoFilledCellId(`line-${index}`);
    setTimeout(() => setAutoFilledCellId(null), 2500);
  };

  // BẢNG TRÊN: Helper to update line items with auto-lookup
  const handleLineItemChange = (index: number, field: keyof LineSummaryItem, value: any) => {
    if (!onUpdateReport) return;
    const updatedItems = [...reportData.lineItems];
    const current = { ...updatedItems[index], [field]: value };
    
    // Auto lookup code in catalog on text change for Upper Table only
    if (field === 'code') {
      const codeStr = String(value || '');
      const matched = findProductInCatalog(codeStr);
      
      if (matched) {
        current.modelName = matched.modelName;
        current.speedPerHour = matched.speedPerHour;
        // Giữ nguyên cột Line (bộ lọc 1 chiều)
        if (matched.defaultPlan && (!current.plan || current.plan === 0)) {
          current.plan = matched.defaultPlan;
          current.gap = (Number(current.actual) || 0) - matched.defaultPlan;
        }

        setAutoFilledCellId(`line-${index}`);
        setTimeout(() => setAutoFilledCellId(null), 2500);
      }
    }

    if (field === 'plan' || field === 'actual') {
      const plan = field === 'plan' ? Number(value) || 0 : Number(current.plan) || 0;
      const actual = field === 'actual' ? Number(value) || 0 : Number(current.actual) || 0;
      current.gap = actual - plan;
    }

    if (field === 'speedPerHour') {
      const newSpeed = Number(value) || 70;
      current.speedPerHour = newSpeed;
      const itemCode = (current.code || '').trim().toLowerCase();
      if (itemCode) {
        const updatedLogs = (reportData.hourlyLogs || []).map((log) => {
          if ((log.modelCode || '').trim().toLowerCase() === itemCode) {
            const mins = calculateDurationMinutes(log.timeStart, log.timeEnd);
            const target = Math.round((newSpeed * mins) / 60);
            const pcs = Number(log.pcsPerHour) || 0;
            const variance = (log.pcsPerHour !== undefined && (log.pcsPerHour as any) !== '')
              ? pcs - target
              : '' as any;
            return { ...log, target, variance };
          }
          return log;
        });
        updatedItems[index] = current;
        onUpdateReport({ ...reportData, lineItems: updatedItems, hourlyLogs: updatedLogs });
        return;
      }
    }
    
    updatedItems[index] = current;
    onUpdateReport({ ...reportData, lineItems: updatedItems });
  };

  // BẢNG DƯỚI: Helper to update hourly log items (HOÀN TOÀN ĐỘC LẬP, KHÔNG ÁP DỤNG BỘ LỌC)
  const handleHourlyLogChange = (index: number, field: keyof HourlyLogItem, value: any) => {
    if (!onUpdateReport) return;
    const updatedLogs = [...reportData.hourlyLogs];
    const current = { ...updatedLogs[index], [field]: value };

    // 1. Auto-calculate target = (speed * minutes) / 60
    if (['modelCode', 'timeStart', 'timeEnd'].includes(field)) {
      const code = current.modelCode;
      const start = current.timeStart;
      const end = current.timeEnd;
      current.target = calculateTargetFromSpeedAndTime(code, start, end);
    }

    // 2. Auto-calculate pcsPerHour = sttEnd - sttStart
    if (['sttStart', 'sttEnd'].includes(field)) {
      const sttS = current.sttStart;
      const sttE = current.sttEnd;
      if (sttS === '' || sttE === '' || sttS === undefined || sttE === undefined) {
        current.pcsPerHour = '' as any;
      } else {
        const pcs = (Number(sttE) || 0) - (Number(sttS) || 0);
        current.pcsPerHour = pcs;
      }
    }

    // 3. Auto-calculate variance
    if (['pcsPerHour', 'target', 'sttStart', 'sttEnd', 'modelCode', 'timeStart', 'timeEnd'].includes(field)) {
      const pcs = Number(current.pcsPerHour);
      const target = Number(current.target);
      if (!isNaN(pcs) && !isNaN(target)) {
        current.variance = pcs - target;
      } else {
        current.variance = '' as any;
      }
    }

    updatedLogs[index] = current;

    // 3. Tự động điền mốc sản lượng sang dòng dưới trong cùng 1 mã hàng:
    // Khi nhập ô bên phải cột STT (sttEnd), mốc này đồng thời được điền vào ô bên trái (sttStart) của dòng kế tiếp
    // (Chỉ áp dụng nếu dòng kế tiếp thuộc cùng một mã hàng modelCode)
    if (field === 'sttEnd') {
      if (index + 1 < updatedLogs.length) {
        const nextLog = { ...updatedLogs[index + 1] };
        const currentModel = (current.modelCode || '').trim().toLowerCase();
        const nextModel = (nextLog.modelCode || '').trim().toLowerCase();

        if (currentModel && nextModel && currentModel === nextModel) {
          nextLog.sttStart = value;

          // Tính lại target, pcsPerHour, variance cho dòng kế tiếp
          const nextTarget = calculateTargetFromSpeedAndTime(nextLog.modelCode, nextLog.timeStart, nextLog.timeEnd);
          nextLog.target = nextTarget;

          const nSttS = nextLog.sttStart;
          const nSttE = nextLog.sttEnd;
          if (nSttS === '' || nSttE === '' || nSttS === undefined || nSttE === undefined) {
            nextLog.pcsPerHour = '' as any;
            nextLog.variance = '' as any;
          } else {
            const nPcs = (Number(nSttE) || 0) - (Number(nSttS) || 0);
            nextLog.pcsPerHour = nPcs;
            nextLog.variance = nPcs - Number(nextTarget || 0);
          }

          updatedLogs[index + 1] = nextLog;
        }
      }
    }

    onUpdateReport({ ...reportData, hourlyLogs: updatedLogs });
  };

  // Calculate upper table totals with overrides
  const totalPlan = reportData.totalUpperPlan !== undefined 
    ? (Number(reportData.totalUpperPlan) || 0)
    : (reportData.lineItems || []).reduce((sum, item) => sum + (Number(item.plan) || 0), 0);
    
  const totalActual = reportData.totalUpperActual !== undefined
    ? (Number(reportData.totalUpperActual) || 0)
    : (reportData.lineItems || []).reduce((sum, item) => sum + (Number(item.actual) || 0), 0);
    
  const totalUpperGap = reportData.totalUpperGap !== undefined
    ? (Number(reportData.totalUpperGap) || 0)
    : totalActual - totalPlan;
    
  // Calculate lower table totals with overrides
  const totalHourlyPcs = reportData.totalHourlyPcs !== undefined
    ? (Number(reportData.totalHourlyPcs) || 0)
    : (reportData.hourlyLogs || []).reduce((sum, item) => sum + (Number(item.pcsPerHour) || 0), 0);
    
  const totalHourlyTarget = reportData.totalHourlyTarget !== undefined
    ? (Number(reportData.totalHourlyTarget) || 0)
    : (reportData.hourlyLogs || []).reduce((sum, item) => sum + (Number(item.target) || 0), 0);
    
  const totalHourlyVariance = reportData.totalHourlyVariance !== undefined
    ? (Number(reportData.totalHourlyVariance) || 0)
    : (reportData.hourlyLogs || []).reduce((sum, item) => sum + (Number(item.variance) || 0), 0);

  return (
    <div className="w-full overflow-x-auto bg-white p-1 sm:p-3 font-sans text-xs sm:text-sm select-text" id="report-container">
      {/* Target element for pixel-perfect image capture */}
      <div
        ref={tableRef}
        id="excel-report-capture"
        className="min-w-[1000px] max-w-[1280px] mx-auto bg-transparent select-text"
        style={{ fontFamily: "'Tahoma', 'Arial', sans-serif" }}
      >
        {/* Unified 14-Column Master Spreadsheet Grid */}
        <div className="w-full bg-white border-2 border-black shadow-sm overflow-visible">
          <table className="w-full border-collapse table-fixed text-center text-xs sm:text-sm">
            <colgroup>
              <col style={{ width: '7.0%' }} />
              <col style={{ width: '8.5%' }} />
              <col style={{ width: '7.0%' }} />
              <col style={{ width: '8.5%' }} />
              <col style={{ width: '6.0%' }} />
              <col style={{ width: '6.0%' }} />
              <col style={{ width: '6.0%' }} />
              <col style={{ width: '6.0%' }} />
              <col style={{ width: '6.0%' }} />
              <col style={{ width: '6.0%' }} />
              <col style={{ width: '6.5%' }} />
              <col style={{ width: '24.0%' }} />
              <col style={{ width: '6.5%' }} />
            </colgroup>
            <tbody>
              {/* 1. Yellow Header Banner */}
              <tr>
                <td
                  colSpan={13}
                  id="report-banner-title"
                  className="text-center py-2 border-b border-black font-bold text-xl sm:text-2xl text-black tracking-wide"
                  style={{ backgroundColor: '#FFFF00' }}
                >
                  Báo Cáo Sản Lượng Hằng Ngày
                </td>
              </tr>

              {/* 2. Top Info Bar Header Row (Light Blue) */}
              <tr className="border-b border-black font-semibold text-black" style={{ backgroundColor: '#89CFF0' }}>
                <td colSpan={3} className="border-r border-black py-1.5 px-2 uppercase">NGÀY</td>
                <td colSpan={2} className="border-r border-black py-1.5 px-2 uppercase">TIME</td>
                <td className="border-r border-black py-1.5 px-1">Nhân Lực</td>
                <td className="border-r border-black py-1.5 px-1">Picking</td>
                <td className="border-r border-black py-1.5 px-1">nghỉ</td>
                <td className="border-r border-black py-1.5 px-1">Mượn</td>
                <td className="border-r border-black py-1.5 px-1 leading-tight text-[11px] sm:text-xs">Chuyển hỗ trợ</td>
                <td className="border-r border-black py-1.5 px-1">Tổng</td>
                <td colSpan={2} className="py-1.5 px-2 text-center font-bold tracking-wider">
                  TEAM
                </td>
              </tr>

              {/* 3. Top Info Bar Values Row */}
              <tr className="border-b-2 border-black bg-white text-black font-semibold">
                <td colSpan={3} className="border-r border-black py-1 px-1">
                  <input
                    type="text"
                    value={reportData.reportDate}
                    onChange={(e) => handleFieldChange('reportDate', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-semibold text-xs sm:text-sm"
                  />
                </td>
                <td colSpan={2} className="border-r border-black py-1 px-1">
                  <input
                    type="text"
                    value={reportData.timeRange}
                    onChange={(e) => handleFieldChange('timeRange', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-semibold text-xs sm:text-sm"
                  />
                </td>
                <td className="border-r border-black py-1 px-1">
                  <input
                    type="number"
                    value={reportData.manpower}
                    onChange={(e) => handleFieldChange('manpower', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-semibold text-xs sm:text-sm"
                  />
                </td>
                <td className="border-r border-black py-1 px-1">
                  <input
                    type="number"
                    value={reportData.picking}
                    onChange={(e) => handleFieldChange('picking', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-semibold text-xs sm:text-sm"
                  />
                </td>
                <td className="border-r border-black py-1 px-1">
                  <input
                    type="number"
                    value={reportData.absent}
                    onChange={(e) => handleFieldChange('absent', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-semibold text-xs sm:text-sm"
                  />
                </td>
                <td className="border-r border-black py-1 px-1">
                  <input
                    type="number"
                    value={reportData.borrowed || ''}
                    onChange={(e) => handleFieldChange('borrowed', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    placeholder=""
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-semibold text-xs sm:text-sm"
                  />
                </td>
                <td className="border-r border-black py-1 px-1">
                  <input
                    type="number"
                    value={reportData.transferredSupport}
                    onChange={(e) => handleFieldChange('transferredSupport', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-semibold text-xs sm:text-sm"
                  />
                </td>
                <td className="border-r border-black py-1 px-1 font-bold text-black bg-white">
                  <input
                    type="number"
                    value={reportData.totalManpower}
                    onChange={(e) => handleFieldChange('totalManpower', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-bold text-xs sm:text-sm text-black"
                  />
                </td>
                <td colSpan={2} className="py-1 px-2 text-center">
                  <input
                    type="text"
                    value={reportData.teamName}
                    onChange={(e) => handleFieldChange('teamName', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="Nhập tên Team..."
                    className="w-full text-center border-none bg-transparent focus:outline-none text-black font-semibold text-xs sm:text-sm"
                  />
                </td>
              </tr>

              {/* 4. Table 1 Header Row (Light Blue) */}
              <tr className="border-b border-black font-semibold text-black" style={{ backgroundColor: '#89CFF0' }}>
                <th
                  onClick={() => setIsLineModalOpen(true)}
                  className="border-r border-black py-2 px-1 cursor-pointer hover:bg-sky-200 transition-colors select-none"
                  title="Bấm vào đây để cài đặt số lượng hàng sản xuất (LINE)"
                >
                  <div className="flex items-center justify-center">
                    <span>LINE</span>
                  </div>
                </th>
                <th colSpan={4} className="border-r border-black py-2 px-1">
                  <div className="flex items-center justify-center">
                    <span>CODE</span>
                  </div>
                </th>
                <th className="border-r border-black py-2 px-1">Plan</th>
                <th className="border-r border-black py-2 px-1">Actual</th>
                <th className="border-r border-black py-2 px-1">Speed/H</th>
                <th className="border-r border-black py-2 px-1">GAP</th>
                <th className="border-r border-black py-2 px-1"></th>
                <th className="border-r border-black py-2 px-1"></th>
                <th colSpan={2} className="py-2 px-1"></th>
              </tr>

              {/* 5. Table 1 Data Rows */}
              {(!reportData.lineItems || reportData.lineItems.length === 0) ? (
                <tr className="border-b border-black bg-slate-50">
                  <td colSpan={13} className="py-6 px-4 text-center">
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-xs text-slate-500 font-medium">Bảng 1 chưa có Line nào được tạo</span>
                      <button
                        type="button"
                        onClick={() => {
                          handleAddLineGroup();
                          setIsLineModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tạo Line Mới
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                reportData.lineItems.map((item, index) => {
                const isFirstOfGroup = index === 0 || reportData.lineItems[index - 1].line !== item.line;
                const groupCount = reportData.lineItems.filter((i) => i.line === item.line).length;
                const isHighlighted = autoFilledCellId === `line-${index}`;

                // Calculate group index for this first item
                const lineGroups = getLineGroups();
                let groupIdx = 0;
                let accum = 0;
                for (let g = 0; g < lineGroups.length; g++) {
                  if (accum === index) {
                    groupIdx = g;
                    break;
                  }
                  accum += lineGroups[g].items.length;
                }

                return (
                  <tr
                    key={item.id || index}
                    className={`border-b border-black text-black transition-colors ${
                      isHighlighted ? 'bg-emerald-50' : 'bg-white'
                    }`}
                  >
                    {/* Line Column (Grouped with RowSpan) */}
                    {isFirstOfGroup ? (
                      <td
                        rowSpan={groupCount}
                        className={`border-r border-black font-bold text-center align-middle bg-white px-1 py-0.5 ${
                          groupCount === 1 ? 'h-[30px]' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveLineGroupIndex(groupIdx);
                            setIsLineModalOpen(true);
                          }}
                          className="w-full h-full min-h-[22px] flex items-center justify-center py-0 px-1 rounded text-[#C0504D] hover:text-blue-700 hover:bg-blue-50/80 transition-all cursor-pointer group border border-transparent hover:border-blue-200"
                          title={`Bấm để mở cài đặt cho Line ${groupIdx + 1} (${item.line})`}
                        >
                          <span className="font-bold text-xs sm:text-sm text-[#C0504D] group-hover:text-blue-700">
                            {item.line || `Line ${groupIdx + 1}`}
                          </span>
                        </button>
                      </td>
                    ) : null}

                    {/* CODE Column */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center text-red-600 font-bold font-mono">
                      <CodeDropdownInput
                        value={item.code}
                        onChange={(newCode) => handleLineItemChange(index, 'code', newCode)}
                        onSelectProduct={(prod) => handleSelectProductForLine(index, prod)}
                        catalog={catalog}
                        placeholder="Gõ mã..."
                      />
                    </td>

                    {/* Model Name Description (Spans 3 cols: D, E, F) */}
                    <td
                      colSpan={3}
                      className={`border-r border-black h-[30px] py-0.5 px-2 text-left uppercase font-semibold transition-all ${
                        isHighlighted
                          ? 'bg-emerald-100 text-emerald-950 font-bold'
                          : 'text-[#C0504D]'
                      }`}
                    >
                      <input
                        type="text"
                        value={item.modelName}
                        onChange={(e) => handleLineItemChange(index, 'modelName', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full text-left uppercase font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-[#C0504D]"
                      />
                    </td>

                    {/* Plan (Matching header background #89CFF0 with Navy Blue #1F497D bold text) */}
                    <td
                      className="border-r border-black h-[30px] py-0.5 px-1 font-bold text-center text-[#1F497D]"
                      style={{ backgroundColor: '#89CFF0' }}
                    >
                      <input
                        type="number"
                        value={item.plan}
                        onChange={(e) => handleLineItemChange(index, 'plan', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-[#1F497D]"
                      />
                    </td>

                    {/* Actual */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 font-bold text-center text-[#C0504D]">
                      <input
                        type="number"
                        value={item.actual}
                        onChange={(e) => handleLineItemChange(index, 'actual', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-[#C0504D]"
                      />
                    </td>

                    {/* Speed/H */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center font-bold text-[#C0504D]">
                      <input
                        type="number"
                        value={item.speedPerHour}
                        onChange={(e) => handleLineItemChange(index, 'speedPerHour', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-[#C0504D]"
                      />
                    </td>

                    {/* GAP (Gold/Yellow background #FFC000 matching spreadsheet) */}
                    <td
                      className="border-r border-black h-[30px] py-0.5 px-1 font-bold text-center text-black"
                      style={{ backgroundColor: '#FFC000' }}
                    >
                      <input
                        type="text"
                        value={item.gap > 0 ? `+${item.gap}` : item.gap}
                        onChange={(e) => handleLineItemChange(index, 'gap', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-black"
                      />
                    </td>

                    {/* Extra Columns to match master layout (Chuyển hỗ trợ, Tổng, TEAM) */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 bg-white">
                      <input
                        type="text"
                        value={item.extra1 || ''}
                        onChange={(e) => handleLineItemChange(index, 'extra1', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs"
                      />
                    </td>
                    <td className="border-r border-black h-[30px] py-0.5 px-1 bg-white">
                      <input
                        type="text"
                        value={item.extra2 || ''}
                        onChange={(e) => handleLineItemChange(index, 'extra2', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs"
                      />
                    </td>
                    <td colSpan={2} className="h-[30px] py-0.5 px-1 bg-white">
                      <input
                        type="text"
                        value={item.extra3 || ''}
                        onChange={(e) => handleLineItemChange(index, 'extra3', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs"
                      />
                    </td>
                  </tr>
                );
              })
              )}

              {/* 6. Table 1 TOTAL Row */}
              <tr className="border-t border-black font-bold text-black bg-white">
                <td colSpan={5} className="border-r border-black py-1.5 text-center uppercase tracking-wider" style={{ backgroundColor: '#E2F0D9' }}>
                  TOTAL
                </td>
                <td
                  className="border-r border-black py-1.5 text-center font-bold text-[#1F497D]"
                  style={{ backgroundColor: '#89CFF0' }}
                >
                  <input
                    type="number"
                    value={reportData.totalUpperPlan !== undefined ? reportData.totalUpperPlan : totalPlan}
                    onChange={(e) => handleFieldChange('totalUpperPlan', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-[#1F497D]"
                  />
                </td>
                <td className="border-r border-black py-1.5 text-center font-bold text-[#C0504D]" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="number"
                    value={reportData.totalUpperActual !== undefined ? reportData.totalUpperActual : totalActual}
                    onChange={(e) => handleFieldChange('totalUpperActual', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-[#C0504D]"
                  />
                </td>
                <td className="border-r border-black py-1.5 text-center" style={{ backgroundColor: '#E2F0D9' }}></td>
                <td
                  className="border-r border-black py-1.5 text-center font-bold text-black"
                  style={{ backgroundColor: '#FFC000' }}
                >
                  <input
                    type="text"
                    value={reportData.totalUpperGap !== undefined ? (Number(reportData.totalUpperGap) > 0 ? `+${reportData.totalUpperGap}` : reportData.totalUpperGap) : (totalUpperGap > 0 ? `+${totalUpperGap}` : totalUpperGap)}
                    onChange={(e) => handleFieldChange('totalUpperGap', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-black"
                  />
                </td>
                <td className="border-r border-black py-1.5 bg-white">
                  <input
                    type="text"
                    value={reportData.extra1 || ''}
                    onChange={(e) => handleFieldChange('extra1', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-bold text-xs"
                  />
                </td>
                <td className="border-r border-black py-1.5 bg-white">
                  <input
                    type="text"
                    value={reportData.extra2 || ''}
                    onChange={(e) => handleFieldChange('extra2', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-bold text-xs"
                  />
                </td>
                <td colSpan={2} className="py-1.5 bg-white">
                  <input
                    type="text"
                    value={reportData.extra3 || ''}
                    onChange={(e) => handleFieldChange('extra3', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 font-bold text-xs"
                  />
                </td>
              </tr>

              {/* 7. Table 2 Header Row (Light Blue) */}
              <tr className="border-b-2 border-t-2 border-black font-semibold text-black" style={{ backgroundColor: '#89CFF0' }}>
                <th className="border-r border-black py-2 px-1 leading-tight align-middle text-[11px] sm:text-xs">
                  Trọng Lượng PU
                </th>
                <th className="border-r border-black py-2 px-1 align-middle">
                  TC
                </th>
                <th className="border-r border-black py-2 px-1 leading-tight align-middle text-[11px] sm:text-xs">
                  Nhân Lực
                </th>
                <th
                  onClick={() => setIsModelModalOpen(true)}
                  className="border-r border-black py-2 px-1 align-middle cursor-pointer hover:bg-sky-200 transition-colors select-none"
                  title="Bấm vào đây để cài đặt số dòng cho các mã hàng Bảng 2"
                >
                  <div className="flex items-center justify-center">
                    <span>MODEL</span>
                  </div>
                </th>
                <th colSpan={2} className="border-r border-black py-2 px-1 align-middle">
                  TIME
                </th>
                <th colSpan={2} className="border-r border-black py-2 px-1 align-middle">
                  STT
                </th>
                <th className="border-r border-black py-2 px-1 align-middle">PCS/H</th>
                <th className="border-r border-black py-2 px-1 align-middle">Mục Tiêu</th>
                <th className="border-r border-black py-2 px-1 align-middle">Âm/Dương</th>
                <th className="border-r border-black py-2 px-2 align-middle">Tình Trạng</th>
                <th className="py-2 px-1 align-middle">PIG</th>
              </tr>

              {/* 8. Table 2 Data Rows */}
              {(!reportData.hourlyLogs || reportData.hourlyLogs.length === 0) ? (
                <tr className="border-b border-black bg-slate-50">
                  <td colSpan={13} className="py-6 px-4 text-center">
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-xs text-slate-500 font-medium">Bảng 2 chưa có Model nào</span>
                      <button
                        type="button"
                        onClick={() => {
                          handleAddModelGroup();
                          setIsModelModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" /> Tạo Model Mới
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                reportData.hourlyLogs.map((log, index) => {
                const isFirstOfModel = index === 0 || reportData.hourlyLogs[index - 1].modelCode !== log.modelCode;
                let contiguousCount = 0;
                for (let i = index; i < reportData.hourlyLogs.length; i++) {
                  if (reportData.hourlyLogs[i].modelCode === log.modelCode) {
                    contiguousCount++;
                  } else {
                    break;
                  }
                }

                // Calculate model group index for this first item
                const modelGroups = getModelGroups();
                let modelGroupIdx = 0;
                let modelAccum = 0;
                for (let m = 0; m < modelGroups.length; m++) {
                  if (modelAccum === index) {
                    modelGroupIdx = m;
                    break;
                  }
                  modelAccum += modelGroups[m].items.length;
                }

                return (
                  <tr key={log.id || index} className="border-b border-black text-black bg-white">
                    {/* Trọng Lượng PU (Light Blue bg) */}
                    <td
                      className="border-r border-black h-[30px] py-0.5 px-1 font-medium"
                      style={{ backgroundColor: '#89CFF0' }}
                    >
                      <input
                        type="text"
                        value={log.puWeight}
                        onChange={(e) => handleHourlyLogChange(index, 'puWeight', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none text-xs sm:text-sm"
                      />
                    </td>

                    {/* TC (Single column, narrowed) */}
                    <td
                      className="border-r border-black h-[30px] py-0.5 px-1 font-medium"
                      style={{ backgroundColor: '#89CFF0' }}
                    >
                      <input
                        type="text"
                        value={log.tc}
                        onChange={(e) => handleHourlyLogChange(index, 'tc', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none text-xs sm:text-sm font-semibold"
                      />
                    </td>

                    {/* Nhân Lực (Light Blue bg) */}
                    <td
                      className="border-r border-black h-[30px] py-0.5 px-1 font-bold text-black"
                      style={{ backgroundColor: '#89CFF0' }}
                    >
                      <input
                        type="number"
                        value={log.manpower}
                        onChange={(e) => handleHourlyLogChange(index, 'manpower', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none text-xs sm:text-sm font-bold text-black"
                      />
                    </td>

                    {/* MODEL (Hiển thị tên mã hàng) */}
                    {isFirstOfModel ? (
                      <td
                        rowSpan={contiguousCount}
                        className={`border-r border-black py-0.5 px-1 text-center text-red-600 font-bold bg-white align-middle ${
                          contiguousCount === 1 ? 'h-[30px]' : ''
                        }`}
                      >
                        <div className="relative flex flex-col items-center justify-center gap-1 group py-0">
                          <input
                            type="text"
                            value={log.modelCode}
                            onChange={(e) => handleGroupModelCodeChange(index, contiguousCount, e.target.value)}
                            onFocus={() => setActiveModelSuggestIndex(index)}
                            onBlur={() => setTimeout(() => setActiveModelSuggestIndex(null), 250)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const suggestions = getModelSuggestions(log.modelCode);
                                if (suggestions.length > 0) {
                                  e.preventDefault();
                                  const chosen = suggestions[0].code;
                                  handleGroupModelCodeChange(index, contiguousCount, chosen);
                                }
                                setActiveModelSuggestIndex(null);
                                e.currentTarget.blur();
                              }
                            }}
                            className="w-full text-center text-red-600 font-bold font-mono border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm"
                            placeholder="MODEL..."
                            spellCheck={false}
                            autoComplete="off"
                          />
                          
                          {/* Autocomplete Suggestions Panel */}
                          {activeModelSuggestIndex === index && (
                            <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto text-left min-w-[240px] max-w-sm">
                              {getModelSuggestions(log.modelCode).length > 0 ? (
                                getModelSuggestions(log.modelCode).map((suggest, sIdx) => (
                                  <button
                                    key={suggest.code + '-' + sIdx}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleGroupModelCodeChange(index, contiguousCount, suggest.code);
                                      setActiveModelSuggestIndex(null);
                                    }}
                                    className="w-full px-3.5 py-2.5 text-left transition-colors flex items-center justify-between gap-2 hover:bg-slate-50 border-b border-slate-50 last:border-0 cursor-pointer"
                                  >
                                    <span className="font-mono text-red-600 font-bold text-xs shrink-0">{suggest.code}</span>
                                    {suggest.modelName && suggest.modelName !== suggest.code && (
                                      <span className="text-[10px] text-slate-400 font-medium truncate max-w-[130px] text-right">
                                        {suggest.modelName}
                                      </span>
                                    )}
                                  </button>
                                ))
                              ) : (
                                <div className="px-4 py-3 text-xs text-slate-400 italic text-center">
                                  Không tìm thấy gợi ý
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    ) : null}

                    {/* TIME Start */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center font-medium bg-white">
                      <input
                        type="text"
                        value={log.timeStart}
                        onChange={(e) => handleHourlyLogChange(index, 'timeStart', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm"
                      />
                    </td>

                    {/* TIME End */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center font-medium bg-white">
                      <input
                        type="text"
                        value={log.timeEnd}
                        onChange={(e) => handleHourlyLogChange(index, 'timeEnd', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm"
                      />
                    </td>

                    {/* STT Start */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center font-medium bg-white">
                      <input
                        type="number"
                        value={log.sttStart}
                        onChange={(e) => handleHourlyLogChange(index, 'sttStart', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm"
                      />
                    </td>

                    {/* STT End */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center font-medium bg-white">
                      <input
                        type="number"
                        value={log.sttEnd}
                        onChange={(e) => handleHourlyLogChange(index, 'sttEnd', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm"
                      />
                    </td>

                    {/* PCS/H */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center font-bold bg-white text-slate-900">
                      <input
                        type="number"
                        value={log.pcsPerHour === '' || log.pcsPerHour === undefined ? '' : log.pcsPerHour}
                        onChange={(e) => handleHourlyLogChange(index, 'pcsPerHour', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-slate-900"
                      />
                    </td>

                    {/* Mục Tiêu */}
                    <td className="border-r border-black h-[30px] py-0.5 px-1 text-center font-bold bg-white text-slate-800">
                      <input
                        type="number"
                        value={log.target === '' || log.target === undefined ? '' : log.target}
                        onChange={(e) => handleHourlyLogChange(index, 'target', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-slate-800"
                      />
                    </td>

                    {/* Âm/Dương: Gold Background #FFC000 (Aligned with Tổng) */}
                    <td
                      className="border-r border-black h-[30px] py-0.5 px-1 text-center font-bold text-black"
                      style={{ backgroundColor: '#FFC000' }}
                    >
                      <input
                        type="text"
                        value={log.variance === '' || log.variance === undefined ? '' : (Number(log.variance) > 0 ? `+${log.variance}` : log.variance)}
                        onChange={(e) => handleHourlyLogChange(index, 'variance', e.target.value)}
                        onKeyDown={handleEnterKeyConfirm}
                        className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-black"
                      />
                    </td>

                    {/* Tình Trạng (Red bold status remarks - flexible font size for 1-line vs multi-line) */}
                    <td className="border-r border-black h-[30px] p-0 bg-white align-middle relative">
                      {(() => {
                        const noteStr = log.statusNote || '';
                        const isMultiLine = noteStr.includes('\n') || noteStr.length > 24;
                        return (
                          <textarea
                            value={log.statusNote}
                            onChange={(e) => handleHourlyLogChange(index, 'statusNote', e.target.value)}
                            onKeyDown={handleEnterKeyConfirm}
                            spellCheck={false}
                            className="w-full text-center text-red-600 font-bold border-none bg-transparent focus:bg-yellow-50 focus:outline-none resize-none m-0 px-1 overflow-hidden block"
                            style={
                              isMultiLine
                                ? { fontSize: '11px', lineHeight: '13.5px', height: '28px', paddingTop: '1px' }
                                : { fontSize: '13px', lineHeight: '28px', height: '28px', paddingTop: '0px' }
                            }
                            placeholder=""
                            title={log.statusNote}
                          />
                        );
                      })()}
                    </td>

                    {/* PIG (Ngay bên phải Tình Trạng - flexible font size for 1-line vs multi-line) */}
                    <td className="h-[30px] p-0 bg-white align-middle relative">
                      {(() => {
                        const pigStr = log.pig || '';
                        const isMultiLine = pigStr.includes('\n') || pigStr.length > 5;
                        return (
                          <textarea
                            value={log.pig || ''}
                            onChange={(e) => handleHourlyLogChange(index, 'pig', e.target.value)}
                            onKeyDown={handleEnterKeyConfirm}
                            spellCheck={false}
                            className="w-full text-center uppercase font-bold border-none bg-transparent focus:bg-yellow-50 focus:outline-none resize-none m-0 px-0.5 overflow-hidden block text-slate-800"
                            style={
                              isMultiLine
                                ? { fontSize: '10.5px', lineHeight: '13.5px', height: '28px', paddingTop: '1px' }
                                : { fontSize: '13px', lineHeight: '28px', height: '28px', paddingTop: '0px' }
                            }
                            placeholder=""
                            title={log.pig}
                          />
                        );
                      })()}
                    </td>
                  </tr>
                );
              })
              )}

              {/* 9. Table 2 TOTAL Row */}
              <tr className="border-t-2 border-black font-bold text-black bg-white">
                {/* Trọng Lượng PU */}
                <td className="border-r border-black py-1.5 text-center" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="text"
                    value={reportData.totalHourlyPU || ''}
                    onChange={(e) => handleFieldChange('totalHourlyPU', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-[10px] text-black"
                  />
                </td>
                {/* TC */}
                <td className="border-r border-black py-1.5 text-center" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="text"
                    value={reportData.totalHourlyTC || ''}
                    onChange={(e) => handleFieldChange('totalHourlyTC', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-[10px] text-black"
                  />
                </td>
                {/* Nhân Lực */}
                <td className="border-r border-black py-1.5 text-center" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="text"
                    value={reportData.totalHourlyManpower || ''}
                    onChange={(e) => handleFieldChange('totalHourlyManpower', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-[10px] text-black"
                  />
                </td>
                {/* MODEL */}
                <td className="border-r border-black py-1.5 text-center uppercase tracking-wider" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="text"
                    value={reportData.totalHourlyLabel !== undefined ? reportData.totalHourlyLabel : 'TOTAL'}
                    onChange={(e) => handleFieldChange('totalHourlyLabel', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-black"
                  />
                </td>
                {/* TIME (colspan 2) */}
                <td colSpan={2} className="border-r border-black py-1.5 text-center" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="text"
                    value={reportData.totalHourlyTime || ''}
                    onChange={(e) => handleFieldChange('totalHourlyTime', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-[10px] text-black"
                  />
                </td>
                {/* STT (colspan 2) */}
                <td colSpan={2} className="border-r border-black py-1.5 text-center" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="text"
                    value={reportData.totalHourlySTT || ''}
                    onChange={(e) => handleFieldChange('totalHourlySTT', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-[10px] text-black"
                  />
                </td>
                {/* PCS/H */}
                <td className="border-r border-black py-1.5 text-center font-bold" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="number"
                    value={reportData.totalHourlyPcs !== undefined ? reportData.totalHourlyPcs : totalHourlyPcs}
                    onChange={(e) => handleFieldChange('totalHourlyPcs', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-black"
                  />
                </td>
                <td className="border-r border-black py-1.5 text-center font-bold" style={{ backgroundColor: '#E2F0D9' }}>
                  <input
                    type="number"
                    value={reportData.totalHourlyTarget !== undefined ? reportData.totalHourlyTarget : totalHourlyTarget}
                    onChange={(e) => handleFieldChange('totalHourlyTarget', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-black"
                  />
                </td>
                <td
                  className="border-r border-black py-1.5 text-center font-bold text-black"
                  style={{ backgroundColor: '#FFC000' }}
                >
                  <input
                    type="text"
                    value={reportData.totalHourlyVariance !== undefined ? (Number(reportData.totalHourlyVariance) > 0 ? `+${reportData.totalHourlyVariance}` : reportData.totalHourlyVariance) : (totalHourlyVariance > 0 ? `+${totalHourlyVariance}` : totalHourlyVariance)}
                    onChange={(e) => handleFieldChange('totalHourlyVariance', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-black"
                  />
                </td>
                <td className="border-r border-black py-1.5 bg-white">
                  <input
                    type="text"
                    value={reportData.totalHourlyStatus || ''}
                    onChange={(e) => handleFieldChange('totalHourlyStatus', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-red-600"
                  />
                </td>
                <td className="py-1.5 bg-white">
                  <input
                    type="text"
                    value={reportData.totalHourlyPig || ''}
                    onChange={(e) => handleFieldChange('totalHourlyPig', e.target.value)}
                    onKeyDown={handleEnterKeyConfirm}
                    className="w-full text-center font-bold border-none bg-transparent focus:outline-none focus:bg-yellow-50 text-xs sm:text-sm text-slate-800"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Cài Đặt Riêng Cho Line Đã Chọn */}
      {isLineModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Cài Đặt Line & Số Dòng (LINE)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Chỉnh sửa tên Line, chọn từ File Root và thiết lập số mã hàng
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLineModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 text-base cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: List of lines with split row count controller */}
            <div className="py-4 flex-1 overflow-y-auto space-y-3 text-xs">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                  DANH SÁCH LINE ({getLineGroups().length})
                </span>
                <span className="text-[11px] text-slate-400 italic">
                  Bấm bên trái để chọn Line • Bấm bên phải để chỉnh số dòng
                </span>
              </div>

              {/* Vertical scrollable stack of line items */}
              <div className="flex flex-col gap-2 overflow-y-auto max-h-[340px] pr-1">
                {getLineGroups().length === 0 ? (
                  <div className="py-8 px-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-xs text-slate-500 font-medium">Chưa có Line sản xuất nào</p>
                    <p className="text-[11px] text-slate-400 mt-1">Bấm nút "Thêm Line Mới" bên dưới để tạo Line đầu tiên</p>
                  </div>
                ) : (
                  getLineGroups().map((group, groupIdx) => {
                  const isActive = activeLineGroupIndex === groupIdx;
                  return (
                    <div
                      key={`line-split-item-${groupIdx}`}
                      className={`w-full rounded-xl transition-all flex items-center justify-between border overflow-hidden ${
                        isActive
                          ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-400/30'
                          : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {/* Left side: Select box to choose line */}
                      <div
                        onClick={() => setActiveLineGroupIndex(groupIdx)}
                        className="flex-1 py-2 px-3 cursor-pointer flex items-center gap-2 truncate"
                        title="Bấm để chọn Line này"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-white animate-pulse' : 'bg-slate-400'}`} />
                        <span className="font-bold text-xs shrink-0">
                          Line {groupIdx + 1}:
                        </span>
                        
                        {availableLines.length > 0 ? (
                          <select
                            value={group.lineName}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleUpdateLineName(groupIdx, e.target.value);
                            }}
                            className={`px-2 py-1 font-bold rounded-lg text-xs cursor-pointer focus:outline-none border shadow-2xs ${
                              isActive
                                ? 'bg-blue-700 text-white border-blue-400'
                                : 'bg-white text-slate-800 border-slate-300'
                            }`}
                          >
                            {availableLines.map((lineOpt) => (
                              <option key={lineOpt} value={lineOpt} className="text-slate-900 bg-white">
                                {lineOpt}
                              </option>
                            ))}
                            {!availableLines.includes(group.lineName) && (
                              <option value={group.lineName} className="text-slate-900 bg-white">
                                {group.lineName}
                              </option>
                            )}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={group.lineName}
                            onClick={(e) => e.stopPropagation()}
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(e) => {
                              e.stopPropagation();
                              handleUpdateLineName(groupIdx, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              handleEnterKeyConfirm(e);
                            }}
                            className={`px-2 py-1 font-bold rounded-lg text-xs focus:outline-none border w-24 ${
                              isActive
                                ? 'bg-blue-700 text-white border-blue-400 placeholder-blue-200'
                                : 'bg-white text-slate-800 border-slate-300'
                            }`}
                            placeholder="Tên Line..."
                          />
                        )}

                        {isActive && (
                          <span className="ml-auto px-1.5 py-0.5 bg-blue-800 text-blue-100 rounded text-[10px] font-semibold shrink-0">
                            Đang chọn
                          </span>
                        )}
                      </div>

                      {/* Right side: Row count controller & delete */}
                      <div className={`flex items-center gap-1.5 px-3 py-2 border-l shrink-0 ${
                        isActive ? 'border-blue-500/60 bg-blue-700/40 text-white' : 'border-slate-200 bg-white/60 text-slate-700'
                      }`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetLineRowCount(groupIdx, group.items.length - 1);
                          }}
                          disabled={group.items.length <= 1}
                          className={`w-7 h-7 rounded-lg font-bold flex items-center justify-center cursor-pointer disabled:opacity-30 active:scale-95 transition-all ${
                            isActive ? 'bg-blue-800 text-white hover:bg-blue-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                          }`}
                          title="Giảm 1 dòng"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>

                        <span className={`font-mono font-bold px-2.5 py-1 rounded-lg text-xs min-w-[56px] text-center ${
                          isActive ? 'bg-blue-900 text-white' : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          {group.items.length} dòng
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetLineRowCount(groupIdx, group.items.length + 1);
                          }}
                          className={`w-7 h-7 rounded-lg font-bold flex items-center justify-center cursor-pointer active:scale-95 transition-all ${
                            isActive ? 'bg-blue-800 text-white hover:bg-blue-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                          }`}
                          title="Tăng 1 dòng"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmInfo({
                              type: 'line',
                              index: groupIdx,
                              name: `Line ${groupIdx + 1} (${group.lineName || 'Trống'})`,
                            });
                          }}
                          className={`p-1.5 rounded-lg cursor-pointer transition-colors ml-1 ${
                            isActive ? 'text-blue-200 hover:text-white hover:bg-red-600/60' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                          title="Xóa Line này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
                )}
              </div>

              {/* Add Line button */}
              <button
                type="button"
                onClick={() => {
                  handleAddLineGroup();
                  setActiveLineGroupIndex(getLineGroups().length);
                }}
                className="w-full mt-2 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-2xs"
              >
                <Plus className="w-4 h-4" /> Thêm Line Mới
              </button>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => setIsLineModalOpen(false)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-2xs cursor-pointer active:scale-95"
              >
                Hoàn Tất & Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cài Đặt Model & Số Dòng Cho Bảng 2 */}
      {isModelModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-100 text-red-700 flex items-center justify-center font-bold">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Cài Đặt Mã Hàng (MODEL) - BẢNG 2
                  </h3>
                  <p className="text-xs text-slate-500">
                    Chỉnh sửa mã hàng và thiết lập số dòng (khung giờ) cho từng Model ở Bảng 2
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModelModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold p-1 text-base cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: List of model groups with split row count controller */}
            <div className="py-4 flex-1 overflow-y-visible space-y-3 text-xs">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                  DANH SÁCH MÃ HÀNG ({getModelGroups().length})
                </span>
                <span className="text-[11px] text-slate-400 italic">
                  Bấm bên trái để chọn Mã • Bấm bên phải để chỉnh số dòng
                </span>
              </div>

              {/* Vertical stack of model items */}
              <div className="flex flex-col gap-2 max-h-[380px] overflow-y-visible pr-1">
                {getModelGroups().length === 0 ? (
                  <div className="py-8 px-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <p className="text-xs text-slate-500 font-medium">Chưa có Mã hàng (Model) nào</p>
                    <p className="text-[11px] text-slate-400 mt-1">Bấm nút "Thêm Mã Hàng Mới" bên dưới để tạo Model đầu tiên</p>
                  </div>
                ) : (
                  getModelGroups().map((group, groupIdx) => {
                  const isActive = activeModelGroupIndex === groupIdx;
                  const isSuggestOpen = activeModalSuggestIndex === groupIdx;
                  return (
                    <div
                      key={`model-split-item-${groupIdx}`}
                      className={`w-full rounded-xl transition-all flex items-center justify-between border relative ${
                        isSuggestOpen ? 'z-50' : isActive ? 'z-20' : 'z-10'
                      } ${
                        isActive
                          ? 'bg-red-600 text-white border-red-600 shadow-md ring-2 ring-red-400/30'
                          : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {/* Left side: Search input with autocomplete suggestions */}
                      <div
                        onClick={() => setActiveModelGroupIndex(groupIdx)}
                        className="flex-1 py-2 px-3 cursor-pointer flex items-center gap-2 relative"
                        title="Bấm để chọn Mã hàng này"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-white animate-pulse' : 'bg-slate-400'}`} />
                        <span className="font-bold text-xs shrink-0">
                          Mã {groupIdx + 1}:
                        </span>
                        
                        <div className="relative flex-1 max-w-[170px]" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={group.modelName}
                            onChange={(e) => {
                              handleUpdateModelName(groupIdx, e.target.value);
                            }}
                            onFocus={() => {
                              setActiveModelGroupIndex(groupIdx);
                              setActiveModalSuggestIndex(groupIdx);
                            }}
                            onBlur={() => {
                              setTimeout(() => setActiveModalSuggestIndex(null), 250);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const suggestions = getModelSuggestions(group.modelName);
                                if (suggestions.length > 0) {
                                  e.preventDefault();
                                  const chosen = suggestions[0].code;
                                  handleUpdateModelName(groupIdx, chosen);
                                }
                                setActiveModalSuggestIndex(null);
                                e.currentTarget.blur();
                              }
                            }}
                            className={`w-full px-2.5 py-1 font-bold font-mono rounded-lg text-xs focus:outline-none border shadow-2xs ${
                              isActive
                                ? 'bg-red-700 text-white border-red-400 placeholder-red-200 focus:bg-red-800'
                                : 'bg-white text-red-700 border-slate-300 focus:border-red-400'
                            }`}
                            placeholder="Nhập mã hàng..."
                            spellCheck={false}
                            autoComplete="off"
                          />

                          {/* Autocomplete Suggestions Panel in Modal */}
                          {activeModalSuggestIndex === groupIdx && (
                            <div className="absolute left-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-52 overflow-y-auto text-left min-w-[210px] w-full animate-in fade-in zoom-in-95 duration-100">
                              {getModelSuggestions(group.modelName).length > 0 ? (
                                getModelSuggestions(group.modelName).map((suggest, sIdx) => (
                                  <button
                                    key={suggest.code + '-modal-' + sIdx}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleUpdateModelName(groupIdx, suggest.code);
                                      setActiveModalSuggestIndex(null);
                                    }}
                                    className="w-full px-3 py-2 text-left transition-colors flex items-center justify-between gap-2 hover:bg-slate-50 border-b border-slate-50 last:border-0 cursor-pointer"
                                  >
                                    <span className="font-mono text-red-600 font-bold text-xs shrink-0">{suggest.code}</span>
                                    {suggest.modelName && suggest.modelName !== suggest.code && (
                                      <span className="text-[10px] text-slate-400 font-medium truncate max-w-[100px] text-right">
                                        {suggest.modelName}
                                      </span>
                                    )}
                                  </button>
                                ))
                              ) : (
                                <div className="px-3 py-2 text-slate-400 text-[11px] italic">
                                  Không tìm thấy mã phù hợp
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {isActive && (
                          <span className="ml-auto px-1.5 py-0.5 bg-red-800 text-red-100 rounded text-[10px] font-semibold shrink-0">
                            Đang chọn
                          </span>
                        )}
                      </div>

                      {/* Right side: Row count controller & delete */}
                      <div className={`flex items-center gap-1.5 px-3 py-2 border-l shrink-0 ${
                        isActive ? 'border-red-500/60 bg-red-700/40 text-white' : 'border-slate-200 bg-white/60 text-slate-700'
                      }`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetModelRowCount(groupIdx, group.items.length - 1);
                          }}
                          disabled={group.items.length <= 1}
                          className={`w-7 h-7 rounded-lg font-bold flex items-center justify-center cursor-pointer disabled:opacity-30 active:scale-95 transition-all ${
                            isActive ? 'bg-red-800 text-white hover:bg-red-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                          }`}
                          title="Giảm 1 dòng"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>

                        <span className={`font-mono font-bold px-2.5 py-1 rounded-lg text-xs min-w-[56px] text-center ${
                          isActive ? 'bg-red-900 text-white' : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {group.items.length} dòng
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetModelRowCount(groupIdx, group.items.length + 1);
                          }}
                          className={`w-7 h-7 rounded-lg font-bold flex items-center justify-center cursor-pointer active:scale-95 transition-all ${
                            isActive ? 'bg-red-800 text-white hover:bg-red-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                          }`}
                          title="Tăng 1 dòng"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmInfo({
                              type: 'model',
                              index: groupIdx,
                              name: `Mã ${groupIdx + 1} (${group.modelName || 'Trống'})`,
                            });
                          }}
                          className={`p-1.5 rounded-lg cursor-pointer transition-colors ml-1 ${
                            isActive ? 'text-red-200 hover:text-white hover:bg-red-600/60' : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                          title="Xóa Mã hàng này"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
                )}
              </div>

              {/* Add Model button */}
              <button
                type="button"
                onClick={() => {
                  handleAddModelGroup();
                  setActiveModelGroupIndex(getModelGroups().length);
                }}
                className="w-full mt-2 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-2xs"
              >
                <Plus className="w-4 h-4" /> Thêm Mã Hàng Mới
              </button>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => setIsModelModalOpen(false)}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-2xs cursor-pointer active:scale-95"
              >
                Hoàn Tất & Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmInfo && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0 font-bold text-lg">
                ⚠️
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Xác nhận xóa</h4>
                <p className="text-xs text-slate-500">Hành động này không thể hoàn tác.</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200">
              Bạn có chắc chắn muốn xóa <span className="font-bold text-red-600">{deleteConfirmInfo.name}</span> không?
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteConfirmInfo(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer transition-all"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deleteConfirmInfo.type === 'line') {
                    handleRemoveLineGroup(deleteConfirmInfo.index);
                    setActiveLineGroupIndex(Math.max(0, deleteConfirmInfo.index - 1));
                  } else {
                    handleRemoveModelGroup(deleteConfirmInfo.index);
                    setActiveModelGroupIndex(Math.max(0, deleteConfirmInfo.index - 1));
                  }
                  setDeleteConfirmInfo(null);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-all shadow-2xs"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
