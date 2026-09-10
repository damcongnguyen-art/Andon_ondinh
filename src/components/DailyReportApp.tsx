import React, { useState, useRef, useEffect } from 'react';
import { DailyReportData, ProductMasterItem } from '../types';
import { initialReportData } from '../data/sampleReport';
import { initialProductCatalog } from '../data/productCatalog';
import { ExcelReportView } from './ExcelReportView';
import { ExportControls } from './ExportControls';
import { ProductCatalogModal } from './ProductCatalogModal';
import {
  Activity,
  FileSpreadsheet,
  CheckCircle,
  Eye,
  Sliders,
  RotateCcw,
  Undo2,
  Trash2,
  Sparkles,
  Database,
  Upload,
  ShieldCheck,
  Laptop,
  Eraser,
  ArrowRightLeft
} from 'lucide-react';

interface DailyReportAppProps {
  onNavigateToLive?: () => void;
}

export default function DailyReportApp({ onNavigateToLive }: DailyReportAppProps) {
  // Auto-calculate Plan, Actual and Gap for Bảng 1 based on Bảng 2 Targets and PCS/H sum
  const recalculatePlanAndGapForReport = (data: DailyReportData): DailyReportData => {
    const lineItems = data.lineItems || [];
    const hourlyLogs = data.hourlyLogs || [];

    const updatedLineItems = lineItems.map((item) => {
      const itemCodeClean = String(item.code || '').trim().toLowerCase();
      let plan = 0;
      let actual = 0;
      if (itemCodeClean) {
        const matchingLogs = hourlyLogs.filter(
          (log) => String(log.modelCode || '').trim().toLowerCase() === itemCodeClean
        );
        if (matchingLogs.length > 0) {
          plan = matchingLogs.reduce((sum, log) => sum + (Number(log.target) || 0), 0);
          actual = matchingLogs.reduce((sum, log) => sum + (Number(log.pcsPerHour) || 0), 0);
        } else {
          plan = Number(item.plan) || 0;
          actual = Number(item.actual) || 0;
        }
      } else {
        plan = Number(item.plan) || 0;
        actual = Number(item.actual) || 0;
      }
      const gap = actual - plan;
      return {
        ...item,
        plan,
        actual,
        gap,
      };
    });

    return {
      ...data,
      lineItems: updatedLineItems,
      hourlyLogs,
    };
  };

  // Local storage for independent per-machine state
  const [reportData, setReportData] = useState<DailyReportData>(() => {
    const saved = localStorage.getItem('active_daily_report_v6');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return recalculatePlanAndGapForReport(parsed);
      } catch (e) {
        return recalculatePlanAndGapForReport(initialReportData);
      }
    }
    return recalculatePlanAndGapForReport(initialReportData);
  });

  // Continuous auto-save whenever reportData changes
  useEffect(() => {
    if (reportData) {
      localStorage.setItem('active_daily_report_v6', JSON.stringify(reportData));
    }
  }, [reportData]);

  // Ensure saving state before tab close or browser refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (reportData) {
        localStorage.setItem('active_daily_report_v6', JSON.stringify(reportData));
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [reportData]);

  // Saved backup report data when user clicks clear
  const [lastClearedReport, setLastClearedReport] = useState<DailyReportData | null>(() => {
    const saved = localStorage.getItem('last_cleared_report_v6');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const [showClearModal, setShowClearModal] = useState(false);

  const handleUpdateReport = (updated: DailyReportData) => {
    const finalData = recalculatePlanAndGapForReport(updated);
    setReportData(finalData);
    
    // Save to localStorage immediately on this specific device
    localStorage.setItem('active_daily_report_v6', JSON.stringify(finalData));
  };

  const [productCatalog, setProductCatalog] = useState<ProductMasterItem[]>(() => {
    const saved = localStorage.getItem('master_product_catalog');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return initialProductCatalog;
      }
    }
    return initialProductCatalog;
  });

  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Function 1: Xóa sạch dữ liệu nhưng giữ nguyên số lượng và tên hàng hiện tại
  const handleClearKeepRows = () => {
    setLastClearedReport(reportData);
    localStorage.setItem('last_cleared_report_v6', JSON.stringify(reportData));

    const cleared: DailyReportData = {
      ...reportData,
      reportDate: "",
      timeRange: "",
      teamName: "",
      manpower: "" as any,
      picking: "" as any,
      absent: "" as any,
      borrowed: "" as any,
      transferredSupport: "" as any,
      totalManpower: "" as any,
      lineItems: (reportData.lineItems || []).map((item) => ({
        ...item,
        code: "",
        modelName: "",
        plan: "" as any,
        actual: "" as any,
        speedPerHour: "" as any,
        gap: "" as any,
        extra1: "",
        extra2: "",
        extra3: "",
        extra4: ""
      })),
      hourlyLogs: (reportData.hourlyLogs || []).map((log) => ({
        ...log,
        puWeight: "",
        tc: "",
        manpower: "",
        timeStart: "",
        timeEnd: "",
        sttStart: "",
        sttEnd: "",
        pcsPerHour: "" as any,
        target: "" as any,
        variance: "" as any,
        statusNote: "",
        pig: ""
      }))
    };

    const finalData = recalculatePlanAndGapForReport(cleared);
    setReportData(finalData);
    localStorage.setItem('active_daily_report_v6', JSON.stringify(finalData));
    showToast('Đã xóa sạch dữ liệu và giữ nguyên cấu trúc các hàng!');
  };

  // Function 2: Xóa toàn bộ về mặc định ban đầu
  const handleResetToDefault = () => {
    setLastClearedReport(reportData);
    localStorage.setItem('last_cleared_report_v6', JSON.stringify(reportData));

    const fresh = recalculatePlanAndGapForReport(initialReportData);
    setReportData(fresh);
    localStorage.setItem('active_daily_report_v6', JSON.stringify(fresh));
    showToast('Đã xóa toàn bộ báo cáo về trạng thái mặc định!');
  };

  // Restore data from last clear backup
  const handleRestoreCleared = () => {
    if (!lastClearedReport) return;
    const restored = recalculatePlanAndGapForReport(lastClearedReport);
    setReportData(restored);
    localStorage.setItem('active_daily_report_v6', JSON.stringify(restored));
    setLastClearedReport(null);
    localStorage.removeItem('last_cleared_report_v6');
    showToast('Đã khôi phục dữ liệu thành công!');
  };

  // Reset product catalog to default
  const handleResetCatalog = () => {
    setProductCatalog(initialProductCatalog);
    localStorage.setItem('master_product_catalog', JSON.stringify(initialProductCatalog));
    showToast('Đã khôi phục danh mục mã hàng mẫu!');
  };

  // Update product catalog (from Excel import or manual)
  const handleUpdateCatalog = (newCatalog: ProductMasterItem[]) => {
    setProductCatalog(newCatalog);
    localStorage.setItem('master_product_catalog', JSON.stringify(newCatalog));
  };

  // Sync to local storage on change
  useEffect(() => {
    localStorage.setItem('active_daily_report_v6', JSON.stringify(reportData));
  }, [reportData]);

  // Load a saved report
  const handleLoadReport = (report: DailyReportData) => {
    const finalData = recalculatePlanAndGapForReport(report);
    setReportData(finalData);
    localStorage.setItem('active_daily_report_v6', JSON.stringify(finalData));
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>{toastMessage}</span>
          {lastClearedReport && (
            <button
              onClick={handleRestoreCleared}
              className="ml-2 px-2 py-1 rounded bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 text-[11px] cursor-pointer"
            >
              Khôi Phục
            </button>
          )}
        </div>
      )}

      {/* Product Master Catalog Modal (Nhập Excel / Quản lý mã) */}
      <ProductCatalogModal
        isOpen={isCatalogModalOpen}
        onClose={() => setIsCatalogModalOpen(false)}
        catalog={productCatalog}
        onUpdateCatalog={handleUpdateCatalog}
        onResetCatalog={handleResetCatalog}
      />

      {/* Clear Confirmation Modal with 2 Options */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 font-bold text-lg">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Tùy Chọn Xóa Dữ Liệu</h3>
                  <p className="text-xs text-slate-500">Chọn 1 trong 2 chức năng xóa bên dưới</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold px-2 py-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 pt-1">
              {/* Option 1: Xóa sạch dữ liệu, giữ nguyên hàng */}
              <button
                type="button"
                onClick={() => {
                  setShowClearModal(false);
                  handleClearKeepRows();
                }}
                className="w-full text-left p-4 rounded-xl border-2 border-amber-200 hover:border-amber-400 bg-amber-50/40 hover:bg-amber-50 transition-all flex items-start gap-3.5 group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 font-bold group-hover:scale-105 transition-transform mt-0.5">
                  <Eraser className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 text-sm group-hover:text-amber-900">
                      1. Xóa sạch dữ liệu, giữ nguyên hàng
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-200 text-amber-900">
                      Khuyên dùng
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    Xóa tất cả giá trị nội dung nhập (mã hàng, sản lượng, thời gian...) nhưng <strong>giữ nguyên các dòng/hàng</strong> hiện có trên bảng.
                  </p>
                </div>
              </button>

              {/* Option 2: Xóa toàn bộ về mặc định */}
              <button
                type="button"
                onClick={() => {
                  setShowClearModal(false);
                  handleResetToDefault();
                }}
                className="w-full text-left p-4 rounded-xl border-2 border-rose-200 hover:border-rose-400 bg-rose-50/40 hover:bg-rose-50 transition-all flex items-start gap-3.5 group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 font-bold group-hover:scale-105 transition-transform mt-0.5">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-900 text-sm group-hover:text-rose-700">
                    2. Xóa toàn bộ về mặc định
                  </h4>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    Xóa toàn bộ nội dung và đưa bảng báo cáo trở về trạng thái trống mặc định ban đầu (chỉ gồm 1 dòng).
                  </p>
                </div>
              </button>
            </div>

            <p className="text-[11px] text-amber-900 bg-amber-50/80 p-2.5 rounded-lg border border-amber-200/80 flex items-center gap-1.5 font-medium">
              <span>💡 Sau khi xóa, bạn vẫn có thể bấm <strong>"Khôi Phục Dữ Liệu"</strong> bất cứ lúc nào để hoàn tác.</span>
            </p>

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                Đóng / Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Application Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-sm print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center justify-between w-full sm:w-auto gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-400 text-slate-900 flex items-center justify-center font-black text-lg shadow-md shrink-0">
                <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h1 className="font-bold text-sm sm:text-lg tracking-tight text-white">
                    Báo Cáo Sản Lượng Hằng Ngày
                  </h1>
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                    Chuẩn 100% Excel
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" title="Dữ liệu lưu độc lập trên máy của bạn, không bị người khác ghi đè">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    Độc lập từng máy
                  </span>
                </div>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Tự động điền Model & Speed/H theo mã Code từ File Root
                </p>
              </div>
            </div>

            {/* Compact 1-button page toggle on mobile */}
            <button
              type="button"
              onClick={onNavigateToLive}
              className="sm:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition-all active:scale-95 cursor-pointer shrink-0 shadow-xs"
              title="Chuyển sang trang Ariston Live"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Ariston Live</span>
              <ArrowRightLeft className="w-3 h-3 text-indigo-400 opacity-70" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Compact 1-button page toggle on PC */}
            <button
              type="button"
              onClick={onNavigateToLive}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition-all active:scale-95 cursor-pointer shrink-0 shadow-xs"
              title="Chuyển sang trang Ariston Production Live"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Ariston Live</span>
              <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-400 opacity-70" />
            </button>
            {/* Master Product Catalog Button (File Root Excel Import) */}
            <button
              onClick={() => setIsCatalogModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-xs cursor-pointer border border-emerald-400/40"
              title="Tải lên và quản lý dữ liệu File Root (Excel) để tự động tra cứu mã hàng, model và Speed/H"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Dữ Liệu File Root</span>
              <span className="bg-emerald-800/80 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                {productCatalog.length} mã
              </span>
            </button>

            {/* Restore button if available */}
            {lastClearedReport && (
              <button
                onClick={handleRestoreCleared}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors shadow-xs cursor-pointer border border-amber-300"
                title="Khôi phục dữ liệu vừa bị xóa"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Khôi Phục Dữ Liệu</span>
              </button>
            )}

            {/* Quick Reset / Clear All Button in Header */}
            <button
              onClick={() => setShowClearModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors shadow-xs cursor-pointer"
              title="Xóa dữ liệu và đưa về bảng trống ban đầu"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Xóa Toàn Bộ</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Action & Export Bar */}
        <div className="print:hidden">
          <ExportControls
            reportData={reportData}
            tableRef={tableRef}
            onResetSample={() => setShowClearModal(true)}
            onRestoreCleared={handleRestoreCleared}
            canRestore={!!lastClearedReport}
            onLoadReport={handleLoadReport}
          />
        </div>

        {/* The 100% Visual Excel Table Replica */}
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-2 sm:p-6 overflow-hidden">
          <ExcelReportView
            reportData={reportData}
            onUpdateReport={handleUpdateReport}
            isEditable={true}
            tableRef={tableRef}
            catalog={productCatalog}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500 print:hidden">
        <p>Hệ Thống Báo Cáo Sản Lượng Hàng Ngày © 2026</p>
      </footer>
    </div>
  );
}

