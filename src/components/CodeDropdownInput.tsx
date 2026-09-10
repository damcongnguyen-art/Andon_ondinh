import React, { useState, useRef, useEffect } from 'react';
import { ProductMasterItem } from '../types';

interface CodeDropdownInputProps {
  value: string;
  onChange: (code: string) => void;
  onSelectProduct: (product: ProductMasterItem) => void;
  catalog: ProductMasterItem[];
  lineFilter?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export const CodeDropdownInput: React.FC<CodeDropdownInputProps> = ({
  value,
  onChange,
  onSelectProduct,
  catalog,
  lineFilter,
  placeholder = 'Gõ mã...',
  className = '',
  inputClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Sync internal query when value prop changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Filter catalog by lineFilter if specified
  const catalogByLine = React.useMemo(() => {
    if (!lineFilter || !lineFilter.trim()) return catalog;
    const cleanLine = lineFilter.trim().toLowerCase();
    const matched = catalog.filter(
      (item) => item.defaultLine && item.defaultLine.trim().toLowerCase() === cleanLine
    );
    // Return matched line products if found, otherwise fallback to full catalog
    return matched.length > 0 ? matched : catalog;
  }, [catalog, lineFilter]);

  // Filter catalogByLine items based on input query
  const filteredItems = catalogByLine.filter((item) => {
    if (!query) return true;
    const cleanQuery = query.trim().toLowerCase();
    return (
      item.code.toLowerCase().includes(cleanQuery) ||
      item.modelName.toLowerCase().includes(cleanQuery)
    );
  });

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Ensure highlighted item is in view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  // Select item action
  const handleSelect = (item: ProductMasterItem) => {
    setQuery(item.code);
    onChange(item.code);
    onSelectProduct(item);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  // Keyboard navigation & Enter commit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) =>
          prev < filteredItems.length - 1 ? prev + 1 : 0
        );
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(filteredItems.length - 1);
      } else {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredItems.length - 1
        );
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && filteredItems.length > 0) {
        const chosen = filteredItems[highlightedIndex] || filteredItems[0];
        if (chosen) {
          handleSelect(chosen);
          return;
        }
      }

      // If user typed custom code and hit Enter
      const matched = catalog.find(
        (c) => c.code.trim().toLowerCase() === query.trim().toLowerCase()
      );
      if (matched) {
        handleSelect(matched);
      } else if (query.trim()) {
        onChange(query.trim());
        setIsOpen(false);
        inputRef.current?.blur();
      } else {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      if (isOpen && filteredItems.length > 0) {
        const chosen = filteredItems[highlightedIndex] || filteredItems[0];
        if (chosen) {
          handleSelect(chosen);
        }
      }
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative inline-block w-full ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => {
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onChange={(e) => {
          const val = e.target.value;
          setQuery(val);
          onChange(val);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full text-center text-red-600 font-bold font-mono border-none bg-transparent focus:outline-none focus:bg-yellow-50 selection:bg-red-100 ${inputClassName}`}
      />

      {/* Floating Suggestions Dropdown (Only appears when typing / focusing) */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 mt-1 min-w-[260px] max-w-sm bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 text-left">
          <ul ref={listRef} className="max-h-60 overflow-y-auto divide-y divide-slate-50 text-xs">
            {filteredItems.length === 0 ? (
              <li className="px-4 py-3 text-center text-slate-400 text-xs">
                Không tìm thấy mã nào phù hợp. Nhấn <strong>Enter</strong> để dùng mã này.
              </li>
            ) : (
              filteredItems.map((item, index) => {
                const isSelected = index === highlightedIndex;

                return (
                  <li
                    key={item.id ? `dd-${item.id}-${index}` : `dd-${item.code}-${index}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleSelect(item)}
                    className={`px-4 py-2.5 cursor-pointer transition-colors flex flex-col text-left ${
                      isSelected
                        ? 'bg-amber-50 text-slate-900 font-semibold'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <span className="font-mono font-bold text-red-600 text-sm">
                      {item.code}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
