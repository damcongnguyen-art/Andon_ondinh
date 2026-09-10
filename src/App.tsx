import React, { useState, useEffect } from 'react';
import { Activity, Settings, Clock, Download, RefreshCw, FileText, Timer, RotateCcw, TrendingUp, ArrowLeft, ArrowRight, Shield, BarChart2, User, Key, Trash2, Flame, FileSpreadsheet, Calendar, Search, ChevronDown, ChevronLeft, ChevronRight, Archive, FolderCheck, CheckCircle2, History, Database, Coffee, PauseCircle, Edit3, Check, PlusCircle, AlertTriangle, Filter, Layers, PackageCheck, ArrowRightLeft } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LineChart, Line } from 'recharts';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import DailyReportApp from './components/DailyReportApp';

interface Config {
  url: string;
  cronTime: string;
  username?: string;
  password?: string;
}

interface DataRow {
  timeRange: string;
  productCode: string;
  completion: string;
  efficiency: string;
  output: string;
  status: string;
  durationHours: number;
}

interface HistoryRecord {
  id: string;
  timestamp: string;
  data: DataRow[];
}

const FACTORY_LINES = [
  { id: '1', name: '15L' },
  { id: '2', name: '20SL' },
  { id: '4', name: '30' },
  { id: '7', name: 'Atmor 1' },
  { id: '8', name: 'Atmor 2' },
  { id: '11', name: 'ELI' },
  { id: '9', name: 'PRO' },
];

const BAR_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6', '#06b6d4'];

interface LineStatusInfo {
  isRunning: boolean;
  isStopped: boolean;
  isNoPlan: boolean;
  isResting?: boolean;
  eventVn: string;
  eventEn: string;
  reasonVn: string;
  stopDuration: number;
  numberOfStops: number;
  color: string;
  restNote?: string;
  breakTimeRange?: string;
}

interface LineStatusLog {
  id: string;
  lineId: string;
  date: string;
  statusType: 'RUNNING' | 'STOP' | 'REST' | 'NOPLAN';
  statusVn: string;
  timeRange: string;
  durationMinutes: number;
  note: string;
  reason?: string;
  timestamp: string;
  isOngoing?: boolean;
}

