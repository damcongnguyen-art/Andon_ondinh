import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { ProductMasterItem } from '../types';
import {
  FileSpreadsheet,
  Upload,
  Search,
  Check,
  RotateCcw,
} from 'lucide-react';

interface ProductCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalog: ProductMasterItem[];
  onUpdateCatalog: (newCatalog: ProductMasterItem[]) => void;
  onResetCatalog: () => void;
}

export const ProductCatalogModal: React.FC<ProductCatalogModalProps> = ({
  isOpen,
  onClose,
  catalog,
  onUpdateCatalog,
  onResetCatalog,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  // Filter catalog
  const filteredCatalog = catalog.filter(
    (item) =>
      item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.modelName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.defaultLine && item.defaultLine.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Handle Excel (.xlsx, .xls, .csv) File Upload using 2D Array parsing
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Parse raw rows as 2D Array (header: 1) to safely handle duplicate column names
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });

        if (!rows || rows.length < 2) {
          setImportStatus('File Excel trống hoặc không đúng định dạng!');
          return;
        }

        // Header row (Row 0)
        const headerRow = (rows[0] || []).map((cell: any) => String(cell || '').trim());

        // Find indices of all columns containing/titled "Model" (from left to right)
        const modelIndices: number[] = [];
        headerRow.forEach((cell, idx) => {
          const clean = cell.toLowerCase();
          if (clean.includes('model') || clean.includes('tên') || clean.includes('quy cách')) {
            modelIndices.push(idx);
          }
        });

        // Column index for Code
        let codeIdx = headerRow.findIndex((cell) => {
          const clean = cell.toLowerCase();
          return clean.includes('code') || clean.includes('mã') || clean.includes('item');
        });
        if (codeIdx === -1) codeIdx = 0;

        // 1st Model column index -> Tên Model
        const firstModelIdx = modelIndices[0] !== undefined ? modelIndices[0] : (codeIdx === 0 ? 1 : 0);

        // 2nd Model column index (thứ 2 từ trái sang phải) -> Ánh xạ thành Cột Line
        let secondModelIdx = modelIndices[1];
        if (secondModelIdx === undefined) {
          // Check fallback explicit "Line" header if second Model header isn't named Model
          const lineIdx = headerRow.findIndex((cell) => cell.toLowerCase().includes('line'));
          if (lineIdx !== -1) secondModelIdx = lineIdx;
        }

        // Column index for Speed
        let speedIdx = headerRow.findIndex((cell) => {
          const clean = cell.toLowerCase();
          return clean.includes('speed') || clean.includes('tốc độ') || clean.includes('target') || clean.includes('định mức');
        });

        const parsedItems: ProductMasterItem[] = [];

        for (let r = 1; r < rows.length; r++) {
          const rowData = rows[r];
          if (!rowData || rowData.length === 0) continue;

          const codeVal = String(rowData[codeIdx] || '').trim();
          const modelVal = String(rowData[firstModelIdx] || '').trim();

          // Exactly extract Line value from the 2nd Model column without hardcoded fallbacks
          let lineVal = '';
          if (secondModelIdx !== undefined && rowData[secondModelIdx] !== undefined) {
            lineVal = String(rowData[secondModelIdx] || '').trim();
          }

          let speedVal = 70;
          if (speedIdx !== -1 && rowData[speedIdx] !== undefined) {
            const parsedSpeed = Number(rowData[speedIdx]);
            if (!isNaN(parsedSpeed) && parsedSpeed > 0) {
              speedVal = parsedSpeed;
            }
          }

          if (codeVal && codeVal.length > 0) {
            parsedItems.push({
              id: `excel-import-${r}-${Date.now()}`,
              code: codeVal,
              modelName: modelVal || codeVal,
              speedPerHour: speedVal,
              defaultLine: lineVal,
            });
          }
        }

        if (parsedItems.length > 0) {
          onUpdateCatalog(parsedItems);
          setImportStatus(`Đã nạp thành công ${parsedItems.length} mã hàng từ File Root!`);
        } else {
          setImportStatus('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
        }
      } catch (err) {
        console.error('File parse error:', err);
        setImportStatus('Lỗi khi đọc file Excel! Vui lòng chọn đúng file .xlsx hoặc .xls');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      {/* Hidden File Input for Direct Memory Picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx, .xls, .csv"
        onChange={handleFileUpload}
        className="hidden"
      />

      <div className="bg-white rounded-2xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                Quản Lý Dữ Liệu File Root (Mã Hàng & Speed/H)
              </h3>
              <p className="text-xs text-slate-500">
                Tự động điền Tên Model và Speed/H từ File Root khi gõ Mã Code
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold p-1 text-base cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Action Header & Direct File Picker Button */}
        <div className="flex items-center justify-between gap-2 my-3 border-b border-slate-100 pb-2 text-xs">
          <div className="font-bold text-slate-700 text-xs">
            Danh Sách Mã Trong File Root ({catalog.length})
          </div>

          <button
            onClick={() => {
              setImportStatus(null);
              fileInputRef.current?.click();
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-xs cursor-pointer active:scale-95"
            title="Mở ngay trình chọn file trong bộ nhớ máy để tải file Root (.xlsx)"
          >
            <Upload className="w-3.5 h-3.5" />
            Tải Lên File Root (.xlsx)
          </button>
        </div>

        {/* Status notice */}
        {importStatus && (
          <div className="mb-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              {importStatus}
            </span>
            <button
              onClick={() => setImportStatus(null)}
              className="text-emerald-600 hover:text-emerald-800 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Main Catalog View */}
        <div className="flex-1 flex flex-col min-h-0 space-y-3">
          {/* Search Bar */}
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              placeholder="Tìm theo Mã Code, Tên Model, Line..."
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-emerald-500 bg-slate-50"
            />
          </div>

          {/* Catalog Table */}
          <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl min-h-[240px] max-h-[380px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">STT</th>
                  <th className="py-2 px-3">MÃ CODE</th>
                  <th className="py-2 px-3">TÊN MODEL</th>
                  <th className="py-2 px-3 text-center">SPEED/H</th>
                  <th className="py-2 px-3 text-center">LINE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCatalog.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-400 text-xs">
                      Không tìm thấy mã hàng nào phù hợp trong File Root. Bấm <strong>Tải Lên File Root (.xlsx)</strong> để tải file từ thiết bị.
                    </td>
                  </tr>
                ) : (
                  filteredCatalog.map((item, idx) => (
                    <tr key={item.id ? `cat-${item.id}-${idx}` : `cat-${item.code}-${idx}`} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 font-mono text-slate-400">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono font-bold text-red-600">
                        {item.code}
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-800 uppercase">
                        {item.modelName}
                      </td>
                      <td className="py-2 px-3 text-center font-bold text-blue-700">
                        {item.speedPerHour}
                      </td>
                      <td className="py-2 px-3 text-center font-bold text-slate-700">
                        {item.defaultLine || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={onResetCatalog}
            className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Khôi phục danh mục mẫu ban đầu
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
