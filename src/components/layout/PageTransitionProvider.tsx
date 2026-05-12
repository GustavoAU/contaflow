"use client";

import { createContext, useCallback, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";

type PageTransitionContextValue = {
  isPending: boolean;
  navigate: (href: string) => void;
  replace: (href: string) => void;
};

const PageTransitionContext = createContext<PageTransitionContextValue>({
  isPending: false,
  navigate: () => {},
  replace: () => {},
});

export function usePageTransition() {
  return useContext(PageTransitionContext);
}

export function PageTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => router.push(href));
    },
    [router],
  );

  const replace = useCallback(
    (href: string) => {
      startTransition(() => router.replace(href));
    },
    [router],
  );

  return (
    <PageTransitionContext.Provider value={{ isPending, navigate, replace }}>
      {children}
    </PageTransitionContext.Provider>
  );
}
