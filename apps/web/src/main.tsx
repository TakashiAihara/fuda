import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles.css';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // Everything that changes arrives on the event stream as a signal to
      // refetch, so refetching on focus would only repeat work the screen does
      // on its own.
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const root = document.getElementById('root');

if (root === null) throw new Error('there is no #root to mount into');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
