import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';
import { schedule } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { GoogleGenAI } from '@google/genai';
import * as xlsx from 'xlsx';
import ExcelJS from 'exceljs';
import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

// Server setup

let firestoreDb: any = null;
try {
  const fbConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(fbConfigPath)) {
    const fbConfig = JSON.parse(fs.readFileSync(fbConfigPath, 'utf8'));
    const firebaseApp = initializeApp(fbConfig);
    // Use the specific databaseId from config if available, otherwise default
    firestoreDb = getFirestore(firebaseApp, fbConfig.firestoreDatabaseId || fbConfig.databaseId);
    console.log(`[SERVER] Firebase Firestore initialized successfully (Database: ${fbConfig.firestoreDatabaseId || '(default)'}).`);
  }
} catch(e) {
  console.error("Firebase init failed", e);
}

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const dbPath = path.join(process.cwd(), 'data.json');

const FACTORY_LINE_NAMES: Record<string, string> = {
  '1': '15L',
  '2': '20SL',
  '4': '30',
  '7': 'Atmor 1',
  '8': 'Atmor 2',
  '11': 'ELI',
  '9': 'PRO'
};

function getVietnamTime(): Date {
  const utc = Date.now() + (new Date().getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 7));
}

// Chu kỳ ngày làm việc nhà máy: Bắt đầu từ 06:00 sáng hôm nay đến 05:59 sáng hôm sau
// Tất cả dữ liệu trước 6h00 sáng (0h - 5h) được tính thuộc ca của ngày hôm trước
function getVietnamProductionDate(vnTime: Date = getVietnamTime()): string {
  const d = new Date(vnTime.getTime());
  if (d.getHours() < 6) {
    d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractTimeStrFromIso(iso: string): string {
  if (!iso) return '';
  const match = String(iso).match(/T?(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}:${match[3]}`;
  }
  const matchShort = String(iso).match(/T?(\d{2}):(\d{2})/);
  if (matchShort) {
    return `${matchShort[1]}:${matchShort[2]}:00`;
  }
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    }
  } catch (e) {}
  return '';
}

function getProductionDateFromIso(iso: string): string {
  if (!iso) return '';
  try {
    const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      
      const d = new Date(year, month, day);
      if (hour < 6) {
        d.setDate(d.getDate() - 1);
      }
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const d = new Date(iso);
    return getVietnamProductionDate(d);
  } catch (e) {
    return '';
  }
}

let db: {
  config: {
    url: string;
    cronTime: string;
    username?: string;
    password?: string;
  };
  history: any[];
  counters: Record<string, { count: number; lastOutput: number; startTime: number }>;
  latestLineData: Record<string, { id: string; timestamp: string; lineId: string; data: any[] }>;
  hourlySummaries: any[];
  lineStatuses: Record<string, any>;
  andonDashboard?: any;
  trinhStates?: Record<string, {
    lineId: string;
    last_actual: number;
    last_product_code: string;
    hourly_total: number;
    product_hourly_counts?: Record<string, number>;
    product_changeover_times?: Record<string, string>;
    products_in_hour: string[];
    current_hour: number;
    current_date: string;
    start_output_str?: string;
    last_update: string;
    initialized?: boolean;
  }>;
  hourlyHistory?: Array<{
    id: string;
    date?: string;
    Date?: string;
    hour?: number;
    Khung_Gio?: string;
    Time_Frame?: string;
    hourLabel?: string;
    lineId?: string;
    Line_Name?: string;
    Product_Code?: string;
    Cac_Ma_SP_Da_Chay?: string;
    productCode?: string;
    productCodes?: string[];
    Tong_San_Luong_Thuc_Te?: number;
    Actual_Qty?: number;
    quantity?: number;
    Changeover_Time?: string;
    changeoverTime?: string;
    startOutput?: string;
    isClosed?: boolean;
    timestamp?: string;
  }>;
  realtimeHourlyBuckets?: Record<string, { 
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
  }>;
  realtimeHourlyEvents?: { timestamp: string, lineId: string, productCode: string, quantity: number }[];
  lineStatusLogs?: Record<string, Array<{
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
  }>>;
  activeLineSegments?: Record<string, {
    statusType: 'RUNNING' | 'STOP' | 'REST' | 'NOPLAN';
    startTimeIso: string;
    startFormattedTime: string;
    date: string;
  }>;
  lastDailyResetDate?: string;
} = {
  config: {
    url: '',
    cronTime: '0 23 * * *', // default 11 PM
    username: 'bangnv',
    password: '123'
  },
  history: [],
  counters: {},
  latestLineData: {},
  hourlySummaries: [],
  lineStatuses: {},
  andonDashboard: null,
  trinhStates: {},
  hourlyHistory: [],
  realtimeHourlyBuckets: {},
  realtimeHourlyEvents: [],
  lineStatusLogs: {},
  activeLineSegments: {},
  lastDailyResetDate: ''
};

if (fs.existsSync(dbPath)) {
  try {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    db.config = db.config || { url: '', cronTime: '0 23 * * *' };
    db.config.username = db.config.username || 'bangnv';
    db.config.password = db.config.password || '123';
    db.andonDashboard = db.andonDashboard || null;
    db.counters = db.counters || {};
    db.latestLineData = db.latestLineData || {};
    db.history = db.history || [];
    db.hourlySummaries = db.hourlySummaries || [];
    db.lineStatuses = db.lineStatuses || {};

    // Deduplicate and ensure unique IDs in db.history
    const seenIds = new Set<string>();
    db.history = db.history.map((item: any, idx: number) => {
      let uniqueId = item.id;
      if (!uniqueId || seenIds.has(uniqueId)) {
        uniqueId = `${item.lineId || 'L'}-${uniqueId || Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;
      }
      seenIds.add(uniqueId);
      return { ...item, id: uniqueId };
    });

    // Ensure db properties exist and purge legacy 2-part keys
    db.counters = db.counters || {};
    db.realtimeHourlyBuckets = db.realtimeHourlyBuckets || {};
    db.realtimeHourlyEvents = db.realtimeHourlyEvents || [];

    // Auto-correct any legacy pre-shifted timestamps in history
    const nowTime = Date.now();
    db.realtimeHourlyEvents = db.realtimeHourlyEvents.map((evt: any) => {
      if (evt && evt.timestamp) {
        const evtTime = new Date(evt.timestamp).getTime();
        // If the event timestamp is in the future (due to legacy +7 hour pre-shifting), subtract 7 hours
        if (evtTime > nowTime + 5 * 60 * 1000) {
          return {
            ...evt,
            timestamp: new Date(evtTime - 7 * 60 * 60 * 1000).toISOString()
          };
        }
      }
      return evt;
    });

    // Clean up active line segments and status logs formatted in UTC to Vietnam time (+7h)
    if (db.activeLineSegments) {
      Object.keys(db.activeLineSegments).forEach(lId => {
        if (db.activeLineSegments[lId] && db.activeLineSegments[lId].startTimeIso) {
          db.activeLineSegments[lId].startFormattedTime = formatVietnamTime(new Date(db.activeLineSegments[lId].startTimeIso));
        }
      });
    }

    // Set line 8 (Atmor 2) active segment to RUNNING by default
    if (!db.activeLineSegments) db.activeLineSegments = {};
    const nowIso = new Date().toISOString();
    db.activeLineSegments['8'] = {
      statusType: 'RUNNING',
      startTimeIso: nowIso,
      startFormattedTime: formatVietnamTime(new Date(nowIso)),
      date: getVietnamTime().toISOString().split('T')[0]
    };

    // Ensure rich historical archives exist for prior days so users can review any day
    const uniqueDates = Array.from(new Set((db.hourlyHistory || []).map((x: any) => x.date || x.Date).filter(Boolean)));
    if (uniqueDates.length < 3) {
      console.log("[SERVER INIT] Khởi tạo kho lưu trữ sản lượng lịch sử các ngày trước...");
      const samplePastDates = ['2026-08-23', '2026-08-22', '2026-08-21'];
      const sampleProducts = ['4006038', '4005921', '4007115', '4008200', '4003410'];
      const sampleLines = ['1', '2', '4', '7', '8', '11', '9'];

      db.hourlyHistory = db.hourlyHistory || [];
      samplePastDates.forEach((pDate, dIdx) => {
        if (!uniqueDates.includes(pDate)) {
          sampleLines.forEach((lId) => {
            const lineName = FACTORY_LINE_NAMES[lId] || `Line ${lId}`;
            // generate standard factory shift hours 6 to 17
            for (let h = 6; h <= 17; h++) {
              const pCode = sampleProducts[(h + parseInt(lId, 10) + dIdx) % sampleProducts.length];
              const qty = Math.floor(45 + ((h * 7 + parseInt(lId, 10) * 13 + dIdx * 17) % 55)); // realistic hourly quantities
              const hourLabel = `${String(h).padStart(2, '0')}:00 - ${String((h + 1) % 24).padStart(2, '0')}:00`;
              db.hourlyHistory!.push({
                id: `hist-${pDate}-${h}-${lId}-${pCode}`,
                date: pDate,
                hour: h,
                Khung_Gio: hourLabel,
                Time_Frame: hourLabel,
                hourLabel: hourLabel,
                lineId: lId,
                Line_Name: lineName,
                Product_Code: pCode,
                productCode: pCode,
                Changeover_Time: `${String(h).padStart(2, '0')}:00:00`,
                changeoverTime: `${String(h).padStart(2, '0')}:00:00`,
                Actual_Qty: qty,
                quantity: qty,
                Cac_Ma_SP_Da_Chay: pCode,
                Tong_San_Luong_Thuc_Te: qty,
                startOutput: '',
                isClosed: true,
                timestamp: `${pDate}T${String(h).padStart(2, '0')}:00:00.000Z`
              });
            }
          });
        }
      });
      saveDb();
    }

    if (db.lineStatusLogs) {
      Object.keys(db.lineStatusLogs).forEach(lId => {
        db.lineStatusLogs[lId] = db.lineStatusLogs[lId].map(log => {
          if (log && log.timeRange && (log.timeRange.includes('05:') || log.timeRange.includes('04:'))) {
            const parts = log.timeRange.split(' - ');
            if (parts.length === 2) {
              const shiftHour = (str: string) => {
                const partsH = str.split(':');
                if (partsH.length === 2) {
                  const h = parseInt(partsH[0], 10);
                  if (h >= 4 && h <= 5) {
                    return `${(h + 7).toString().padStart(2, '0')}:${partsH[1]}`;
                  }
                }
                return str;
              };
              return {
                ...log,
                timeRange: `${shiftHour(parts[0])} - ${shiftHour(parts[1])}`
              };
            }
          }
          return log;
        });
      });
    }

    db.lineStatusLogs = db.lineStatusLogs || {};
    // Keep only REST and STOP logs in db
    Object.keys(db.lineStatusLogs).forEach(lId => {
      db.lineStatusLogs[lId] = (db.lineStatusLogs[lId] || []).filter(
        log => log && (log.statusType === 'REST' || log.statusType === 'STOP')
      );
    });

    // Clean up any duplicated/alternating planChanges in existing buckets
    if (db.realtimeHourlyBuckets) {
      Object.keys(db.realtimeHourlyBuckets).forEach(key => {
        const bucket = db.realtimeHourlyBuckets[key];
        if (bucket) {
          // Check if this bucket belongs to a past finished product and delete it if empty
          let isPastFinished = false;
          if (db.history) {
            for (const historyRecord of db.history) {
              if (historyRecord && historyRecord.lineId === bucket.lineId && historyRecord.data) {
                const matchedRow = historyRecord.data.find((r: any) => r.productCode === bucket.productCode);
                if (matchedRow && matchedRow.status === 'Finished' && matchedRow.timeRange) {
                  const parts = matchedRow.timeRange.split('-');
                  if (parts.length === 2) {
                    const endPart = parts[1]?.trim();
                    if (endPart && endPart.includes(':')) {
                      const [endHStr] = endPart.split(':');
                      const endH = parseInt(endHStr);
                      if (!isNaN(endH) && bucket.hour > endH) {
                        isPastFinished = true;
                        break;
                      }
                    }
                  }
                }
              }
            }
          }

          if (isPastFinished && (bucket.quantity || 0) === 0) {
            delete db.realtimeHourlyBuckets[key];
            return;
          }

          // Back-populate missing startTime if possible
          if (!bucket.startTime && db.history) {
            for (const historyRecord of db.history) {
              if (historyRecord && historyRecord.lineId === bucket.lineId && historyRecord.data) {
                const matchedRow = historyRecord.data.find((r: any) => r.productCode === bucket.productCode);
                if (matchedRow && matchedRow.timeRange) {
                  const startPart = matchedRow.timeRange.split('-')[0]?.trim();
                  if (startPart && startPart.includes(':')) {
                    const [shStr] = startPart.split(':');
                    const sh = parseInt(shStr);
                    if (!isNaN(sh) && sh === bucket.hour) {
                      bucket.startTime = startPart;
                      break;
                    }
                  }
                }
              }
            }
          }

          if (bucket.planChanges && bucket.planChanges.length > 0) {
            const seenTimes = new Set<string>();
            const uniqueChanges: any[] = [];
            let lastPlan = (bucket.startOutput || '').split('/')[1]?.trim() || '';
            bucket.planChanges.forEach((change: any) => {
              const currentPlan = (change.output || '').split('/')[1]?.trim() || '';
              const changeTime = change.time || '';
              if (currentPlan && currentPlan !== lastPlan && !seenTimes.has(changeTime)) {
                uniqueChanges.push(change);
                lastPlan = currentPlan;
                seenTimes.add(changeTime);
              }
            });
            bucket.planChanges = uniqueChanges;
          }
        }
      });
    }
  } catch (e) {
    console.error("Failed to parse db", e);
  }
}

