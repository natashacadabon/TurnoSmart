'use client';

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

type UnsavedChanges = {
  setDirty: (dirty: boolean) => void;
  allowNavigation: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChanges>({
  setDirty: () => undefined,
  allowNavigation: () => true,
});

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const allowNavigation = useCallback(
    () =>
      !dirty.current ||
      window.confirm('Hay cambios de disponibilidad sin guardar. ¿Salir de la pantalla?'),
    [],
  );
  const value = useMemo(() => ({ setDirty, allowNavigation }), [setDirty, allowNavigation]);
  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}
