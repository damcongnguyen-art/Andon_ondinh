import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { DailyReportData } from '../types';

function getSheetNameFromDate(reportDateStr?: string): string {
  if (!reportDateStr || !reportDateStr.trim()) {
    const now = new Date();
    return `${now.getDate()}.${now.getMonth() + 1}`;
  }

  const str = reportDateStr.trim();

  // 1. YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = str.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})/);
  if (ymdMatch) {
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (!isNaN(day) && !isNaN(month)) {
      return `${day}.${month}`;
    }
  }

  // 2. DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY or DD/MM or DD.MM
  const dmyMatch = str.match(/^(\d{1,2})[-/. ](\d{1,2})(?:[-/. ]\d{2,4})?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    if (!isNaN(day) && !isNaN(month) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${day}.${month}`;
    }
  }

  // 3. Try standard Date parsing
  const parsedDate = new Date(str);
  if (!isNaN(parsedDate.getTime())) {
    return `${parsedDate.getDate()}.${parsedDate.getMonth() + 1}`;
  }

  // 4. Fallback sanitize for Excel sheet name limit & characters
  let cleanName = str.replace(/[:\\/?*\[\]]/g, '.').replace(/^'+|'+$/g, '');
  if (cleanName.length > 31) cleanName = cleanName.substring(0, 31);
  return cleanName || `${new Date().getDate()}.${new Date().getMonth() + 1}`;
}

export const exportToExcel = async (reportData: DailyReportData) => {
  const workbook = new ExcelJS.Workbook();
  const sheetName = getSheetNameFromDate(reportData.reportDate);
  const sheet = workbook.addWorksheet(sheetName);

  // Define 13 standard columns with explicit widths matching the unified UI grid
  sheet.columns = [
    { key: 'A', width: 10 }, // Col 1 (B): LINE / Trọng Lượng PU
    { key: 'B', width: 11 }, // Col 2 (C): CODE / TC
    { key: 'C', width: 10 }, // Col 3 (D): Model Name pt1 / Nhân Lực
    { key: 'D', width: 11 }, // Col 4 (E): Model Name pt2 / MODEL in T2
    { key: 'E', width: 8 },  // Col 5 (F): TIME in header / Model Name pt3 / TIME start
    { key: 'F', width: 8 },  // Col 6 (G): Nhân lực info / Plan / TIME end
    { key: 'G', width: 8 },  // Col 7 (H): Picking / Actual / STT start
    { key: 'H', width: 8 },  // Col 8 (I): nghỉ / Speed/H / STT end
    { key: 'I', width: 9 },  // Col 9 (J): Mượn / GAP / PCS/H
    { key: 'J', width: 9 },  // Col 10 (K): Chuyển hỗ trợ / Mục Tiêu
    { key: 'K', width: 10 }, // Col 11 (L): Tổng / Âm/Dương
    { key: 'L', width: 32 }, // Col 12 (M): TEAM pt1 / Tình Trạng
    { key: 'M', width: 10 }, // Col 13 (N): TEAM pt2 / PIG
  ];

  // Common styles
  const alignCenter: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'center', wrapText: true };
  const borderAll: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' }
  };
  
  const fontBold = { bold: true, name: 'Tahoma' };
  const fontRedBold = { bold: true, color: { argb: 'FFDC2626' }, name: 'Tahoma' }; // Tailwind red-600
  const fontBrownBold = { bold: true, color: { argb: 'FFC0504D' }, name: 'Tahoma' }; // Brownish-red #C0504D
  const fontBlueBold = { bold: true, color: { argb: 'FF0284C7' }, name: 'Tahoma' }; // Sky-600 #0284c7
  const fontNavyBold = { bold: true, color: { argb: 'FF1F497D' }, name: 'Tahoma' }; // Navy blue #1F497D matching screenshot
  const fontNormal = { name: 'Tahoma' };
  
  const bgBlueHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF89CFF0' } } as ExcelJS.Fill;
  const bgPlanHighlight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF89CFF0' } } as ExcelJS.Fill; // Matching header color #89CFF0
  const bgYellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } } as ExcelJS.Fill;
  const bgGoldHighlight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } } as ExcelJS.Fill; // Amber/Gold #FFC000 matching screenshot
  const bgWhite = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as ExcelJS.Fill;
  const bgTotalLight = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } } as ExcelJS.Fill;

  // --- Banner Row ---
  const rBanner = sheet.addRow(['Báo Cáo Sản Lượng Hằng Ngày']);
  sheet.mergeCells('A1:M1');
  rBanner.height = 35;
  rBanner.eachCell((cell, colNumber) => {
    if (colNumber <= 13) {
      cell.alignment = alignCenter;
      cell.font = { bold: true, size: 16, name: 'Tahoma' };
      cell.fill = bgYellow;
      cell.border = borderAll;
    }
  });

  // --- Header Table ---
  const r1 = sheet.addRow(['NGÀY', '', '', 'TIME', '', 'Nhân Lực', 'Picking', 'nghỉ', 'Mượn', 'Chuyển hỗ trợ', 'Tổng', 'TEAM', '']);
  sheet.mergeCells('A2:C2');
  sheet.mergeCells('D2:E2');
  sheet.mergeCells('L2:M2');
  r1.height = 25;
  
  r1.eachCell((cell, colNumber) => {
    if (colNumber <= 13) {
      cell.alignment = alignCenter;
      cell.border = borderAll;
      cell.font = fontBold;
      cell.fill = bgBlueHeader;
    }
  });

  const r2 = sheet.addRow([
    reportData.reportDate || '', '', '',
    reportData.timeRange || '', '',
    reportData.manpower || '', 
    reportData.picking || '', 
    reportData.absent || '', 
    reportData.borrowed || '', 
    reportData.transferredSupport || '', 
    reportData.totalManpower || '', 
    reportData.teamName || '', ''
  ]);
  sheet.mergeCells('A3:C3');
  sheet.mergeCells('D3:E3');
  sheet.mergeCells('L3:M3');
  r2.height = 25;

  r2.eachCell((cell, colNumber) => {
    if (colNumber <= 13) {
      cell.alignment = alignCenter;
      cell.border = borderAll;
      cell.font = fontBold;
      cell.fill = bgWhite;
    }
  });

  // --- Bảng 1: Line Summary ---
  const rB1 = sheet.addRow(['LINE', 'CODE', '', '', '', 'Plan', 'Actual', 'Speed/H', 'GAP', 'Chuyển hỗ trợ', 'Tổng', 'TEAM', '']);
  sheet.mergeCells('B4:E4');
  sheet.mergeCells('L4:M4');
  rB1.height = 25;
  
  sheet.getRow(4).eachCell((cell, colNumber) => {
    if (colNumber <= 13) {
      cell.alignment = alignCenter;
      cell.border = borderAll;
      cell.font = fontBold;
      cell.fill = colNumber === 9 ? bgGoldHighlight : bgBlueHeader;
    }
  });

  let currentRow = 5;
  let lineStartRow = currentRow;

  reportData.lineItems.forEach((item, index) => {
    const isFirstOfGroup = index === 0 || reportData.lineItems[index - 1].line !== item.line;
    
    if (isFirstOfGroup) {
      if (index > 0 && lineStartRow < currentRow) {
        sheet.mergeCells(`A${lineStartRow}:A${currentRow - 1}`);
      }
      lineStartRow = currentRow;
    }

    const row = sheet.addRow([
      item.line || '', 
      item.code || '', 
      item.modelName || '', '', '',
      item.plan || '', 
      item.actual || '', 
      item.speedPerHour || '', 
      item.gap || '', 
      item.extra1 || '', 
      item.extra2 || '', 
      item.extra3 || '', ''
    ]);
    row.height = 25;

    sheet.mergeCells(`C${currentRow}:E${currentRow}`);
    sheet.mergeCells(`L${currentRow}:M${currentRow}`);

    // Styling
    row.eachCell((cell, colNumber) => {
      if (colNumber > 13) return;
      cell.alignment = alignCenter;
      cell.border = borderAll;
      cell.font = fontBold;
      cell.fill = bgWhite;
      
      // Line is Brownish
      if (colNumber === 1) cell.font = fontBrownBold;
      // Code is Red
      if (colNumber === 2) cell.font = fontRedBold;
      // Model Name is Brownish
      if (colNumber >= 3 && colNumber <= 5) cell.font = fontBrownBold;
      // Plan is Navy Blue with Light Blue highlight
      if (colNumber === 6) {
        cell.font = fontNavyBold;
        cell.fill = bgPlanHighlight;
      }
      // Actual is Brownish
      if (colNumber === 7) cell.font = fontBrownBold;
      // Speed/H is Brownish
      if (colNumber === 8) cell.font = fontBrownBold;
      
      // GAP column has gold/yellow background #FFC000
      if (colNumber === 9) {
        cell.fill = bgGoldHighlight;
        const gapVal = Number(item.gap) || 0;
        if (item.gap !== undefined && String(item.gap) !== '' && gapVal > 0) {
          cell.value = `+${gapVal}`;
        } else {
          cell.value = item.gap;
        }
      }
    });

    currentRow++;
  });
  if (reportData.lineItems.length > 0 && lineStartRow < currentRow) {
    sheet.mergeCells(`A${lineStartRow}:A${currentRow - 1}`);
  }

  // --- Bảng 1: TOTAL Row ---
  const totalPlanCalc = reportData.lineItems.reduce((sum, item) => sum + (Number(item.plan) || 0), 0);
  const totalActualCalc = reportData.lineItems.reduce((sum, item) => sum + (Number(item.actual) || 0), 0);
  const totalUpperGapCalc = totalActualCalc - totalPlanCalc;

  const finalTotalPlan = reportData.totalUpperPlan !== undefined ? reportData.totalUpperPlan : totalPlanCalc;
  const finalTotalActual = reportData.totalUpperActual !== undefined ? reportData.totalUpperActual : totalActualCalc;
  const finalTotalUpperGap = reportData.totalUpperGap !== undefined ? reportData.totalUpperGap : totalUpperGapCalc;

  const rTotal1 = sheet.addRow([
    'TOTAL', '', '', '', '', 
    finalTotalPlan, 
    finalTotalActual, 
    '', 
    finalTotalUpperGap, 
    reportData.extra1 || '', 
    reportData.extra2 || '', 
    reportData.extra3 || '', ''
  ]);
  sheet.mergeCells(`A${currentRow}:E${currentRow}`);
  sheet.mergeCells(`L${currentRow}:M${currentRow}`);
  rTotal1.height = 25;
  rTotal1.eachCell((cell, colNumber) => {
    if (colNumber > 13) return;
    cell.alignment = alignCenter;
    cell.border = borderAll;
    cell.font = fontBold;
    cell.fill = bgWhite;
    
    if (colNumber <= 5 || colNumber === 7 || colNumber === 8 || colNumber >= 10) {
      cell.fill = bgTotalLight;
    }
    
    if (colNumber === 6) {
      cell.font = fontNavyBold;
      cell.fill = bgPlanHighlight;
    }
    if (colNumber === 7) cell.font = fontBrownBold;
    if (colNumber === 9) { // Gap total bg Gold/Yellow #FFC000
      cell.fill = bgGoldHighlight;
      const gapVal = Number(finalTotalUpperGap) || 0;
      if (finalTotalUpperGap !== undefined && String(finalTotalUpperGap) !== '' && gapVal > 0) {
        cell.value = `+${gapVal}`;
      } else {
        cell.value = finalTotalUpperGap;
      }
    }
  });

  currentRow++;

  // --- Bảng 2: Hourly Logs Header ---
  const headerB2Row = currentRow;
  const rB2 = sheet.addRow([
    'Trọng Lượng PU', 'TC', 'Nhân Lực', 
    'MODEL', 
    'TIME', '', 
    'STT', '', 
    'PCS/H', 'Mục Tiêu', 'Âm/Dương', 'Tình Trạng', 'PIG'
  ]);
  
  sheet.mergeCells(`E${headerB2Row}:F${headerB2Row}`);
  sheet.mergeCells(`G${headerB2Row}:H${headerB2Row}`);
  rB2.height = 32; 

  sheet.getRow(headerB2Row).eachCell((cell) => {
    cell.alignment = alignCenter;
    cell.border = borderAll;
    cell.font = fontBold;
    cell.fill = bgBlueHeader;
  });

  currentRow++;
  let modelStartRow = currentRow;

  reportData.hourlyLogs.forEach((log, index) => {
    const isFirstOfModel = index === 0 || reportData.hourlyLogs[index - 1].modelCode !== log.modelCode;
    
    if (isFirstOfModel) {
      if (index > 0 && modelStartRow < currentRow) {
        sheet.mergeCells(`D${modelStartRow}:D${currentRow - 1}`);
      }
      modelStartRow = currentRow;
    }

    const row = sheet.addRow([
      log.puWeight || '',
      log.tc || '',
      log.manpower || '',
      log.modelCode || '',
      log.timeStart || '',
      log.timeEnd || '',
      log.sttStart || '',
      log.sttEnd || '',
      log.pcsPerHour === undefined || String(log.pcsPerHour) === '' ? '' : log.pcsPerHour,
      log.target === undefined || String(log.target) === '' ? '' : log.target,
      log.variance === undefined || String(log.variance) === '' ? '' : log.variance,
      log.statusNote || '',
      log.pig || ''
    ]);
    row.height = 25;

    row.eachCell((cell, colNumber) => {
      cell.alignment = alignCenter;
      cell.border = borderAll;
      cell.font = fontBold;
      cell.fill = bgWhite;
      
      // Light blue columns for PU Weight, TC, and Manpower
      if (colNumber <= 3) {
        cell.fill = bgBlueHeader;
      }
      if (colNumber === 3) {
        cell.font = fontBlueBold;
      }
      
      // MODEL column is Red
      if (colNumber === 4) {
        cell.font = fontRedBold;
      }
      
      // PCS/H is Blue text
      if (colNumber === 9) {
        cell.font = fontBlueBold;
      }
      
      // Variance is bgGoldHighlight #FFC000 for ALL rows in Bảng 2
      if (colNumber === 11) {
        cell.fill = bgGoldHighlight;
        const varVal = Number(log.variance) || 0;
        if (log.variance !== undefined && String(log.variance) !== '' && varVal > 0) {
          cell.value = `+${varVal}`;
        }
      }

      // Status Note is Red Center-Aligned with wrapText
      if (colNumber === 12) {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.font = { ...fontRedBold, size: 9, name: 'Tahoma' };
      }

      // PIG is Center-Aligned with wrapText
      if (colNumber === 13) {
        const pigStr = String(log.pig || '');
        const isMulti = pigStr.includes('\n') || pigStr.length > 5;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.font = { bold: true, size: isMulti ? 9 : 10, name: 'Tahoma' };
      }
    });

    currentRow++;
  });
  
  if (reportData.hourlyLogs.length > 0 && modelStartRow < currentRow) {
    sheet.mergeCells(`D${modelStartRow}:D${currentRow - 1}`);
  }

  // --- Bảng 2: TOTAL Row ---
  const totalHourlyPcsCalc = reportData.hourlyLogs.reduce((sum, item) => sum + (Number(item.pcsPerHour) || 0), 0);
  const totalHourlyTargetCalc = reportData.hourlyLogs.reduce((sum, item) => sum + (Number(item.target) || 0), 0);
  const totalHourlyVarianceCalc = reportData.hourlyLogs.reduce((sum, item) => sum + (Number(item.variance) || 0), 0);

  const finalHourlyPcs = reportData.totalHourlyPcs !== undefined ? reportData.totalHourlyPcs : totalHourlyPcsCalc;
  const finalHourlyTarget = reportData.totalHourlyTarget !== undefined ? reportData.totalHourlyTarget : totalHourlyTargetCalc;
  const finalHourlyVariance = reportData.totalHourlyVariance !== undefined ? reportData.totalHourlyVariance : totalHourlyVarianceCalc;

  const rTotal2 = sheet.addRow([
    reportData.totalHourlyPU || '',
    reportData.totalHourlyTC || '',
    reportData.totalHourlyManpower || '',
    reportData.totalHourlyLabel || 'TOTAL',
    reportData.totalHourlyTime || '', '',
    reportData.totalHourlySTT || '', '',
    finalHourlyPcs, 
    finalHourlyTarget, 
    finalHourlyVariance, 
    reportData.totalHourlyStatus || '', 
    reportData.totalHourlyPig || ''
  ]);
  
  sheet.mergeCells(`E${currentRow}:F${currentRow}`);
  sheet.mergeCells(`G${currentRow}:H${currentRow}`);
  rTotal2.height = 25;
  
  rTotal2.eachCell((cell, colNumber) => {
    if (colNumber > 13) return;
    cell.alignment = alignCenter;
    cell.border = borderAll;
    cell.font = fontBold;
    cell.fill = bgWhite;

    if (colNumber <= 10) {
      cell.fill = bgTotalLight;
    }

    if (colNumber === 11) {
      cell.fill = bgGoldHighlight;
      const varVal = Number(finalHourlyVariance) || 0;
      if (finalHourlyVariance !== undefined && String(finalHourlyVariance) !== '' && varVal > 0) {
        cell.value = `+${varVal}`;
      } else {
        cell.value = finalHourlyVariance;
      }
    }

    if (colNumber === 12) {
      cell.font = { ...fontRedBold, size: 9, name: 'Tahoma' };
    }
  });

  // Generate Excel file
  const buffer = await workbook.xlsx.writeBuffer();
  const safeDate = (reportData.reportDate || '').replace(/[./\\]/g, '-');
  const safeTeam = (reportData.teamName || '').replace(/\s+/g, '_');
  saveAs(new Blob([buffer]), `Bao_Cao_San_Luong_${safeDate}_${safeTeam}.xlsx`);
};