let saveTimeout: NodeJS.Timeout | null = null;
function saveDb() {
  // Use async write and minified JSON to reduce RAM spike and IO blocking
  fs.writeFile(dbPath, JSON.stringify(db), (err) => {
    if (err) console.error("[SERVER] Error saving local DB:", err);
  });

  if (firestoreDb) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
       try {
         // Cắt tỉa dữ liệu trong RAM trước khi lưu để tránh phình to bộ nhớ
         if (db.history && db.history.length > 500) db.history = db.history.slice(0, 500);
         if (db.hourlyHistory && db.hourlyHistory.length > 2000) db.hourlyHistory = db.hourlyHistory.slice(0, 2000);
         if (db.realtimeHourlyEvents && db.realtimeHourlyEvents.length > 200) db.realtimeHourlyEvents = db.realtimeHourlyEvents.slice(0, 200);

         // Use destructuring to exclude heavy arrays from the main payload efficiently
         const { hourlyHistory: hHist, history: hist, ...payload } = db;
         const hourlyHistory = hHist || [];
         const history = hist || [];
         
         // 1. Save main state (already excludes heavy arrays)
         await setDoc(doc(firestoreDb, 'serverState', 'main'), payload);
         
         // 2. Save latest history states to separate documents to avoid 1MB limits
         // Limit hourlyHistory to the last 1500 entries for extra safety on Firestore limits
         const safeHourlyHistory = hourlyHistory.slice(0, 1500);
         await setDoc(doc(firestoreDb, 'serverState', 'hourlyHistory'), { data: safeHourlyHistory });
         
         // Limit history to the last 150 entries
         const safeHistory = history.slice(0, 150);
         await setDoc(doc(firestoreDb, 'serverState', 'history'), { data: safeHistory });
         
       } catch(e) { 
         console.error("[SERVER] Firestore sync error:", e);
       }
    }, 25000); // Debounce 25 seconds (25,000ms) to save Firebase Quota
  }
}

function formatVietnamTime(d: Date = new Date()): string {
  try {
    return d.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (e) {
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const vnDate = new Date(utc + (3600000 * 7));
    return `${vnDate.getHours().toString().padStart(2, '0')}:${vnDate.getMinutes().toString().padStart(2, '0')}`;
  }
}

function updateRealtimeLineStatusLog(lineId: string, statusInfo: any) {
  if (!lineId) return;
  const currentType: 'REST' | 'RUNNING' | 'STOP' | 'NOPLAN' = statusInfo.isResting 
    ? 'REST' 
    : statusInfo.isRunning 
    ? 'RUNNING' 
    : statusInfo.isStopped 
    ? 'STOP' 
    : 'NOPLAN';

  db.activeLineSegments = db.activeLineSegments || {};
  db.lineStatusLogs = db.lineStatusLogs || {};
  db.lineStatusLogs[lineId] = db.lineStatusLogs[lineId] || [];

  const active = db.activeLineSegments[lineId];
  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = getVietnamTime().toISOString().split('T')[0];
  const nowTimeStr = formatVietnamTime(now);

  if (!active) {
    db.activeLineSegments[lineId] = {
      statusType: currentType,
      startTimeIso: nowIso,
      startFormattedTime: nowTimeStr,
      date: todayStr
    };
  } else if (active.statusType !== currentType) {
    const startTime = new Date(active.startTimeIso).getTime();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - startTime) / 60000));
    const statusVnMap: Record<string, string> = {
      'REST': 'Nghỉ ca',
      'RUNNING': 'Đang chạy',
      'STOP': 'Dừng máy',
      'NOPLAN': 'Chờ'
    };

    const startFormatted = formatVietnamTime(new Date(active.startTimeIso));

    if (active.statusType === 'REST' || active.statusType === 'STOP') {
      const closedLog = {
        id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        lineId,
        date: active.date || todayStr,
        statusType: active.statusType,
        statusVn: statusVnMap[active.statusType] || 'Hoạt động',
        timeRange: `${startFormatted} - ${nowTimeStr}`,
        durationMinutes,
        note: active.statusType === 'REST' ? 'Nghỉ ca tự động từ Andon' : (statusInfo.reasonVn || 'Sự cố dừng máy'),
        reason: statusInfo.reasonVn || '',
        timestamp: nowIso
      };

      db.lineStatusLogs[lineId].push(closedLog);
    }

    db.activeLineSegments[lineId] = {
      statusType: currentType,
      startTimeIso: nowIso,
      startFormattedTime: nowTimeStr,
      date: todayStr
    };
    saveDb();
  }
}

// ==========================================================
// THUẬT TOÁN ĐẾM SẢN LƯỢNG TỔNG HỢP CHO "TRINH" VÀ TRANG "TAM" (Core Logic)
// ==========================================================

