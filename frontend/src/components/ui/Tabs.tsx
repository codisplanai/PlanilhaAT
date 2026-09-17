import React, { useId, useRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

type TabId = string | number;

export interface TabItem<T extends TabId = TabId> {
  id: T;
  label: string;
  count?: number;
  badge?: React.ReactNode;
}

export interface TabsProps<T extends TabId = TabId> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  className?: string;
  variant?: 'underline' | 'pills';
  ariaLabel?: string;
}

export function Tabs<T extends TabId>({
  tabs,
  activeTab,
  onChange,
  className,
  variant = 'underline',
  ariaLabel = 'Navegação por abas',
}: TabsProps<T>) {
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const tablistId = useId();

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab) {
      onChange(nextTab.id);
      tabsRef.current[nextIndex]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={twMerge(
        clsx(
          'flex gap-1 overflow-x-auto pb-0.5 no-scrollbar select-none',
          variant === 'underline' && 'border-b border-slate-200/90',
          className
        )
      )}
    >
      {tabs.map((tab, idx) => {
        const isSelected = tab.id === activeTab;
        const tabId = `${tablistId}-tab-${tab.id}`;
        const panelId = `${tablistId}-panel-${tab.id}`;

        return (
          <button
            key={tab.id}
            id={tabId}
            ref={(el) => { tabsRef.current[idx] = el; }}
            role="tab"
            aria-selected={isSelected}
            aria-controls={panelId}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={clsx(
              'px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all duration-150 flex items-center gap-2 cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1',
              variant === 'underline' && [
                'border-b-2',
                isSelected
                  ? 'border-blue-600 text-blue-900 bg-blue-50/50 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/60',
              ],
              variant === 'pills' && [
                'rounded-lg',
                isSelected
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              ]
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={clsx(
                  'text-[10px] px-2 py-0.5 rounded-full font-mono font-bold',
                  isSelected
                    ? 'bg-blue-200/80 text-blue-900'
                    : 'bg-slate-200/80 text-slate-700'
                )}
              >
                {tab.count}
              </span>
            )}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