export default function App() {
  const [mainMode, setMainMode] = useState<'daily_report' | 'ariston_live'>('daily_report');
  const [liveTab, setLiveTab] = useState<'dashboard' | 'hourly_counter' | 'total_output' | 'settings'>('dashboard');
  const [selectedTotalOutputLine, setSelectedTotalOutputLine] = useState<string>('all');
  const [totalOutputSearchQuery, setTotalOutputSearchQuery] = useState<string>('');
  const [config, setConfig] = useState<Config>({ url: '', cronTime: '0 23 * * *', username: '', password: '' });
  const [andonDashboard, setAndonDashboard] = useState<any>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hourlySearchQuery, setHourlySearchQuery] = useState('');
  
  // Realtime tracking state
  const [isLive, setIsLive] = useState(true);
  const [lineStatuses, setLineStatuses] = useState<Record<string, LineStatusInfo>>({});
  
  const [realtimeHourlyBuckets, setRealtimeHourlyBuckets] = useState<Record<string, { 
    date: string; 
    hour: number; 
    hourLabel: string; 
    lineId: string; 
    productCode: string; 
    startOutput?: string; 
    quantity: number; 
    planChanges?: Array<{ output: string; time: string; timestamp?: string }>;
    startTime?: string;
    isClosed?: boolean;
    isRunning?: boolean;
    changeoverTime?: string;
  }>>({});
  const [realtimeHourlyEvents, setRealtimeHourlyEvents] = useState<{ timestamp: string, lineId: string, productCode: string, quantity: number }[]>([]);
  const [now, setNow] = useState(Date.now());
  const [liveRecord, setLiveRecord] = useState<HistoryRecord | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [selectedLine, setSelectedLine] = useState<string>('all'); // Default to 'all' for first page
  const [selectedMatrixLine, setSelectedMatrixLine] = useState<string>('all');
  const [selectedRawLogLine, setSelectedRawLogLine] = useState<string>('all');
  const [trinhStates, setTrinhStates] = useState<Record<string, any>>({});
  const [hourlyHistory, setHourlyHistory] = useState<any[]>([]);
  const [latestLineData, setLatestLineData] = useState<Record<string, any>>({});
  const [showLiveFeed, setShowLiveFeed] = useState<boolean>(false); // Hidden into a button by default
  const [userHasCustomizedVisibility, setUserHasCustomizedVisibility] = useState<boolean>(false);
  const [visibleLineIds, setVisibleLineIds] = useState<string[]>([]);

  const toggleLineVisibility = (lineId: string) => {
    setVisibleLineIds(prev =>
      prev.includes(lineId) ? prev.filter(id => id !== lineId) : [...prev, lineId]
    );
  };

  const toggleAllLinesVisibility = () => {
    if (visibleLineIds.length === FACTORY_LINES.length) {
      setVisibleLineIds([]);
    } else {
      setVisibleLineIds(FACTORY_LINES.map(l => l.id));
    }
  };

  // Rest state note editing
  const [editingRestLineId, setEditingRestLineId] = useState<string | null>(null);
  const [tempRestNote, setTempRestNote] = useState<string>('');
  const [tempBreakTimeRange, setTempBreakTimeRange] = useState<string>('');

  // Line status history log state
  const [lineStatusLogs, setLineStatusLogs] = useState<LineStatusLog[]>([]);
  const [showAddLogForm, setShowAddLogForm] = useState<boolean>(false);
  const [newLogType, setNewLogType] = useState<'REST' | 'RUNNING' | 'STOP' | 'NOPLAN'>('REST');
  const [newLogTimeRange, setNewLogTimeRange] = useState<string>('11:30 - 12:00');
  const [newLogDuration, setNewLogDuration] = useState<number>(30);
  const [newLogNote, setNewLogNote] = useState<string>('');
  const [newLogReason, setNewLogReason] = useState<string>('');

  const fetchLineStatusLogs = async (lineId: string) => {
    if (!lineId || lineId === 'all') return;
    try {
      const res = await fetch(`/api/line-status-logs?lineId=${lineId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.logs) {
          setLineStatusLogs(data.logs);
        }
      }
    } catch (e) {
      console.error("Failed to fetch line status logs", e);
    }
  };

  const handleAddStatusLog = async () => {
    if (!selectedLine || selectedLine === 'all') return;
    try {
      const res = await fetch('/api/line-status-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: selectedLine,
          statusType: newLogType,
          statusVn: newLogType === 'REST' ? 'Nghỉ ca' : newLogType === 'RUNNING' ? 'Đang chạy' : newLogType === 'STOP' ? 'Dừng máy' : 'Chờ',
          timeRange: newLogTimeRange,
          durationMinutes: newLogDuration,
          note: newLogNote,
          reason: newLogReason
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.logs) {
          setLineStatusLogs(data.logs);
          setShowAddLogForm(false);
          setNewLogNote('');
          setNewLogReason('');
        }
      }
    } catch (e) {
      console.error("Failed to add status log", e);
    }
  };

  const handleDeleteStatusLog = async (logId: string) => {
    if (!selectedLine || selectedLine === 'all') return;
    try {
      const res = await fetch('/api/line-status-logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId: selectedLine, logId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.logs) {
          setLineStatusLogs(data.logs);
        }
      }
    } catch (e) {
      console.error("Failed to delete status log", e);
    }
  };

  const handleSimulateStatus = async (statusType: 'RUNNING' | 'REST' | 'STOP' | 'NOPLAN', reason?: string) => {
    if (!selectedLine || selectedLine === 'all') return;
    try {
      const res = await fetch('/api/simulate-line-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId: selectedLine, statusType, reason })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.logs) {
          setLineStatusLogs(data.logs);
        }
        fetchLiveStatus();
      }
    } catch (e) {
      console.error("Failed to simulate line status", e);
    }
  };

  const handleSaveRestNote = async (lineId: string) => {
    try {
      await fetch('/api/update-line-rest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId,
          restNote: tempRestNote,
          breakTimeRange: tempBreakTimeRange,
          isResting: true
        })
      });
      setEditingRestLineId(null);
      fetchLiveStatus();
    } catch (e) {
      console.error("Failed to save rest note:", e);
    }
  };

  // Vietnam Time helpers
  const getVietnamTime = (date: Date = new Date()): Date => {
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 7));
  };

  // Helper: Chu kỳ ngày làm việc nhà máy (06:00 sáng -> 05:59 sáng hôm sau)
  const getVietnamProductionDate = (date: Date = new Date()): string => {
    const vnTime = getVietnamTime(date);
    const d = new Date(vnTime.getTime());
    if (d.getHours() < 6) {
      d.setDate(d.getDate() - 1);
    }
    return format(d, 'yyyy-MM-dd');
  };

  const [userHasSelectedCustomDate, setUserHasSelectedCustomDate] = useState<boolean>(false);
  const [selectedMatrixDate, setSelectedMatrixDate] = useState<string>(() => getVietnamProductionDate(new Date()));
  const [matrixSearchQuery, setMatrixSearchQuery] = useState<string>('');
  const [highlightedProduct, setHighlightedProduct] = useState<string | null>(null);

  // Auto-sync selectedMatrixDate to current shift date if user hasn't explicitly selected a historical date
  useEffect(() => {
    if (!userHasSelectedCustomDate) {
      const activeShiftDate = getVietnamProductionDate(new Date(now));
      if (selectedMatrixDate !== activeShiftDate) {
        setSelectedMatrixDate(activeShiftDate);
      }
    }
  }, [now, userHasSelectedCustomDate, selectedMatrixDate]);

  // Full 24-hour day starting from 6h, 7h... up to 4h, 5h
  const MATRIX_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];

  // Available unique dates stored in history
  const availableMatrixDates = Array.from(new Set([
    getVietnamProductionDate(),
    ...Object.values(realtimeHourlyBuckets || {}).map((item: any) => item.date || getVietnamProductionDate()).filter(Boolean),
    ...(hourlyHistory || []).map((item: any) => item.date).filter(Boolean)
  ])).sort().reverse();

  // Compute Matrix Pivot Table data (Khớp chuẩn 100% cùng lúc với Bảng giờ chi tiết)
  const getMatrixTableData = () => {
    const map: Record<string, Record<number, number>> = {};
    const seenBucketKeys = new Set<string>();

    const currentVnProdDate = getVietnamProductionDate();

    // 1. Process from authoritative realtimeHourlyBuckets
    Object.entries(realtimeHourlyBuckets || {}).forEach(([bucketKey, item]: [string, any]) => {
      const itemDate = item.date || currentVnProdDate;
      const matchesLine = selectedMatrixLine === 'all' || item.lineId === selectedMatrixLine;
      const pCode = (item.productCode || '').trim();
      const qty = item.quantity || 0;

      if (itemDate === selectedMatrixDate && pCode && pCode !== '---' && !pCode.includes('Dừng chuyền') && matchesLine && qty > 0) {
        const hour = Number(item.hour);
        if (!isNaN(hour)) {
          if (!map[pCode]) map[pCode] = {};
          map[pCode][hour] = (map[pCode][hour] || 0) + qty;
          seenBucketKeys.add(bucketKey);
        }
      }
    });

    // 2. Merge from hourlyHistory for historical dates or closed buckets not in realtimeHourlyBuckets
    (hourlyHistory || []).forEach((item: any) => {
      const itemDate = item.date;
      const matchesLine = selectedMatrixLine === 'all' || item.lineId === selectedMatrixLine;
      const pCode = (item.productCode || item.Product_Code || '').trim();
      const hour = Number(item.hour);
      const qty = item.quantity || item.Actual_Qty || item.Tong_San_Luong_Thuc_Te || 0;
      const bucketKey = `${itemDate}_${hour}_${item.lineId}_${pCode}`;

      if (itemDate === selectedMatrixDate && pCode && pCode !== '---' && !pCode.includes('Dừng chuyền') && matchesLine && qty > 0) {
        if (!seenBucketKeys.has(bucketKey) && !isNaN(hour)) {
          if (!map[pCode]) map[pCode] = {};
          map[pCode][hour] = (map[pCode][hour] || 0) + qty;
          seenBucketKeys.add(bucketKey);
        }
      }
    });

    let products = Object.keys(map).sort();
    const activeSearch = (matrixSearchQuery || hourlySearchQuery || '').trim().toLowerCase();
    if (activeSearch) {
      products = products.filter(p => p.toLowerCase().includes(activeSearch));
    }

    const colTotals: Record<number, number> = {};
    MATRIX_HOURS.forEach(h => { colTotals[h] = 0; });
    let grandTotal = 0;

    const rows = products.map(pCode => {
      const hoursMap = map[pCode] || {};
      let rowTotal = 0;
      MATRIX_HOURS.forEach(h => {
        const val = hoursMap[h] || 0;
        const roundedVal = Math.round(val * 100) / 100;
        rowTotal += roundedVal;
        colTotals[h] = Math.round(((colTotals[h] || 0) + roundedVal) * 100) / 100;
      });
      rowTotal = Math.round(rowTotal * 100) / 100;
      grandTotal += rowTotal;
      return {
        productCode: pCode,
        hours: hoursMap,
        total: rowTotal
      };
    });

    grandTotal = Math.round(grandTotal * 100) / 100;

    return { rows, colTotals, grandTotal };
  };

  const handleExportExcelMatrix = () => {
    const { rows, colTotals, grandTotal } = getMatrixTableData();
    if (rows.length === 0) {
      alert("Chưa có dữ liệu sản lượng cho ngày đã chọn!");
      return;
    }

    const headers = ['ProductCode', ...MATRIX_HOURS.map(h => `${h}`), 'Grand Total'];
    const excelRows = rows.map(r => [
      r.productCode,
      ...MATRIX_HOURS.map(h => r.hours[h] || ''),
      r.total
    ]);
    const footerRow = ['Grand Total', ...MATRIX_HOURS.map(h => colTotals[h] || ''), grandTotal];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...excelRows, footerRow]);

    // Set column widths
    ws['!cols'] = [
      { wch: 16 },
      ...MATRIX_HOURS.map(() => ({ wch: 8 })),
      { wch: 14 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sản Lượng Theo Giờ");
    XLSX.writeFile(wb, `Bang_San_Luong_Theo_Gio_${selectedMatrixDate}.xlsx`);
  };

  useEffect(() => {
    fetchConfig();
    fetchHistory();
  }, []);

  useEffect(() => {
    setSelectedMatrixLine(selectedLine);
    if (selectedLine && selectedLine !== 'all') {
      fetchLineStatusLogs(selectedLine);
    }
  }, [selectedLine]);

  const currentTargetUrl = selectedLine && selectedLine !== 'all'
    ? `https://andon-vn.aristongroup.com/msg_line?LineId=${selectedLine}` 
    : (config.url || '');

  const fetchLiveStatus = async () => {
    try {
      const res = await fetch(`/api/live-status?lineId=${selectedLine}`);
      if (res.ok) {
        const data = await res.json();
        if (data.record) {
          setLiveRecord(data.record);
        }
        if (data.latestLineData) {
          setLatestLineData(data.latestLineData);
        }
        if (data.lineStatuses) {
          setLineStatuses(data.lineStatuses);
        }
        if (data.realtimeHourlyBuckets) {
          setRealtimeHourlyBuckets(data.realtimeHourlyBuckets);
        }
        if (data.realtimeHourlyEvents) {
          setRealtimeHourlyEvents(data.realtimeHourlyEvents);
        }
        if (data.andonDashboard !== undefined) {
          setAndonDashboard(data.andonDashboard);
        }
        if (data.trinhStates) {
          setTrinhStates(data.trinhStates);
        }
        if (data.hourlyHistory) {
          setHourlyHistory(data.hourlyHistory);
        }
        if (selectedLine && selectedLine !== 'all') {
          fetchLineStatusLogs(selectedLine);
        }
      }
    } catch (e: any) {
      // Suppress loud error messages in logs during server restarts / hot module reloads
      if (e && e.message && e.message.includes('fetch')) {
        console.debug("Live status fetch pending...", e.message);
      } else {
        console.warn("Live status fetch notice:", e);
      }
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLive) {
      fetchLiveStatus();
      interval = setInterval(() => {
        fetchLiveStatus();
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isLive, selectedLine]);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      setHistory(data);
    } catch (e) {
      console.error(e);
    }
  };

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error('Lỗi khi lưu cài đặt');
      alert('Đã lưu cài đặt!');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchData = async (silent = false) => {
    if (!silent) {
        setLoading(true);
        setError(null);
    }
    try {
      const payload: any = { url: currentTargetUrl };

      const res = await fetch('/api/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi khi lấy dữ liệu');
      
      await fetchHistory();
      await fetchLiveStatus();
      if (!silent) alert('Đã cập nhật dữ liệu thành công!');
    } catch (e: any) {
      if (!silent) setError(e.message);
      else console.error("Auto-fetch error:", e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const checkIsLineRunning = (lineId: string) => {
    const s = lineStatuses[lineId];
    const isNoPlan = s && typeof s === 'object' && s.isNoPlan;
    const isResting = s && typeof s === 'object' && (s.isResting || (lineId === '8' && !s.isRunning && !s.isStopped && !isNoPlan));
    const isStopped = s && typeof s === 'object' && s.isStopped && !isResting;
    const isRunningFromStatus = s && (typeof s === 'object' ? (s.isRunning && !isNoPlan && !isResting && !isStopped) : s === true);

    const record = latestLineData[lineId];
    let hasRunningRow = false;
    if (record && record.data && Array.isArray(record.data)) {
      hasRunningRow = record.data.some((row: any) => {
        const statusLower = (row.status || '').toLowerCase();
        return statusLower.includes('run') || statusLower.includes('chạy');
      });
    }

    // Check if line has any active output or production in realtime buckets for active shift date
    const currentShiftDate = getVietnamProductionDate();
    const hasOutputInBuckets = Object.values(realtimeHourlyBuckets || {}).some(
      (item: any) => item.lineId === lineId && (item.date === currentShiftDate || !item.date) && item.quantity > 0
    );

    return Boolean(isRunningFromStatus || hasRunningRow || hasOutputInBuckets);
  };

  useEffect(() => {
    const runningIds = FACTORY_LINES.filter(l => checkIsLineRunning(l.id)).map(l => l.id);

    if (!userHasCustomizedVisibility) {
      if (runningIds.length > 0) {
        setVisibleLineIds(runningIds);
      } else {
        setVisibleLineIds(FACTORY_LINES.map(l => l.id));
      }
    } else {
      // Even if user customized visibility, if ANY line NEWLY starts running (checkIsLineRunning becomes true),
      // we automatically add it to visibleLineIds so running lines are never missing when they start running
      setVisibleLineIds(prev => {
        const set = new Set(prev);
        let updated = false;
        runningIds.forEach(id => {
          if (!set.has(id)) {
            set.add(id);
            updated = true;
          }
        });
        return updated ? Array.from(set) : prev;
      });
    }
  }, [latestLineData, lineStatuses, realtimeHourlyBuckets, userHasCustomizedVisibility]);

  const getLineTableRowData = (lineId: string) => {
    const line = FACTORY_LINES.find(l => l.id === lineId);
    const lineName = line ? line.name : `Chuyền ${lineId}`;
    const isRunning = checkIsLineRunning(lineId);
    const statusInfo = lineStatuses[lineId];

    let timeRange = '---';
    let productCode = '---';
    let output = '0/0';
    let statusStr = isRunning ? 'Running' : 'Dừng';

    const record = latestLineData[lineId];
    if (record && record.data && Array.isArray(record.data) && record.data.length > 0) {
      let row = record.data.find((r: any) => {
        const statusLower = (r.status || '').toLowerCase();
        return statusLower.includes('run') || statusLower.includes('chạy');
      });

      if (!row) {
        row = record.data.find((r: any) => !(r.status || '').toLowerCase().includes('finish')) || record.data[0];
      }

      if (row) {
        timeRange = row.timeRange || '---';
        productCode = row.productCode || '---';
        output = row.output || '0/0';
        if (row.status) {
          statusStr = row.status;
        }
      }
    }

    const isNoPlan = statusInfo && typeof statusInfo === 'object' && statusInfo.isNoPlan;
    const isResting = statusInfo && typeof statusInfo === 'object' && (statusInfo.isResting || (lineId === '8' && !isRunning && !statusInfo.isStopped && !isNoPlan));
    const isStopped = statusInfo && typeof statusInfo === 'object' && statusInfo.isStopped && !isResting;

    if (isNoPlan) statusStr = 'Không KH';
    else if (isResting) statusStr = 'Nghỉ Ca';
    else if (isStopped) statusStr = 'Dừng Máy';
    else if (isRunning && !statusStr.toLowerCase().includes('run')) statusStr = 'Running';

    return {
      lineId,
      lineName,
      timeRange,
      productCode,
      output,
      status: statusStr,
      isRunning,
      isResting,
      isStopped,
      isNoPlan
    };
  };

  const getRunningLinesData = () => {
    const runningList: { lineId: string; lineName: string; timeRange: string; productCode: string; output: string; status: string; efficiency: string; completion: string }[] = [];
    
    FACTORY_LINES.forEach(line => {
      const lineId = line.id;
      const record = latestLineData[lineId];
      const statusInfo = lineStatuses[lineId];
      const isLineRunning = statusInfo && (typeof statusInfo === 'object' ? statusInfo.isRunning : statusInfo === true);

      if (record && record.data && Array.isArray(record.data)) {
        let foundRunningRow = false;
        record.data.forEach((row: any) => {
          const statusLower = (row.status || '').toLowerCase();
          if (statusLower.includes('run') || statusLower.includes('chạy')) {
            runningList.push({
              lineId,
              lineName: line.name,
              timeRange: row.timeRange || '',
              productCode: row.productCode || '',
              output: row.output || '0/0',
              status: row.status || 'Running',
              efficiency: row.efficiency || '0%',
              completion: row.completion || '0%'
            });
            foundRunningRow = true;
          }
        });

        if (!foundRunningRow && isLineRunning && record.data.length > 0) {
          const row = record.data[0];
          runningList.push({
            lineId,
            lineName: line.name,
            timeRange: row.timeRange || '',
            productCode: row.productCode || '',
            output: row.output || '0/0',
            status: row.status || 'Running',
            efficiency: row.efficiency || '0%',
            completion: row.completion || '0%'
          });
        }
      }
    });
    
    return runningList;
  };

  const handleExport = (id?: string) => {
    const url = id ? `/api/export?id=${id}` : '/api/export';
    window.open(url, '_blank');
  };

  const renderLineButton = (id: string, name: string) => {
    const isSelected = selectedLine === id;
    if (id === 'all') {
      const anyRunning = Object.values(lineStatuses).some((s: any) => s && s.isRunning);
      let btnClass = "relative w-full px-1 sm:px-2 py-1.5 sm:py-2 text-[11px] sm:text-sm md:text-[30px] font-black rounded-lg transition-all duration-200 flex items-center justify-center cursor-pointer select-none whitespace-nowrap min-h-[38px] sm:min-h-[48px] h-auto min-w-0 active:scale-[0.98] touch-manipulation ";
      if (isSelected) {
        btnClass += "bg-indigo-600 text-white border-2 border-indigo-300 shadow-sm shadow-indigo-500/40 ring-1 ring-indigo-300";
      } else {
        btnClass += "bg-slate-800 text-indigo-300 border border-indigo-500/30 hover:bg-slate-700/80 hover:text-white";
      }
      return (
        <button
          key="all"
          onClick={() => {
            setSelectedLine('all');
            setSelectedMatrixLine('all');
            if (mainMode !== 'ariston_live') setMainMode('ariston_live');
            if (liveTab !== 'dashboard') setLiveTab('dashboard');
          }}
          className={btnClass}
        >
          <span className="truncate text-[11px] sm:text-sm md:text-[30px]">{name}</span>
          {anyRunning && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-indigo-400"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
            </span>
          )}
        </button>
      );
    }

    const s = lineStatuses[id];
    const isNoPlan = s && typeof s === 'object' && s.isNoPlan;
    const isRunning = s && (typeof s === 'object' ? (s.isRunning && !isNoPlan) : s === true);
    const isResting = s && typeof s === 'object' && (s.isResting || (id === '8' && !isRunning && !s.isStopped && !isNoPlan));
    const isStopped = s && typeof s === 'object' && s.isStopped && !isResting;

    let btnClass = "relative w-full px-1 sm:px-2 py-1.5 sm:py-2 text-[11px] sm:text-sm md:text-[30px] font-bold rounded-lg transition-all duration-200 flex items-center justify-center cursor-pointer select-none whitespace-nowrap min-h-[38px] sm:min-h-[48px] h-auto min-w-0 active:scale-[0.98] touch-manipulation ";

    if (isNoPlan) {
      if (isSelected) {
        btnClass += "bg-slate-700 text-slate-100 border-2 border-slate-400 shadow-sm shadow-slate-500/40 ring-1 ring-slate-400";
      } else {
        btnClass += "bg-slate-900/90 text-slate-400 border border-slate-700/60 hover:bg-slate-800/90";
      }
    } else if (isResting) {
      if (isSelected) {
        btnClass += "bg-amber-500 text-slate-950 border-2 border-amber-200 shadow-md shadow-amber-500/50 ring-2 ring-amber-300 font-black";
      } else {
        btnClass += "bg-amber-950/90 text-amber-300 border border-amber-500/80 hover:bg-amber-900/90 font-bold";
      }
    } else if (isStopped) {
      if (isSelected) {
        btnClass += "bg-rose-600 text-white border-2 border-rose-300 shadow-sm shadow-rose-500/40 ring-1 ring-rose-300";
      } else {
        btnClass += "bg-rose-950/80 text-rose-300 border border-rose-500/60 hover:bg-rose-900/90";
      }
    } else if (isRunning) {
      if (isSelected) {
        btnClass += "bg-emerald-500 text-white border-2 border-emerald-300 shadow-sm shadow-emerald-500/40 ring-1 ring-emerald-300";
      } else {
        btnClass += "bg-emerald-950/80 text-emerald-300 border border-emerald-500/60 hover:bg-emerald-900/90";
      }
    } else {
      if (isSelected) {
        btnClass += "bg-blue-600 text-white border-2 border-blue-400 shadow-sm shadow-blue-500/40";
      } else {
        btnClass += "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white";
      }
    }

    return (
      <button
        key={id}
        onClick={() => {
          setSelectedLine(id);
          setSelectedMatrixLine(id);
          if (mainMode !== 'ariston_live') setMainMode('ariston_live');
          if (liveTab !== 'dashboard') setLiveTab('dashboard');
        }}
        className={btnClass}
      >
        <span className="truncate flex items-center gap-0.5 sm:gap-1 text-[11px] sm:text-sm md:text-[30px]">
          {name}
          {isNoPlan ? (
            <span className="text-[8px] sm:text-[10px] md:text-[16px] opacity-90 font-mono text-slate-400">(Ko KH)</span>
          ) : isResting ? (
            <span className="text-[8px] sm:text-[10px] md:text-[16px] opacity-90 font-mono">(Nghỉ)</span>
          ) : isStopped ? (
            <span className="text-[8px] sm:text-[10px] md:text-[16px] opacity-90 font-mono text-rose-300">(Dừng)</span>
          ) : isRunning ? (
            <span className="text-[8px] sm:text-[10px] md:text-[16px] opacity-90 font-mono text-emerald-300">(Chạy)</span>
          ) : (
            <span className="text-[8px] sm:text-[10px] md:text-[16px] opacity-75 font-mono text-slate-400">(Chờ)</span>
          )}
        </span>
        {isResting && (
          <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSelected ? 'bg-amber-200' : 'bg-amber-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-3.5 w-3.5 items-center justify-center ${isSelected ? 'bg-amber-950 text-amber-300' : 'bg-amber-500 text-slate-950'} font-bold text-[9px]`}>☕</span>
          </span>
        )}
        {!isResting && isStopped && (
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSelected ? 'bg-white' : 'bg-rose-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isSelected ? 'bg-white' : 'bg-rose-500'}`}></span>
          </span>
        )}
        {!isResting && !isStopped && isRunning && (
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSelected ? 'bg-white' : 'bg-emerald-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isSelected ? 'bg-white' : 'bg-emerald-500'}`}></span>
          </span>
        )}
      </button>
    );
  };

  const currentData = liveRecord || (history.length > 0 ? history[0] : null);

  // Compute hourly production breakdown dynamically from active batches
  const getHourlyProductionBreakdown = () => {
    if (!currentData || !currentData.data) return { breakdown: [], productCodes: [] };
    
    let intervals: { S: number; E: number; productCode: string; rate: number }[] = [];

    currentData.data.forEach(row => {
      // row.output is e.g. "189/465"
      const actual = parseFloat(row.output.split('/')[0]);
      if (isNaN(actual) || actual <= 0) return;

      const parts = row.timeRange.split('-');
      if (parts.length !== 2) return;
      const [start, end] = parts;
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;

      let startMin = sh * 60 + sm;
      let endMin = eh * 60 + em;
      if (endMin < startMin) {
        endMin += 24 * 60;
      }

      const duration = endMin - startMin;
      if (duration <= 0) return;
      const rate = actual / duration;

      if (endMin > 1440) {
        intervals.push({ S: startMin, E: 1440, productCode: row.productCode, rate });
        intervals.push({ S: 0, E: endMin - 1440, productCode: row.productCode, rate });
      } else {
        intervals.push({ S: startMin, E: endMin, productCode: row.productCode, rate });
      }
    });

    const hourlyData: Record<number, Record<string, number>> = {};
    for (let h = 0; h < 24; h++) {
      hourlyData[h] = {};
    }

    intervals.forEach(interval => {
      for (let h = 0; h < 24; h++) {
        const Hs = h * 60;
        const He = (h + 1) * 60;
        const overlap = Math.max(0, Math.min(interval.E, He) - Math.max(interval.S, Hs));
        if (overlap > 0) {
          const qty = overlap * interval.rate;
          hourlyData[h][interval.productCode] = (hourlyData[h][interval.productCode] || 0) + qty;
        }
      }
    });

    const breakdown: any[] = [];
    const allProductCodes = new Set<string>();

    for (let h = 0; h < 24; h++) {
      const products = hourlyData[h];
      const hasProduction = Object.values(products).some(v => v > 0);
      if (hasProduction) {
        const hourLabel = `${h.toString().padStart(2, '0')}h-${(h + 1).toString().padStart(2, '0')}h`;
        const item: any = { hourLabel, rawHour: h };
        let total = 0;
        Object.entries(products).forEach(([prod, qty]) => {
          const roundedQty = Math.round(qty);
          if (roundedQty > 0) {
            item[prod] = roundedQty;
            total += roundedQty;
            allProductCodes.add(prod);
          }
        });
        item.total = total;
        if (total > 0) {
          breakdown.push(item);
        }
      }
    }
    
    breakdown.sort((a, b) => a.rawHour - b.rawHour);
    return {
      breakdown,
      productCodes: Array.from(allProductCodes)
    };
  };

  const { breakdown: hourlyBreakdown, productCodes: hourlyProductCodes } = getHourlyProductionBreakdown();

  const renderMatrixSection = () => (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-3 sm:p-4 space-y-3">
      {/* Action Controls & Search - Single Row Toolbar */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2 border-b border-slate-200 whitespace-nowrap no-scrollbar">
        <div className="flex items-center gap-2 shrink-0">
          {/* Line Filter */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Chuyền:</span>
            <select
              value={selectedMatrixLine}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedMatrixLine(val);
                setSelectedLine(val);
              }}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 shadow-2xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">Tất cả dây chuyền</option>
              {FACTORY_LINES.map(l => (
                <option key={l.id} value={l.id}>{l.name} (Line {l.id})</option>
              ))}
            </select>
          </div>

          {/* Date History Selector */}
          <div className="flex items-center gap-1 bg-slate-50 p-0.5 rounded-lg border border-slate-200 text-xs shrink-0">
            <Calendar className="w-3.5 h-3.5 text-slate-500 ml-1 shrink-0" />
            <input
              type="date"
              value={selectedMatrixDate}
              onChange={(e) => {
                setSelectedMatrixDate(e.target.value);
                setUserHasSelectedCustomDate(true);
              }}
              className="bg-transparent font-bold text-slate-700 outline-none px-1 py-0.5 cursor-pointer text-xs"
            />
            {availableMatrixDates.length > 0 && (
              <select
                value={selectedMatrixDate}
                onChange={(e) => {
                  setSelectedMatrixDate(e.target.value);
                  setUserHasSelectedCustomDate(true);
                }}
                className="bg-white font-semibold text-slate-700 border border-slate-200 rounded px-1.5 py-0.5 outline-none cursor-pointer max-w-[130px] text-xs"
              >
                {availableMatrixDates.map((d) => (
                  <option key={d} value={d}>
                    {d === getVietnamProductionDate() ? `Hôm nay (${d})` : `Lịch sử ${d}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quick Today button */}
          <button
            onClick={() => {
              const currentShiftDate = getVietnamProductionDate();
              setSelectedMatrixDate(currentShiftDate);
              setUserHasSelectedCustomDate(false);
            }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer border shrink-0 ${
              selectedMatrixDate === getVietnamProductionDate()
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Hôm nay
          </button>

          {/* Search Box */}
          <div className="relative w-36 sm:w-44 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Lọc mã sản phẩm..."
              value={matrixSearchQuery}
              onChange={(e) => setMatrixSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 pl-2">
          {/* Stats */}
          <div className="text-xs text-slate-500 font-medium whitespace-nowrap">
            Ngày chọn: <b className="text-indigo-600 font-bold">{selectedMatrixDate}</b> | Tổng mã SP: <b className="text-slate-800 font-bold">{getMatrixTableData().rows.length}</b>
          </div>

          {/* Export Excel Button */}
          <button
            onClick={handleExportExcelMatrix}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Xuất File Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Excel Pivot Table View */}
      {getMatrixTableData().rows.length === 0 ? (
        <div className="py-10 px-4 text-center border-2 border-dashed border-indigo-100 rounded-xl bg-slate-50/50">
          <div className="flex flex-col items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Cloud Live 24/7 (2s) - Đang kết nối
            </span>
            <p className="text-xs sm:text-sm font-semibold text-slate-700">
              Chưa có dữ liệu sản lượng cho ca <b className="text-indigo-600 font-bold">{selectedMatrixDate}</b>.
            </p>
            <p className="text-xs text-slate-500 max-w-md">
              Hệ thống sẽ tự động cập nhật ngay khi chuyền sản xuất phát tín hiệu đếm sản lượng đầu tiên trong ca.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-300 rounded-xl shadow-2xs">
          <table className="w-full text-left border-collapse font-sans min-w-[750px]">
            <thead>
              {/* Main Excel Header Row */}
              <tr className="bg-slate-200 text-slate-800 text-xs font-black uppercase border-b-2 border-slate-300 divide-x divide-slate-300">
                <th className="py-2.5 px-3 bg-slate-300/80 sticky left-0 z-10 w-[94px] min-w-[94px] text-center shadow-2xs">
                  ProductCode
                </th>
                {MATRIX_HOURS.map((h) => (
                  <th key={h} className="py-2.5 px-2 text-center w-12 font-mono">
                    {h}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right bg-slate-300/80 w-[81px] min-w-[81px] shadow-2xs">
                  Grand Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs sm:text-sm md:text-[16px] font-mono font-medium">
              {getMatrixTableData().rows.map((row) => {
                const isHighlighted = highlightedProduct === row.productCode;
                return (
                  <tr
                    key={row.productCode}
                    onClick={() => setHighlightedProduct(highlightedProduct === row.productCode ? null : row.productCode)}
                    className={`divide-x divide-slate-200 cursor-pointer transition-colors ${
                      isHighlighted
                        ? 'bg-amber-100/90 hover:bg-amber-100 text-slate-900 font-bold'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    {/* ProductCode Column */}
                    <td className={`py-1.5 md:py-2 px-2 md:px-3 font-bold sticky left-0 z-10 font-mono text-xs sm:text-sm md:text-[16px] text-center w-[82px] md:w-[94px] min-w-[82px] md:min-w-[94px] ${
                      isHighlighted ? 'bg-amber-200/90 text-slate-900' : 'bg-white text-slate-900'
                    }`}>
                      {row.productCode}
                    </td>

                    {/* Hourly Columns */}
                    {MATRIX_HOURS.map((h) => {
                      const val = row.hours[h];
                      return (
                        <td key={h} className="py-1.5 md:py-2 px-0.5 md:px-1 text-center font-mono text-xs sm:text-sm md:text-[16px]">
                          {val ? val : ''}
                        </td>
                      );
                    })}

                    {/* Row Grand Total */}
                    <td className="py-1.5 md:py-2 px-2 md:px-3 text-right font-black text-slate-900 bg-slate-50/80 text-xs sm:text-sm md:text-[16px]">
                      {row.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Bottom Total Row (Yellow Highlight like Excel) */}
            <tfoot>
              <tr className="bg-amber-200/90 border-t-2 border-slate-400 divide-x divide-slate-300 text-xs sm:text-sm md:text-[16px] font-black font-mono text-slate-900">
                <td className="py-2 md:py-2.5 px-2 md:px-3 sticky left-0 z-10 bg-amber-300/90 uppercase text-xs sm:text-sm md:text-[16px]">
                  Grand Total
                </td>
                {MATRIX_HOURS.map((h) => (
                  <td key={h} className="py-2 md:py-2.5 px-0.5 md:px-1 text-center text-xs sm:text-sm md:text-[16px]">
                    {getMatrixTableData().colTotals[h] || ''}
                  </td>
                ))}
                <td className="py-2 md:py-2.5 px-2 md:px-3 text-right text-indigo-900 text-xs sm:text-sm md:text-[16px] bg-amber-300/90">
                  {getMatrixTableData().grandTotal}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );

  const renderTrinhEngineSection = () => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-4 animate-fade-in">
      {/* Detailed hourly table */}
      <div className={showLiveFeed ? "lg:col-span-8 space-y-6" : "lg:col-span-12 space-y-6"}>

        {/* Table of detailed counts */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Top action bar: Search & Live Feed Toggle */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Tìm kiếm mã sản phẩm / mã đơn hàng trong bảng giờ..."
                value={hourlySearchQuery}
                onChange={(e) => setHourlySearchQuery(e.target.value)}
                className="w-full pl-9 pr-10 py-1.5 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-sans"
              />
              {hourlySearchQuery && (
                <button
                  onClick={() => setHourlySearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[10px] text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
                >
                  XÓA
                </button>
              )}
            </div>

            {/* Toggle Button to Hide / Show Live Feed */}
            <button
              onClick={() => setShowLiveFeed(!showLiveFeed)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-100 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer shrink-0"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              {showLiveFeed ? 'Ẩn Live Feed' : 'Xem Live Feed Realtime'}
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showLiveFeed ? 'rotate-180' : ''}`} />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase">
                  <th className="px-6 py-3 whitespace-nowrap">Khung giờ</th>
                  <th className="px-6 py-3 text-center whitespace-nowrap">Dây chuyền</th>
                  <th className="px-6 py-3 text-center whitespace-nowrap">Thời điểm chuyển mã / Bắt đầu</th>
                  <th className="px-6 py-3 text-center whitespace-nowrap">Các Mã SP Đã Chạy</th>
                  <th className="px-6 py-3 text-center whitespace-nowrap">Tổng SL Thực Tế</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                  {(() => {
                    const currentVnProdDate = getVietnamProductionDate();
                    const activeSearch = (hourlySearchQuery || matrixSearchQuery || '').trim().toLowerCase();
                    const combinedList: any[] = [];
                    const seenKeys = new Set<string>();

                    // 1. Add matching realtimeHourlyBuckets
                    Object.entries(realtimeHourlyBuckets || {}).forEach(([bucketKey, item]: [string, any]) => {
                      const itemDate = item.date || currentVnProdDate;
                      const matchesLine = selectedMatrixLine === 'all' || item.lineId === selectedMatrixLine;
                      const matchesDate = itemDate === selectedMatrixDate;
                      const matchesSearch = !activeSearch || (item.productCode || '').toLowerCase().includes(activeSearch);
                      const hasQuantity = (item.quantity > 0);

                      if (matchesDate && matchesLine && matchesSearch && hasQuantity) {
                        combinedList.push(item);
                        seenKeys.add(bucketKey);
                      }
                    });

                    // 2. Add from hourlyHistory if looking at historical dates or closed buckets
                    (hourlyHistory || []).forEach((item: any) => {
                      const itemDate = item.date;
                      const matchesLine = selectedMatrixLine === 'all' || item.lineId === selectedMatrixLine;
                      const matchesDate = itemDate === selectedMatrixDate;
                      const pCode = (item.productCode || item.Product_Code || '').trim();
                      const matchesSearch = !activeSearch || pCode.toLowerCase().includes(activeSearch);
                      const qty = item.quantity || item.Actual_Qty || item.Tong_San_Luong_Thuc_Te || 0;
                      const bucketKey = `${itemDate}_${item.hour}_${item.lineId}_${pCode}`;

                      if (matchesDate && matchesLine && matchesSearch && qty > 0 && !seenKeys.has(bucketKey)) {
                        combinedList.push({
                          date: itemDate,
                          hour: Number(item.hour),
                          hourLabel: item.hourLabel || `${String(item.hour).padStart(2, '0')}:00 - ${String((Number(item.hour) + 1) % 24).padStart(2, '0')}:00`,
                          lineId: item.lineId,
                          productCode: pCode,
                          changeoverTime: item.changeoverTime || item.Time_Start || `${String(item.hour).padStart(2, '0')}:00:00`,
                          quantity: qty,
                          isClosed: true,
                          isRunning: false
                        });
                        seenKeys.add(bucketKey);
                      }
                    });

                    const filtered = combinedList.sort((a: any, b: any) => {
                        // 1. Khung giờ mới hơn xếp ở trên (theo chu kỳ ca 6h sáng -> 5h sáng hôm sau)
                        const shiftHourA = (a.hour - 6 + 24) % 24;
                        const shiftHourB = (b.hour - 6 + 24) % 24;
                        if (shiftHourB !== shiftHourA) {
                          return shiftHourB - shiftHourA;
                        }

                        // 2. Cùng khung giờ: Sắp xếp theo mã chuyền
                        if (a.lineId !== b.lineId) {
                          return a.lineId.localeCompare(b.lineId);
                        }

                        // 3. Trong cùng 1 khung giờ & cùng chuyền: Đơn mới hơn xếp ở trên, đơn chạy trước xếp ở dưới (dựa theo Thời điểm chuyển mã / Bắt đầu)
                        const getShiftSeconds = (timeStr: string) => {
                          if (!timeStr || timeStr === '---') return -1;
                          const parts = timeStr.split(':').map((p: string) => parseInt(p, 10) || 0);
                          const h = parts[0] !== undefined ? parts[0] : 0;
                          const m = parts[1] !== undefined ? parts[1] : 0;
                          const s = parts[2] !== undefined ? parts[2] : 0;
                          const sHour = (h - 6 + 24) % 24;
                          return sHour * 3600 + m * 60 + s;
                        };

                        const secA = getShiftSeconds(a.changeoverTime);
                        const secB = getShiftSeconds(b.changeoverTime);
                        if (secB !== secA) {
                          return secB - secA;
                        }

                        return (b.productCode || '').localeCompare(a.productCode || '');
                      });

                    if (filtered.length === 0) {
                      const activeSearch = (hourlySearchQuery || matrixSearchQuery || '').trim();
                      return (
                        <tr>
                          <td colSpan={5} className="py-10 text-center font-medium text-slate-500">
                            {activeSearch ? (
                              <span>Không tìm thấy mã sản phẩm / mã đơn hàng khớp với từ khóa "{activeSearch}".</span>
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-1.5">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                  Cloud Live 24/7 (2s) - Đang kết nối
                                </span>
                                <span className="text-xs sm:text-sm text-slate-700 font-semibold">
                                  Chưa có dữ liệu tích lũy giờ cho ca <b className="text-indigo-600 font-bold">{selectedMatrixDate}</b>.
                                </span>
                                <span className="text-xs text-slate-400">
                                  Hệ thống sẽ tự động cập nhật ngay khi chuyền phát tín hiệu đếm sản lượng.
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    }

                    return filtered.map((item: any, idx) => {
                      const lineObj = FACTORY_LINES.find(l => l.id === item.lineId);
                      const lineName = lineObj ? lineObj.name : `Chuyền ${item.lineId}`;
                      
                      let startOutputVal = item.startOutput;
                      if (!startOutputVal && latestLineData[item.lineId]?.data) {
                        const matchedRow = latestLineData[item.lineId].data.find((r: any) => (item.productCode || '').includes(r.productCode));
                        if (matchedRow && matchedRow.output) {
                          startOutputVal = matchedRow.output;
                        } else if (latestLineData[item.lineId].data[0]?.output) {
                          startOutputVal = latestLineData[item.lineId].data[0].output;
                        }
                      }

                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors text-xs sm:text-sm md:text-[18px]">
                          <td className="px-2.5 sm:px-6 py-2 sm:py-4 font-bold text-slate-700 whitespace-nowrap text-xs sm:text-sm md:text-[18px]">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <Clock className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-slate-400 shrink-0" />
                              <span className="text-xs sm:text-sm md:text-[18px]">{item.hourLabel}</span>
                              {item.isClosed ? (
                                <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-semibold">
                                  Đã chốt :00
                                </span>
                              ) : item.isRunning !== false ? (
                                <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded font-semibold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                                  Đang tích lũy
                                </span>
                              ) : (
                                <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded font-semibold">
                                  Đã chuyển mã
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2.5 sm:px-6 py-2 sm:py-4 whitespace-nowrap text-xs sm:text-sm md:text-[18px] text-center">
                            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-slate-100 text-slate-800 rounded font-bold text-xs sm:text-sm md:text-[18px]">
                              {lineName}
                            </span>
                          </td>
                          <td className="px-2.5 sm:px-6 py-2 sm:py-4 font-mono font-bold text-amber-600 whitespace-nowrap text-xs sm:text-sm md:text-[18px] text-center">
                            {item.changeoverTime || '---'}
                          </td>
                          <td className="px-2.5 sm:px-6 py-2 sm:py-4 font-mono font-medium text-indigo-600 whitespace-nowrap text-xs sm:text-sm md:text-[18px] text-center">
                            {item.productCode || '---'}
                          </td>
                          <td className="px-2.5 sm:px-6 py-2 sm:py-4 text-center font-mono font-black text-emerald-600 whitespace-nowrap text-xs sm:text-sm md:text-[18px]">
                            +{item.quantity} sp
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
        </div>
      </div>

      {/* Live Ticker Feed (Right Sidebar) - Shown only when toggled on */}
      {showLiveFeed && (
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 text-slate-100 rounded-xl shadow-lg border border-slate-800 p-5 flex flex-col h-[600px]">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
                Live Feed (Nhật ký thực tế)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Nhận tín hiệu đếm sản lượng realtime của tất cả mã hàng từ hệ thống Andon
              </p>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-slate-800">
              {(realtimeHourlyEvents || []).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 text-xs py-20">
                  <Timer className="w-8 h-8 text-slate-600 mb-2 animate-spin" />
                  Đang đợi tín hiệu đếm sản lượng...
                </div>
              ) : (
                (realtimeHourlyEvents || []).map((evt: any, idx) => {
                  const lineObj = FACTORY_LINES.find(l => l.id === evt.lineId);
                  const lineName = lineObj ? lineObj.name : `Chuyền ${evt.lineId}`;
                  return (
                    <div 
                      key={idx} 
                      className="p-3 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 rounded-lg text-xs space-y-1.5 transition-all"
                    >
                      <div className="flex justify-between items-center text-[10px] text-slate-400">
                        <span className="font-bold text-slate-300 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                          {lineName}
                        </span>
                        <span>{format(new Date(evt.timestamp), 'HH:mm:ss')}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-200 font-mono">Mã SP: <b className="text-indigo-300 font-bold">{evt.productCode}</b></span>
                        <span className="font-mono font-extrabold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          +{evt.quantity} sp
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const getTotalOutputData = () => {
    const resultMap: Record<string, { productCode: string; actualQuantity: number; lineId: string; lineName: string }> = {};

    FACTORY_LINES.forEach(line => {
      const lineId = line.id;
      if (selectedTotalOutputLine !== 'all' && selectedTotalOutputLine !== lineId) {
        return;
      }

      const record = latestLineData[lineId];
      if (record && record.data && Array.isArray(record.data)) {
        record.data.forEach((row: any) => {
          const statusLower = String(row.status || '').toLowerCase().trim();
          const isFinishedOrRunning = 
            statusLower.includes('finish') || 
            statusLower.includes('run') || 
            statusLower.includes('chạy') || 
            statusLower.includes('hoàn thành');

          if (isFinishedOrRunning && row.output && row.productCode) {
            const productCode = String(row.productCode).trim();
            if (productCode && productCode !== '---' && productCode !== '') {
              const outputStr = String(row.output).trim();
              const actualStr = outputStr.split('/')[0].trim();
              const actualQty = parseInt(actualStr, 10) || 0;

              const key = `${lineId}_${productCode}`;
              if (!resultMap[key]) {
                resultMap[key] = {
                  productCode,
                  actualQuantity: 0,
                  lineId,
                  lineName: line.name
                };
              }
              resultMap[key].actualQuantity += actualQty;
            }
          }
        });
      }
    });

    let list = Object.values(resultMap);

    if (totalOutputSearchQuery.trim()) {
      const q = totalOutputSearchQuery.trim().toLowerCase();
      list = list.filter(item => item.productCode.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      if (a.productCode !== b.productCode) {
        return a.productCode.localeCompare(b.productCode);
      }
      return parseInt(a.lineId, 10) - parseInt(b.lineId, 10);
    });

    const grandTotalActual = list.reduce((sum, item) => sum + item.actualQuantity, 0);

    return { list, grandTotalActual };
  };

  const handleExportTotalOutputExcel = () => {
    const { list, grandTotalActual } = getTotalOutputData();
    if (list.length === 0) {
      alert("Chưa có dữ liệu sản lượng!");
      return;
    }

    const headers = ['Mã hàng', 'Sản lượng actual', 'Dây chuyền'];
    const rows = list.map(item => [item.productCode, item.actualQuantity, item.lineName]);
    const lineFilterText = selectedTotalOutputLine === 'all' 
      ? 'Tất cả dây chuyền' 
      : (FACTORY_LINES.find(l => l.id === selectedTotalOutputLine)?.name || selectedTotalOutputLine);
    const footerRow = ['Tổng Cộng', grandTotalActual, lineFilterText];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, footerRow]);
    ws['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tong_San_Luong");
    XLSX.writeFile(wb, `Tong_San_Luong_Actual_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const renderTotalOutputSection = () => {
    const { list, grandTotalActual } = getTotalOutputData();

    return (
      <div className="space-y-6 animate-fade-in">
        {/* Banner Card / Stats summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-3.5 md:p-5 rounded-2xl border border-indigo-500/30 text-white shadow-md flex items-center justify-between">
            <div>
              <p className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-indigo-300">Tổng Sản Lượng Actual (Lũy kế)</p>
              <h3 className="text-xl sm:text-2xl md:text-3xl font-black text-emerald-400 mt-1 font-mono">
                {grandTotalActual.toLocaleString('vi-VN')} <span className="text-[10px] md:text-xs text-slate-300 font-normal">sản phẩm</span>
              </h3>
            </div>
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0">
              <Layers className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>

          <div className="bg-white p-3.5 md:p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-slate-500">Số Lượng Mã Hàng Ghi Nhận</p>
              <h3 className="text-lg sm:text-xl md:text-2xl font-black text-slate-800 mt-1 font-mono">
                {list.length} <span className="text-[10px] md:text-xs text-slate-500 font-normal">mã</span>
              </h3>
            </div>
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
              <PackageCheck className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>

          <div className="bg-white p-3.5 md:p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-[10px] md:text-xs font-bold uppercase tracking-wider text-slate-500">Bộ Lọc Dây Chuyền Hiện Tại</p>
              <h3 className="text-sm sm:text-base md:text-lg font-bold text-indigo-600 mt-1 truncate max-w-[180px]">
                {selectedTotalOutputLine === 'all'
                  ? 'Tất cả dây chuyền'
                  : FACTORY_LINES.find(l => l.id === selectedTotalOutputLine)?.name || selectedTotalOutputLine}
              </h3>
            </div>
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
              <Filter className="w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>
        </div>

        {/* Main Table Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-600" />
                <h3 className="text-base sm:text-lg font-black text-slate-800">
                  Bảng Tổng Sản Lượng Actual Theo Mã Hàng
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Trích xuất sản lượng actual từ Dashboard dây chuyền (tính lũy kế các dòng Finished & Running)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              {/* Search Box */}
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm mã hàng..."
                  value={totalOutputSearchQuery}
                  onChange={(e) => setTotalOutputSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Export Button */}
              <button
                onClick={handleExportTotalOutputExcel}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Xuất Excel</span>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-100">
                  <th className="px-2.5 md:px-6 py-2.5 md:py-4 text-[11px] sm:text-xs font-black uppercase tracking-wider w-1/3">
                    Mã hàng
                  </th>
                  <th className="px-2.5 md:px-6 py-2.5 md:py-4 text-center text-[11px] sm:text-xs font-black uppercase tracking-wider w-1/3">
                    Sản lượng actual
                  </th>
                  <th className="px-2.5 md:px-6 py-2.5 md:py-4 text-right text-[11px] sm:text-xs font-black uppercase tracking-wider w-1/3">
                    <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                      <span className="shrink-0">Dây chuyền</span>
                      <select
                        value={selectedTotalOutputLine}
                        onChange={(e) => setSelectedTotalOutputLine(e.target.value)}
                        className="w-auto max-w-[100px] sm:max-w-none px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 border border-amber-500 rounded-lg cursor-pointer outline-none shadow-xs transition-colors truncate"
                      >
                        <option value="all">Tất cả dây chuyền</option>
                        {FACTORY_LINES.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm font-medium bg-white">
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 md:px-6 py-8 md:py-10 text-center text-slate-400 italic">
                      Không tìm thấy dữ liệu sản lượng phù hợp.
                    </td>
                  </tr>
                ) : (
                  list.map((item, index) => (
                    <tr 
                      key={`${item.lineId}-${item.productCode}-${index}`}
                      className="hover:bg-indigo-50/50 transition-colors"
                    >
                      <td className="px-2.5 md:px-6 py-2 md:py-4 font-mono font-bold text-indigo-600 whitespace-nowrap text-xs sm:text-base md:text-[40px]">
                        {item.productCode}
                      </td>
                      <td className="px-2.5 md:px-6 py-2 md:py-4 text-center font-mono font-black text-emerald-600 whitespace-nowrap text-sm sm:text-xl md:text-[40px]">
                        {item.actualQuantity.toLocaleString('vi-VN')}
                      </td>
                      <td className="px-2.5 md:px-6 py-2 md:py-4 text-right whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 md:px-3 md:py-1 rounded-md text-xs sm:text-sm md:text-[30px] font-bold bg-slate-100 text-slate-800 border border-slate-300 shadow-2xs">
                          {item.lineName}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {list.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                    <td className="px-2.5 md:px-6 py-2.5 md:py-4 text-slate-800 uppercase text-[10px] sm:text-xs font-black">
                      Tổng Cộng ({list.length} mã)
                    </td>
                    <td className="px-2.5 md:px-6 py-2.5 md:py-4 text-center font-mono text-xs sm:text-lg md:text-[32px] font-black text-emerald-600">
                      {grandTotalActual.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-2.5 md:px-6 py-2.5 md:py-4 text-right text-[10px] sm:text-xs font-bold text-slate-600">
                      {selectedTotalOutputLine === 'all' 
                        ? 'Tất cả dây chuyền' 
                        : (FACTORY_LINES.find(l => l.id === selectedTotalOutputLine)?.name || selectedTotalOutputLine)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    );
  };

  if (mainMode === 'daily_report') {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-800 font-sans">
        <DailyReportApp onNavigateToLive={() => setMainMode('ariston_live')} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans pb-24 md:pb-8">
      <header className="bg-slate-900 border-b border-slate-700 shadow-md sticky top-0 z-20 py-2 sm:py-3">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* Top Bar with Title, 2-Tab Navigation Switcher & Tools */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-2 sm:mb-3 pb-2 sm:pb-3 border-b border-slate-800 gap-2 sm:gap-4">
            <div className="flex items-center justify-between w-full md:w-auto gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <h1 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-200 truncate">
                  Ariston Production Live
                </h1>
              </div>

              {/* Mobile Right Side: Compact 1-Button Page Switcher & Clock on Same Row */}
              <div className="md:hidden flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setMainMode('daily_report')}
                  className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-xs"
                  title="Chuyển sang Trang Báo Cáo Hằng Ngày"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
                  <span>Báo Cáo</span>
                  <ArrowRightLeft className="w-3 h-3 text-amber-400 opacity-70" />
                </button>

                <div className="flex items-center gap-1 text-indigo-300 bg-slate-850 border border-slate-750 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold">
                  <Clock className="w-3 h-3 text-indigo-400" />
                  <span>{format(now, 'HH:mm:ss')}</span>
                </div>
              </div>
            </div>

            {/* Primary Navigation & Ariston Tools (Desktop only) */}
            <div className="hidden md:flex flex-wrap items-center gap-2">
              {/* Compact 1-button page toggle on PC */}
              <button
                onClick={() => setMainMode('daily_report')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-xs shrink-0"
                title="Chuyển sang Trang Báo Cáo Sản Lượng Hằng Ngày"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
                <span>Báo Cáo Hằng Ngày</span>
                <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400 opacity-70" />
              </button>

              {/* Sub-tools of Ariston Live */}
              <div className="hidden lg:flex items-center gap-1 bg-slate-800/60 p-1 rounded-xl border border-slate-700/50">
                <button
                  onClick={() => setLiveTab('dashboard')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    liveTab === 'dashboard'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Activity className="w-3 h-3 text-indigo-400" />
                  <span>Dashboard</span>
                </button>
                <button
                  onClick={() => setLiveTab('hourly_counter')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    liveTab === 'hourly_counter'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                  <span className="flex items-center gap-1">
                    Counter 
                    <span className="bg-emerald-500 text-[8px] text-white px-1 rounded font-mono font-bold">LIVE</span>
                  </span>
                </button>
                <button
                  onClick={() => setLiveTab('total_output')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    liveTab === 'total_output'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3 h-3 text-amber-400" />
                  <span>Tổng sản lượng</span>
                </button>
                <button
                  onClick={() => setLiveTab('settings')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    liveTab === 'settings'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Settings className="w-3 h-3 text-slate-400" />
                  <span>Cài đặt</span>
                </button>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-1.5 text-indigo-300 bg-slate-850 border border-slate-750 rounded-full px-2.5 sm:px-3 py-0.5 sm:py-1 font-mono text-[10px] sm:text-xs font-bold select-none shadow-inner shrink-0">
              <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-indigo-400 shrink-0" />
              <span>{format(now, 'dd/MM/yyyy HH:mm:ss')}</span>
            </div>
          </div>

          {/* Sub-tools on tablet/medium desktop (md to lg) */}
          <div className="hidden md:flex lg:hidden items-center justify-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setLiveTab('dashboard')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                liveTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <Activity className="w-3 h-3" />
              <span>Dashboard</span>
            </button>
            <button
              onClick={() => setLiveTab('hourly_counter')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                liveTab === 'hourly_counter' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <TrendingUp className="w-3 h-3 text-emerald-400" />
              <span>Counter LIVE</span>
            </button>
            <button
              onClick={() => setLiveTab('total_output')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                liveTab === 'total_output' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <Layers className="w-3 h-3 text-amber-400" />
              <span>Tổng sản lượng</span>
            </button>
            <button
              onClick={() => setLiveTab('settings')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                liveTab === 'settings' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-800 text-slate-400'
              }`}
            >
              <Settings className="w-3 h-3" />
              <span>Cài đặt</span>
            </button>
          </div>

          {/* Status Legend & Grid Layout */}
          <div className="flex items-center justify-between text-xs text-slate-300 mb-2 px-1 gap-2 overflow-x-auto no-scrollbar">
            <span className="font-bold uppercase tracking-wider text-slate-400 text-[10px] sm:text-[11px] flex items-center gap-1.5 shrink-0">
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              Trạng thái chuyền:
            </span>
            <div className="flex items-center gap-2 sm:gap-2.5 text-[10px] sm:text-[11px] font-bold shrink-0">
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Chạy
              </span>
              <span className="flex items-center gap-1 text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span> Dừng
              </span>
              <span className="flex items-center gap-1 text-amber-300">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> Nghỉ Ca
              </span>
              <span className="flex items-center gap-1 text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-500"></span> Chờ
              </span>
            </div>
          </div>

          {/* 8-Button Grid Layout: 2 Rows x 4 Columns */}
          <div className="grid grid-cols-4 gap-1.5 sm:gap-3 w-full">
            {renderLineButton('all', 'TẤT CẢ')}
            {renderLineButton('1', '15L')}
            {renderLineButton('2', '20SL')}
            {renderLineButton('4', '30')}
            {renderLineButton('7', 'Atmor 1')}
            {renderLineButton('8', 'Atmor 2')}
            {renderLineButton('11', 'ELI')}
            {renderLineButton('9', 'PRO')}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <div className="text-red-600 font-semibold">Lỗi:</div>
            <div className="text-red-700">{error}</div>
          </div>
        )}


        {liveTab === 'dashboard' && (
          selectedLine === 'all' ? (
            <div className="space-y-6">
              {/* Clean Main Table Card */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 sm:p-6 space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-slate-100 pb-3">
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    Danh sách chuyền đang chạy trực tuyến
                  </span>

                  {/* Line Visibility Checkbox Selector Bar */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs bg-slate-50 p-1.5 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 mr-1 ml-1">Ẩn/Hiện chuyền:</span>
                    {(() => {
                      const allVisible = FACTORY_LINES.every(line => visibleLineIds.includes(line.id));
                      
                      const handleToggleAll = () => {
                        setUserHasCustomizedVisibility(true);
                        if (allVisible) {
                          setVisibleLineIds([]);
                        } else {
                          setVisibleLineIds(FACTORY_LINES.map(l => l.id));
                        }
                      };

                      const handleAutoSyncRunning = () => {
                        setUserHasCustomizedVisibility(false);
                        const runningIds = FACTORY_LINES.filter(l => checkIsLineRunning(l.id)).map(l => l.id);
                        if (runningIds.length > 0) {
                          setVisibleLineIds(runningIds);
                        } else {
                          setVisibleLineIds(FACTORY_LINES.map(l => l.id));
                        }
                      };

                      return (
                        <>
                          <button
                            type="button"
                            onClick={handleAutoSyncRunning}
                            className="px-2 py-1 rounded-lg text-[11px] font-bold border border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                            title="Tự động đồng bộ tất cả chuyền đang chạy thực tế"
                          >
                            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                            <span>Tự động chuyền chạy</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleToggleAll}
                            className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                              allVisible
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={allVisible}
                              onChange={() => {}}
                              className="w-3.5 h-3.5 rounded text-indigo-600 cursor-pointer pointer-events-none"
                            />
                            Tất cả
                          </button>
                          {FACTORY_LINES.map(line => {
                            const isRunning = checkIsLineRunning(line.id);
                            const isChecked = visibleLineIds.includes(line.id);
                            
                            return (
                              <button
                                key={line.id}
                                type="button"
                                onClick={() => {
                                  setUserHasCustomizedVisibility(true);
                                  toggleLineVisibility(line.id);
                                }}
                                className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                                  isChecked
                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-400 shadow-2xs font-bold'
                                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100 font-medium'
                                }`}
                                title={`Bật/Tắt hiển thị chuyền ${line.name}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="w-3.5 h-3.5 rounded text-emerald-600 cursor-pointer pointer-events-none"
                                />
                                <span>{line.name}</span>
                                {isRunning && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" title="Đang chạy" />
                                )}
                              </button>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Horizontal scroll container allowing zoom & horizontal swipe on mobile */}
                <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                  <table className="w-full text-left border-collapse min-w-[620px]">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-50/80">
                        <th className="py-3 px-3 w-10 text-center whitespace-nowrap">STT</th>
                        <th className="py-3 px-4 whitespace-nowrap">DÂY CHUYỀN</th>
                        <th className="py-3 px-4 whitespace-nowrap">Khung giờ chạy</th>
                        <th className="py-3 px-4 whitespace-nowrap">Mã sản phẩm</th>
                        <th className="py-3 px-4 whitespace-nowrap text-right">Sản lượng thực tế</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {(() => {
                        const visibleRows = FACTORY_LINES
                          .filter(line => visibleLineIds.includes(line.id))
                          .map(line => getLineTableRowData(line.id));

                        if (visibleRows.length === 0) {
                          return (
                            <tr>
                              <td colSpan={5} className="py-10 text-center font-medium text-slate-500">
                                <div className="flex flex-col items-center justify-center gap-2">
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-bold">
                                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                    Đang chờ ca sản xuất ({getVietnamProductionDate()})
                                  </span>
                                  <span className="text-xs sm:text-sm text-slate-700 font-semibold">
                                    {userHasCustomizedVisibility 
                                      ? "Tất cả dây chuyền đang bị bỏ tích. Hãy tích chọn dây chuyền ở thanh phía trên để hiển thị."
                                      : "Chưa có chuyền nào phát tín hiệu đang chạy. Hệ thống sẽ tự động hiển thị ngay khi chuyền sản xuất hoạt động."}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return visibleRows.map((row, idx) => (
                          <tr key={row.lineId} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2 md:py-3.5 px-2 md:px-3 text-center font-bold text-slate-400 font-mono whitespace-nowrap text-xs sm:text-sm md:text-[30px]">
                              {idx + 1}
                            </td>
                            <td className="py-2 md:py-3.5 px-3 md:px-4 font-bold text-slate-900 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 md:gap-2 text-sm sm:text-base md:text-[30px] font-bold">
                                <span className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full shrink-0 ${
                                  row.isRunning ? 'bg-emerald-500 animate-pulse' :
                                  row.isResting ? 'bg-amber-400' :
                                  row.isStopped ? 'bg-rose-500' : 'bg-slate-400'
                                }`} />
                                {row.lineName}
                                {!row.isRunning && (
                                  <span className="text-[10px] sm:text-xs md:text-[18px] font-mono font-normal text-slate-400">
                                    ({row.status})
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="py-2 md:py-3.5 px-3 md:px-4 text-slate-700 font-semibold font-mono whitespace-nowrap text-xs sm:text-sm md:text-[30px]">
                              {row.timeRange}
                            </td>
                            <td className="py-2 md:py-3.5 px-3 md:px-4 font-mono font-bold text-indigo-600 whitespace-nowrap text-xs sm:text-sm md:text-[30px]">
                              {row.productCode}
                            </td>
                            <td className="py-2 md:py-3.5 px-3 md:px-4 font-mono font-black text-slate-900 text-right whitespace-nowrap text-sm sm:text-base md:text-[30px]">
                              {row.output.split(' ')[0]}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>



              {/* MATRIX TABLE FOR ALL LINES VIEW */}
              <div className="mt-8">
                {renderMatrixSection()}
              </div>

              {/* HOURLY COUNTER TABLE FOR ALL LINES VIEW */}
              {renderTrinhEngineSection()}
            </div>
          ) : (
            /* Original Single Line Dashboard View */
            <div className="space-y-6">
              {/* Line Status History Log Section - Realtime Dynamic Tracking */}
              <div className="bg-white border-2 border-slate-200/90 rounded-2xl shadow-sm p-2.5 sm:p-5 space-y-3 sm:space-y-4">

                {/* Form add manual log entry */}
                {showAddLogForm && (
                  <div className="bg-indigo-50/70 p-3 sm:p-4 rounded-xl border border-indigo-200 space-y-3">
                    <h4 className="text-xs font-black uppercase text-indigo-950 tracking-wider">
                      ➕ Thêm Mốc Thời Gian Trạng Thái
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Trạng thái:</label>
                        <select
                          value={newLogType}
                          onChange={(e: any) => setNewLogType(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800"
                        >
                          <option value="REST">☕ Nghỉ ca (REST)</option>
                          <option value="STOP">🛑 Dừng máy (STOP)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Khung giờ (VD: 15:00 - 15:10):</label>
                        <input
                          type="text"
                          value={newLogTimeRange}
                          onChange={(e) => setNewLogTimeRange(e.target.value)}
                          placeholder="15:00 - 15:10"
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Thời lượng (Số phút):</label>
                        <input
                          type="number"
                          value={newLogDuration}
                          onChange={(e) => setNewLogDuration(Number(e.target.value))}
                          placeholder="30"
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Ghi chú / Lý do:</label>
                        <input
                          type="text"
                          value={newLogNote}
                          onChange={(e) => setNewLogNote(e.target.value)}
                          placeholder="Nghỉ giữa ca / Sự cố kỹ thuật"
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setShowAddLogForm(false)}
                        className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={handleAddStatusLog}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1 shadow-2xs"
                      >
                        <Check className="w-3.5 h-3.5" /> Lưu mốc
                      </button>
                    </div>
                  </div>
                )}

                {/* Realtime History Log Table - Filtered to only REST and STOP */}
                <div className="overflow-x-auto border border-indigo-100/80 rounded-xl shadow-xs -mx-1 sm:mx-0">
                  <table className="w-full text-left border-collapse text-xs min-w-full">
                    <thead>
                      <tr className="bg-[#F4F6FB] text-[#334155] uppercase font-black tracking-wider text-[10px] sm:text-[12px] border-b border-slate-200">
                        <th className="py-2.5 sm:py-3 px-2 sm:px-4 text-left whitespace-nowrap">TRẠNG THÁI</th>
                        <th className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-center font-mono whitespace-nowrap">KHUNG GIỜ</th>
                        <th className="py-2.5 sm:py-3 px-1.5 sm:px-4 text-center whitespace-nowrap">THỜI LƯỢNG</th>
                        <th className="py-2.5 sm:py-3 px-1 sm:px-2 text-right whitespace-nowrap"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {lineStatusLogs.filter(log => log.statusType === 'REST' || log.statusType === 'STOP').length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-slate-400 font-medium">
                            Chưa có dữ liệu ghi nhận Nghỉ ca hoặc Dừng máy.
                          </td>
                        </tr>
                      ) : (
                        lineStatusLogs
                          .filter(log => log.statusType === 'REST' || log.statusType === 'STOP')
                          .map((log) => {
                            const isRest = log.statusType === 'REST';
                            const isStop = log.statusType === 'STOP';

                            return (
                              <tr key={log.id} className={`hover:bg-indigo-50/40 transition-colors ${log.isOngoing ? 'bg-indigo-50/20' : ''}`}>
                                {/* TRẠNG THÁI Badge Pill */}
                                <td className="py-2 sm:py-3 px-1.5 sm:px-4 whitespace-nowrap">
                                  {isRest ? (
                                    <span className="inline-flex items-center justify-center gap-1 px-2 sm:px-3.5 py-1 sm:py-1.5 bg-[#F59E0B] text-slate-950 font-black text-[10px] sm:text-[12px] uppercase tracking-tight rounded-full shadow-2xs min-w-[95px] sm:min-w-[120px]">
                                      <Coffee className="w-3 h-3 text-slate-900" />
                                      NGHỈ CA
                                    </span>
                                  ) : isStop ? (
                                    <span className="inline-flex items-center justify-center gap-1 px-2 sm:px-3.5 py-1 sm:py-1.5 bg-[#FF2E4C] text-white font-black text-[10px] sm:text-[12px] uppercase tracking-tight rounded-full shadow-2xs min-w-[95px] sm:min-w-[120px]">
                                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                                      DỪNG MÁY
                                    </span>
                                  ) : null}
                                </td>

                              {/* KHUNG GIỜ */}
                              <td className="py-2 sm:py-3 px-1 sm:px-4 text-center font-mono font-bold text-slate-900 text-[11px] sm:text-sm tracking-tighter sm:tracking-tight whitespace-nowrap">
                                {log.timeRange}
                                {log.isOngoing && (
                                  <span className="ml-1 text-[9px] sm:text-[10px] font-bold text-indigo-600 bg-indigo-100 px-1 py-0.5 rounded-full animate-pulse">
                                    Đang diễn ra
                                  </span>
                                )}
                              </td>

                              {/* THỜI LƯỢNG */}
                              <td className="py-2 sm:py-3 px-1 sm:px-4 text-center font-mono font-black text-[#4338CA] text-[11px] sm:text-sm tracking-tight whitespace-nowrap">
                                {log.durationMinutes} phút
                              </td>

                              {/* Action */}
                              <td className="py-2 sm:py-3 px-1 sm:px-2 text-right whitespace-nowrap">
                                {!log.isOngoing && (
                                  <button
                                    onClick={() => handleDeleteStatusLog(log.id)}
                                    className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                                    title="Xóa mốc thời gian này"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>


              </div>

              {/* Header & Main Actions */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <span>Sản Lượng Gần Nhất</span>
                    <span className="text-indigo-600 font-extrabold bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-100">
                      {FACTORY_LINES.find(l => l.id === selectedLine)?.name || `Line ${selectedLine}`}
                    </span>
                  </h2>
                  {currentData && (
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                      Cập nhật lúc: {format(new Date(currentData.timestamp), 'dd/MM/yyyy HH:mm:ss', { locale: vi })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg shadow-2xs text-xs sm:text-sm font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Cloud Live 24/7 (2s)</span>
                  </div>
                  <button
                    onClick={() => handleFetchData(false)}
                    disabled={loading || !currentTargetUrl}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-2xs text-xs sm:text-sm font-medium whitespace-nowrap"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 
                    Làm mới
                  </button>
                  <button
                    onClick={() => handleExport(currentData?.id)}
                    disabled={!currentData}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-2xs text-xs sm:text-sm font-bold active:scale-95 whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" /> Xuất Excel
                  </button>
                </div>
              </div>

              {currentData ? (
                <>
                  <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
                          <th className="px-2 sm:px-6 py-2 sm:py-3 text-center">Giờ chạy</th>
                          <th className="px-2 sm:px-6 py-2 sm:py-3 text-center">Mã SP</th>
                          <th className="px-2 sm:px-6 py-2 sm:py-3 text-center">Sản lượng</th>
                          <th className="px-2 sm:px-6 py-2 sm:py-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {currentData.data.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-2.5 sm:px-6 py-2 sm:py-4 whitespace-nowrap text-slate-600 font-medium text-xs sm:text-sm md:text-[30px] text-center">
                              {row.timeRange}
                              <span className="block text-[10px] sm:text-xs text-slate-400 font-normal">({row.durationHours}h)</span>
                            </td>
                            <td className="px-2.5 sm:px-6 py-2 sm:py-4 whitespace-nowrap text-slate-900 font-mono text-xs sm:text-sm md:text-[30px] text-center font-bold">
                              {row.productCode}
                            </td>
                            <td className="px-2.5 sm:px-6 py-2 sm:py-4 whitespace-nowrap text-slate-900 font-mono text-xs sm:text-sm md:text-[30px] text-center font-bold">
                              {row.output.split(' ')[0]}
                            </td>
                            <td className="px-2.5 sm:px-6 py-2 sm:py-4 whitespace-nowrap text-center">
                              <span className={`inline-flex items-center px-2 sm:px-4 py-0.5 sm:py-1 rounded-full text-xs sm:text-sm md:text-[30px] text-center font-bold ${row.status.toLowerCase().includes('run') ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600'}`}>
                                {row.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                </>
              ) : (
                <div className="text-center py-20 bg-white rounded-lg border border-slate-200 border-dashed">
                  <FileText className="mx-auto h-12 w-12 text-slate-300" />
                  <h3 className="mt-2 text-sm font-semibold text-slate-700">Chưa có dữ liệu</h3>
                  <p className="mt-1 text-sm text-slate-500">Hãy cập nhật dữ liệu từ URL hoặc nhập thủ công.</p>
                </div>
              )}

              {/* MATRIX TABLE FOR SINGLE LINE VIEW */}
              <div className="mt-8">
                {renderMatrixSection()}
              </div>

              {/* TRINH ENGINE TABLE FOR SINGLE LINE VIEW */}
              {renderTrinhEngineSection()}
            </div>
          )
        )}

        {liveTab === 'hourly_counter' && (
          <div className="space-y-6 animate-fade-in">
            {renderMatrixSection()}
            {renderTrinhEngineSection()}
          </div>
        )}

        {liveTab === 'total_output' && renderTotalOutputSection()}



        {liveTab === 'settings' && (
          <div className="space-y-8 max-w-4xl">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setLiveTab('dashboard')}
                className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 hover:text-slate-900 rounded-lg text-sm font-bold shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Trở lại</span>
              </button>
              <h2 className="text-2xl font-bold text-slate-800">Cài Đặt Hệ Thống & Lịch Sử</h2>
            </div>
            
            {/* Cấu Hình Nguồn Dữ Liệu */}
            <form onSubmit={saveConfig} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-6">
              <h3 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-600" />
                Cấu Hình Nguồn Dữ Liệu
              </h3>
              
              {/* Hidden old logic inputs per user request to use Ariston Dashboard logic instead */}
              <div className="hidden">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  URL Trang Web Dashboard
                </label>
                <input
                  type="url"
                  value={config.url}
                  onChange={e => setConfig({...config, url: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                  placeholder="https://example.com/dashboard"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-500" />
                    Tài khoản Andon Ariston
                  </label>
                  <input
                    type="text"
                    value={config.username || ''}
                    onChange={e => setConfig({...config, username: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                    placeholder="Nhập tên tài khoản"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-indigo-500" />
                    Mật khẩu Andon Ariston
                  </label>
                  <input
                    type="password"
                    value={config.password || ''}
                    onChange={e => setConfig({...config, password: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                    placeholder="Nhập mật khẩu"
                  />
                </div>
              </div>

              <div className="hidden">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Lịch tự động lấy dữ liệu (Cron Expression)
                </label>
                <input
                  type="text"
                  value={config.cronTime}
                  onChange={e => setConfig({...config, cronTime: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow"
                  placeholder="0 23 * * *"
                />
              </div>

              <div className="pt-2 flex flex-col sm:flex-row justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 transition-colors shadow-sm text-sm font-bold active:scale-95"
                >
                  {loading ? 'ĐANG LƯU...' : 'LƯU CÀI ĐẶT'}
                </button>
              </div>
            </form>

            {/* The old history section is removed as we now use the Ariston Dashboard & Trinh Engine logic */}
          </div>
        )}

      </main>

      {/* Mobile Bottom Navigation Bar (Android optimized thumb navigation) */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 md:hidden px-2 py-1.5 flex items-center justify-around shadow-2xl safe-area-bottom">
        <button
          onClick={() => setLiveTab('dashboard')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer min-h-[44px] min-w-[64px] active:scale-95 ${
            liveTab === 'dashboard'
              ? 'text-indigo-400 font-bold bg-indigo-950/80 border border-indigo-500/40 shadow-inner'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-bold">Dashboard</span>
        </button>
        <button
          onClick={() => setLiveTab('hourly_counter')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer min-h-[44px] min-w-[64px] active:scale-95 ${
            liveTab === 'hourly_counter'
              ? 'text-emerald-400 font-bold bg-emerald-950/80 border border-emerald-500/40 shadow-inner'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <TrendingUp className="w-5 h-5 mb-0.5 text-emerald-400" />
            <span className="absolute -top-1 -right-2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <span className="text-[10px] font-bold">Counter</span>
        </button>
        <button
          onClick={() => setLiveTab('total_output')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer min-h-[44px] min-w-[64px] active:scale-95 ${
            liveTab === 'total_output'
              ? 'text-amber-400 font-bold bg-amber-950/80 border border-amber-500/40 shadow-inner'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-5 h-5 mb-0.5 text-amber-400" />
          <span className="text-[10px] font-bold">Tổng SL</span>
        </button>
        <button
          onClick={() => setLiveTab('settings')}
          className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer min-h-[44px] min-w-[64px] active:scale-95 ${
            liveTab === 'settings'
              ? 'text-indigo-400 font-bold bg-indigo-950/80 border border-indigo-500/40 shadow-inner'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-bold">Cài đặt</span>
        </button>
      </nav>
    </div>
  );
}