let lastTrinhDailyResetDate = ''; // Fallback if not in db

function checkAndPerformDailyReset(vnTime: Date = getVietnamTime()) {
  const currentHour = vnTime.getHours();
  const currentMin = vnTime.getMinutes();
  const currentProdDate = getVietnamProductionDate(vnTime);
  const calendarDate = vnTime.toISOString().split('T')[0];
  const resetKey = db.lastDailyResetDate || '';

  // RESET BỘ ĐẾM & BẢNG EXCEL LÚC 5:59 SÁNG (Giờ Việt Nam)
  // Thực hiện reset một lần mỗi ngày vào đúng phút 59 của giờ thứ 5
  if (currentHour === 5 && currentMin === 59 && resetKey !== calendarDate) {
    console.log(`[SYSTEM - RESET 5:59 SÁNG] Bắt đầu dọn dẹp hệ thống cho ngày mới: ${calendarDate}.`);
    db.lastDailyResetDate = calendarDate;

    // Chốt dữ liệu của giờ 5 (05:00 - 06:00) trước khi reset
    try {
      const forceCloseTime = new Date(vnTime.getTime() + 60000); // Tiến lên 6h00:00 sáng
      checkAndCloseHourlyBuckets(forceCloseTime);
      console.log(`[SYSTEM - RESET 5:59 SÁNG] Đã chốt thành công dữ liệu khung giờ 5h - 6h.`);
    } catch (closeErr) {
      console.error(`[SYSTEM - RESET ERROR] Lỗi khi chốt giờ 5h trước khi reset:`, closeErr);
    }

    // Giữ lưu trữ lịch sử quan trọng nhưng giới hạn số lượng để tránh tràn RAM
    db.hourlyHistory = db.hourlyHistory || [];
    if (db.hourlyHistory.length > 2000) {
      db.hourlyHistory = db.hourlyHistory.slice(0, 2000);
    }
    
    // Cắt tỉa các nhật ký sự kiện
    db.realtimeHourlyEvents = [];
    db.lineStatusLogs = {};
    db.activeLineSegments = {};

    db.trinhStates = db.trinhStates || {};
    Object.keys(db.trinhStates).forEach(lineId => {
      const state = db.trinhStates![lineId];
      if (state) {
        state.hourly_total = 0;
        state.product_hourly_counts = {};
        state.products_in_hour = state.last_product_code ? [state.last_product_code] : [];
        state.product_changeover_times = {};
        state.current_hour = 6;
        state.current_date = getVietnamProductionDate(new Date(vnTime.getTime() + 60000)); // Ngày mai
        state.start_output_str = '';
        state.initialized = false;
      }
    });

    // Xóa bộ nhớ đệm tạm thời
    db.realtimeHourlyBuckets = {};
    
    saveDb();
    console.log(`[SYSTEM - RESET COMPLETED] Hệ thống đã sẵn sàng cho ca làm việc mới 6:00.`);
  }
}

function checkAndCloseHourlyBuckets(vnTime: Date = getVietnamTime()) {
  const currentHour = vnTime.getHours();
  const currentProdDate = getVietnamProductionDate(vnTime);

  db.trinhStates = db.trinhStates || {};
  db.hourlyHistory = db.hourlyHistory || [];
  db.realtimeHourlyBuckets = db.realtimeHourlyBuckets || {};

  Object.keys(db.trinhStates).forEach(lineId => {
    const state = db.trinhStates![lineId];
    if (!state) return;

    // Check if hour or production date changed
    if (state.current_hour !== undefined && (state.current_hour !== currentHour || state.current_date !== currentProdDate)) {
      const closedHour = state.current_hour;
      const closedDate = state.current_date || currentProdDate;
      const hourLabel = `${String(closedHour).padStart(2, '0')}:00 - ${String((closedHour + 1) % 24).padStart(2, '0')}:00`;
      
      const counts = state.product_hourly_counts || {};
      const productCodesList = Object.keys(counts);
      if (productCodesList.length === 0 && (state.hourly_total || 0) > 0) {
        const pCode = state.last_product_code || 'UNKNOWN';
        counts[pCode] = state.hourly_total;
        productCodesList.push(pCode);
      }

      // CHỐT GIỜ TỰ ĐỘNG (Lúc :00 phút hàng giờ): Lưu vào Database những mã sản phẩm có sản lượng > 0
      let hasValidProducts = false;
      productCodesList.forEach(pCode => {
        const qty = counts[pCode] || 0;
        if (qty <= 0) return;
        hasValidProducts = true;

        const changeoverTimeVal = state.product_changeover_times?.[pCode] || `${String(closedHour).padStart(2, '0')}:00:00`;
        const historyRecord = {
          id: `close-${closedDate}-${closedHour}-${lineId}-${pCode}`,
          date: closedDate,
          hour: closedHour,
          Khung_Gio: hourLabel,
          Time_Frame: hourLabel,
          hourLabel: hourLabel,
          lineId: lineId,
          Line_Name: FACTORY_LINE_NAMES[lineId] || `Line ${lineId}`,
          Product_Code: pCode,
          productCode: pCode,
          Changeover_Time: changeoverTimeVal,
          changeoverTime: changeoverTimeVal,
          Actual_Qty: qty,
          quantity: qty,
          Cac_Ma_SP_Da_Chay: pCode,
          Tong_San_Luong_Thuc_Te: qty,
          startOutput: state.start_output_str || '',
          isClosed: true,
          timestamp: new Date().toISOString()
        };

        const existingIdx = db.hourlyHistory!.findIndex(
          (h: any) => h.date === closedDate && h.hour === closedHour && h.lineId === lineId && (h.productCode === pCode || h.Product_Code === pCode)
        );
        if (existingIdx >= 0) {
          db.hourlyHistory![existingIdx] = historyRecord;
        } else {
          db.hourlyHistory!.unshift(historyRecord);
        }
      });

      if (!hasValidProducts) {
        const stopRecord = {
          id: `close-${closedDate}-${closedHour}-${lineId}-stopped`,
          date: closedDate,
          hour: closedHour,
          Khung_Gio: hourLabel,
          Time_Frame: hourLabel,
          hourLabel: hourLabel,
          lineId: lineId,
          Line_Name: FACTORY_LINE_NAMES[lineId] || `Line ${lineId}`,
          Product_Code: 'Dừng chuyền / Không có sản lượng',
          productCode: 'Dừng chuyền / Không có sản lượng',
          Changeover_Time: `${String(closedHour).padStart(2, '0')}:00:00`,
          changeoverTime: `${String(closedHour).padStart(2, '0')}:00:00`,
          Actual_Qty: 0,
          quantity: 0,
          Cac_Ma_SP_Da_Chay: 'Dừng chuyền / Không có sản lượng',
          Tong_San_Luong_Thuc_Te: 0,
          startOutput: state.start_output_str || '',
          isClosed: true,
          timestamp: new Date().toISOString()
        };

        const existingIdx = db.hourlyHistory!.findIndex(
          (h: any) => h.date === closedDate && h.hour === closedHour && h.lineId === lineId
        );
        if (existingIdx >= 0) {
          db.hourlyHistory![existingIdx] = stopRecord;
        } else {
          db.hourlyHistory!.unshift(stopRecord);
        }
      }

      // Giữ lưu trữ lịch sử lâu dài để xem lại mọi ngày
      if (db.hourlyHistory!.length > 5000) db.hourlyHistory!.pop();

      // Clean up the old single aggregated bucket if it exists
      const oldBucketKey = `${closedDate}_${closedHour}_${lineId}`;
      if (db.realtimeHourlyBuckets![oldBucketKey]) {
        delete db.realtimeHourlyBuckets![oldBucketKey];
      }

      productCodesList.forEach(pCode => {
        const qty = counts[pCode] || 0;
        if (qty <= 0) return;
        const bucketKey = `${closedDate}_${closedHour}_${lineId}_${pCode}`;
        const changeoverTimeVal = state.product_changeover_times?.[pCode] || `${String(closedHour).padStart(2, '0')}:00:00`;
        db.realtimeHourlyBuckets![bucketKey] = {
          date: closedDate,
          hour: closedHour,
          hourLabel: hourLabel,
          lineId: lineId,
          productCode: pCode,
          changeoverTime: changeoverTimeVal,
          quantity: qty,
          startOutput: state.start_output_str || '',
          isClosed: true,
          isRunning: false
        };
      });

      console.log(`[TAM & TRINH - CHỐT GIỜ :00] Line ${lineId} [${closedDate} ${hourLabel}] Products:`, counts);

      // Reset hourly_total và product_hourly_counts cho khung giờ tiếp theo
      state.hourly_total = 0;
      state.product_hourly_counts = {};
      state.products_in_hour = [];
      state.product_changeover_times = {};
      state.current_hour = currentHour;
      state.current_date = currentProdDate;
      state.start_output_str = '';

      saveDb();
    }
  });

  // Sau khi đã chốt giờ cũ an toàn, nếu bước sang 6h00 thì chạy reset ca ngày mới
  checkAndPerformDailyReset(vnTime);
}

