import { useEffect, RefObject } from 'react';

interface GlobalKeyboardOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  setCurrentView?: (view: string) => void;
  toggleSidebar?: () => void;
  toggleAgentPanel?: () => void;
}

export function useGlobalKeyboard(options: GlobalKeyboardOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Cmd+K / Ctrl+K - focus search (always)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        options.searchInputRef.current?.focus();
        return;
      }

      // Escape - blur search
      if (e.key === 'Escape') {
        if (document.activeElement === options.searchInputRef.current) {
          options.searchInputRef.current?.blur();
        }
        return;
      }

      // Skip number/bracket shortcuts when input focused
      if (isInputFocused) return;

      switch (e.key) {
        case '1': options.setCurrentView?.('overview'); break;
        case '2': options.setCurrentView?.('project-list'); break;
        case '3': options.setCurrentView?.('history'); break;
        case '4': options.setCurrentView?.('settings'); break;
        case '[': options.toggleSidebar?.(); break;
        case ']': options.toggleAgentPanel?.(); break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [options]);
}
