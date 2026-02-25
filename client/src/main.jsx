import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'

const publishableKey = 'pk_test_cG9zaXRpdmUta2l0dGVuLTc5LmNsZXJrLmFjY291bnRzLmRldiQ' // Paste your key here directly

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </React.StrictMode>,
)