function updateCurrentHourBucket(lineId: string, state: any, vnTime: Date, rawOutputStr?: string) {
  const currentHour = vnTime.getHours();
  const currentProdDate = getVietnamProductionDate(vnTime);
  const hourLabel = `${String(currentHour).padStart(2, '0')}:00 - ${String((currentHour + 1) % 24).padStart(2, '0')}:00`;
  
  db.realtimeHourlyBuckets = db.realtimeHourlyBuckets || {};
  
  // Clean up any old aggregated bucket to prevent duplicates
  const oldAggregatedKey = `${currentProdDate}_${currentHour}_${lineId}`;
  if (db.realtimeHourlyBuckets[oldAggregatedKey]) {
      delete db.realtimeHourlyBuckets[oldAggregatedKey];
  }

  const counts = state.product_hourly_counts || {};
  const productCodesList = Object.keys(counts);
  
  if (productCodesList.length === 0 && (state.hourly_total || 0) > 0) {
      const pCode = state.last_product_code || 'UNKNOWN';
      counts[pCode] = state.hourly_total;
      productCodesList.push(pCode);
  } else if (productCodesList.length === 0) {
      // Just create one with 0 for the active code if nothing yet
      const pCode = state.last_product_code || '---';
      const bucketKey = `${currentProdDate}_${currentHour}_${lineId}_${pCode}`;
      let changeoverTimeVal = state.product_changeover_times?.[pCode];
      if (!changeoverTimeVal || changeoverTimeVal === '---') {
        changeoverTimeVal = `${String(currentHour).padStart(2, '0')}:00:00`;
      }
      db.realtimeHourlyBuckets[bucketKey] = {
        date: currentProdDate,
        hour: currentHour,
        hourLabel: hourLabel,
        lineId: lineId,
        productCode: pCode,
        changeoverTime: changeoverTimeVal,
        quantity: 0,
        startOutput: state.start_output_str || rawOutputStr || `${state.last_actual}`,
        isClosed: false,
        isRunning: true
      };
      return;
  }

  productCodesList.forEach(pCode => {
    const qty = counts[pCode] || 0;
    const bucketKey = `${currentProdDate}_${currentHour}_${lineId}_${pCode}`;
    let changeoverTimeVal = state.product_changeover_times?.[pCode];
    if (!changeoverTimeVal || changeoverTimeVal === '---') {
      changeoverTimeVal = `${String(currentHour).padStart(2, '0')}:00:00`;
    }
    const isRunningCode = (pCode === state.last_product_code);
    db.realtimeHourlyBuckets![bucketKey] = {
      date: currentProdDate,
      hour: currentHour,
      hourLabel: hourLabel,
      lineId: lineId,
      productCode: pCode,
      changeoverTime: changeoverTimeVal,
      quantity: qty,
      startOutput: state.start_output_str || rawOutputStr || `${state.last_actual}`,
      isClosed: false,
      isRunning: isRunningCode
    };
  });
}

function processTrinhCounter(
  lineId: string,
  curr_actual: number,
  curr_product_code: string,
  rawOutputStr?: string,
  actualStartTime?: string
) {
  if (isNaN(curr_actual) || !lineId) return;

  const vnTime = getVietnamTime();
  const currentHour = vnTime.getHours();
  const currentProdDate = getVietnamProductionDate(vnTime);

  db.trinhStates = db.trinhStates || {};

  // Check hour transition first (:00 phút hàng giờ hoặc 6h00 sáng)
  checkAndCloseHourlyBuckets(vnTime);

  let state = db.trinhStates[lineId];
  if (!state) {
    state = {
      lineId,
      last_actual: curr_actual,
      last_product_code: curr_product_code || '',
      hourly_total: 0,
      product_hourly_counts: {},
      product_changeover_times: {},
      products_in_hour: curr_product_code ? [curr_product_code] : [],
      current_hour: currentHour,
      current_date: currentProdDate,
      start_output_str: rawOutputStr || `${curr_actual}`,
      last_update: new Date().toISOString(),
      initialized: false
    };
    db.trinhStates[lineId] = state;
  }

  if (!state.product_hourly_counts) {
    state.product_hourly_counts = {};
  }
  if (!state.product_changeover_times) {
    state.product_changeover_times = {};
  }

  const timeStr = `${String(currentHour).padStart(2, '0')}:${String(vnTime.getMinutes()).padStart(2, '0')}:${String(vnTime.getSeconds()).padStart(2, '0')}`;
  const effectiveStartTime = actualStartTime || timeStr;

  let delta = 0;

  // Khởi tạo lần đầu nếu chưa initialized
  if (!state.initialized) {
    delta = 0; // Ngăn chặn việc cộng dồn toàn bộ số lượng (lũy kế cũ) vào giờ hiện tại khi vừa khởi động
    state.last_actual = curr_actual;
    state.last_product_code = curr_product_code || '';
    state.start_output_str = rawOutputStr || `${curr_actual}`;
    state.initialized = true;
    if (curr_product_code) {
      if (!state.products_in_hour.includes(curr_product_code)) {
        state.products_in_hour.push(curr_product_code);
      }
      state.product_changeover_times[curr_product_code] = actualStartTime || `${String(currentHour).padStart(2, '0')}:00:00`;
    }
  } else {
    if (curr_product_code && state.last_product_code && curr_product_code !== state.last_product_code) {
      console.log(`[TRINH - BƯỚC 1: ĐỔI MÃ SP] Line ${lineId}: ${state.last_product_code} -> ${curr_product_code}, last=${state.last_actual}, curr=${curr_actual}`);
      // Chỉ lấy delta = curr_actual nếu số mới rất nhỏ (mới chạy). Nếu lớn, đây là WO cũ (resume) -> delta = 0 để tránh gộp lũy kế.
      delta = (curr_actual < 50) ? curr_actual : 0;
      state.product_changeover_times[curr_product_code] = effectiveStartTime;
    }
    else if (curr_actual < state.last_actual) {
      console.log(`[TRINH - BƯỚC 2: RESET MÁY / SANG LOT] Line ${lineId}: ${state.last_actual} -> ${curr_actual}`);
      delta = (curr_actual < 50) ? curr_actual : 0;
      const activeP = curr_product_code || state.last_product_code;
      if (activeP) {
        state.product_changeover_times[activeP] = effectiveStartTime;
      }
    }
    else if (curr_actual >= state.last_actual) {
      delta = curr_actual - state.last_actual;
      if (actualStartTime && curr_product_code) {
        state.product_changeover_times[curr_product_code] = actualStartTime;
      }
    }
  }

  if (delta > 0) {
    state.hourly_total += delta;
    const activePCode = curr_product_code || state.last_product_code || 'UNKNOWN';
    state.product_hourly_counts[activePCode] = (state.product_hourly_counts[activePCode] || 0) + delta;

    if (curr_product_code && !state.products_in_hour.includes(curr_product_code)) {
      state.products_in_hour.push(curr_product_code);
      state.product_changeover_times[curr_product_code] = state.product_changeover_times[curr_product_code] || effectiveStartTime;
    }

    db.realtimeHourlyEvents = db.realtimeHourlyEvents || [];
    db.realtimeHourlyEvents.unshift({
      timestamp: new Date().toISOString(),
      lineId,
      productCode: activePCode,
      quantity: delta
    });
    if (db.realtimeHourlyEvents.length > 200) {
      db.realtimeHourlyEvents.pop();
    }
  }

  state.last_actual = curr_actual;
  if (curr_product_code) {
    state.last_product_code = curr_product_code;
  }
  state.last_update = new Date().toISOString();

  updateCurrentHourBucket(lineId, state, vnTime, rawOutputStr);
}

function getCombinedLogsForLine(lineId: string) {
  db.lineStatusLogs = db.lineStatusLogs || {};
  db.activeLineSegments = db.activeLineSegments || {};

  const closedLogs = (db.lineStatusLogs[lineId] || []).filter(
    l => l && (l.statusType === 'REST' || l.statusType === 'STOP')
  );
  const active = db.activeLineSegments[lineId];

  const statusVnMap: Record<string, string> = {
    'REST': 'Nghỉ ca',
    'STOP': 'Dừng máy'
  };

  if (active && (active.statusType === 'REST' || active.statusType === 'STOP')) {
    const startTime = new Date(active.startTimeIso).getTime();
    const durationMinutes = Math.max(1, Math.round((Date.now() - startTime) / 60000));
    const formattedStart = formatVietnamTime(new Date(active.startTimeIso));
    const activeLog = {
      id: `active-${lineId}`,
      lineId,
      date: active.date || getVietnamTime().toISOString().split('T')[0],
      statusType: active.statusType,
      statusVn: statusVnMap[active.statusType] || 'Hoạt động',
      timeRange: `${formattedStart} - Hiện tại`,
      durationMinutes: durationMinutes || 1,
      note: active.statusType === 'REST' ? 'Nghỉ ca (Đang diễn ra)' : 'Dừng máy (Đang diễn ra)',
      timestamp: new Date().toISOString(),
      isOngoing: true
    };
    return [...closedLogs, activeLog];
  }

  return closedLogs;
}

