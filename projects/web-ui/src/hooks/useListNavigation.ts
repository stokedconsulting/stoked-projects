import { useState, useCallback } from 'react';

export function useListNavigation(itemCount: number) {
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, itemCount - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        // handled by consumer
        break;
    }
  }, [itemCount]);

  return { focusedIndex, setFocusedIndex, handleKeyDown };
}
