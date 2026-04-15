import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

type Ctx = { markReady: () => void };

const RootShellReadyContext = createContext<Ctx | null>(null);

/**
 * À placer une fois sous le splash (ex. autour du contenu principal).
 * `onReady` est idempotent (une seule prise en compte).
 */
export function RootShellReadyProvider({
  children,
  onReady,
}: {
  children: React.ReactNode;
  onReady: () => void;
}) {
  const doneRef = useRef(false);
  const markReady = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onReady();
  }, [onReady]);
  const value = useMemo(() => ({ markReady }), [markReady]);
  return (
    <RootShellReadyContext.Provider value={value}>
      {children}
    </RootShellReadyContext.Provider>
  );
}

/** Appeler sur l’écran d’accueil : 1er layout → le splash peut partir sans flash blanc. */
export function useMarkRootShellReady() {
  const ctx = useContext(RootShellReadyContext);
  useLayoutEffect(() => {
    ctx?.markReady();
  }, [ctx]);
}