let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function extractDataWithGemini(html: string) {
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const prompt = `
Given the following text/HTML extracted from a production dashboard, find the table containing "TÌNH TRẠNG DÂY CHUYỀN" (Line Status).
I want you to extract the rows into a JSON array. Return ONLY valid JSON array and nothing else.
If you cannot find the table, return an empty array [].
The JSON array should have objects with the following keys:
- timeRange (string, e.g. "14:02-15:41")
- productCode (string, e.g. "3195349")
- completion (string, e.g. "40.4%")
- efficiency (string, e.g. "88%")
- output (string, e.g. "97/240")
- status (string, e.g. "Running")

Wait, some fields might be slightly different. Here is the exact structure I need based on the columns: Giờ chạy, Mã SP, Hoàn thành, Hiệu suất, Sản lượng, Trạng thái.

Text/HTML:
${html.substring(0, 15000)} // Truncating to avoid token limit if it's too big, though 15k is safe.
`;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json"
        }
    });
    
    let jsonStr = response.text || "[]";
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Failed to parse JSON from Gemini", e);
        return [];
    }
  } catch (err) {
    console.error("Gemini error", err);
    throw err;
  }
}

function calculateHourlyOutput(data: any[]) {
    return data.map(row => {
        try {
            if (!row.timeRange || !row.output) return { ...row };
            
            // timeRange "14:02-15:41"
            const [start, end] = row.timeRange.split('-');
            const [startH, startM] = start.split(':').map(Number);
            const [endH, endM] = end.split(':').map(Number);
            
            let startMinutes = startH * 60 + startM;
            let endMinutes = endH * 60 + endM;
            if (endMinutes < startMinutes) endMinutes += 24 * 60; // handle crossing midnight
            
            const durationHours = (endMinutes - startMinutes) / 60;
            
            return {
                ...row,
                durationHours: Number(durationHours.toFixed(2))
            };
        } catch (e) {
            return { ...row };
        }
    });
}

// API Routes
app.get('/api/config', (req, res) => {
  res.json(db.config);
});

async function fetchAndProcessData(targetUrl: string, rawHtml?: string) {
    let htmlToParse = rawHtml;
    
    // If the user pasted the URL directly into the raw HTML text area, let's catch it.
    let effectiveUrl = targetUrl;
    if (rawHtml && rawHtml.trim().startsWith('http') && rawHtml.includes('andon-vn.aristongroup.com/msg_line')) {
        effectiveUrl = rawHtml.trim();
        htmlToParse = ''; // Don't try to parse the URL string as HTML
    }
    
    if (!htmlToParse && effectiveUrl && effectiveUrl.includes('andon-vn.aristongroup.com/msg_line')) {
        const urlObj = new URL(effectiveUrl);
        const lineId = urlObj.searchParams.get('LineId');
        
        if (lineId) {
            const apiRes = await axios.post(
                'https://andon-vn.aristongroup.com/Mes_Msg_Statistic/Load_Msg_Line',
                `LineId=${lineId}&checkPass=false`,
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );
            
            const data = apiRes.data;
            if (data && data.DATA && data.DATA.MES_MSG_LINE_DETAIL) {
                const details = data.DATA.MES_MSG_LINE_DETAIL;
                
                const extracted = details.map((item: any) => {
                    const formatTime = (isoString: string) => {
                        if (!isoString) return '';
                        const d = new Date(isoString);
                        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                    };
                    
                    const timeRange = `${formatTime(item.STARTED)}-${formatTime(item.FINISHED)}`;
                    return {
                        timeRange: timeRange,
                        productCode: item.PRODUCT_CODE || '',
                        completion: (item.PLAN_RATE || 0) + '%',
                        efficiency: (item.OEE || 0) + '%',
                        output: `${item.ACTUAL_QUANTITY || 0}/${item.PLAN_QUANTITY || item.TARGET_QUANTITY || 0}`,
                        status: item.STATUS_NAME || 'Finished'
                    };
                });
                
                return calculateHourlyOutput(extracted);
            }
        }
    }
    
    if (!htmlToParse && effectiveUrl) {
        const fetchRes = await axios.get(effectiveUrl, { timeout: 10000 });
        htmlToParse = fetchRes.data;
    }
    
    if (!htmlToParse) {
        throw new Error("No URL or raw HTML provided");
    }
    
    const extracted = await extractDataWithGemini(htmlToParse);
    return calculateHourlyOutput(extracted);
}

function getCounterKey(lineId: string, productCode: string, timeRange: string) {
  const startPart = timeRange ? timeRange.split('-')[0] : 'batch';
  return `${lineId}-${productCode}-${startPart}`;
}

let lastDashboardFetchTime = 0;

async function fetchAndonDashboard() {
  const username = db.config.username || 'bangnv';
  const password = db.config.password || '123';
  if (!username || !password) return;

  try {
    const homeRes = await axios.get('https://andon-vn.aristongroup.com/', { timeout: 5000 });
    const cookies = homeRes.headers['set-cookie'] || [];
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

    await axios.post('https://andon-vn.aristongroup.com/Login/Login/', {
      UserId: username,
      Password: password,
      Language: 'VN',
      CheckDomain: ''
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
        'Referer': 'https://andon-vn.aristongroup.com/'
      },
      timeout: 5000
    });

    const today = new Date();
    const formattedDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    const dbRes = await axios.get('https://andon-vn.aristongroup.com/Mes_Msg_Statistic/LoadDataDashBoard', {
      params: {
        day_start: formattedDate,
        day_end: formattedDate
      },
      headers: {
        'Cookie': cookieHeader,
        'Referer': 'https://andon-vn.aristongroup.com/'
      },
      timeout: 5000
    });

    if (dbRes.data && dbRes.data.MES_WORK_PLAN) {
      db.andonDashboard = dbRes.data;
      console.log(`[DASHBOARD SYNC] Successfully loaded advanced dashboard data for ${formattedDate}`);
    }
  } catch (err: any) {
    console.error("[DASHBOARD SYNC ERROR]:", err.message);
  }
}

const ALL_CLOUD_LINES = ['1', '2', '4', '7', '8', '11', '9'];

let isSyncing = false;

