import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'

const rawKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const isPlaceholder = !rawKey || rawKey.includes('your_clerk_publishable_key_here') || rawKey.trim() === '';
const publishableKey = isPlaceholder
  ? 'pk_test_cG9zaXRpdmUta2l0dGVuLTc5LmNsZXJrLmFjY291bnRzLmRldiQ'
  : rawKey;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </React.StrictMode>,
)