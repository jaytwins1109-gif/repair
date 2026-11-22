import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface CaseFilterState {
  customer: string;
  model: string;
  category: string;
  status: string;
  source: string;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
}

export const INITIAL_CASE_FILTERS: CaseFilterState = {
  customer: '',
  model: '',
  category: '',
  status: '',
  source: '',
  q: '',
  sort: 'repaired_at',
  order: 'desc',
  page: 1,
};

type FilterKey = keyof CaseFilterState;

interface CaseFiltersContextValue {
  filters: CaseFilterState;
  setFilter: <K extends FilterKey>(key: K, value: CaseFilterState[K]) => void;
  /** 移除单个已选标签 */
  clearOne: (key: FilterKey) => void;
  /** 全部重置：清空所有筛选条件、恢复默认排序、回到第一页 */
  reset: () => void;
}

const CaseFiltersContext = createContext<CaseFiltersContextValue | null>(null);

/**
 * 筛选状态放在 AppShell 常驻层，而不是 CasesPage 组件内：
 * 切到别的导航页再回案例库，级联条件、关键字、排序、分页都不丢。
 */
export function CaseFiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<CaseFilterState>(INITIAL_CASE_FILTERS);

  const setFilter = useCallback(<K extends FilterKey>(key: K, value: CaseFilterState[K]) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      // 筛选条件一变，分页回到第一页，避免停在第 3 页看到空列表
      page: key === 'page' ? (value as number) : 1,
    }));
  }, []);

  const clearOne = useCallback((key: FilterKey) => {
    setFilters((prev) => ({ ...prev, [key]: INITIAL_CASE_FILTERS[key], page: 1 }));
  }, []);

  const reset = useCallback(() => setFilters(INITIAL_CASE_FILTERS), []);

  return (
    <CaseFiltersContext.Provider value={{ filters, setFilter, clearOne, reset }}>
      {children}
    </CaseFiltersContext.Provider>
  );
}

export function useCaseFilters(): CaseFiltersContextValue {
  const ctx = useContext(CaseFiltersContext);
  if (!ctx) throw new Error('useCaseFilters 必须在 CaseFiltersProvider 内使用');
  return ctx;
}