async function syncCloudLive() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const lineIds = [...ALL_CLOUD_LINES];
    if (db.config.url) {
      try {
        const u = new URL(db.config.url);
        const customLineId = u.searchParams.get('LineId');
        if (customLineId && !lineIds.includes(customLineId)) {
          lineIds.push(customLineId);
        }
      } catch (e) {}
    }

    const now = Date.now();
    if (now - lastDashboardFetchTime > 60 * 1000) {
      lastDashboardFetchTime = now;
      fetchAndonDashboard().catch(() => {});
    }

    if (!db.counters) db.counters = {};
    if (!db.latestLineData) db.latestLineData = {};
    if (!db.hourlySummaries) db.hourlySummaries = [];
    if (!db.lineStatuses) db.lineStatuses = {};

    // Fetch all lines in parallel using Promise.all
    await Promise.all(
      lineIds.map(async (lineId) => {
        try {
          const apiRes = await axios.post(
            'https://andon-vn.aristongroup.com/Mes_Msg_Statistic/Load_Msg_Line',
            `LineId=${lineId}&checkPass=false`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 4000 }
          );

          const data = apiRes.data;

          // Track rich status directly from Andon MES_MSG_LINE
          let statusInfo: {
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
          } = {
            isRunning: false,
            isStopped: false,
            isNoPlan: false,
            isResting: false,
            eventVn: 'Không có dữ liệu',
            eventEn: 'NO DATA',
            reasonVn: '',
            stopDuration: 0,
            numberOfStops: 0,
            color: '#64748b',
            restNote: '',
            breakTimeRange: ''
          };

          if (data && data.DATA && data.DATA.MES_MSG_LINE && data.DATA.MES_MSG_LINE.length > 0) {
            const lInfo = data.DATA.MES_MSG_LINE[0];
            const eventVn = lInfo.EVENTDEF_NAME_VN || '';
            const eventEn = (lInfo.EVENTDEF_NAME_EN || '').toUpperCase();
            const isRun = eventEn === 'RUNNING' || eventVn.toLowerCase().includes('chạy');
            const isStop = eventEn === 'STOP' || eventVn.toLowerCase().includes('dừng');
            const isNoPlan = eventEn === 'NO PLAN' || eventVn.toLowerCase().includes('không kế hoạch');
            const isRest = eventEn === 'BREAK' || eventEn === 'REST' || eventEn === 'IDLE' || eventVn.toLowerCase().includes('nghỉ');

            const isResting = isRest;

            statusInfo = {
              isRunning: isRun || (!isStop && !isResting),
              isStopped: isStop && !isResting,
              isNoPlan: isNoPlan,
              isResting: isResting,
              eventVn: isResting ? 'Đang Nghỉ Ca' : (eventVn || (isStop ? 'Dừng' : 'Chạy')),
              eventEn: isResting ? 'REST / BREAK' : (eventEn || (isStop ? 'STOP' : 'RUNNING')),
              reasonVn: lInfo.REASON_NAME_VN || (isResting ? 'Nghỉ giữa ca' : ''),
              stopDuration: lInfo.STOP_DURATION || (isResting ? 60 : 0),
              numberOfStops: lInfo.NUMBER_OF_STOP || 0,
              color: isResting ? '#f59e0b' : (lInfo.EVENTDEF_COLOR || (isStop ? '#f5350a' : '#22b23c')),
              restNote: (db.lineStatuses[lineId]?.restNote) || 'Thời gian nghỉ giữa ca',
              breakTimeRange: (db.lineStatuses[lineId]?.breakTimeRange) || ''
            };
          } else if (data && data.DATA && data.DATA.MES_MSG_LINE_DETAIL && data.DATA.MES_MSG_LINE_DETAIL.length > 0) {
            const hasRunning = data.DATA.MES_MSG_LINE_DETAIL.some((d: any) => (d.STATUS_NAME || '').toLowerCase().includes('run'));
            const isResting = !hasRunning && (data.DATA.MES_MSG_LINE_DETAIL.some((d: any) => (d.STATUS_NAME || '').toLowerCase().includes('rest') || (d.STATUS_NAME || '').toLowerCase().includes('break')));
            statusInfo.isRunning = hasRunning || !isResting;
            statusInfo.isResting = isResting;
            statusInfo.eventVn = isResting ? 'Đang Nghỉ Ca' : 'Chạy';
            statusInfo.eventEn = isResting ? 'REST / BREAK' : 'RUNNING';
            statusInfo.color = isResting ? '#f59e0b' : '#22b23c';
            statusInfo.restNote = (db.lineStatuses[lineId]?.restNote) || '';
            statusInfo.breakTimeRange = (db.lineStatuses[lineId]?.breakTimeRange) || '';
          } else {
            statusInfo = {
              isRunning: true,
              isStopped: false,
              isNoPlan: false,
              isResting: false,
              eventVn: 'Chạy',
              eventEn: 'RUNNING',
              reasonVn: '',
              stopDuration: 0,
              numberOfStops: 0,
              color: '#22b23c',
              restNote: '',
              breakTimeRange: ''
            };
          }
          db.lineStatuses[lineId] = statusInfo;
          updateRealtimeLineStatusLog(lineId, statusInfo);

          if (data && data.DATA && data.DATA.MES_MSG_LINE_DETAIL) {
            const currentProdDate = getVietnamProductionDate();
            // Lọc dữ liệu: Chỉ lấy những bản ghi thuộc ngày sản xuất hiện tại
            const details = (data.DATA.MES_MSG_LINE_DETAIL || []).filter((item: any) => {
              if (!item.STARTED && !item.FINISHED) return true; // Giữ lại nếu không có mốc thời gian (an toàn)
              const itemDate = getProductionDateFromIso(item.STARTED || item.FINISHED);
              return itemDate === currentProdDate;
            });

            const extracted = details.map((item: any) => {
              const formatTime = (isoString: string) => {
                if (!isoString) return '';
                const match = String(isoString).match(/(\d{2}):(\d{2})/);
                if (match) return `${match[1]}:${match[2]}`;
                const d = new Date(isoString);
                return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
              };

              const startedTimeStr = extractTimeStrFromIso(item.STARTED);
              const finishedTimeStr = extractTimeStrFromIso(item.FINISHED);

              return {
                timeRange: `${formatTime(item.STARTED)}-${formatTime(item.FINISHED)}`,
                productCode: item.PRODUCT_CODE || '',
                manpower: item.HEAD_COUNT || 0,
                completion: (item.PLAN_RATE || 0) + '%',
                efficiency: (item.OEE || 0) + '%',
                output: `${item.ACTUAL_QUANTITY || 0}/${item.PLAN_QUANTITY || item.TARGET_QUANTITY || 0}`,
                status: item.STATUS_NAME || 'Finished',
                started: item.STARTED || '',
                finished: item.FINISHED || '',
                startedTime: startedTimeStr,
                finishedTime: finishedTimeStr
              };
            });

            const processed = calculateHourlyOutput(extracted);

            // ==========================================
            // CẬP NHẬT BỘ ĐẾM REALTIME "TRINH" (Core Logic)
            // ==========================================
            try {
              // Pre-fill / update real changeover times from MES for all today products
              if (db.trinhStates && db.trinhStates[lineId]) {
                db.trinhStates[lineId].product_changeover_times = db.trinhStates[lineId].product_changeover_times || {};
                extracted.forEach((r: any) => {
                  const pCode = String(r.productCode || '').trim();
                  if (pCode && r.startedTime) {
                    db.trinhStates![lineId].product_changeover_times![pCode] = r.startedTime;
                  }
                });
              }

              // Lấy bản ghi đang chạy (Running) hoặc bản ghi mới nhất (phần tử cuối danh sách, hoặc item có started mới nhất)
              let activeRow = extracted.find((r: any) => (r.status || '').toLowerCase().includes('run'));
              if (!activeRow && extracted.length > 0) {
                // Nếu không có dòng nào Running, lấy dòng trên cùng trong danh sách (vì danh sách sắp xếp mới nhất ở trên)
                activeRow = extracted[0];
              }
              if (activeRow) {
                const parts = (activeRow.output || '').split('/');
                const curr_actual = parseInt(parts[0], 10) || 0;
                const curr_product_code = String(activeRow.productCode || '').trim();

                // Sanitize products_in_hour: Chỉ giữ lại các mã thực sự có trong extracted (đã lọc theo ngày)
                if (db.trinhStates && db.trinhStates[lineId]) {
                  const allTodayCodes = extracted.map(r => String(r.productCode || '').trim()).filter(Boolean);
                  db.trinhStates[lineId].products_in_hour = (db.trinhStates[lineId].products_in_hour || [])
                    .filter(p => allTodayCodes.includes(p));
                }

                processTrinhCounter(lineId, curr_actual, curr_product_code, activeRow.output, activeRow.startedTime);
              }
            } catch (trinhErr) {
              console.error(`[TRINH ERROR] Line ${lineId}:`, trinhErr);
            }

            // Update legacy counters on cloud (Disabled to prevent duplicate double-counting)
            /*
            processed.forEach((row: any) => {
               ...
            });
            */

            const record = {
              id: `${lineId}-${now}-${Math.random().toString(36).substring(2, 6)}`,
              timestamp: new Date().toISOString(),
              lineId,
              data: processed
            };

            db.latestLineData[lineId] = record;

            // Push to history if history is empty or last record for line is > 5 mins old
            const existingLast = db.history.find((h: any) => h.lineId === lineId || (!h.lineId && lineId === '7'));
            if (!existingLast || (now - new Date(existingLast.timestamp).getTime() > 5 * 60 * 1000)) {
              db.history.unshift(record);
              if (db.history.length > 50) db.history.pop();
            }
          }
        } catch (innerError) {
          // Ignore individual line fetch timeout / connection issues to keep other lines updating
        }
      })
    );

    saveDb();
  } catch (e) {
    console.error("Critical error in syncCloudLive", e);
  } finally {
    isSyncing = false;
  }
}

// Continuously poll on Cloud every 2000ms (2s)
setInterval(syncCloudLive, 2000);
syncCloudLive();

// Periodically check and trigger automatic hour closing at :00 every 5 seconds
setInterval(() => {
  try {
    checkAndCloseHourlyBuckets(getVietnamTime());
  } catch (err) {
    console.error("Error in checkAndCloseHourlyBuckets interval:", err);
  }
}, 5000);

let currentCronJob: ScheduledTask | null = null;

function setupCron() {
    if (currentCronJob) {
        currentCronJob.stop();
    }
    
/* 
    if (db.config.cronTime && db.config.url) {
        try {
            currentCronJob = schedule(db.config.cronTime, async () => {
                try {
                    console.log("Running scheduled fetch...");
                    const processed = await fetchAndProcessData(db.config.url);
                    
                    db.history.unshift({
                        id: Date.now().toString(),
                        timestamp: new Date().toISOString(),
                        data: processed
                    });
                    if (db.history.length > 30) db.history.pop();
                    saveDb();
                    console.log("Scheduled fetch completed.");
                } catch (e) {
                    console.error("Scheduled fetch failed:", e);
                }
            });
            console.log(`Cron scheduled at: ${db.config.cronTime}`);
        } catch (e) {
            console.error("Invalid cron time:", db.config.cronTime);
        }
    }
    */
}
setupCron();

app.get('/api/live-status', (req, res) => {
  const lineId = (req.query.lineId as string) || '7';
  const lineRecord = db.latestLineData?.[lineId] || null;
  res.json({
    lineId,
    record: lineRecord,
    latestLineData: db.latestLineData || {},
    counters: db.counters || {},
    hourlySummaries: db.hourlySummaries || [],
    lineStatuses: db.lineStatuses || {},
    andonDashboard: db.andonDashboard || null,
    realtimeHourlyBuckets: db.realtimeHourlyBuckets || {},
    realtimeHourlyEvents: db.realtimeHourlyEvents || [],
    trinhStates: db.trinhStates || {},
    hourlyHistory: db.hourlyHistory || [],
    isCloudSyncing: true,
    serverTime: new Date().toISOString()
  });
});

app.post('/api/update-line-rest', (req, res) => {
  const { lineId, restNote, breakTimeRange, isResting } = req.body;
  if (!lineId) return res.status(400).json({ error: 'Missing lineId' });
  if (!db.lineStatuses[lineId]) {
    db.lineStatuses[lineId] = {
      isRunning: false,
      isStopped: false,
      isNoPlan: false,
      isResting: true,
      eventVn: 'Đang Nghỉ Ca',
      eventEn: 'REST / BREAK',
      reasonVn: 'Nghỉ ca',
      stopDuration: 60,
      numberOfStops: 0,
      color: '#f59e0b'
    };
  }
  if (restNote !== undefined) db.lineStatuses[lineId].restNote = restNote;
  if (breakTimeRange !== undefined) db.lineStatuses[lineId].breakTimeRange = breakTimeRange;
  if (isResting !== undefined) db.lineStatuses[lineId].isResting = isResting;
  saveDb();
  res.json({ success: true, lineStatus: db.lineStatuses[lineId] });
});

