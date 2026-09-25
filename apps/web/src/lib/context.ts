import { createContext, useContext } from 'react';
import type { Source } from './source.js';
import { mockSource } from './mock.js';

export const SourceContext = createContext<Source>(mockSource);
export const useSource = () => useContext(SourceContext);
