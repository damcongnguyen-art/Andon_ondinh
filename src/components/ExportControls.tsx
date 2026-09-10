import React, { useState, useEffect } from 'react';
import { toPng, toBlob } from 'html-to-image';
import {
  Download,
  Copy,
  Printer,
  Save,
  RotateCcw,
  Undo2,
  Trash2,
  Check,
  FolderOpen,
  Calendar,
  Sparkles,
  Table,
  Clock,
  Search,
  History,
  FileSpreadsheet,
  Laptop
} from 'lucide-react';
import { DailyReportData } from '../types';
import { exportToExcel } from '../utils/excelExport';

interface ExportControlsProps {
  reportData: DailyReportData;
  tableRef: React.RefObject<HTMLDivElement | null>;
  onResetSample?: () => void;
  onRestoreCleared?: () => void;
  canRestore?: boolean;
  onLoadReport: (report: DailyReportData) => void;
}

const formatDateTime = (isoString?: string) => {
  if (!isoString) return 'Không rõ thời gian';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    return `${hours}:${minutes}:${seconds} - ${day}/${month}/${year}`;
  } catch (e) {
    return isoString;
  }
};

export const ExportControls: React.FC<ExportControlsProps> = ({
  reportData,
  tableRef,
  onResetSample,
  onRestoreCleared,
  canRestore,
  onLoadReport,
}) => {
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [savedReports, setSavedReports] = useState<DailyReportData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // PWA Installation State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    // Check if app is running in standalone mode (already installed as PC/mobile PWA)
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    setIsStandalone(isStandaloneMode);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      showToast('Đã cài đặt ứng dụng PWA lên Windows PC thành công!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsStandalone(true);
        showToast('Đã cài đặt ứng dụng PWA lên Windows PC!');
      }
      setDeferredPrompt(null);
    } else {
      alert('Hướng dẫn cài đặt App Báo Cáo Sản Xuất lên Windows PC:\n\n1. Nhấp vào biểu tượng [Cài đặt ứng dụng] / [Install App] ở góc phải thanh địa chỉ trình duyệt (Chrome/Edge).\n2. Bấm [Cài đặt] để đưa ứng dụng ra màn hình Desktop Windows.');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Shared export options with onClone to ensure all input/textarea values are fully rendered
  const exportOptions = {
    quality: 1,
    pixelRatio: 2.5,
    cacheBust: true,
    backgroundColor: '#ffffff',
    onClone: (clonedNode: HTMLElement) => {
      const inputs = clonedNode.querySelectorAll('input, textarea, select');
      inputs.forEach((input) => {
        const el = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const span = document.createElement('span');
        let textVal = '';
        if (el instanceof HTMLSelectElement) {
          textVal = el.options[el.selectedIndex]?.text || el.value || '';
        } else {
          textVal = el.value || el.placeholder || '';
        }
        span.textContent = textVal;
        span.className = el.className;
        span.style.cssText = el.style.cssText;
        span.style.display = 'inline-block';
        span.style.width = '100%';
        span.style.overflow = 'visible';
        span.style.whiteSpace = 'pre-wrap';
        span.style.wordBreak = 'break-word';
        span.style.border = 'none';
        span.style.background = 'transparent';

        if (el.parentNode) {
          el.parentNode.replaceChild(span, el);
        }
      });
    },
  };

  // High-Resolution PNG Export
  const handleExportPng = async () => {
    if (!tableRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(tableRef.current, exportOptions);
      const link = document.createElement('a');
      const safeDate = reportData.reportDate.replace(/[./\\]/g, '-');
      const safeTeam = reportData.teamName.replace(/\s+/g, '_');
      link.download = `Bao_Cao_San_Luong_${safeDate}_${safeTeam}.png`;
      link.href = dataUrl;
      link.click();
      showToast('Đã xuất file hình ảnh HD thành công!');
    } catch (err) {
      console.error('Export PNG failed:', err);
      showToast('Lỗi khi xuất ảnh. Vui lòng thử lại.');
    } finally {
      setExporting(false);
    }
  };

  // Quick Copy Image to Clipboard
  const handleCopyToClipboard = async () => {
    if (!tableRef.current) return;
    try {
      const blob = await toBlob(tableRef.current, exportOptions);
      if (!blob) throw new Error('Không thể tạo blob ảnh');

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        setCopied(true);
        showToast('Đã sao chép ảnh báo cáo vào bộ nhớ tạm! Dán ngay vào Zalo/Telegram (Ctrl + V)');
        setTimeout(() => setCopied(false), 2500);
      } else {
        handleExportPng();
      }
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      handleExportPng();
    }
  };

  // Print / PDF Export
  const handlePrint = () => {
    window.print();
  };

  // Export to Excel
  const handleExportExcelClick = async () => {
    try {
      showToast('Đang tạo file Excel. Vui lòng đợi...');
      await exportToExcel(reportData);
      showToast('Xuất file Excel thành công!');
    } catch (err) {
      console.error('Export Excel failed:', err);
      showToast('Lỗi khi xuất file Excel. Vui lòng thử lại.');
    }
  };

  // Save report as a NEW version with timestamp in history
  const handleSaveReport = async () => {
    setSaving(true);
    const nowIso = new Date().toISOString();
    const versionId = `version_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    const dataToSave: DailyReportData = {
      ...reportData,
      id: versionId,
      updatedAt: nowIso,
    };

    try {
      const stored = localStorage.getItem('daily_reports_backup');
      let reportsList: DailyReportData[] = stored ? JSON.parse(stored) : [];
      
      // Prepend new version
      reportsList = [dataToSave, ...reportsList];
      
      // Keep up to 50 versions max
      if (reportsList.length > 50) {
        reportsList = reportsList.slice(0, 50);
      }

      localStorage.setItem('daily_reports_backup', JSON.stringify(reportsList));

      setSavedSuccess(true);
      const timeLabel = formatDateTime(nowIso);
      showToast(`Đã lưu phiên bản báo cáo thành công lúc ${timeLabel}!`);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err) {
      console.error('Save failed:', err);
      showToast('Lỗi khi lưu phiên bản báo cáo');
    } finally {
      setSaving(false);
    }
  };

  // Load History Reports from LocalStorage sorted by time
  const loadSavedReports = () => {
    const stored = localStorage.getItem('daily_reports_backup');
    if (!stored) return [];
    try {
      const parsed: DailyReportData[] = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });
    } catch (e) {
      return [];
    }
  };

  const handleOpenHistory = () => {
    setShowHistoryModal(true);
    setLoadingHistory(true);
    setSearchQuery('');
    try {
      const list = loadSavedReports();
      setSavedReports(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDeleteVersion = (versionId: string) => {
    const stored = localStorage.getItem('daily_reports_backup');
    if (!stored) return;
    try {
      let list: DailyReportData[] = JSON.parse(stored);
      list = list.filter((r) => r.id !== versionId);
      localStorage.setItem('daily_reports_backup', JSON.stringify(list));
      setSavedReports(list);
      showToast('Đã xóa phiên bản khỏi lịch sử!');
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearAllHistory = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử tất cả phiên bản đã lưu?')) {
      localStorage.removeItem('daily_reports_backup');
      setSavedReports([]);
      showToast('Đã xóa toàn bộ lịch sử lưu báo cáo!');
    }
  };

  const filteredReports = savedReports.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const dateStr = item.reportDate ? item.reportDate.toLowerCase() : '';
    const teamStr = item.teamName ? item.teamName.toLowerCase() : '';
    const timeStr = item.updatedAt ? formatDateTime(item.updatedAt).toLowerCase() : '';
    const codesStr = (item.lineItems || []).map((l) => l.code).join(' ').toLowerCase();
    return dateStr.includes(q) || teamStr.includes(q) || timeStr.includes(q) || codesStr.includes(q);
  });

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Tự động lưu
          </span>
          <span className="text-slate-300">|</span>
          <span>Báo cáo ngày: <strong className="text-slate-800">{reportData.reportDate}</strong></span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <span className="hidden sm:inline">Team: <strong className="text-slate-800">{reportData.teamName}</strong></span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* PWA Install Button */}
          {!isStandalone ? (
            <button
              onClick={handleInstallPWA}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors cursor-pointer"
              title="Cài đặt ứng dụng trực tiếp lên Windows PC để dùng như phần mềm độc lập"
            >
              <Laptop className="w-3.5 h-3.5 text-purple-600" />
              <span>Cài Đặt App PC</span>
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg text-purple-800 bg-purple-100 border border-purple-200"
              title="Ứng dụng đang chạy ở chế độ App PC độc lập"
            >
              <Laptop className="w-3.5 h-3.5 text-purple-700" />
              <span>App PC Standalone</span>
            </span>
          )}

          {/* History modal button */}
          <button
            onClick={handleOpenHistory}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
            title="Xem danh sách các phiên bản báo cáo đã lưu theo ngày giờ"
          >
            <History className="w-3.5 h-3.5 text-slate-600" />
            <span>Lịch Sử Phân Bản</span>
          </button>

          {/* Save button */}
          <button
            onClick={handleSaveReport}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer disabled:opacity-50"
            title="Lưu một phiên bản snapshot mới của báo cáo vào lịch sử"
          >
            {savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700 font-bold">Đã Lưu Phiên Bản</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 text-blue-600" />
                <span>Lưu Báo Cáo</span>
              </>
            )}
          </button>

          {/* Copy to Clipboard button */}
          <button
            onClick={handleCopyToClipboard}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors cursor-pointer"
            title="Sao chép hình ảnh để dán ngay vào Zalo/Telegram"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Đã Sao Chép!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-indigo-600" />
                <span>Sao Chép Ảnh (Zalo)</span>
              </>
            )}
          </button>

          {/* Export Excel button */}
          <button
            onClick={handleExportExcelClick}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 shadow-sm transition-all cursor-pointer"
          >
            <Table className="w-3.5 h-3.5" />
            <span>Xuất Excel (.xlsx)</span>
          </button>

          {/* Export PNG button */}
          <button
            onClick={handleExportPng}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-500/30 transition-all cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting ? 'Đang Xuất...' : 'Xuất File Ảnh HD'}</span>
          </button>

          {/* Print button */}
          <button
            onClick={handlePrint}
            title="In hoặc lưu PDF"
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    Lịch Sử Lưu Phiên Bản Báo Cáo
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
                      {savedReports.length} phiên bản
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Mỗi lần bấm "Lưu Báo Cáo" hệ thống sẽ tự động ghi lại phiên bản theo ngày giờ
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Search Box */}
            {savedReports.length > 0 && (
              <div className="mt-3 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Tìm kiếm phiên bản theo ngày, giờ, team hoặc mã hàng..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            )}

            {/* Versions List */}
            <div className="overflow-y-auto flex-1 my-3 space-y-3 pr-1">
              {loadingHistory ? (
                <p className="text-center py-12 text-xs text-slate-400">Đang tải lịch sử phiên bản...</p>
              ) : savedReports.length === 0 ? (
                <div className="text-center py-12 px-4 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                  <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="font-bold text-slate-700 text-xs">Chưa có phiên bản nào được lưu</p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                    Hãy bấm nút <strong className="text-blue-600 font-semibold">"Lưu Báo Cáo"</strong> trên thanh công cụ để lưu trữ các phiên bản báo cáo theo mốc ngày giờ!
                  </p>
                </div>
              ) : filteredReports.length === 0 ? (
                <p className="text-center py-8 text-xs text-slate-400">Không tìm thấy phiên bản phù hợp với tìm kiếm.</p>
              ) : (
                filteredReports.map((item) => {
                  const totalPlan = (item.lineItems || []).reduce((sum, curr) => sum + (Number(curr.plan) || 0), 0);
                  const totalActual = (item.lineItems || []).reduce((sum, curr) => sum + (Number(curr.actual) || 0), 0);
                  const totalGap = totalActual - totalPlan;

                  return (
                    <div
                      key={item.id}
                      className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-bold shadow-2xs">
                            <Clock className="w-3 h-3" />
                            {formatDateTime(item.updatedAt)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                            <Calendar className="w-3 h-3 text-blue-600" />
                            Ngày BC: {item.reportDate} ({item.timeRange})
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 pt-0.5">
                          <span>
                            Tổ / Team: <strong className="text-slate-800">{item.teamName || 'Chưa đặt'}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Nhân lực: <strong className="text-slate-800">{item.totalManpower} người</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Mã hàng: <strong className="text-slate-800">{(item.lineItems || []).length} mã</strong>
                          </span>
                        </div>

                        {/* Summary metrics pill */}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] pt-1">
                          <span className="bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                            Plan: <strong className="text-slate-900">{totalPlan.toLocaleString()}</strong>
                          </span>
                          <span className="bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
                            Actual: <strong className="text-slate-900">{totalActual.toLocaleString()}</strong>
                          </span>
                          <span className={`px-2 py-0.5 rounded font-bold border ${
                            totalGap >= 0
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            GAP: {totalGap >= 0 ? `+${totalGap.toLocaleString()}` : totalGap.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        <button
                          onClick={() => {
                            onLoadReport(item);
                            setShowHistoryModal(false);
                            showToast(`Đã khôi phục phiên bản lưu lúc ${formatDateTime(item.updatedAt)}!`);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
                          title="Khôi phục và nạp dữ liệu từ phiên bản này lên bảng"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          <span>Khôi Phục Phiên Bản</span>
                        </button>

                        <button
                          onClick={() => handleDeleteVersion(item.id!)}
                          title="Xóa phiên bản này khỏi lịch sử"
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              {savedReports.length > 0 ? (
                <button
                  onClick={handleClearAllHistory}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Xóa Tất Cả Lịch Sử
                </button>
              ) : (
                <div></div>
              )}

              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