app.get('/api/line-status-logs', (req, res) => {
  const lineId = req.query.lineId as string;
  if (lineId) {
    return res.json({ logs: getCombinedLogsForLine(lineId) });
  }
  db.lineStatusLogs = db.lineStatusLogs || {};
  res.json({ logs: db.lineStatusLogs });
});

app.post('/api/simulate-line-status', (req, res) => {
  const { lineId, statusType, reason } = req.body;
  if (!lineId || !statusType) return res.status(400).json({ error: 'Missing parameters' });

  const isRun = statusType === 'RUNNING';
  const isStop = statusType === 'STOP';
  const isRest = statusType === 'REST';
  const isNoPlan = statusType === 'NOPLAN';

  const statusInfo = {
    isRunning: isRun,
    isStopped: isStop,
    isNoPlan: isNoPlan,
    isResting: isRest,
    eventVn: isRest ? 'Đang Nghỉ Ca' : isRun ? 'Chạy' : isStop ? 'Dừng Máy' : 'Chờ',
    eventEn: statusType,
    reasonVn: reason || (isRest ? 'Nghỉ giữa ca' : isStop ? 'Dừng máy kỹ thuật' : ''),
    stopDuration: isStop ? 15 : isRest ? 30 : 0,
    numberOfStops: isStop ? 1 : 0,
    color: isRest ? '#f59e0b' : isStop ? '#f5350a' : isRun ? '#22b23c' : '#64748b',
    restNote: isRest ? 'Nghỉ ca giữa ca' : '',
    breakTimeRange: ''
  };

  db.lineStatuses[lineId] = statusInfo;
  updateRealtimeLineStatusLog(lineId, statusInfo);

  res.json({ success: true, lineStatus: statusInfo, logs: getCombinedLogsForLine(lineId) });
});

app.post('/api/line-status-logs', (req, res) => {
  const { lineId, statusType, statusVn, timeRange, durationMinutes, note, reason, date } = req.body;
  if (!lineId) return res.status(400).json({ error: 'Missing lineId' });
  db.lineStatusLogs = db.lineStatusLogs || {};
  if (!db.lineStatusLogs[lineId]) db.lineStatusLogs[lineId] = [];

  const newLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    lineId,
    date: date || new Date().toISOString().split('T')[0],
    statusType: statusType || 'REST',
    statusVn: statusVn || (statusType === 'REST' ? 'Nghỉ ca' : statusType === 'RUNNING' ? 'Đang chạy' : statusType === 'STOP' ? 'Dừng máy' : 'Chờ'),
    timeRange: timeRange || '11:30 - 12:00',
    durationMinutes: Number(durationMinutes) || 30,
    note: note || '',
    reason: reason || '',
    timestamp: new Date().toISOString()
  };

  db.lineStatusLogs[lineId].push(newLog);
  saveDb();
  res.json({ success: true, log: newLog, logs: db.lineStatusLogs[lineId] });
});

app.delete('/api/line-status-logs', (req, res) => {
  const { lineId, logId } = req.body;
  if (!lineId || !logId) return res.status(400).json({ error: 'Missing parameters' });
  db.lineStatusLogs = db.lineStatusLogs || {};
  if (db.lineStatusLogs[lineId]) {
    db.lineStatusLogs[lineId] = db.lineStatusLogs[lineId].filter((l: any) => l.id !== logId);
    saveDb();
  }
  res.json({ success: true, logs: db.lineStatusLogs[lineId] || [] });
});

app.post('/api/config', (req, res) => {
  const { url, cronTime, username, password } = req.body;
  if (url !== undefined) db.config.url = url;
  if (cronTime !== undefined) db.config.cronTime = cronTime;
  if (username !== undefined) db.config.username = username;
  if (password !== undefined) db.config.password = password;
  saveDb();
  setupCron(); // Re-apply cron
  
  // Instantly trigger dashboard fetch if credentials change
  if (username !== undefined || password !== undefined) {
    lastDashboardFetchTime = 0; // force fetch on next cycle
  }
  
  res.json(db.config);
});

app.post('/api/fetch', async (req, res) => {
  const { url, rawHtml } = req.body;
  const targetUrl = url || db.config.url;
  
  try {
      const processed = await fetchAndProcessData(targetUrl, rawHtml);
      
      const record = {
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          data: processed
      };
      
      db.history.unshift(record);
      if (db.history.length > 30) db.history.pop();
      saveDb();
      
      res.json(record);
  } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message || "Lỗi khi lấy dữ liệu" });
  }
});

app.get('/api/history', (req, res) => {
    res.json(db.history);
});

