import { createContext, useContext } from 'react';

export const WordLookupContext = createContext({ openWordLookup: () => {} });
export function useWordLookup() {
  return useContext(WordLookupContext);
}