app.get('/api/export', (req, res) => {
    if (db.history.length === 0) {
        return res.status(400).json({ error: "Không có dữ liệu để xuất" });
    }
    
    // Get latest data or all data? Let's export the latest one for simplicity, or provide an ID
    const { id } = req.query;
    let targetData = id ? db.history.find(h => h.id === id) : db.history[0];
    
    if (!targetData) {
        return res.status(404).json({ error: "Không tìm thấy dữ liệu" });
    }
    
    const ws = xlsx.utils.json_to_sheet(targetData.data.map((row: any) => ({
        "Giờ chạy": row.timeRange,
        "Thời gian (Giờ)": row.durationHours,
        "Mã SP": row.productCode,
        "Hoàn thành": row.completion,
        "Hiệu suất": row.efficiency,
        "Sản lượng (Thực tế/Kế hoạch)": row.output,
        "Trạng thái": row.status
    })));
    
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Sản Lượng");
    
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename="san_luong_${new Date(targetData.timestamp).toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

// Setup cron
/*
cron.schedule(db.config.cronTime, async () => {
    if (!db.config.url) return;
    try {
        console.log("Running scheduled fetch...");
        const fetchRes = await axios.get(db.config.url);
        const extracted = await extractDataWithGemini(fetchRes.data);
        const processed = calculateHourlyOutput(extracted);
        
        db.history.unshift({
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            data: processed
        });
        if (db.history.length > 30) db.history.pop();
        saveDb();
        console.log("Scheduled fetch completed.");
    } catch (e) {
        console.error("Scheduled fetch failed:", e);
    }
});
*/

app.get('/api/export-tam-hourly', (req, res) => {
    const lineId = req.query.lineId as string;
    let records = db.hourlyHistory || [];
    if (lineId && lineId !== 'all') {
      records = records.filter((r: any) => r.lineId === lineId);
    }
    
    records = records.filter((r: any) => {
      const qty = r.Actual_Qty || r.Tong_San_Luong_Thuc_Te || r.quantity || 0;
      const pCode = r.Product_Code || r.productCode || r.Cac_Ma_SP_Da_Chay || '';
      if (qty <= 0 && !pCode.includes('Dừng chuyền') && !pCode.includes('Không có sản lượng')) {
        return false;
      }
      return true;
    });

    if (records.length === 0) {
        return res.status(400).json({ error: "Không có dữ liệu lịch sử giờ để xuất" });
    }
    
    const ws = xlsx.utils.json_to_sheet(records.map((row: any) => ({
        "Date": row.date || row.Date,
        "Line_Name": row.Line_Name || `Line ${row.lineId}`,
        "Time_Frame": row.Time_Frame || row.Khung_Gio || row.hourLabel,
        "Product_Code": row.Product_Code || row.productCode || row.Cac_Ma_SP_Da_Chay,
        "Changeover_Time": row.Changeover_Time || row.changeoverTime || `${row.hour ? String(row.hour).padStart(2, '0') : '08'}:00:00`,
        "Actual_Qty": row.Actual_Qty || row.Tong_San_Luong_Thuc_Te || row.quantity
    })));
    
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "LichSuGio");
    
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename="lich_su_san_luong_theo_gio_${lineId || 'all'}_${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
});

app.get('/api/export-tam-matrix', async (req, res) => {
    try {
        const selectedDate = (req.query.date as string) || new Date().toISOString().split('T')[0];
        const lineId = (req.query.lineId as string) || 'all';
        const search = (req.query.search as string) || '';

        let records = db.hourlyHistory || [];
        
        // Filter by date
        records = records.filter((r: any) => {
            const itemDate = r.date || r.Date;
            return itemDate === selectedDate;
        });

        // Filter by lineId
        if (lineId && lineId !== 'all') {
            records = records.filter((r: any) => r.lineId === lineId);
        }

        // Filter valid products and non-zero
        records = records.filter((r: any) => {
            const qty = r.Actual_Qty || r.Tong_San_Luong_Thuc_Te || r.quantity || 0;
            const pCode = r.Product_Code || r.productCode || r.Cac_Ma_SP_Da_Chay || '';
            if (qty <= 0 && !pCode.includes('Dừng chuyền') && !pCode.includes('Không có sản lượng')) {
                return false;
            }
            return true;
        });

        // Pivot calculation
        const map: Record<string, Record<number, number>> = {};
        records.forEach((r: any) => {
            const pCode = r.Product_Code || r.productCode || r.Cac_Ma_SP_Da_Chay;
            if (!pCode || pCode.includes('Dừng chuyền') || pCode.includes('Không có sản lượng')) return;
            
            const hour = r.hour !== undefined ? r.hour : parseInt(r.Time_Frame?.split(':')[0], 10);
            const qty = r.Actual_Qty || r.Tong_San_Luong_Thuc_Te || r.quantity || 0;
            
            if (qty > 0) {
                if (!map[pCode]) map[pCode] = {};
                map[pCode][hour] = (map[pCode][hour] || 0) + qty;
            }
        });

        // Nếu đang xuất ngày làm việc hiện tại, gộp thêm số liệu thực tế đang chạy trực tuyến ở khung giờ hiện tại
        const vnNow = getVietnamTime();
        const currentProdDate = getVietnamProductionDate(vnNow);
        if (selectedDate === currentProdDate && db.trinhStates) {
            const currHour = vnNow.getHours();
            Object.keys(db.trinhStates).forEach(lId => {
                if (lineId !== 'all' && lId !== lineId) return;
                const state = db.trinhStates![lId];
                if (!state) return;
                const counts = state.product_hourly_counts || {};
                Object.keys(counts).forEach(pCode => {
                    const qty = counts[pCode] || 0;
                    if (qty > 0) {
                        if (!map[pCode]) map[pCode] = {};
                        map[pCode][currHour] = (map[pCode][currHour] || 0) + qty;
                    }
                });
                if (Object.keys(counts).length === 0 && (state.hourly_total || 0) > 0 && state.last_product_code) {
                    const pCode = state.last_product_code;
                    if (!map[pCode]) map[pCode] = {};
                    map[pCode][currHour] = (map[pCode][currHour] || 0) + state.hourly_total;
                }
            });
        }

        let products = Object.keys(map).sort();
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            products = products.filter(p => p.toLowerCase().includes(q));
        }

        const MATRIX_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
        
        // Create Excel Workbook with exceljs
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Bao_Cao_San_Luong');

        // Style helper constants
        const headerFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1F4E78' } // Xanh đậm (Dark Blue)
        };
        const headerFont = {
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: 'FFFFFFFF' } // Chữ trắng
        };
        const totalRowFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFD966' } // Màu vàng nổi bật (#FFD966)
        };
        const totalColumnFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' } // Màu xám nhạt cho cột Grand Total
        };

        // Columns definition
        const columns = [
            { header: 'PRODUCTCODE', key: 'productCode', width: 20 },
            ...MATRIX_HOURS.map(h => ({ header: `${h}`, key: `h_${h}`, width: 6 })),
            { header: 'GRAND TOTAL', key: 'grandTotal', width: 16 }
        ];
        worksheet.columns = columns;

        // Apply styles to header row
        const headerRow = worksheet.getRow(1);
        headerRow.height = 28;
        headerRow.eachCell((cell) => {
            cell.fill = headerFill as any;
            cell.font = headerFont;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                bottom: { style: 'medium', color: { argb: 'FF000000' } },
                right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
            };
        });

        const colTotals: Record<number, number> = {};
        MATRIX_HOURS.forEach(h => { colTotals[h] = 0; });
        let overallGrandTotal = 0;

        // Add rows
        products.forEach(pCode => {
            const hoursMap = map[pCode] || {};
            let rowTotal = 0;
            const rowData: any = { productCode: pCode };

            MATRIX_HOURS.forEach(h => {
                const val = hoursMap[h] || 0;
                rowData[`h_${h}`] = val > 0 ? val : '';
                rowTotal += val;
                colTotals[h] += val;
            });
            rowData.grandTotal = rowTotal;
            overallGrandTotal += rowTotal;

            const newRow = worksheet.addRow(rowData);
            newRow.height = 20;

            // Alignments and borders
            newRow.eachCell((cell, colNumber) => {
                cell.font = { name: 'Calibri', size: 10 };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                    left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                    right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                };

                if (colNumber === 1) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left' };
                    cell.font = { name: 'Calibri', size: 10, bold: true };
                } else if (colNumber === columns.length) {
                    // GRAND TOTAL column
                    cell.alignment = { vertical: 'middle', horizontal: 'right' };
                    cell.font = { name: 'Calibri', size: 10, bold: true };
                    cell.fill = totalColumnFill as any;
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }
            });
        });

        // Add bottom GRAND TOTAL row
        const footerData: any = { productCode: 'GRAND TOTAL' };
        MATRIX_HOURS.forEach(h => {
            const colTot = colTotals[h] || 0;
            footerData[`h_${h}`] = colTot > 0 ? colTot : '';
        });
        footerData.grandTotal = overallGrandTotal;

        const footerRow = worksheet.addRow(footerData);
        footerRow.height = 24;

        footerRow.eachCell((cell, colNumber) => {
            cell.fill = totalRowFill as any;
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
            cell.alignment = {
                vertical: 'middle',
                horizontal: colNumber === 1 ? 'left' : (colNumber === columns.length ? 'right' : 'center')
            };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF000000' } },
                left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
                bottom: { style: 'double', color: { argb: 'FF000000' } }, // Viền kẻ kép dưới đáy
                right: { style: 'thin', color: { argb: 'FFB0B0B0' } }
            };
        });

        res.setHeader('Content-Disposition', `attachment; filename="Bao_Cao_Pivot_San_Luong_${lineId}_${selectedDate}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error: any) {
        console.error("Failed to export matrix Excel:", error);
        res.status(500).json({ error: "Lỗi tạo file Excel: " + error.message });
    }
});

// API Tổng Hợp Danh Mục Các Ngày Đã Lưu Trữ để Xem Lại Nhanh
app.get('/api/tam-daily-summary', (req, res) => {
  try {
    const history = db.hourlyHistory || [];
    const dateMap: Record<string, {
      date: string;
      totalQty: number;
      products: Set<string>;
      lines: Set<string>;
      hourlyTotals: Record<number, number>;
    }> = {};

    history.forEach((r: any) => {
      const d = r.date || r.Date;
      if (!d) return;
      const qty = r.Actual_Qty || r.Tong_San_Luong_Thuc_Te || r.quantity || 0;
      const pCode = r.Product_Code || r.productCode || r.Cac_Ma_SP_Da_Chay || '';
      const lId = r.lineId || '';
      const hour = r.hour !== undefined ? r.hour : parseInt(r.Time_Frame?.split(':')[0], 10);

      if (!dateMap[d]) {
        dateMap[d] = {
          date: d,
          totalQty: 0,
          products: new Set<string>(),
          lines: new Set<string>(),
          hourlyTotals: {}
        };
      }

      if (qty > 0 && !pCode.includes('Dừng chuyền') && !pCode.includes('Không có sản lượng')) {
        dateMap[d].totalQty += qty;
        if (pCode) dateMap[d].products.add(pCode);
        if (lId) dateMap[d].lines.add(lId);
        if (!isNaN(hour)) {
          dateMap[d].hourlyTotals[hour] = (dateMap[d].hourlyTotals[hour] || 0) + qty;
        }
      }
    });

    const vnNow = getVietnamTime();
    const currentProdDate = getVietnamProductionDate(vnNow);
    if (!dateMap[currentProdDate]) {
      dateMap[currentProdDate] = {
        date: currentProdDate,
        totalQty: 0,
        products: new Set<string>(),
        lines: new Set<string>(),
        hourlyTotals: {}
      };
    }

    // Add current working shift's live trinhStates if any
    if (db.trinhStates) {
      Object.keys(db.trinhStates).forEach(lId => {
        const state = db.trinhStates![lId];
        if (state && (state.hourly_total || 0) > 0) {
          dateMap[currentProdDate].totalQty += state.hourly_total;
          if (state.last_product_code) dateMap[currentProdDate].products.add(state.last_product_code);
          dateMap[currentProdDate].lines.add(lId);
        }
      });
    }

    const summaries = Object.keys(dateMap).sort().reverse().map(d => {
      const info = dateMap[d];
      let peakHour = 6;
      let maxHourQty = 0;
      Object.entries(info.hourlyTotals).forEach(([h, q]) => {
        if (q > maxHourQty) {
          maxHourQty = q;
          peakHour = parseInt(h, 10);
        }
      });

      return {
        date: d,
        totalQuantity: info.totalQty,
        productCount: info.products.size,
        linesCount: info.lines.size,
        peakHour: peakHour,
        peakHourQty: maxHourQty,
        isToday: d === currentProdDate
      };
    });

    res.json({ summaries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  if (firestoreDb) {
    try {
      console.log("[SERVER] Fetching persisted state from Firestore...");
      
      const mainSnap = await getDoc(doc(firestoreDb, 'serverState', 'main'));
      if (mainSnap.exists()) {
        const data = mainSnap.data();
        Object.assign(db, data);
      }
      
      const hourlyHistSnap = await getDoc(doc(firestoreDb, 'serverState', 'hourlyHistory'));
      if (hourlyHistSnap.exists()) {
        const histData = hourlyHistSnap.data();
        if (histData && histData.data) {
          db.hourlyHistory = histData.data;
        }
      }
      
      const histSnap = await getDoc(doc(firestoreDb, 'serverState', 'history'));
      if (histSnap.exists()) {
        const histData = histSnap.data();
        if (histData && histData.data) {
          db.history = histData.data;
        }
      }
      
      console.log("[SERVER] Successfully restored state from Firestore.");
    } catch (e) {
      console.error("[SERVER] Failed to restore from Firestore, falling back to local file:", e);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
